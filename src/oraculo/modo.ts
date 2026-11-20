// Passo 9 (t-5358d400) — which part of the Oráculo this process runs. The registro owns the ledger (`ledger.sqlite`)
// and the PC's API; the entregador owns the sessions' gate, the recados (`recados.json`) and the board picture
// (`retrato.json`). Without the mark `<dir>/entregador.separado` one process runs both, as before the split; with it,
// `donel-oraculo` runs the registro and `DONEL_ORACULO_MODO=entregador` (its own unit) the entregador, each file with
// one writer.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Present = the entregador runs in its own process (and the registro leaves its files alone). */
export const ENTREGADOR_SEPARADO_FILE = 'entregador.separado';
/** With the entregador apart, the PC's last push is left here by the registro; the entregador merges it into retrato.json. */
export const RETRATO_PC_FILE = 'retrato-pc.json';

export type OracleMode = 'satelite' | 'junto' | 'registro' | 'entregador';

/**
 * The mode from the env and the mark. The entregador alone without the mark is refused: the registro of the same dir
 * still runs the recados there, and two writers of `recados.json` deliver a message twice or lose it.
 */
export function oracleMode(env: Readonly<Record<string, string | undefined>>, dir: string): OracleMode {
  if (env.DONEL_PORTAO_SATELITE?.trim()) return 'satelite';
  const separado = existsSync(join(dir, ENTREGADOR_SEPARADO_FILE));
  const modo = env.DONEL_ORACULO_MODO?.trim();
  if (modo === 'entregador') {
    if (!separado) throw new Error(`DONEL_ORACULO_MODO=entregador sem ${join(dir, ENTREGADOR_SEPARADO_FILE)}: o donel-oraculo ainda entrega os recados; nada subiu.`);
    return 'entregador';
  }
  if (modo) throw new Error(`DONEL_ORACULO_MODO=${modo} não existe (só "entregador"); nada subiu.`);
  return separado ? 'registro' : 'junto';
}
