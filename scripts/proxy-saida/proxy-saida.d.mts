// Tipos do proxy-saida.mjs para o teste (tests/proxySaida.test.ts). O script roda em Node puro, sem build.
type LogEntry = Record<string, unknown>;

export const DEFAULT_ALLOW: string[];
export function isTailnetAddress(address: string | undefined): boolean;
export function assertTailnetBind(bind: string): void;
export function parseConnectTarget(target: string): { host: string; port: number } | null;
export function isAllowed(host: string, port: number, allow?: string[]): boolean;
export function hashPassword(password: string, salt?: string): string;
export function checkProxyAuth(header: string | undefined, user: string, passwordHash: string): boolean;
export function createUpstreamHealth(options: {
  probe: () => Promise<unknown>;
  log: (entry: LogEntry) => void;
  onChange?: (state: LogEntry) => void;
  probeMs?: number;
  queda?: 'direto' | 'parar';
}): { usarProxy(): boolean; markUp(): void; markDown(motivo: string): void; recheck(motivo: string): void; stop(): void };
