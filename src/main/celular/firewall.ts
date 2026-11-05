// Ledger no celular — o que o app pergunta ao sistema sobre o caminho até o celular: quais celulares a Tailscale
// enxerga, e (só quando o celular não abre a página) se o Firewall do Windows deixa entrar na porta do app.
// A regra, quando o dono pede, é estreita: só TCP na porta do app, só da faixa da Tailscale, e criada pelo pedido
// de administrador do Windows, que o dono vê e aceita; o app nunca a cria em silêncio.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { CelularAllowFirewallResult, CelularFirewallRule, CelularTailnet } from '../../shared/celular';
import { MOBILE_PORT } from './server';
import { phonesInTailnet } from './tailscale';

export const FIREWALL_RULE_NAME = 'Donel Dev - celular (Tailscale)';
const TAILSCALE_RANGE = '100.64.0.0/10';

function run(file: string, args: readonly string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: error === null, stdout: String(stdout ?? '') });
    });
  });
}

function tailscaleExe(): string {
  if (process.platform === 'win32') {
    const installed = 'C:\Program Files\Tailscale\tailscale.exe';
    if (existsSync(installed)) return installed;
  }
  return 'tailscale';
}

export async function readTailnet(): Promise<CelularTailnet> {
  const result = await run(tailscaleExe(), ['status', '--json'], 5000);
  if (!result.ok) return { readable: false, phones: [] };
  try {
    const phones = phonesInTailnet(JSON.parse(result.stdout));
    return phones === null ? { readable: false, phones: [] } : { readable: true, phones };
  } catch {
    return { readable: false, phones: [] };
  }
}

function powershell(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], timeoutMs);
}

export async function readFirewallRule(): Promise<CelularFirewallRule> {
  if (process.platform !== 'win32') return 'unknown';
  // `netsh` responde em menos de 1 s (o `Get-NetFirewallRule` leva ~15 s): sai 0 com a regra, 1 sem ela.
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE_NAME}`], { timeout: 10_000, windowsHide: true }, (error) => {
      if (error === null) resolve('present');
      else resolve(error.code === 1 ? 'absent' : 'unknown');
    });
  });
}

/** Abre o pedido de administrador do Windows para criar a regra; espera o dono responder. */
export async function allowFirewallRule(): Promise<CelularAllowFirewallResult> {
  if (process.platform !== 'win32') return { ok: false, reason: 'Só existe no Windows.' };
  const inner = `New-NetFirewallRule -DisplayName '${FIREWALL_RULE_NAME}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${MOBILE_PORT} -RemoteAddress ${TAILSCALE_RANGE} | Out-Null`;
  const innerEncoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${innerEncoded}'`;
  const result = await powershell(outer, 120_000);
  if (!result.ok) return { ok: false, reason: 'O Windows não criou a regra (o pedido de administrador foi recusado ou fechado).' };
  return (await readFirewallRule()) === 'present' ? { ok: true } : { ok: false, reason: 'O Windows não criou a regra.' };
}
