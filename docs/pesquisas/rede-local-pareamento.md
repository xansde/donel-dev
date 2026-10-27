---
tema: rede-local-pareamento
plano: docs/planos/pool-contas.pda.md
item: 05 — Transporte e pareamento na rede local
data: 2026-10-27
taskdex: []  # Donel Dev roda sem TaskDex (ferramenta pessoal)
fontes-consultadas: [repos-locais, externas]
---

# Pesquisa: transporte e pareamento na rede local

## Pergunta

Como dois Donel Dev (Electron 43.2, Windows), nos dois PCs do mesmo dono, se acham e conversam com segurança pela rede
local para sincronizar contas, inclusive pares OAuth com refresh token de uso único, **sem serviço de terceiros e sem
nuvem** (decisão do dono, 27/10)? Cobre: (1) descoberta, (2) pareamento único por código, (3) cifra do canal, (4)
Firewall do Windows, (5) o que muda com PCs em redes diferentes, (6) dependências npm novas. Compara opções; a
arquitetura fica para a `/arquitetura`, e as escolhas que são do dono vão para o item 04.

## Resposta (gist)

O runtime do app já cobre o canal e o pareamento sem dependência nova: TLS 1.3 mútuo com fingerprint pinado funciona no
Electron 43, e X25519, Ed25519, HKDF, AES-256-GCM e SHA-256 estão no `node:crypto`. Faltam três peças. O `node:crypto`
não gera certificado X.509. A cifra ChaCha20-Poly1305 avulsa não existe, porque o Electron usa BoringSSL. E não há
aritmética de ponto para PAKE. Pareamento com código curto exige PAKE (lib) ou comparação de código na tela com
compromisso (sem lib); TLS-PSK com código curto é inseguro. mDNS pede lib e regra de firewall UDP, e falha em Wi-Fi com
isolamento de cliente. Quem escuta fora do loopback dispara o alerta do Firewall, que pede UAC, e a rede de casa deste PC
está classificada como **Pública**. Redes diferentes sem terceiros só funcionam com porta aberta no roteador ou com uma VPN
que o próprio usuário já tenha.

## Achados

Marcação: **VERIFICADO** = lido na fonte citada ou executado e visto. **INFERIDO** = dedução a partir de fontes
verificadas, com o raciocínio exposto. Os testes de runtime rodaram com `ELECTRON_RUN_AS_NODE=1` no
`node_modules/electron/dist/electron.exe` do checkout principal (Electron 43.2.0) em 27/10/2026. Os scripts ficaram no
scratchpad da sessão, fora do repo, e os certificados de teste foram gerados com o `openssl` do Git for Windows.

### 0. Ponto de partida no código

- **VERIFICADO.** Hoje o app só abre servidores HTTP em `127.0.0.1` com porta efêmera: a ponte de hooks, com token de
  128 bits por aba no cabeçalho `x-donel-token`, e o semáforo de sessões. **Fonte:** `src/main/hook-bridge.ts:299,238`;
  `src/main/session-semaphore-manager.ts:119`.
- **VERIFICADO.** O runtime é Node 24.18.0 dentro do Electron 43.2.0, com `process.versions.openssl = "0.0.0"`, o que
  indica BoringSSL. **Fonte:** teste de runtime (`process.versions`).
- **VERIFICADO.** O instalador NSIS é por usuário, sem admin (`perMachine: false`). Neste PC o alfa está em
  `%LOCALAPPDATA%\Programs\Donel Dev Alfa\Donel Dev Alfa.exe`. **Fonte:** `electron-builder.yml:74-79`; listagem de
  `%LOCALAPPDATA%\Programs`.
- **VERIFICADO.** Nenhuma dependência atual cobre rede, mDNS, cripto extra ou certificado. **Fonte:** `package.json`
  (`dependencies`).

### 1. Descoberta

