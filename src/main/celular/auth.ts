// Ledger no celular — pareamento e tokens. O app mostra um link com código de uso único (10 minutos);
// o celular troca o código por um token de sessão, que ele guarda. Aqui só fica o hash do token, em
// `<userData>/celular.json`, gravado só pelo main (temp → rename, como o mindscape-store). O dono revoga
// um celular nas Preferências. Nenhuma credencial do CLI passa por aqui.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import type { ConfigIoDeps } from '../config-store';
import type { CelularDevice } from '../../shared/celular';

export const CELULAR_SCHEMA_VERSION = 1;
export const PAIRING_TTL_MS = 10 * 60_000;
/** Não regrava `lastSeenAt` a cada pedido. */
const LAST_SEEN_RESOLUTION_MS = 60_000;

interface StoredDevice {
  readonly id: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly pairedAt: string;
  readonly lastSeenAt: string | null;
}

interface CelularFile {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly devices: readonly StoredDevice[];
}

const EMPTY: CelularFile = { schemaVersion: CELULAR_SCHEMA_VERSION, enabled: false, devices: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDevice(value: unknown): StoredDevice | null {
  if (!isRecord(value)) return null;
  const { id, name, tokenHash, pairedAt, lastSeenAt } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  if (typeof pairedAt !== 'string') return null;
  return { id, name, tokenHash, pairedAt, lastSeenAt: typeof lastSeenAt === 'string' ? lastSeenAt : null };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CelularAuthDeps {
  readonly filePath: string;
  readonly io: ConfigIoDeps;
  readonly now?: () => number;
}

export interface CelularAuth {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  devices(): CelularDevice[];
  /** Novo código de uso único; invalida o anterior. */
  createPairingCode(): { code: string; expiresAt: number };
  /** Troca o código por um token de sessão. `null` = código errado, vencido ou já usado. */
  pair(code: string, deviceName: string): { token: string; deviceId: string } | null;
  /** O celular dono do token, ou `null` (token ausente, errado ou revogado). */
  verify(token: string | null | undefined): CelularDevice | null;
  revoke(deviceId: string): void;
  /** O arquivo é de um canal mais novo: lido, nunca gravado. */
  readonly readOnly: boolean;
}

export function createCelularAuth(deps: CelularAuthDeps): CelularAuth {
  const now = deps.now ?? Date.now;
  let readOnly = false;
  let file: CelularFile = load();
  let pending: { codeHash: string; expiresAt: number } | null = null;

  function load(): CelularFile {
    const text = deps.io.readFileText(deps.filePath);
    if (text === null) return EMPTY;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return EMPTY;
    }
    if (!isRecord(raw)) return EMPTY;
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > CELULAR_SCHEMA_VERSION) readOnly = true;
    const devices = Array.isArray(raw.devices) ? raw.devices.map(parseDevice).filter((d): d is StoredDevice => d !== null) : [];
    return { schemaVersion: CELULAR_SCHEMA_VERSION, enabled: raw.enabled === true, devices };
  }

  function save(next: CelularFile): void {
    file = next;
    if (readOnly) return;
    const tmp = `${deps.filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const dir = dirname(deps.filePath);
      if (!deps.io.existsSync(dir)) deps.io.mkdirSync(dir);
      deps.io.writeFileText(tmp, JSON.stringify(next, null, 2));
      deps.io.renameFile(tmp, deps.filePath);
    } catch (error) {
      deps.io.unlinkFile(tmp);
      throw error;
    }
  }

  const toPublic = (device: StoredDevice): CelularDevice => ({ id: device.id, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt });

  return {
    get enabled() {
      return file.enabled;
    },
    get readOnly() {
      return readOnly;
    },
    setEnabled(enabled) {
      if (file.enabled === enabled) return;
      save({ ...file, enabled });
      if (!enabled) pending = null;
    },
    devices: () => file.devices.map(toPublic),
    createPairingCode() {
      const code = randomToken();
      const expiresAt = now() + PAIRING_TTL_MS;
      pending = { codeHash: hashToken(code), expiresAt };
      return { code, expiresAt };
    },
    pair(code, deviceName) {
      if (!pending || typeof code !== 'string' || code.length === 0 || code.length > 200) return null;
      const presented = Buffer.from(hashToken(code), 'hex');
      const expected = Buffer.from(pending.codeHash, 'hex');
      const expired = now() > pending.expiresAt;
      if (!timingSafeEqual(presented, expected) || expired) {
        if (expired) pending = null;
        return null;
      }
      pending = null; // uso único, antes de qualquer outra coisa
      const token = randomToken();
      const deviceId = randomBytes(8).toString('hex');
      const name = (typeof deviceName === 'string' ? deviceName.trim().slice(0, 60) : '') || 'Celular';
      const at = new Date(now()).toISOString();
      save({ ...file, devices: [...file.devices, { id: deviceId, name, tokenHash: hashToken(token), pairedAt: at, lastSeenAt: at }] });
      return { token, deviceId };
    },
    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;
      const presented = Buffer.from(hashToken(token), 'hex');
      const device = file.devices.find((d) => timingSafeEqual(presented, Buffer.from(d.tokenHash, 'hex')));
      if (!device) return null;
      const last = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
      if (now() - last >= LAST_SEEN_RESOLUTION_MS) {
        const seen = { ...device, lastSeenAt: new Date(now()).toISOString() };
        try {
          save({ ...file, devices: file.devices.map((d) => (d.id === device.id ? seen : d)) });
        } catch {
          // lastSeenAt é só informativo: falha de disco não derruba o pedido
        }
        return toPublic(seen);
      }
      return toPublic(device);
    },
    revoke(deviceId) {
      if (!file.devices.some((d) => d.id === deviceId)) return;
      save({ ...file, devices: file.devices.filter((d) => d.id !== deviceId) });
    },
  };
}
