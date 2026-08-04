import { existsSync, readFileSync } from 'node:fs';

// Leitura de arquivo injetável, do jeito que este repo faz desde o
// `config-store.ts`: **nunca lança** — degrada para "não sei" em vez de
// derrubar o processo.
//
// Nasceu dentro do leitor do mapa antigo e ficou de pé
// quando ele saiu (batch B6): não tem nada de esteira aqui, é o utilitário que
// meia dúzia de módulos do main usa para ler config e credencial sem se
// preocupar com arquivo ausente.

export interface FileReadIoDeps {
  existsSync: (path: string) => boolean;
  /** `null` = ausente/ilegível — nunca lança. */
  readFileText: (path: string) => string | null;
}

export function createSystemFileReadIoDeps(): FileReadIoDeps {
  return {
    existsSync,
    readFileText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
  };
}
