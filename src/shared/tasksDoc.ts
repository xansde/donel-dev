// C3 (batch N5, spec 010) — "o card do item mostra O QUE RODA JUNTO".
//
// O modelo do store para (discovery → planos → itens) já é o mais fino que
// existe: um item de tipo `issue` não sabe, por si, que ele corresponde a um
// bloco de 27 tasks (`T1102`..`T1131`) num `tasks.md`. Investigação: o único
// lugar onde essa granularidade existe HOJE é o próprio `specs/*/tasks.md` do
// repo-alvo — todo tasks.md deste repo já segue o mesmo formato de checklist
// (`- [x] **T1301** — Confirmar...`), então ler e interpretar ESSE arquivo,
// quando um artefato apontar para ele (D-8: `ArtifactPointer`), é o caminho
// mais honesto com o que o app JÁ TEM — em vez de inventar um campo novo no
// contrato que nenhuma skill declara ainda.
//
// Puro de propósito: quem lê o arquivo do disco é o main (IPC read-only,
// `esteira:readArtifactText`); este módulo só interpreta o TEXTO que chega.

export interface TaskEntry {
  readonly id: string;
  readonly done: boolean;
  readonly title: string;
}

const CHECKBOX_LINE = /^-\s*\[([ xX])\]\s*\*\*([A-Za-z]+\d+)\*\*\s*(.*)$/;

/**
 * As tasks de um documento no formato que `specs/*\/tasks.md` já usa neste
 * repo. Linha que não bate com `- [ ] **T<n>** ...` não é uma task — prosa em
 * volta (título do documento, regras, notas) nunca vira entrada fantasma.
 */
export function parseTasksDoc(markdown: string): readonly TaskEntry[] {
  const entries: TaskEntry[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = CHECKBOX_LINE.exec(rawLine.trim());
    if (match === null) continue;
    const [, box, id, rest] = match;

    // O `[P]` (pode rodar em paralelo) é metadado de ORDEM, não do título —
    // e o travessão que costuma separar id/título é opcional (task sem ele
    // ainda tem o resto da linha como título inteiro).
    let title = (rest ?? '').trim();
    title = title.replace(/^\[P\]\s*/, '');
    title = title.replace(/^[—-]\s*/, '');
    title = title.replace(/\*\*/g, '');

    entries.push({ id: id!, done: box!.toLowerCase() === 'x', title: title.length > 0 ? title : id! });
  }

  return entries;
}

export interface TaskScope {
  readonly total: number;
  /** "T1102-T1131" quando dá para calcular uma faixa; senão o melhor rótulo que não inventa números. */
  readonly rangeLabel: string;
  /** "27 tasks · T1102-T1131" — o que o card do item desenha. */
  readonly compact: string;
}

interface SplitId {
  readonly prefix: string;
  readonly n: number;
}

/** "T1102" → `{ prefix: 'T', n: 1102 }`. `null` para um id que não segue letra(s)+número. */
function splitTaskId(id: string): SplitId | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(id);
  if (match === null) return null;
  return { prefix: match[1]!, n: Number(match[2]) };
}

function contagem(total: number): string {
  return total === 1 ? '1 task' : `${total} tasks`;
}

/**
 * O escopo compacto de "o que roda junto" — `null` sem task nenhuma (nada a
 * resumir). A faixa nunca é inventada: só aparece quando os ids realmente
 * compartilham prefixo (o formato deste repo, `T####`); documento misto ou
 * id fora do padrão degradam para o que dá pra afirmar sem palpite.
 */
export function taskScope(tasks: readonly TaskEntry[]): TaskScope | null {
  if (tasks.length === 0) return null;
  const total = tasks.length;

  const split = tasks.map((task) => splitTaskId(task.id));
  const primeiro = split[0];

  if (primeiro === null) {
    return { total, rangeLabel: tasks[0]!.id, compact: contagem(total) };
  }

  const mesmoPrefixo = split.every((entry): entry is SplitId => entry !== null && entry.prefix === primeiro.prefix);
  if (!mesmoPrefixo) {
    return { total, rangeLabel: `${tasks[0]!.id}…`, compact: `${contagem(total)} · ${tasks[0]!.id}…` };
  }

  const numeros = (split as readonly SplitId[]).map((entry) => entry.n);
  const min = Math.min(...numeros);
  const max = Math.max(...numeros);
  const rangeLabel = min === max ? `${primeiro.prefix}${min}` : `${primeiro.prefix}${min}-${primeiro.prefix}${max}`;

  return { total, rangeLabel, compact: `${contagem(total)} · ${rangeLabel}` };
}
