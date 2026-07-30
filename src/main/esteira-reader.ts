import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EsteiraPhase } from '../shared/devMode';

// T303 (003-modo-dev, Batch A) — leitura dos artefatos que a Esteira já grava
// em disco. Mesmo estilo de `config-store.ts`: I/O injetável, NUNCA lança —
// degrada para "não sei" em vez de crashar (C4). O app só LÊ; quem escreve
// estes arquivos é sempre a skill, nunca o app (invariante 5/CA-19).
//
// CA-4 (009-modo-dev-v3) — a raiz do handoff saiu de `<repo>/.esteira/` para
// `~/.claude/esteira-state/<repo_slug>/<card_id>/<fase>/`, FORA de qualquer
// checkout git (contrato `handoff-v3.md` §D.0-bis). `<repo_slug>` é o nome do
// repo-alvo tal como aparece em `repos.json → repos` (chave, não path) — este
// app ainda não lê `repos.json` (isso é da engrenagem do lote 3, CA-23), então
// quem resolve `repoSlug` (hoje: basename do `repoPath` local) é o chamador
// (`main/index.ts`), nunca este módulo. Ver decisão no report do lote 2.
//
// Layout, um diretório por fase:
//   <root>/<repoSlug>/<cardId>/<fase>/
//     <cardId>-ctx.md
//     handoffs/<fase>-result.json                      (discovery/plano/documentar/cliente)
//     handoffs/fase-<n>/<fase>-result.json              (implementar/validar — D.0-bis)
//
// Implementar/Validar arquivam POR FASE DO PLANO (`fase_num`, unidade de PR):
// sem um `faseNum` conhecido não há como saber QUAL arquivo ler — a
// degradação (C4/CA-6) é não ler nada, nunca chutar `fase-1`. Quem hoje
// decide `faseNum: 1` como ponto de partida (até o carrossel do lote 7/CA-11
// existir) é o chamador (`discovery-tree.ts`), documentado lá — este módulo
// permanece agnóstico.

export interface EsteiraReaderIoDeps {
  existsSync: (path: string) => boolean;
  /** `null` = ausente/ilegível — nunca lança. */
  readFileText: (path: string) => string | null;
}

