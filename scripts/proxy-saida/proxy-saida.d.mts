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
}): UpstreamHealth;
type UpstreamHealth = { usarProxy(): boolean; markUp(): void; markDown(motivo: string): void; recheck(motivo: string): void; stop(): void };
export function startVpsRelay(
  config: {
    modo: 'vps';
    porta?: number;
    upstream: { host: string; porta: number; usuario: string; senha: string };
    /** Ignorada desde 08/11: sem o PC, o relay sempre para. */
    queda?: string;
    permitir?: string[];
    estado?: string;
    log?: string;
    testeMs?: number;
  },
  log?: (entry: LogEntry) => void,
): { server: import('node:http').Server; health: UpstreamHealth };