- **VERIFICADO.** O Windows 10+ tem API nativa de DNS-SD: `DnsServiceRegister` e `DnsServiceBrowse` (`dnsapi.dll`,
  `windns.h`, "Windows 10 [desktop apps only]"). O registro fica preso à vida do processo e o browse é assíncrono, com
  callback por resultado. **Fonte:**
  https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsserviceregister e
  .../nf-windns-dnsservicebrowse (acesso em 27/10/2026).
- **INFERIDO.** Chamar essa API a partir do Electron exige addon nativo ou FFI, e qualquer um deles é dependência nativa
  nova a recompilar contra a ABI do Electron, como o node-pty. A vantagem é que o tráfego mDNS passa pelo serviço
  `dnscache`, que já tem regra de firewall própria (achado abaixo).
- **VERIFICADO.** Neste PC a porta UDP 5353 já está ocupada pelo `svchost` (`0.0.0.0:5353`) e pelo `msedge`
  (`:::5353`). A regra embutida "mDNS (UDP-Entrada)" vale só para `svchost.exe`/serviço `dnscache`, com remoto
  `LocalSubnet` nos perfis Privado e Público. **Fonte:** `Get-NetUDPEndpoint -LocalPort 5353`;
  `Get-NetFirewallRule -DisplayName 'mDNS*'` com filtros de aplicação, serviço e endereço.
- **INFERIDO.** Uma lib mDNS em JS dentro do Electron abre o próprio socket UDP 5353, compartilhado com `reuseAddr`, e
  **não** herda a regra do `dnscache`. Para receber anúncios e respostas por multicast, o exe do app precisa da própria
  regra de entrada UDP. Sem ela, a descoberta tende a falhar em silêncio.
- **VERIFICADO.** O `multicast-dns` usa por padrão a porta 5353, o grupo `224.0.0.251`, `reuseAddr: true` e todas as
  interfaces, e o README não traz nota sobre Windows. **Fonte:** https://github.com/mafintosh/multicast-dns (acesso em
  27/10/2026).
- **VERIFICADO.** O `@homebridge/ciao` só anuncia e não faz browse. Ele não segura o socket primário da 5353 e por isso
  não recebe respostas unicast. Passa no Bonjour Conformance Test, e o README diz que o `mdns` (binding nativo) é difícil
  de instalar no Windows. **Fonte:** https://github.com/homebridge/ciao (acesso em 27/10/2026).
- **VERIFICADO.** Redes Wi-Fi corporativas costumam filtrar mDNS. A Juniper/Mist recomenda descartar a maior parte do
  broadcast e do multicast no Wi-Fi, e com o Bonjour Gateway ligado o AP "drop[s] any unsolicited mDNS traffic going in
  direct to the wireless clients". A Cisco 9800 manda conferir se o isolamento de cliente não bloqueia a descoberta.
  **Fonte:** https://mist.com/documentation/bonjour-gateway-2 ;
  https://juniper.net/documentation/us/en/software/mist/mist-wireless/topics/concept/mist-bonjour-gateway.html ;
  https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/226301-configure-best-recommended-design-as.pdf
  (acesso em 27/10/2026).
- **INFERIDO.** Com isolamento de cliente ativo, que é comum em Wi-Fi de visitante e de escritório, nem o endereço
  digitado funciona, porque o AP bloqueia unicast entre clientes. Nesse caso nenhuma opção de rede local resolve, só uma
  rede que o dono controle.
- **VERIFICADO (só o próprio nome).** Neste PC, `Resolve-DnsName <hostname>.local` devolve o IPv4 e os IPv6 da máquina.
  **Não verificado:** resolver o `.local` do **outro** PC, porque só há um PC no teste. **Fonte:**
  `Resolve-DnsName "$env:COMPUTERNAME.local"`.
- **INFERIDO.** O IP dinâmico só atrapalha quem guarda o IP como identidade. Se a identidade do par for a chave pública
  pinada no pareamento, o endereço vira só uma dica descartável. Para achar o outro PC de novo existem três caminhos: o
  último IP conhecido, o nome `<host>.local` (se a resolução entre PCs funcionar) ou um novo anúncio mDNS. Endereço
  digitado sem nenhum desses caminhos quebra a cada troca de DHCP.
