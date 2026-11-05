// Ledger no celular — o endereço Tailscale deste PC. O servidor do celular só ouve nele: nunca em 0.0.0.0,
// nunca numa rede local ou na internet. A Tailscale dá a cada máquina um IPv4 da faixa 100.64.0.0/10 (CGNAT)
// e um IPv6 em fd7a:115c:a1e0::/48; o tráfego entre elas já vai cifrado (WireGuard).

import type { NetworkInterfaceInfo } from 'node:os';

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

/** Endereço da Tailscale (100.64.0.0/10 ou fd7a:115c:a1e0::/48), aceitando a forma `::ffff:100.x.y.z`. */
export function isTailscaleAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const lower = address.trim().toLowerCase();
  const v4 = lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
  const parts = ipv4Parts(v4);
  if (parts) return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  return /^fd7a:115c:a1e0:/.test(lower);
}

/**
 * O IPv4 Tailscale entre as interfaces de rede (`os.networkInterfaces()`). Prefere a interface com
 * "tailscale" no nome; `null` quando a Tailscale não está ligada neste PC.
 */
export function pickTailscaleAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const candidates: { name: string; address: string }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal && isTailscaleAddress(info.address)) candidates.push({ name, address: info.address });
    }
  }
  const named = candidates.find((candidate) => /tailscale/i.test(candidate.name));
  return (named ?? candidates[0])?.address ?? null;
}
