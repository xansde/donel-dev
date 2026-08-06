// Achado do dogfooding de 06/08 — o vocabulário de ALVO e ESCOPO num lugar só.
//
// O store já separava os dois desde a spec 010 (`D-6`: `targetRepo: string |
// null` e `scopeRepos: string[]`, em `DiscoverySnapshot` e `WorkItemSnapshot`),
// e o contrato os carrega ponta a ponta. O que faltava era a tela: o formulário
// oferecia UM campo de texto livre chamado "Repo alvo", então quem trabalha em
// microsserviço — que atravessa repositórios por natureza — digitava os dois
// nomes numa frase só. Foi assim que nasceu o card com alvo `"spotsys e
// api-spotsys"`: uma string que não bate com pasta nenhuma, e que só falhou no
// disparo, depois de já ter travado o card.
//
// As duas perguntas são diferentes e continuam separadas aqui:
//
// - **âncora** (`targetRepo`, 0..1) — ONDE a sessão senta. É o cwd. Uma só,
//   sempre, porque um agente com dois diretórios raiz erra de qual arquivo está
//   falando e o `git` dele passa a depender de onde ele estava.
// - **escopo** (`scopeRepos`, 0..N) — O QUE a mudança toca. Não abre nada;
//   viaja no `run-input.json` para a skill saber o alcance do que investiga.
//
// Coordenar dois repos que sobem juntos é trabalho do PLANO, não de uma sessão
// com dois cwd: dois itens, um por repo, ligados pela relação `ships_with`
// ("entra junto", `RelationKind`) — que existe no store exatamente para isso.

import { findProject, type KnownProject } from './esteiraSession';

export interface RepoScope {
  /** A âncora: onde a sessão abre. `null` é legítimo — discovery investiga problema, não repositório. */
  readonly targetRepo: string | null;
  /** O alcance declarado. Inclui a âncora depois de `normalizeRepoScope`. */
  readonly scopeRepos: readonly string[];
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A escolha do operador, arrumada: apara, descarta vazio, deduplica ignorando
 * caixa (preservando a grafia declarada) e **põe a âncora na frente do escopo**.
 *
 * A âncora pertencer ao escopo não é enfeite: sem isso, um card com alvo
 * `api-spotsys` e escopo `["spotsys"]` diria à skill que o repo onde ela está
 * sentada não faz parte do que ela pode tocar.
 *
 * O que esta função NÃO faz: promover a âncora quando ela falta. Escopo com um
 * repo só continua sem âncora — "só tem um, deve ser esse" é a mesma classe de
 * palpite que a D-6 proíbe, e que abriu uma fase no repo errado em 03/08.
 */
export function normalizeRepoScope(input: RepoScope): RepoScope {
  const targetRepo = clean(input.targetRepo);
  const seen = new Set<string>();
  const scopeRepos: string[] = [];

  for (const candidate of [targetRepo, ...input.scopeRepos]) {
    const repo = clean(candidate);
    if (repo === null) continue;
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    scopeRepos.push(repo);
  }

  return { targetRepo, scopeRepos };
}

/** O alcance do card em uma linha — a palavra "âncora" só aparece quando há o que ancorar. */
export function scopeSummary(input: RepoScope): string {
  const { targetRepo, scopeRepos } = normalizeRepoScope(input);
  if (targetRepo === null) {
    return scopeRepos.length === 0 ? 'nenhum repo declarado' : `${scopeRepos.join(', ')} — sem âncora`;
  }

  const outros = scopeRepos.filter((repo) => repo !== targetRepo);
  return outros.length === 0 ? targetRepo : `${targetRepo} (âncora) · ${outros.join(' · ')}`;
}

/**
 * Os repos declarados que o app não enxerga — pela **mesma** regra do disparo
 * (`findProject`). Duas regras de correspondência divergiriam no primeiro
 * conserto, e divergir aqui significa a tela dizer "tudo certo" sobre um card
 * que a fase vai recusar.
 */
export function unknownRepos(input: RepoScope, projects: readonly KnownProject[]): readonly string[] {
  const { scopeRepos } = normalizeRepoScope(input);
  return scopeRepos.filter((repo) => findProject(repo, projects) === null);
}

/** "a", "a e b", "a, b e c" — a lista lida como frase, não como array despejado. */
function enumerar(items: readonly string[], conjuncao: string): string {
  const citados = items.map((item) => `"${item}"`);
  if (citados.length <= 1) return citados[0] ?? '';
  return `${citados.slice(0, -1).join(', ')} ${conjuncao} ${citados[citados.length - 1]}`;
}

/**
 * O que dizer sobre alvo/escopo **antes** de o operador preparar a fase — ou
 * `null` quando não há o que dizer.
 *
 * O motivo de existir é o incidente de 06/08: o app só falou do repo impossível
 * DEPOIS de gravar o contexto e travar o card. Um aviso que chega depois do
 * gesto não é aviso, é laudo.
 *
 * Ordem: repo desconhecido primeiro (é o que impede a fase), falta de âncora
 * depois (é o que impede escolher onde ela roda).
 */
export function repoScopeWarning(input: RepoScope, projects: readonly KnownProject[]): string | null {
  const desconhecidos = unknownRepos(input, projects);
  if (desconhecidos.length > 0) {
    return `O app não conhece ${enumerar(desconhecidos, 'nem')} entre os projetos. A fase não abre num repo que ele não enxerga.`;
  }

  const { targetRepo, scopeRepos } = normalizeRepoScope(input);
  if (targetRepo === null && scopeRepos.length > 0) {
    return `Este card toca ${scopeRepos.length} repo${scopeRepos.length === 1 ? '' : 's'} e não diz em qual a sessão senta. Escolha a âncora antes de preparar uma fase.`;
  }

  return null;
}

/**
 * O alcance como METADADO de card — a mesma frase de `scopeSummary`, mas `null`
 * quando não há repo nenhum a declarar.
 *
 * Existe porque a linha de meta do card no mapa é uma lista de partes filtradas
 * ("repo · N planos · N itens"): ali, "nenhum repo declarado" não é informação,
 * é ruído ocupando o lugar de nada.
 */
export function scopeMeta(input: RepoScope): string | null {
  const { targetRepo, scopeRepos } = normalizeRepoScope(input);
  if (targetRepo === null && scopeRepos.length === 0) return null;
  return scopeSummary(input);
}