- **INFERIDO.** O QR code serve para o celular, não entre dois PCs de mesa, que não têm câmera apontável. Entre PCs, o
  equivalente prático é **digitar** o endereço curto e o código exibido no outro PC.

### 2. Pareamento único por código

**Opção P1 — TLS-PSK derivado do código curto.**
- **VERIFICADO.** A doc do Node diz: "Deriving a shared secret from a password or other low-entropy sources is not
  secure." **Fonte:** https://nodejs.org/docs/latest-v24.x/api/tls.html (seção Pre-shared keys, acesso em
  27/10/2026).
- **VERIFICADO.** No Electron 43, o TLS-PSK funciona **só em TLS 1.2**: `PSK-AES128-CBC-SHA` e
  `ECDHE-PSK-CHACHA20-POLY1305` conectaram. Em TLS 1.3 o servidor falha com `NO_CERTIFICATE_SET` (BoringSSL
  `tls13_server.cc:405`), embora a doc do Node diga que todas as cifras TLS 1.3 aceitam PSK. **Fonte:** teste de runtime
  (`tls.createServer` e `tls.connect` com `pskCallback`); doc citada acima.
- **INFERIDO.** Um atacante ativo na rede que se passe por um dos lados recebe material suficiente (o Finished) para
  testar offline todos os 10^6 códigos de 6 dígitos. Por isso **P1 não serve**.

**Opção P2 — PAKE balanceado (CPace ou SPAKE2) com código curto digitado.**
- **VERIFICADO.** O SPAKE2 é a RFC 9382 (IRTF, Informational, set/2023). Ele é simétrico, não aceita aumento, e "the
  choice of M and N is critical for the security proof". As ciphersuites cobrem P-256 e edwards25519. **Fonte:**
  https://www.rfc-editor.org/rfc/rfc9382.html (acesso em 27/10/2026).
- **VERIFICADO.** O CPace ainda é draft: `draft-irtf-cfrg-cpace-21`, de abr/2026, PAKE balanceado e ainda não RFC
  ("Awaiting First editor"). **Fonte:** https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/ (acesso em
  27/10/2026).
- **VERIFICADO.** O `node:crypto` do Electron 43 tem X25519, P-256 (ECDH), Ed25519, HKDF, scrypt e PBKDF2, mas não tem
  Argon2 ("Argon2 algorithm not supported"). **Fonte:** teste de runtime.
- **INFERIDO.** O `node:crypto` expõe ECDH e assinatura, mas não soma de pontos nem hash-to-curve, que CPace e SPAKE2
  exigem. Implementar qualquer um dos dois pede uma lib de curvas. O `@noble/curves` (MIT, auditado, com ristretto255 e
  hash-to-curve) dá as peças, e o protocolo seria montado à mão em cima dele.
- **VERIFICADO.** Não há implementação de PAKE madura no npm: `spake2` 1.0.2 é de 2019 e usa `elliptic`; `cpace` no npm
  é outro pacote, um "Nodemon for C/C++ files", sem relação com o protocolo. **Fonte:** `npm view` em 27/10/2026.
- **INFERIDO.** Contra quem está na mesma rede, o PAKE dá ao atacante ativo **uma** tentativa por sessão de pareamento:
  1 em 10^6 com 6 dígitos. Também não vaza o código a quem só escuta. O risco que sobra é o da implementação própria.

**Opção P3 — OPAQUE (aPAKE).**
- **VERIFICADO.** O OPAQUE é a RFC 9807 (jul/2025), um protocolo cliente-servidor com registro e "password file" no
  servidor. **Fonte:** https://www.rfc-editor.org/rfc/rfc9807.html (acesso em 27/10/2026). As libs são
  `@serenity-kit/opaque` (MIT, 1.1.0, fev/2026) e `@cloudflare/opaque-ts` (BSD-3, último publish em 2022). **Fonte:**
  `npm view`.
