// Coletor de saúde do PC (t-16393812). Um processo só, sem janela (winexe), que a cada minuto mede CPU, RAM, arquivo de
// paginação, disco, rede, carga equivalente e sessões Claude, guarda a linha em %LOCALAPPDATA%\donel-saude\pendente.jsonl
// e manda as pendentes à VPS pessoal por ssh (saude_receber.sh pc), que as grava no Supabase (schema saude).
//
// Compila com o csc do .NET Framework 4.x que vem no Windows (só C# 5):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize+ /out:saude-coletor.exe saude-coletor.cs
// Argumentos: (nenhum) = laço; --uma-vez = mede por 3 s, grava ultima-amostra.json e sai (não envia).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace DonelSaude
{
    internal static class Program
    {
        // ---------------------------------------------------------------- Win32
        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME { public uint Low; public uint High; }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

        [StructLayout(LayoutKind.Sequential)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
            public MEMORYSTATUSEX() { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)); }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX buffer);

        [DllImport("ntdll.dll")]
        private static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int returnLength);

        [StructLayout(LayoutKind.Explicit)]
        private struct PDH_FMT_COUNTERVALUE
        {
            [FieldOffset(0)] public uint CStatus;
            [FieldOffset(8)] public double DoubleValue;
        }

        [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
        private static extern uint PdhOpenQuery(string dataSource, IntPtr userData, out IntPtr query);

        [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
        private static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr userData, out IntPtr counter);

        [DllImport("pdh.dll")]
        private static extern uint PdhCollectQueryData(IntPtr query);

        [DllImport("pdh.dll")]
        private static extern uint PdhGetFormattedCounterValue(IntPtr counter, uint format, IntPtr type, out PDH_FMT_COUNTERVALUE value);

        private const uint PDH_FMT_DOUBLE = 0x00000200;
        private const int SystemPageFileInformation = 18;
        private const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);

        // ---------------------------------------------------------------- estado
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static string _dir;
        private static string _log;
        private static IntPtr _pdhQuery = IntPtr.Zero;
        private static IntPtr _pdhQueue = IntPtr.Zero;
        private static ulong _cpuIdle, _cpuTotal;          // para o % do minuto
        private static ulong _ldIdle, _ldTotal;            // para a carga a cada 5 s
        private static long _netRx, _netTx;
        private static DateTime _netAt;
        private static double _load1, _load5, _load15;
        private static DateTime _loadAt;
        private static bool _loadInit;
        private static readonly Dictionary<string, string> Cfg = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        [STAThread]
        private static int Main(string[] args)
        {
            _dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "donel-saude");
            Directory.CreateDirectory(_dir);
            _log = Path.Combine(_dir, "coletor.log");
            bool umaVez = args.Length > 0 && args[0] == "--uma-vez";

            bool criado;
            using (Mutex mtx = new Mutex(true, umaVez ? @"Local\DonelSaudeColetorTeste" : @"Local\DonelSaudeColetor", out criado))
            {
                if (!criado) return 0; // já há um coletor rodando
                try
                {
                    LerConfig();
                    IniciarPdh();
                    ulong i0, t0;
                    LerCpu(out i0, out t0);
                    _cpuIdle = i0; _cpuTotal = t0; _ldIdle = i0; _ldTotal = t0;
                    LerRede(out _netRx, out _netTx);
                    _netAt = DateTime.UtcNow;
                    if (umaVez)
                    {
                        for (int k = 0; k < 3; k++) { Thread.Sleep(1000); AtualizarCarga(); }
                        string linha = Amostra(DateTime.UtcNow);
                        File.WriteAllText(Path.Combine(_dir, "ultima-amostra.json"), linha, new UTF8Encoding(false));
                        return 0;
                    }
                    Log("iniciado");
                    Laco();
                }
                catch (Exception e)
                {
                    Log("erro fatal: " + e.GetType().Name + ": " + e.Message);
                    return 1;
                }
            }
            return 0;
        }

        private static void Laco()
        {
            int ultimoMinuto = DateTime.UtcNow.Minute;
            while (true)
            {
                Thread.Sleep(5000);
                AtualizarCarga();
                DateTime agora = DateTime.UtcNow;
                if (agora.Minute == ultimoMinuto) continue;
                ultimoMinuto = agora.Minute;
                try
                {
                    string linha = Amostra(agora);
                    File.WriteAllText(Path.Combine(_dir, "ultima-amostra.json"), linha, new UTF8Encoding(false));
                    Enfileirar(linha);
                    Enviar();
                }
                catch (Exception e)
                {
                    Log("erro na amostra: " + e.GetType().Name + ": " + e.Message);
                }
            }
        }

        // ---------------------------------------------------------------- config e log
        private static void LerConfig()
        {
            Cfg["ssh_exe"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"OpenSSH\ssh.exe");
            Cfg["ssh_chave"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".ssh\id_ed25519");
            Cfg["destino"] = "alexandrelentz@100.110.135.26";
            Cfg["porta"] = "2222"; // a 22 da VPS passa pelo check do Tailscale SSH e trava em BatchMode (17/11)
            Cfg["comando_remoto"] = "/home/alexandrelentz/bin/rotinas/saude/saude_receber.sh pc";
            string ini = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "saude-coletor.ini");
            if (!File.Exists(ini)) return;
            foreach (string bruta in File.ReadAllLines(ini))
            {
                string l = bruta.Trim();
                if (l.Length == 0 || l.StartsWith("#") || l.StartsWith(";")) continue;
                int i = l.IndexOf('=');
                if (i > 0) Cfg[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim();
            }
        }

        private static void Log(string msg)
        {
            try
            {
                FileInfo fi = new FileInfo(_log);
                if (fi.Exists && fi.Length > 200 * 1024)
                {
                    string velho = _log + ".1";
                    if (File.Exists(velho)) File.Delete(velho);
                    File.Move(_log, velho);
                }
                File.AppendAllText(_log, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", Inv) + " " + msg + "\r\n");
            }
            catch (Exception)
            {
                // log é melhor esforço
            }
        }

        // ---------------------------------------------------------------- medidas
        private static ulong Ft(FILETIME f) { return ((ulong)f.High << 32) | f.Low; }

        private static void LerCpu(out ulong idle, out ulong total)
        {
            FILETIME fi, fk, fu;
            if (!GetSystemTimes(out fi, out fk, out fu)) { idle = 0; total = 0; return; }
            idle = Ft(fi);
            total = Ft(fk) + Ft(fu); // o tempo de kernel já inclui o ocioso
        }

        private static void IniciarPdh()
        {
            try
            {
                if (PdhOpenQuery(null, IntPtr.Zero, out _pdhQuery) != 0) { _pdhQuery = IntPtr.Zero; return; }
                if (PdhAddEnglishCounter(_pdhQuery, @"\System\Processor Queue Length", IntPtr.Zero, out _pdhQueue) != 0) _pdhQueue = IntPtr.Zero;
            }
            catch (Exception)
            {
                _pdhQuery = IntPtr.Zero; _pdhQueue = IntPtr.Zero;
            }
        }

        private static double FilaProcessador()
        {
            if (_pdhQuery == IntPtr.Zero || _pdhQueue == IntPtr.Zero) return 0;
            try
            {
                if (PdhCollectQueryData(_pdhQuery) != 0) return 0;
                PDH_FMT_COUNTERVALUE v;
                if (PdhGetFormattedCounterValue(_pdhQueue, PDH_FMT_DOUBLE, IntPtr.Zero, out v) != 0) return 0;
                return v.DoubleValue < 0 ? 0 : v.DoubleValue;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        // Carga equivalente ao load average do Linux: n = CPU ocupada × núcleos + fila do processador, com médias
        // exponenciais de 1, 5 e 15 min pelo tempo real decorrido.
        private static void AtualizarCarga()
        {
            ulong idle, total;
            LerCpu(out idle, out total);
            DateTime agora = DateTime.UtcNow;
            ulong dTot = total - _ldTotal;
            double ocupada = dTot > 0 ? 1.0 - (double)(idle - _ldIdle) / dTot : 0;
            if (ocupada < 0) ocupada = 0;
            if (ocupada > 1) ocupada = 1;
            _ldIdle = idle; _ldTotal = total;
            double n = ocupada * Environment.ProcessorCount + FilaProcessador();
            if (!_loadInit)
            {
                _load1 = n; _load5 = n; _load15 = n; _loadAt = agora; _loadInit = true;
                return;
            }
            double dt = (agora - _loadAt).TotalSeconds;
            _loadAt = agora;
            if (dt <= 0) return;
            _load1 = Ema(_load1, n, dt, 60);
            _load5 = Ema(_load5, n, dt, 300);
            _load15 = Ema(_load15, n, dt, 900);
        }

        private static double Ema(double atual, double n, double dt, double periodo)
        {
            double e = Math.Exp(-dt / periodo);
            return atual * e + n * (1 - e);
        }

        private static void LerRede(out long rx, out long tx)
        {
            rx = 0; tx = 0;
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    if (ni.Name.StartsWith("vEthernet", StringComparison.OrdinalIgnoreCase)) continue; // Hyper-V/WSL contaria em dobro
                    IPInterfaceStatistics s = ni.GetIPStatistics();
                    rx += s.BytesReceived;
                    tx += s.BytesSent;
                }
            }
            catch (Exception)
            {
                // sem rede legível: zera
            }
        }

        // Arquivo de paginação: soma TotalSize e TotalInUse (páginas) de cada arquivo. -1 se não der para ler.
        private static void LerPaginacao(out long totalMb, out long usadaMb)
        {
            totalMb = -1; usadaMb = -1;
            int tam = 4096;
            for (int tentativa = 0; tentativa < 4; tentativa++)
            {
                IntPtr buf = Marshal.AllocHGlobal(tam);
                try
                {
                    int ret;
                    int st = NtQuerySystemInformation(SystemPageFileInformation, buf, tam, out ret);
                    if (st == STATUS_INFO_LENGTH_MISMATCH) { tam = Math.Max(tam * 2, ret); continue; }
                    if (st != 0) return;
                    long tot = 0, uso = 0;
                    if (ret == 0) { totalMb = 0; usadaMb = 0; return; } // sem arquivo de paginação
                    int off = 0;
                    while (true)
                    {
                        uint prox = (uint)Marshal.ReadInt32(buf, off);
                        tot += (uint)Marshal.ReadInt32(buf, off + 4);
                        uso += (uint)Marshal.ReadInt32(buf, off + 8);
                        if (prox == 0) break;
                        off += (int)prox;
                        if (off <= 0 || off >= tam) break;
                    }
                    long pagina = Environment.SystemPageSize;
                    totalMb = tot * pagina / (1024 * 1024);
                    usadaMb = uso * pagina / (1024 * 1024);
                    return;
                }
                catch (Exception)
                {
                    return;
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
        }

        private static string Amostra(DateTime agoraUtc)
        {
            DateTime em = new DateTime(agoraUtc.Year, agoraUtc.Month, agoraUtc.Day, agoraUtc.Hour, agoraUtc.Minute, 0, DateTimeKind.Utc);

            ulong idle, total;
            LerCpu(out idle, out total);
            ulong dTot = total - _cpuTotal;
            double cpu = dTot > 0 ? 100.0 * (1.0 - (double)(idle - _cpuIdle) / dTot) : 0;
            cpu = Math.Max(0, Math.Min(100, cpu));
            _cpuIdle = idle; _cpuTotal = total;

            MEMORYSTATUSEX m = new MEMORYSTATUSEX();
            GlobalMemoryStatusEx(m);
            long ramTot = (long)(m.ullTotalPhys / (1024 * 1024));
            long ramUsada = (long)((m.ullTotalPhys - m.ullAvailPhys) / (1024 * 1024));

            long swTot, swUsada;
            LerPaginacao(out swTot, out swUsada);

            string sysRoot = Path.GetPathRoot(Environment.SystemDirectory);
            double dTotGb = 0, dUsadoGb = 0, dPct = 0;
            StringBuilder discos = new StringBuilder();
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                    double t = d.TotalSize / 1e9;
                    double u = (d.TotalSize - d.TotalFreeSpace) / 1e9;
                    double p = t > 0 ? 100.0 * u / t : 0;
                    if (string.Equals(d.Name, sysRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        dTotGb = t; dUsadoGb = u; dPct = p;
                    }
                    if (discos.Length > 0) discos.Append(',');
                    discos.Append("{\"nome\":").Append(Str(d.Name.TrimEnd('\\'))).Append(",\"total_gb\":").Append(Num(t, 1))
                          .Append(",\"pct\":").Append(Num(p, 1)).Append('}');
                }
                catch (Exception)
                {
                    // disco que some no meio da leitura
                }
            }

            long rx, tx;
            LerRede(out rx, out tx);
            double dt = (agoraUtc - _netAt).TotalSeconds;
            if (dt < 1) dt = 1;
            double rxKb = Math.Max(0, rx - _netRx) / 1024.0 / dt;
            double txKb = Math.Max(0, tx - _netTx) / 1024.0 / dt;
            _netRx = rx; _netTx = tx; _netAt = agoraUtc;

            int sessoes = 0;
            Dictionary<string, long> porNome = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            Process[] procs = Process.GetProcesses();
            foreach (Process p in procs)
            {
                try
                {
                    string nome = p.ProcessName;
                    long ws = p.WorkingSet64;
                    if (string.Equals(nome, "claude", StringComparison.OrdinalIgnoreCase)) sessoes++;
                    long acc;
                    porNome.TryGetValue(nome, out acc);
                    porNome[nome] = acc + ws;
                }
                catch (Exception)
                {
                    // processo que saiu
                }
                finally
                {
                    p.Dispose();
                }
            }
            List<KeyValuePair<string, long>> lista = new List<KeyValuePair<string, long>>(porNome);
            lista.Sort(delegate(KeyValuePair<string, long> a, KeyValuePair<string, long> b) { return b.Value.CompareTo(a.Value); });
            StringBuilder top = new StringBuilder();
            for (int i = 0; i < lista.Count && i < 5; i++)
            {
                if (i > 0) top.Append(',');
                top.Append("{\"nome\":").Append(Str(lista[i].Key)).Append(",\"mb\":").Append((lista[i].Value / (1024 * 1024)).ToString(Inv)).Append('}');
            }

            double proprioMb, privadaMb;
            using (Process eu = Process.GetCurrentProcess())
            {
                eu.Refresh();
                proprioMb = eu.WorkingSet64 / (1024.0 * 1024.0);
                privadaMb = eu.PrivateMemorySize64 / (1024.0 * 1024.0);
            }

            StringBuilder j = new StringBuilder(1024);
            j.Append('{');
            Campo(j, "maquina", Str("pc"));
            Campo(j, "em", Str(em.ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss'Z'", Inv)));
            Campo(j, "cpu_pct", Num(cpu, 1));
            Campo(j, "carga1", Num(_load1, 2));
            Campo(j, "carga5", Num(_load5, 2));
            Campo(j, "carga15", Num(_load15, 2));
            Campo(j, "ncpu", Environment.ProcessorCount.ToString(Inv));
            Campo(j, "ram_total_mb", ramTot.ToString(Inv));
            Campo(j, "ram_usada_mb", ramUsada.ToString(Inv));
            Campo(j, "ram_pct", ramTot > 0 ? Num(100.0 * ramUsada / ramTot, 1) : "null");
            Campo(j, "swap_total_mb", swTot >= 0 ? swTot.ToString(Inv) : "null");
            Campo(j, "swap_usada_mb", swUsada >= 0 ? swUsada.ToString(Inv) : "null");
            Campo(j, "swap_pct", swTot > 0 ? Num(100.0 * swUsada / swTot, 1) : (swTot == 0 ? "0" : "null"));
            Campo(j, "disco_total_gb", Num(dTotGb, 1));
            Campo(j, "disco_usado_gb", Num(dUsadoGb, 1));
            Campo(j, "disco_pct", Num(dPct, 1));
            Campo(j, "rede_rx_kb_s", Num(rxKb, 1));
            Campo(j, "rede_tx_kb_s", Num(txKb, 1));
            Campo(j, "sessoes_claude", sessoes.ToString(Inv));
            Campo(j, "coletor_rss_mb", Num(proprioMb, 1));
            j.Append("\"extra\":{\"top\":[").Append(top).Append("],\"discos\":[").Append(discos)
             .Append("],\"carga\":\"equivalente\",\"coletor_privada_mb\":").Append(Num(privadaMb, 1)).Append("}}");
            return j.ToString();
        }

        private static void Campo(StringBuilder j, string nome, string valor)
        {
            j.Append('"').Append(nome).Append("\":").Append(valor).Append(',');
        }

        private static string Num(double v, int casas)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
            return Math.Round(v, casas).ToString("0.##########", Inv);
        }

        // JSON só em ASCII: tudo fora de 0x20..0x7E vira \uXXXX.
        private static string Str(string s)
        {
            StringBuilder b = new StringBuilder(s.Length + 2);
            b.Append('"');
            foreach (char c in s)
            {
                if (c == '"') b.Append("\\\"");
                else if (c == '\\') b.Append("\\\\");
                else if (c < 0x20 || c > 0x7E) b.Append("\\u").Append(((int)c).ToString("x4", Inv));
                else b.Append(c);
            }
            b.Append('"');
            return b.ToString();
        }

        // ---------------------------------------------------------------- fila e envio
        private static string Pendente() { return Path.Combine(_dir, "pendente.jsonl"); }

        private static void Enfileirar(string linha)
        {
            string p = Pendente();
            File.AppendAllText(p, linha + "\n", new UTF8Encoding(false));
            FileInfo fi = new FileInfo(p);
            if (fi.Length > 4 * 1024 * 1024) // ~4320 linhas (3 dias): guarda só as mais novas
            {
                string[] todas = File.ReadAllLines(p);
                int manter = Math.Min(todas.Length, 4320);
                string[] novas = new string[manter];
                Array.Copy(todas, todas.Length - manter, novas, 0, manter);
                File.WriteAllText(p, string.Join("\n", novas) + "\n", new UTF8Encoding(false));
            }
        }

        private static void Enviar()
        {
            string p = Pendente();
            if (!File.Exists(p)) return;
            string conteudo = File.ReadAllText(p);
            if (conteudo.Trim().Length == 0) return;
            int linhas = 0;
            foreach (char c in conteudo) if (c == '\n') linhas++;

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = Cfg["ssh_exe"];
            psi.Arguments = "-i \"" + Cfg["ssh_chave"] + "\" -p " + Cfg["porta"] + " -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 " +
                            "-o StrictHostKeyChecking=accept-new " + Cfg["destino"] + " " + Cfg["comando_remoto"];
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (Process ssh = new Process())
            {
                ssh.StartInfo = psi;
                StringBuilder saida = new StringBuilder();
                ssh.OutputDataReceived += delegate(object o, DataReceivedEventArgs ev) { if (ev.Data != null) lock (saida) saida.Append(ev.Data).Append(' '); };
                ssh.ErrorDataReceived += delegate(object o, DataReceivedEventArgs ev) { if (ev.Data != null) lock (saida) saida.Append(ev.Data).Append(' '); };
                try
                {
                    ssh.Start();
                }
                catch (Exception e)
                {
                    Log("ssh não abriu: " + e.Message);
                    return;
                }
                ssh.BeginOutputReadLine();
                ssh.BeginErrorReadLine();
                try
                {
                    byte[] bytes = new UTF8Encoding(false).GetBytes(conteudo);
                    ssh.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
                    ssh.StandardInput.BaseStream.Flush();
                    ssh.StandardInput.Close();
                }
                catch (Exception e)
                {
                    Log("ssh recusou a entrada: " + e.Message);
                }
                if (!ssh.WaitForExit(45000))
                {
                    try { ssh.Kill(); } catch (Exception) { }
                    Log("ssh passou de 45 s; " + linhas + " linha(s) guardada(s)");
                    return;
                }
                ssh.WaitForExit(); // esvazia os eventos de saída
                string txt;
                lock (saida) txt = saida.ToString().Trim();
                if (txt.Length > 200) txt = txt.Substring(0, 200);
                if (ssh.ExitCode == 0)
                {
                    // só este processo escreve no pendente e nada foi acrescentado durante o envio: pode apagar
                    File.Delete(p);
                    Log("enviado " + linhas + " linha(s): " + txt);
                }
                else
                {
                    Log("ssh saiu " + ssh.ExitCode + "; " + linhas + " linha(s) guardada(s): " + txt);
                }
            }
        }
    }
}
