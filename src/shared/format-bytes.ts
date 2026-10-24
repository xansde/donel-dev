// 016-jobu-faxina - sizes the way the owner reads them in pt-BR: `319 MB`, `2,0 MB`, `1,4 GB`. Shared by the
// bubble of the Jobu (renderer-safe) and the `resumo.html` of the sweep (main). Pure.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Bytes up to KB are whole numbers; from MB up, one decimal below 10 and none from 10 on. Negative or non-finite counts as 0 B. */
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const label = UNITS[unit];
  if (unit <= 1 || value >= 9.95) return `${Math.round(value)} ${label}`;
  return `${value.toFixed(1).replace('.', ',')} ${label}`;
}