- **INFERIDO.** É desenhado para senha reutilizada contra servidor e não se encaixa em pareamento único entre pares.
  Fica descartado por excesso.

**Opção P4 — troca de chave efêmera + código curto comparado nas duas telas (SAS).**
- **VERIFICADO.** Na RFC 6189 (ZRTP), o SAS é derivado da troca DH e os usuários o comparam. O **compromisso** com hash
  (mensagem Commit com `hvi`) existe porque, sem ele, o MITM testaria valores DH até casar os dois SAS. "A 16-bit SAS
  ... provides the attacker only one chance out of 65536." **Fonte:** https://www.rfc-editor.org/rfc/rfc6189.html
  (acesso em 27/10/2026).
- **VERIFICADO.** Todas as primitivas necessárias (X25519, SHA-256, HKDF) estão no `node:crypto` do Electron 43.
  **Fonte:** teste de runtime.
- **INFERIDO.** Com compromisso e 6 dígitos (~20 bits), o MITM tem 1 chance em 10^6 por tentativa e não precisa de
  dependência nova. A segurança depende de o dono **olhar as duas telas** antes de confirmar. O caso dele é favorável,
  com os dois PCs à mão no pareamento. A fraqueza é o "OK" dado sem comparar.

**Opção P5 — certificado autoassinado por PC + pinning do fingerprint.**
- **VERIFICADO.** O pinning funciona no Electron 43. TLS 1.3 mútuo (`requestCert: true`, `rejectUnauthorized: false`)
  com conferência de `getPeerX509Certificate().fingerprint256` dos dois lados negociou `TLS_AES_128_GCM_SHA256`, e o
  servidor reconheceu o certificado do cliente. **Fonte:** teste de runtime com certificados P-256 de teste.
- **VERIFICADO.** O `node:crypto` não gera certificado (`crypto.createCertificate` é `undefined`), mas lê e compara
  certificados (`X509Certificate`). **Fonte:** teste de runtime.
- **INFERIDO.** O fingerprint inteiro (SHA-256, 64 hex) não dá para conferir de olho. P5 sozinho não é pareamento por
  código. Ele é o **resultado** do pareamento: P2 ou P4 autentica uma vez, troca os fingerprints, e dali em diante cada
  conexão confere o fingerprint pinado.
- **INFERIDO.** Gerar o certificado tem três caminhos: a lib `selfsigned` (MIT, que puxa `@peculiar/x509` e `pkijs`),
  `@peculiar/x509` direto (MIT; a 3.0.0 é major nova, publicada em 27/10/2026, hoje) ou montar o DER à mão (algumas
  centenas de linhas de ASN.1, sem dependência). Chamar o `openssl` da máquina não serve, porque não há garantia de que
  ele exista no PC do dono.

### 3. Canal

- **VERIFICADO.** O mTLS 1.3 com certificados pinados funciona com `node:tls` do Electron 43 e não exige dependência
  além da geração do certificado (achados de P5). **Fonte:** teste de runtime.
- **VERIFICADO.** A doc do Node manda passar `checkServerIdentity` próprio quando não há verificação por nome. O
  `rejectUnauthorized` vem `true` por padrão e só checa contra CA. **Fonte:**
  https://nodejs.org/docs/latest-v24.x/api/tls.html (acesso em 27/10/2026).
- **INFERIDO.** Com `rejectUnauthorized: false`, a conferência do fingerprint precisa acontecer **antes** de qualquer
  byte de aplicação (no `secureConnect` do cliente e na conexão do servidor). Se for esquecida, o canal aceita qualquer
  certificado em silêncio. É a armadilha principal desta opção e precisa de teste dedicado.
