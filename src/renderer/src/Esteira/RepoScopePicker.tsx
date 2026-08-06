import { Select } from '@donel-dev/design-system';
import { useMemo } from 'react';
import type { KnownProject } from './esteiraSession';
import { normalizeRepoScope, repoScopeWarning, type RepoScope } from './repoScope';
import styles from './RepoScopePicker.module.css';

// Achado do dogfooding de 06/08 — o formulário onde a âncora e o escopo do card
// são declarados. Ele existe porque o campo anterior era um `TextInput` livre
// rotulado "Repo alvo (opcional)", com placeholder `ex.: donel-dev`: um convite
// a digitar o nome de uma pasta de memória. Quem trabalha em microsserviço
// digitou o que faltava — `"spotsys e api-spotsys"` — e o card só falhou no
// disparo, depois de travar.
//
// Duas escolhas de forma, as duas com motivo:
//
// 1. **A âncora é um Select, não um campo de texto.** O app já sabe a lista de
//    projetos (`scanProjects`); pedir que o operador a digite de novo é pedir
//    que ele erre. O que ele não pode fazer é inventar um repo que o app não
//    enxerga — a D-6 já dizia isso do lado do disparo, e agora a tela concorda.
// 2. **O escopo é chip que liga e desliga**, não uma segunda caixa de texto.
//    "Quais destes" é a pergunta certa; "escreva os nomes separados por
//    vírgula" recria o campo livre com outra roupa.
//
// Um repo declarado que o app NÃO conhece continua aparecendo — marcado como
// desconhecido. Esconder o valor ruim deixaria o operador sem entender por que
// o card recusa: ele veria um formulário limpo sobre um card quebrado.

export const SEM_ANCORA = '';

export interface RepoScopePickerProps {
  readonly value: RepoScope;
  readonly onChange: (next: RepoScope) => void;
  readonly projects: readonly KnownProject[];
  readonly disabled?: boolean;
  /** Rótulo da âncora — muda entre criar ("Onde isto roda") e corrigir um card existente. */
  readonly anchorLabel?: string;
}

export function RepoScopePicker({
  value,
  onChange,
  projects,
  disabled = false,
  anchorLabel = 'Âncora (onde a sessão abre)',
}: RepoScopePickerProps): JSX.Element {
  const normalized = useMemo(() => normalizeRepoScope(value), [value]);
  const warning = useMemo(() => repoScopeWarning(normalized, projects), [normalized, projects]);

  const conhecidos = useMemo(() => projects.map((project) => project.name), [projects]);
  // Os repos que o card declara e o app não conhece entram na lista mesmo assim:
  // é assim que o operador vê — e consegue tirar — o valor que trava o card.
  const declaradosDesconhecidos = useMemo(
    () => normalized.scopeRepos.filter((repo) => !conhecidos.some((nome) => nome.toLowerCase() === repo.toLowerCase())),
    [normalized.scopeRepos, conhecidos],
  );
  const chips = useMemo(() => [...conhecidos, ...declaradosDesconhecidos], [conhecidos, declaradosDesconhecidos]);

  const anchorOptions = useMemo(
    () => [
      { value: SEM_ANCORA, label: '— sem repo (só investigação) —' },
      ...chips.map((repo) => ({
        value: repo,
        label: declaradosDesconhecidos.includes(repo) ? `${repo} (o app não conhece)` : repo,
      })),
    ],
    [chips, declaradosDesconhecidos],
  );

  function setAnchor(next: string): void {
    onChange(normalizeRepoScope({ targetRepo: next === SEM_ANCORA ? null : next, scopeRepos: normalized.scopeRepos }));
  }

  function toggleScope(repo: string): void {
    // A âncora não sai do escopo por clique no chip: ela pertence ao escopo por
    // definição. Quem quer removê-la troca a âncora, que é o gesto honesto.
    if (repo === normalized.targetRepo) return;
    const marcado = normalized.scopeRepos.includes(repo);
    onChange(
      normalizeRepoScope({
        targetRepo: normalized.targetRepo,
        scopeRepos: marcado ? normalized.scopeRepos.filter((item) => item !== repo) : [...normalized.scopeRepos, repo],
      }),
    );
  }

  return (
    <div className={styles.picker} data-testid="repo-scope-picker">
      <Select label={anchorLabel} value={normalized.targetRepo ?? SEM_ANCORA} options={anchorOptions} onChange={setAnchor} disabled={disabled} />

      <div className={styles.scope}>
        <span className={styles.scopeLabel}>Escopo (o que a mudança toca)</span>
        {chips.length === 0 ? (
          <p className={styles.empty}>Nenhum projeto configurado — a fase não tem onde abrir.</p>
        ) : (
          <div className={styles.chips}>
            {chips.map((repo) => {
              const marcado = normalized.scopeRepos.includes(repo);
              const ancora = repo === normalized.targetRepo;
              const desconhecido = declaradosDesconhecidos.includes(repo);
              return (
                <button
                  key={repo}
                  type="button"
                  className={[styles.chip, marcado ? styles.chipOn : '', desconhecido ? styles.chipUnknown : ''].filter(Boolean).join(' ')}
                  onClick={() => toggleScope(repo)}
                  disabled={disabled || ancora}
                  aria-pressed={marcado}
                  title={ancora ? 'É a âncora — troque a âncora para tirá-la do escopo.' : undefined}
                >
                  {repo}
                  {ancora ? <span className={styles.anchorMark}> ⚓</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* O aviso vive AQUI, ao lado da escolha — não depois do disparo. Foi um
          aviso chegando tarde demais que deixou um card travado por um trabalho
          que nunca começou. */}
      {warning ? (
        <p className={styles.warning} data-testid="repo-scope-warning">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