export function createSystemEsteiraReaderIoDeps(): EsteiraReaderIoDeps {
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

/** A raiz durável do handoff v3 (CA-4/D.0-bis) — `~/.claude/esteira-state/<repo_slug>`. */
export interface EsteiraStateRoot {
  readonly esteiraStateRoot: string;
  readonly repoSlug: string;
}

/** CA-4 — onde ler UMA fase de UM card. `faseNum` só se aplica a implementar/validar. */
export interface PhaseArtifactsLocation extends EsteiraStateRoot {
  readonly cardId: string;
  readonly fase: EsteiraPhase;
  readonly faseNum?: number | null;
}

/** Fases que arquivam o result.json por fase do plano (`handoffs/fase-<n>/…`, D.0-bis). */
const PHASE_ARCHIVES_BY_FASE_NUM: readonly EsteiraPhase[] = ['implementar', 'validar'];

/** Shape lido de `<fase>-result.json` (produzido pela SKILL, nunca pelo app). */
export interface EsteiraResultManifest {
  readonly card_id: string;
  readonly fase: string;
  readonly status: string; // "success" | outro valor = falhou (CA-15)
  readonly started_at: string;
  readonly finished_at: string;
  readonly executor: string;
  readonly model: string;
  readonly effort: string;
  readonly outputs: {
    readonly summary?: string;
    /**
     * CA-17 — só no discovery-result.json. Substitui `fanout_cards[]`
     * (`{card_id, marco_id}`, morto): agora `{card_id, track, shadow}`, sem
     * `marco_id` (contrato §D.2). Um item por card de plano.
     */
    readonly plan_cards?: readonly { card_id: string; track: 'codigo' | 'documental'; shadow: boolean }[];
    /**
     * Lote 7 (CA-11) — só no plano-result.json: as fases (`fase_num`, unidade
     * de PR) que o plano fatiou. É a fonte de "quantos PRs este card de plano
     * propõe" — sem ela, Implementação/Validação não têm de onde nascer
     * (CA-14, degradação por omissão, nunca `fase 1` chutada).
     *
     * Lote 8 (CA-20) — `garantia` por fase (contrato §D.3): a declaração
     * AUTORITATIVA da garantia daquela fase do plano (`tipo`, `descricao`,
     * `roteiro_path` — `null` quando `tipo != "roteiro_e2e"`). É a mesma
     * garantia pras duas sub-fases (implementar/validar, D13 — "1 garantia :
     * 1 fase do plano"), por isso mora aqui e não em cada `*-result.json`
     * individual.
     */
    readonly fases?: readonly {
      fase_num: number;
      titulo?: string;
      garantia?: { tipo?: string; descricao?: string; roteiro_path?: string | null };
    }[];
    /** CA-21 — só no validar-result.json (contrato §D.5): "todas as fases deste plano estão homologadas". A v3 não grava `concluir-result.json`; este é o sinal de disco mais próximo de "o card de plano terminou". */
    readonly plano_completo?: boolean;
    /** CA-8: os ÚNICOS artefatos declarados por uma fase — nunca varredura. */
    readonly artifact_paths?: readonly string[];
    /**
     * CA-17 — substitui o antigo `e2e_path` (escalar solto, morto). A
     * garantia é 1:1 com a fase (contrato §D.3/§D.4): `tipo` +
     * `path`/`roteiro_path` conforme a fase que gravou. Shape permissivo de
     * propósito — o schema completo (`fases[]`, `pr`, `checks`...) é dos
     * lotes 4/7/8; aqui só o suficiente para o que a UI hoje lê.
     */
    readonly garantia?: {
      readonly tipo?: string;
      readonly path?: string | null;
      readonly descricao?: string;
      readonly roteiro_path?: string | null;
    };
    readonly documents?: readonly string[];
    readonly knowledge?: { readonly repo_lessons?: string; readonly consulted?: unknown };
    readonly [key: string]: unknown;
  };
  readonly registrations?: {
    readonly taskdex?: unknown;
    readonly vault?: { readonly path: string | null; readonly section: string | null };
  };
  readonly next_fase_suggested?: string | null;
}

export interface PhaseArtifacts {
  readonly ctxPath: string; // <root>/<repoSlug>/<cardId>/<fase>/<cardId>-ctx.md
  /** `null` — implementar/validar sem `faseNum` conhecido: não há onde ler (degradação por omissão, CA-6). */
  readonly resultPath: string | null;
  readonly ctxExists: boolean;
  readonly result: EsteiraResultManifest | null; // null = ausente OU ilegível OU sem faseNum
  /** C4 — distingue "ausente" de "ilegível": o nó mostra o que der pra ler + um marcador discreto, nunca crash. */
  readonly resultUnreadable: boolean;
  /** D3 — lidos do frontmatter do `ctx.md`; ausência de qualquer um dos dois é `null`, nunca erro. */
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

/**
 * A skill da Esteira grava `artifact_paths` como OBJETO nomeado
 * ({spec: "...", plan: "..."}), não como array — o tipo aqui prometia array e
 * o cast cru chegou ao renderer, onde o spread de um não-iterável derrubou a
 * árvore inteira (tela preta, 1º teste com manifesto real em 28/07). O reader
 * aceita os dois formatos e entrega SEMPRE lista de paths; valor de formato
 * desconhecido degrada para lista vazia (C4), nunca lança. Agnóstico ao NOME
 * das chaves do objeto — `e2e` → `garantia` (CA-17) não pede mudança aqui.
 */
function normalizePathList(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value === 'object') {
    return Object.values(value).filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function normalizeManifest(parsed: EsteiraResultManifest): EsteiraResultManifest {
  const outputs = parsed.outputs;
  if (!outputs || typeof outputs !== 'object') return parsed;

  const artifactPaths = normalizePathList(outputs.artifact_paths);
  const documents = normalizePathList(outputs.documents);
  if (artifactPaths === outputs.artifact_paths && documents === outputs.documents) return parsed;

  return {
    ...parsed,
    outputs: {
      ...outputs,
      ...(artifactPaths !== undefined ? { artifact_paths: artifactPaths } : {}),
      ...(documents !== undefined ? { documents } : {}),
    },
  };
}

function phaseDir(location: PhaseArtifactsLocation): string {
  return join(location.esteiraStateRoot, location.repoSlug, location.cardId, location.fase);
}

function esteiraCtxPath(location: PhaseArtifactsLocation): string {
  return join(phaseDir(location), `${location.cardId}-ctx.md`);
}

/** `null` quando implementar/validar não têm `faseNum` — não há caminho a resolver (nunca chuta `fase-1`). */
function esteiraResultPath(location: PhaseArtifactsLocation): string | null {
  const dir = phaseDir(location);
  const fileName = `${location.fase}-result.json`;

  if (PHASE_ARCHIVES_BY_FASE_NUM.includes(location.fase)) {
    if (location.faseNum === undefined || location.faseNum === null) return null;
    return join(dir, 'handoffs', `fase-${location.faseNum}`, fileName);
  }

  return join(dir, 'handoffs', fileName);
}

/** CA-4/CA-8/CA-10/D3 — leitura pura de UMA fase de UM card. Nunca lança. */
export function readPhaseArtifacts(location: PhaseArtifactsLocation, io: EsteiraReaderIoDeps): PhaseArtifacts {
  const ctxPath = esteiraCtxPath(location);
  const resultPath = esteiraResultPath(location);

  const ctxFileExists = io.existsSync(ctxPath);
  const ctxText = ctxFileExists ? io.readFileText(ctxPath) : null;
  const worktreePath = ctxText ? extractFrontmatterField(ctxText, 'worktree_path') : null;
  const branch = ctxText ? extractFrontmatterField(ctxText, 'branch') : null;

  const resultExists = resultPath !== null && io.existsSync(resultPath);
  // FIX (E2E 30/07, achado F3) — `<cardId>-ctx.md` mora em `<fase>/`, um
  // arquivo só POR TIPO de fase (`implementar`/`validar`), reescrito a cada
  // `fase_num` que passa por ali (contrato v3, não muda aqui). Pra
  // implementar/validar (arquivam por `fase-<n>`, D.0-bis), a mera EXISTÊNCIA
  // desse arquivo compartilhado não prova que ESTE `faseNum` específico já
  // rodou — a fase 2 herdava o ctx.md que a fase 1 escreveu e virava "stuck"
  // (nenhum result.json ainda, mas ctx "existe") em vez de "not-started"
  // (CA-13: só a etapa que JÁ teve sessão entra na trilha antes da próxima).
  // O único sinal por-fase-num que temos é o próprio `handoffs/fase-<n>/…`
  // (o mesmo arquivo que `esteiraResultPath` lê) — sem ele, a fase 2 nunca
  // arquivou nada, e `ctxExists` (o campo que `derivePhaseStatus` consulta)
  // reflete isso, mesmo com `worktreePath`/`branch` acima ainda lidos do
  // ctx.md compartilhado (esses dois continuam válidos — o worktree é o
  // mesmo pro card inteiro). Sem `faseNum` conhecido, comportamento
  // INALTERADO (mesma degradação "sem resultado" já documentada abaixo,
  // C4/CA-6).
  const ctxExists =
    PHASE_ARCHIVES_BY_FASE_NUM.includes(location.fase) && location.faseNum !== undefined && location.faseNum !== null
      ? ctxFileExists && resultExists
      : ctxFileExists;
  const resultText = resultExists && resultPath !== null ? io.readFileText(resultPath) : null;

  let result: EsteiraResultManifest | null = null;
  let resultUnreadable = false;
  if (resultText !== null) {
    try {
      result = normalizeManifest(JSON.parse(resultText) as EsteiraResultManifest);
    } catch {
      resultUnreadable = true;
    }
  }

  return { ctxPath, resultPath, ctxExists, result, resultUnreadable, worktreePath, branch };
}

/**
 * Extrai um campo escalar simples do bloco de frontmatter YAML (`---`...`---`
 * no topo do arquivo). Não é um parser YAML completo — só o suficiente para os
 * campos planos que o `ctx.md` da Esteira grava (`chave: valor` numa linha só).
 * `null`/`~`/vazio/ausente viram `null`, nunca lançam.
 */
function extractFrontmatterField(text: string, field: string): string | null {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatterMatch) return null;

  const body = frontmatterMatch[1];
  const lineMatch = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm').exec(body);
  if (!lineMatch) return null;

  const raw = lineMatch[1].trim();
  if (!raw || raw === 'null' || raw === '~') return null;
  return raw.replace(/^['"]|['"]$/g, '');
}

/** CA-17 — um card de plano lido de `outputs.plan_cards[]` (substitui `fanout_cards[]`, sem `marco_id`). */
export interface PlanCardRef {
  readonly cardId: string;
  readonly track: 'codigo' | 'documental';
  readonly shadow: boolean;
}

/** CA-14/CA-17/Modelo de domínio — os cards de plano lidos do `discovery-result.json` do card raiz. Nunca lança; ausente/ilegível/sem campo vira `[]`. */
export function readDiscoveryPlanCards(root: EsteiraStateRoot, cardId: string, io: EsteiraReaderIoDeps): readonly PlanCardRef[] {
  const { result, resultUnreadable } = readPhaseArtifacts({ ...root, cardId, fase: 'discovery' }, io);
  if (resultUnreadable || result === null) return [];

  const planCards = result.outputs.plan_cards;
  if (!planCards) return [];

  return planCards.map((entry) => ({
    cardId: entry.card_id,
    track: entry.track === 'documental' ? 'documental' : 'codigo',
    shadow: entry.shadow === true,
  }));
}

/** Lote 8 (CA-20) — a garantia declarada pelo plano para uma fase (contrato §D.3). `null` = a fase não declarou (ou o plano ainda não gravou) garantia — degradação por omissão. */
export interface PlanoFaseGarantiaRef {
  readonly tipo: string | null;
  readonly descricao: string | null;
  readonly roteiroPath: string | null;
}

/** Lote 7 (CA-11) — uma fase (`fase_num`, unidade de PR) que o plano declarou. */
export interface PlanoFaseRef {
  readonly faseNum: number;
  /** `null` = plano não deu título à fase — degradação por omissão, nunca fabricado. */
  readonly titulo: string | null;
  /** Lote 8 (CA-20) — `null` = a fase não tem garantia declarada. */
  readonly garantia: PlanoFaseGarantiaRef | null;
}

/**
 * CA-11/CA-14 — as fases que o PLANO de um card propôs, lidas de
 * `plano-result.json → outputs.fases[]`, ordenadas por `fase_num`. Nunca
 * lança; ausente/ilegível/sem o campo vira `[]` — é essa lista vazia que faz
 * os níveis de Implementação/Validação não nascerem (CA-14), nunca uma fase
 * 1 chutada por suposição. Entradas sem `fase_num` numérico são descartadas;
 * as vizinhas válidas sobrevivem (mesma disciplina de `parseSubIssues`).
 */
export function readPlanoFases(root: EsteiraStateRoot, cardId: string, io: EsteiraReaderIoDeps): readonly PlanoFaseRef[] {
  const { result, resultUnreadable } = readPhaseArtifacts({ ...root, cardId, fase: 'plano' }, io);
  if (resultUnreadable || result === null) return [];

  const fases = result.outputs.fases;
  if (!fases) return [];

  return fases
    .filter((entry) => typeof entry.fase_num === 'number')
    .map((entry) => ({
      faseNum: entry.fase_num,
      titulo: typeof entry.titulo === 'string' ? entry.titulo : null,
      garantia: normalizeGarantiaRef(entry.garantia),
    }))
    .sort((a, b) => a.faseNum - b.faseNum);
}

/** Lote 8 (CA-20) — `undefined`/shape errado vira `null` (C4), nunca fabrica um tipo/descrição que o plano não declarou. */
function normalizeGarantiaRef(raw: { tipo?: string; descricao?: string; roteiro_path?: string | null } | undefined): PlanoFaseGarantiaRef | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    tipo: typeof raw.tipo === 'string' ? raw.tipo : null,
    descricao: typeof raw.descricao === 'string' ? raw.descricao : null,
    roteiroPath: typeof raw.roteiro_path === 'string' ? raw.roteiro_path : null,
  };
}