- **VERIFICADO.** O Noise define os padrões XX (autenticação mútua, com as chaves estáticas enviadas cifradas) e KK (as
  duas chaves estáticas já conhecidas, nada transmitido), e modificadores `psk0`/`psk2` para segredo pré-compartilhado de
  32 bytes. As funções definidas são ChaChaPoly e AESGCM sobre 25519 e 448. **Fonte:** https://noiseprotocol.org/noise.html
  (rev. 34, acesso em 27/10/2026).
- **VERIFICADO.** No Electron 43, `createCipheriv('chacha20-poly1305')` falha com "Unknown cipher", e o AES-256-GCM
  funciona. **Fonte:** teste de runtime.
- **INFERIDO.** O `Noise_XX_25519_AESGCM_SHA256`, ou KK depois do pareamento, cabe só no `node:crypto` (X25519 +
  AES-256-GCM + SHA-256/HMAC). Seriam algumas centenas de linhas de protocolo próprio, validadas contra os vetores de
  teste da spec.
- **VERIFICADO.** O `noise-handshake` (Apache-2.0, 4.2.0, dez/2025) depende de `sodium-universal`, que no Node usa
  `sodium-native` (addon nativo, MIT). O `@chainsafe/libp2p-noise` (Apache-2.0 OR MIT, 17.0.0) puxa a pilha libp2p.
  **Fonte:** `npm view` em 27/10/2026.
- **INFERIDO.** A "cifra própria" sobre TCP ou WebSocket (AES-GCM com chave do pareamento, sem handshake padronizado)
  perde sigilo futuro e repete erros conhecidos (nonce, replay, reordenação), sem ganho sobre TLS ou Noise.
  **Desaconselhada.** Também não precisa de WebSocket: `node:tls` sobre TCP basta. O `ws` (MIT) só entraria se houvesse
  outra razão.
- **INFERIDO.** O servidor novo escuta fora do loopback, então qualquer aparelho da rede chega à porta. O que essa porta
  aceita antes de um par autenticado (pareamento, limite de tentativas, tamanho de mensagem) vira superfície de ataque
  nova, que hoje não existe.

### 4. Firewall do Windows

- **VERIFICADO.** Microsoft: "If there's no active application or administrator-defined allow rule(s), a dialog box
  prompts the user to either allow or block". Com admin, "No" ou cancelar cria regras de **bloqueio** (TCP e UDP). Sem
  admin, "block rules are created. It doesn't matter what option is selected". Depois de criadas, as regras "must be
  deleted to generate the prompt again". A recomendação é criar a regra antes do primeiro uso e restringir a
  `Local Subnet` nos perfis Privado e Público. Regra de aplicação exige caminho completo, sem curinga. **Fonte:**
  https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules
  (acesso em 27/10/2026).
- **VERIFICADO.** Neste PC a rede Wi-Fi de casa está como **Public**, os três perfis estão com `NotifyOnListen = True`,
  e existe uma regra "Node.js JavaScript Runtime" de entrada liberada no perfil Público (sinal de que o alerta já foi
  aceito para o Node). O usuário está no grupo Administradores, mas o processo não está elevado, então o "Permitir"
  passa pelo UAC. **Fonte:** `Get-NetConnectionProfile`, `Get-NetFirewallProfile`, `Get-NetFirewallRule`,
  `WindowsPrincipal.IsInRole` e `whoami /groups`.
- **INFERIDO.** O instalador por usuário roda sem elevação e por isso **não consegue** criar a regra (criar regra de
  firewall exige admin, como diz o achado anterior). Para pré-criar a regra, o app teria de pedir UAC no momento de ativar
  a sincronização (por exemplo `New-NetFirewallRule` elevado, com `-RemoteAddress LocalSubnet` e o caminho do exe), ou
  então aceitar o alerta nativo no primeiro `listen`.
- **INFERIDO.** Como a regra é por caminho do exe, os três canais (alfa, beta, stable) precisam de três regras, uma por
  pasta de instalação. Uma atualização no mesmo caminho mantém a regra. Mudar o caminho de instalação perde a regra.
- **INFERIDO.** Só o lado que **escuta** precisa de regra de entrada, porque a saída é liberada por padrão (a mesma doc
  da Microsoft recomenda "allow outbound by default"). Se só um PC escutasse, só ele precisaria de regra. Mas o PC que
  volta de desligado e precisa ser avisado sugere que os dois escutem. Quem escuta é decisão do item 04.
- **INFERIDO.** Se o dono cancelar o alerta uma vez, a sincronização fica bloqueada até alguém apagar as regras de
  bloqueio na mão. O app precisa detectar e explicar isso, porque o Windows não volta a perguntar.

### 5. Redes diferentes (fora de casa)

- **VERIFICADO.** No Tailscale, o servidor de coordenação é operado pela Tailscale (`login.tailscale.com`) e distribui
  chaves públicas e políticas. O tráfego vai direto por WireGuard ou passa pelos relays DERP, que "can't read it".
  **Fonte:** https://tailscale.com/blog/how-tailscale-works (acesso em 27/10/2026).
- **VERIFICADO.** O ZeroTier usa root servers "deployed and maintained by ZeroTier, Inc.", e as moons privadas estão
  "no longer recommended". **Fonte:** https://docs.zerotier.com/roots (acesso em 27/10/2026).
- **INFERIDO.** Quadro das opções para o dono:
  - **Relay ou servidor de encontro (hole punching via STUN/sinalização):** exige servidor sempre ligado com IP público.
    Viola "sem serviço de terceiros/sem nuvem", a não ser que o próprio dono hospede (e aí é infraestrutura dele, fora do
    app).
  - **Porta aberta no roteador de casa + endereço público:** não envolve terceiro, mas expõe a porta à internet. Precisa
    de IP público, e operadora com CGNAT impede isso (não verificado para a operadora do dono). Com IP dinâmico de
    internet, exige DNS dinâmico, que é serviço de terceiro.
  - **VPN que o usuário já tenha (Tailscale, ZeroTier):** viola "sem terceiros" na coordenação, embora o conteúdo siga
    cifrado de ponta a ponta. O app não depende dela: se os dois PCs estiverem na mesma rede virtual, o mecanismo de rede
    local funciona por endereço digitado. É provável que o mDNS não atravesse o túnel (não verificado).
  - **WireGuard puro do usuário:** sem terceiros, mas precisa de um lado alcançável (a porta acima) e de admin para
    instalar.
- **INFERIDO.** Nenhuma via fora de casa é "sem terceiros e sem configuração". O que dá para entregar sem violar a
  decisão é **"funciona em qualquer rede onde um PC alcance o outro"**, com endereço digitado, deixando ao usuário
  prover essa rede (VPN própria, por exemplo).

### 6. Dependências npm candidatas (só listagem; nada instalado)

Fonte de todos os dados: `npm view <pacote>` em 27/10/2026. "Publish" é a data da versão atual.

| Pacote | Para quê | Versão / publish | Licença | Observação |
|---|---|---|---|---|
| `bonjour-service` | mDNS/DNS-SD anunciar + browse | 1.4.4 / 2026-07-28 | MIT | Depende de `multicast-dns` (7.2.5, publish 2022-05) e `fast-deep-equal`. JS puro. |
| `multicast-dns` | mDNS cru | 7.2.5 / 2022-05-16 | MIT | Sem release há 4 anos. JS puro. |
| `@homebridge/ciao` | mDNS só anúncio | 1.3.12 / 2026-08-15 | MIT | Não faz browse: sozinho não resolve a descoberta. |
| `@noble/curves` (+ `@noble/hashes`) | Base para PAKE (ristretto255, hash-to-curve) | 2.4.0 / 2026-08-27 | MIT | Auditado, JS puro. O protocolo CPace/SPAKE2 seria escrito à mão. |
| `selfsigned` | Gerar certificado autoassinado | 5.5.0 / 2026-01-12 | MIT | Puxa `@peculiar/x509` + `pkijs`. |
| `@peculiar/x509` | Gerar/ler X.509 | 3.0.0 / **2026-10-27** | MIT | Major publicada hoje: imatura para pin. |
| `noise-handshake` | Noise pronto | 4.2.0 / 2025-12-01 | Apache-2.0 | Puxa `sodium-native` (addon **nativo**): rebuild contra o Electron. |
| `@chainsafe/libp2p-noise` | Noise pronto | 17.0.0 | Apache-2.0 OR MIT | Pilha libp2p inteira: pesado demais para o caso. |
| `@serenity-kit/opaque` | OPAQUE | 1.1.0 / 2026-02-01 | MIT | Descartado por excesso (P3). |
| `ws` | WebSocket | 8.22.0 | MIT | Desnecessário: `node:tls` basta. |
| `mdns` | Binding nativo Bonjour | 2.7.2 (2022) | — | Sem licença no registry; o ciao relata instalação difícil no Windows. Descartar. |

- **VERIFICADO.** Todas as candidatas viáveis são MIT ou Apache-2.0, compatíveis com o espelho público MIT
  (`xansde/donel`). **Fonte:** tabela acima; `CLAUDE.md` (seção Repo público).
- **INFERIDO.** O caminho de **zero dependência** existe: descoberta por endereço ou hostname digitado, pareamento P4,
  canal Noise feito à mão **ou** mTLS com DER montado à mão. O custo é mais código criptográfico próprio para testar.

## Lacunas

- **Resolução `<host>.local` entre os dois PCs:** só a do próprio PC foi testada. Falta testar com os dois PCs na mesma
  rede.
- **mDNS JS no Windows com o `svchost` já na 5353:** não testado em runtime. Também não está provado se a regra de
  firewall UDP é necessária para receber respostas. Precisa de teste com dois PCs.
- **Alerta do Firewall com o exe empacotado:** não disparado nesta pesquisa (o teste usou só loopback). Falta ver o
  texto, os perfis pré-marcados (Privado/Público) e o comportamento com a rede "Pública".
- **Ed25519 como chave de certificado no TLS 1.3 do BoringSSL:** não testado. Só P-256 foi provado.
- **Isolamento de cliente na rede do dono e CGNAT da operadora:** não verificáveis daqui.
- **O outro PC do dono:** não se sabe se o usuário de lá é admin (sem admin, o alerta só cria bloqueio). Também não se
  sabe como a rede dele está classificada.
- **Decisões, não fatos (candidatas ao item 04):** descoberta automática ou digitada, P2 ou P4, mTLS ou Noise, quem
  escuta, aceitar UAC no ativar, dependência nova ou zero, e se redes diferentes entram na V1. A lista está em
  Implicações.
- **Fora do escopo deste item:** o `userData` compartilhado entre canais faz os três canais disputarem a mesma
  identidade de pareamento (a chave privada do PC). Isso pesa no B10 e no item 06.

## Trilha de busca

- **Runtime Electron 43.2** (`ELECTRON_RUN_AS_NODE`): sondagem de `node:crypto` (x25519, ed25519, ECDH P-256, HKDF,
  chacha20-poly1305, aes-256-gcm, scrypt, argon2, X509Certificate, createCertificate), TLS-PSK 1.2/1.3 e mTLS 1.3 com
  pinning. Resultados registrados nos Achados.
- **Windows local:** perfis de rede e de firewall, regras mDNS e Node, ocupação da UDP 5353, `.local` do próprio host,
  grupo admin. Nenhum arquivo de credencial foi aberto.
- **Docs Microsoft:** regras do Firewall e `DnsServiceRegister`/`DnsServiceBrowse`. A busca web genérica sobre o alerta
  do firewall devolveu só fontes de terceiros, descartadas em favor da doc oficial.
- **RFCs/specs:** 9382 (SPAKE2), 9807 (OPAQUE), draft CPace no Datatracker, 6189 (ZRTP/SAS), Noise rev. 34.
- **npm registry:** 17 pacotes consultados. `dns-sd` não existe (404), e `cpace` é pacote sem relação com o protocolo.
- **Vendors Wi-Fi:** Juniper/Mist e Cisco sobre filtro de mDNS e isolamento de cliente. A Ruckus ficou sem resposta
  oficial nos resultados.
- **KB Seazone e Nekt:** não consultados. A pergunta é sobre plataforma de terceiros (Windows, Node, Electron) e o código
  local, e a decisão do dono exclui estrutura da Seazone.

## Implicações para o item 04

Fatos que o refinamento do item 04 precisa considerar. Não é proposta de arquitetura.

1. **O canal seguro não é o gargalo.** O mTLS 1.3 pinado já roda no Electron 43 (VERIFICADO). O Noise cabe no
   `node:crypto` com AES-GCM (INFERIDO). As duas opções exigem que a identidade do outro PC seja uma **chave pinada no
   pareamento**, não um IP. Isso também resolve o IP dinâmico.
2. **Código curto pede PAKE ou comparação; nunca PSK.** TLS-PSK com código de 6 dígitos cai em ataque offline
   (VERIFICADO na doc do Node). E no Electron o TLS 1.3 com PSK nem funciona (VERIFICADO). A escolha do dono é entre:
   - **(a) comparar um código nas duas telas (P4):** sem dependência, e exige olhar as duas telas.
   - **(b) digitar no PC B o código mostrado no PC A (P2):** usa `@noble/curves` e um protocolo PAKE escrito à mão.
3. **O par OAuth vai trafegar pela rede.** Hoje o `CredentialPair` não sai de `src/main/accounts/` (ADR 0001,
   invariante 2). O socket e o handshake passam a ser a fronteira dele, e faz sentido que o módulo de rede more dentro do
   perímetro ou que a ADR nova o nomeie como exceção, como foi feito com `claude-state.ts`.
4. **O Firewall é atrito de UX garantido.** Quem escuta fora do loopback dispara o alerta com UAC (VERIFICADO na doc).
   A rede de casa deste PC está "Pública" (VERIFICADO). Cancelar uma vez bloqueia para sempre, até apagar a regra na mão.
   O dono decide:
   - se os dois PCs escutam ou só um;
   - se o app pede UAC ao ativar a sincronização para criar regra restrita a `LocalSubnet`, ou se depende do alerta
     nativo;
   - como a tela explica o bloqueio.
5. **Descoberta automática custa caro e falha onde mais importa.** O mDNS pede uma dependência (ou addon nativo da API
   do Windows) e uma regra UDP. Ele não passa em Wi-Fi com filtro ou isolamento (VERIFICADO nas docs de vendors). O dono
   decide se a V1 aceita **endereço ou hostname digitado no pareamento + último IP conhecido**, com o mDNS ficando para
   depois.
6. **Redes diferentes não fecham sem violar uma decisão já tomada.** Relay, encontro e DNS dinâmico são terceiros.
   Porta aberta expõe o PC e esbarra em CGNAT. O que cabe é "funciona onde um PC alcance o outro", com VPN do próprio
   usuário (INFERIDO). Para a V1, a decisão do dono é entre "só mesma rede" e "mesma rede ou VPN do usuário, por
   endereço digitado".
7. **Dependência nova é decisão do dono** (baseline e `CLAUDE.md`). Existe uma rota de zero dependência: digitado + P4 +
   Noise ou DER à mão (INFERIDO). Ela troca dependência por código criptográfico próprio, que precisa de vetores de teste.
   As libs viáveis são todas MIT ou Apache-2.0.
8. **Identidade de pareamento × `userData` compartilhado.** A chave privada do PC gravada no `userData` comum fica
   visível aos três canais. Isso pode ser desejado (um PC, uma identidade) ou um risco (canal velho sobrescreve). O item
   04 e o B10 precisam dizer qual dos dois vale.
