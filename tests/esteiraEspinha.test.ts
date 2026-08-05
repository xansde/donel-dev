import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEsteiraService, type EsteiraService } from '../src/main/esteira-service';
import { cardView, lockView, phaseLines, verificationLines } from '../src/renderer/src/Esteira/esteiraView';

// Spec 010 — A ESPINHA, ponta a ponta, com as duas pontas de VERDADE:
//
//   app dispara  →  run-input.json no inbox
//   skill lê o input e emite pelo emissor Python real  →  result.json no outbox
//   app ingere   →  o card aparece na tela
//
// Não há dublê: o `result.json` sai de `skills/esteira-donel-3.0.0/tools`, o
// mesmo código que a skill roda. E o teste que mais importa é o último — o
// documento fora do contrato vira ERRO VISÍVEL no card, com caminho e motivo.
// É esse par (caminho feliz + documento quebrado) que prova que a inverdade de
// 03/08 não tem mais como acontecer.

const SKILL_TOOLS_DIR = fileURLToPath(new URL('../skills/esteira-donel-3.0.0/tools/', import.meta.url));

let root: string;
let service: EsteiraService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'donel-esteira-espinha-'));
  mkdirSync(join(root, 'outbox'), { recursive: true });
  let seq = 0;
  service = createEsteiraService({
    storeDir: join(root, 'store'),
    inboxDir: join(root, 'inbox'),
    outboxDir: join(root, 'outbox'),
    channel: 'dev',
    now: () => '2026-08-04T14:30:00.000Z',
    newId: (prefix) => {
      seq += 1;
      return `${prefix}-${seq}`;
    },
  });
});

afterEach(() => {
  service.dispose();
});

/** A skill de verdade: lê o input, monta os fatos e emite pelo `emit_result.py`. */
function runSkill(inputPath: string, facts: unknown[], extraArgs: string[] = []): string {
  const factsPath = join(root, 'facts.json');
  writeFileSync(factsPath, JSON.stringify(facts), 'utf8');
  return execFileSync(
    'python',
    ['emit_result.py', '--input', inputPath, '--facts-file', factsPath, '--model', 'claude-opus-5', '--effort', 'high', ...extraArgs],
    { cwd: SKILL_TOOLS_DIR, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  ).trim();
}

describe('espinha — do gesto no app ao card na tela', () => {
  it('cria, dispara, a skill responde, o app ingere e o card mostra o que aconteceu', () => {
    // 1. O gesto no app.
    const created = service.createDiscovery({
      title: 'Fila de importacao trava sem sinal',
      problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
      targetRepo: 'atlas',
      scopeRepos: ['atlas'],
      tracker: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // 2. O disparo: contexto tipado no inbox + trava + sessão.
    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) return;

    // A skill consegue LER o que o app escreveu (o outro lado do contrato).
    const rendered = execFileSync('python', ['read_input.py', '--input', dispatched.inputPath], {
      cwd: SKILL_TOOLS_DIR,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    expect(rendered).toContain('Fila de importacao trava sem sinal');
    expect(rendered).toContain(dispatched.resultPath);

    // 3. A skill responde — emissor real, nenhum JSON escrito à mão aqui.
    const written = runSkill(dispatched.inputPath, [
      {
        type: 'discovery.recorded',
        discovery_id: created.discoveryId,
        title: 'Fila de importacao trava sem sinal',
        problem: 'Lotes grandes ficam pendentes sem erro e sem log.',
        target_repo: 'atlas',
        scope_repos: ['atlas'],
      },
      { type: 'plan.recorded', plan_id: 'pln-espinha-1', discovery_id: created.discoveryId, title: 'Tornar o estado observavel' },
      {
        type: 'relation.recorded',
        relation: 'originated',
        from: { entity: 'discovery', id: created.discoveryId },
        to: { entity: 'plan', id: 'pln-espinha-1' },
      },
      { type: 'note.recorded', subject: { entity: 'discovery', id: created.discoveryId }, text: 'Duas hipoteses descartadas.' },
      // A18 — a discovery so fecha porque alguem confirmou alguma coisa.
      {
        type: 'gate.confirmed',
        subject: { entity: 'discovery', id: created.discoveryId },
        condition: 'o repo alvo e atlas',
        confirmed_by: 'dono do repo',
      },
      {
        type: 'phase.completed',
        subject: { entity: 'discovery', id: created.discoveryId },
        phase: 'discovery',
        outcome: 'done',
        summary: 'Um plano proposto.',
      },
    ]);
    expect(written).toBe(dispatched.resultPath);

    // 4. O app ingere e o card mostra.
    const state = service.scanOutbox();
    const view = cardView(state.snapshot, created.discoveryId);

    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.plans).toHaveLength(1);
    expect(view.notes).toHaveLength(1);
    expect(view.phases[0].outcome).toBe('done');
    // Com plano registrado, o card sai de "discovery" — a etapa foi DERIVADA
    // dos fatos, nunca digitada.
    expect(view.discovery.derivedStage).toBe('planned');
    expect(view.signals.map((signal) => signal.label)).not.toContain('não consegui ler');
  });

  // Batch B1 — o pedaço que faltava da espinha: o disparo abre a SESSÃO, e o
  // card acompanha as três frases dela. As três são diferentes de propósito, e
  // as três já foram ditas erradas nesta tela.
  it('preparada → em andamento → interrompida: o card conta o que houve com a sessão', () => {
    const created = service.createDiscovery({ title: 'Card com sessao', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    if (!created.ok) return;

    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    if (!dispatched.ok) return;

    // 1. Preparada: o app separou o contexto e travou. Nada está rodando.
    const preparada = cardView(service.snapshotDto().snapshot, created.discoveryId)!;
    expect(lockView(preparada)?.title).toBe('Preparada — ninguém assumiu ainda');
    expect(phaseLines(preparada)[0].text).toBe('discovery — preparada, ninguém assumiu');
    // O comando oferecido é o MESMO que a aba recebe pré-digitado.
    // A2 — a skill do FORK (sufixo -3), nunca o plugin 2.1.0 sem sufixo.
    expect(lockView(preparada)?.nextStep?.command).toBe(`/esteira-discovery-3 --input "${dispatched.inputPath}"`);

    // 2. A aba abriu e o CLI devolveu o id: a trava ganha dono com nome. E só
    //    isso — a aba existir não é a fase estar rodando, porque o Enter é
    //    gesto humano e o app não tem como saber se ele aconteceu.
    const assumida = cardView(service.claimSession({ sessionId: dispatched.sessionId, cliSessionId: 'cli-espinha' }).snapshot, created.discoveryId)!;
    expect(lockView(assumida)?.title).toBe('Sessão aberta');
    expect(lockView(assumida)?.line).toContain('cli-espinha');
    expect(phaseLines(assumida)[0].text).toBe('discovery — sessão aberta');

    // 3. A aba fechou sem concluir: o card NÃO fica preso, e diz o que houve.
    const fechada = cardView(service.endSession({ sessionId: dispatched.sessionId, reason: 'tab-closed' }).snapshot, created.discoveryId)!;
    expect(fechada.lock).toBeNull();
    expect(lockView(fechada)).toBeNull();
    expect(phaseLines(fechada)[0].text).toBe('discovery — interrompida: a sessão terminou sem concluir');

    // E o card volta a aceitar disparo — a saída não depende de ninguém.
    const denovo = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    expect(denovo.ok).toBe(true);
  });

  it('a fase que a skill CONCLUIU não vira "interrompida" quando a aba fecha depois', () => {
    const created = service.createDiscovery({ title: 'Card concluido', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    if (!created.ok) return;
    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: 'C:/dev/atlas', worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    if (!dispatched.ok) return;
    service.claimSession({ sessionId: dispatched.sessionId, cliSessionId: 'cli-espinha' });

    runSkill(dispatched.inputPath, [
      { type: 'discovery.recorded', discovery_id: created.discoveryId, title: 'Card concluido' },
      { type: 'gate.confirmed', subject: { entity: 'discovery', id: created.discoveryId }, condition: 'o problema e esse', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery', outcome: 'done' },
    ]);
    service.scanOutbox();

    // Fechar a aba DEPOIS do trabalho pronto é o caso normal: não grava nada,
    // e a fase continua concluída.
    const state = service.endSession({ sessionId: dispatched.sessionId, reason: 'tab-closed' });
    expect(phaseLines(cardView(state.snapshot, created.discoveryId)!)[0].text).toBe('discovery — concluída');
  });

  it('discovery que termina SEM plano aparece como desfecho, não como pendência (o card F3)', () => {
    const created = service.createDiscovery({ title: 'Como o time decide a semana', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    if (!created.ok) return;
    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: null,
      continuesSessionId: null,
      handoffReason: null,
    });
    if (!dispatched.ok) return;

    runSkill(dispatched.inputPath, [
      { type: 'discovery.recorded', discovery_id: created.discoveryId, title: 'Como o time decide a semana' },
      {
        type: 'decision.recorded',
        subject: { entity: 'discovery', id: created.discoveryId },
        decision: 'a fila da semana se decide na segunda',
        confirmed_by: 'dono do repo',
      },
      { type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery', outcome: 'done' },
    ]);

    const view = cardView(service.scanOutbox().snapshot, created.discoveryId);
    expect(view?.signals.map((signal) => signal.label)).toContain('sem plano registrado');
    expect(view?.signals.find((signal) => signal.label === 'sem plano registrado')?.tone).toBe('neutral');
  });

  it('fase que FALHOU chega ao card com o código do erro — nunca como "não realizada"', () => {
    const created = service.createDiscovery({ title: 'Card com fase que falha', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    if (!created.ok) return;
    const dispatched = service.dispatch({
      phase: 'discovery',
      discoveryId: created.discoveryId,
      planId: null,
      workItemId: null,
      workspace: { target_repo: 'atlas', repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    if (!dispatched.ok) return;

    runSkill(
      dispatched.inputPath,
      [{ type: 'note.recorded', subject: { entity: 'discovery', id: created.discoveryId }, text: 'Abortou antes de tocar arquivo.' }],
      ['--status', 'failed', '--failure-code', 'worktree-dirty', '--failure-message', 'Havia alteracoes nao commitadas.'],
    );

    const view = cardView(service.scanOutbox().snapshot, created.discoveryId);
    const failed = view?.phases.find((entry) => entry.phase === 'discovery');
    expect(failed?.failure?.code).toBe('worktree-dirty');
    // A fase NÃO conta como concluída — a etapa não avança por causa de um run ruim.
    expect(failed?.completedAt).toBeNull();
    expect(view?.discovery.derivedStage).toBe('discovery');
  });

  // Spec 010 (B7) — o CICLO COMPLETO de um item, com os emissores reais das
  // seis fases. É o que P-3 exige para a 2.x sair: um card rodando de ponta a
  // ponta no modelo novo. O que cada fase promete declarar vem da tabela
  // `x-required-facts` do schema, cobrada nos dois lados.
  it('um item vai de plano a concluído com as quatro fases novas, e a evidência aparece no card', () => {
    const created = service.createDiscovery({
      title: 'Fila de importacao trava sem sinal',
      problem: null,
      targetRepo: 'atlas',
      scopeRepos: ['atlas'],
      tracker: null,
    });
    if (!created.ok) return;
    const workspace = { target_repo: 'atlas', repo_path: 'C:/code/atlas', worktree_path: null, branch: 'feat/fila' };

    /** Dispara a fase pelo app e devolve o caminho do `run-input.json` que ele deixou. */
    function dispatch(phase: string, subject: { planId?: string; workItemId?: string } = {}): string {
      const dispatched = service.dispatch({
        phase,
        discoveryId: created.ok ? created.discoveryId : '',
        planId: subject.planId ?? null,
        workItemId: subject.workItemId ?? null,
        workspace,
        continuesSessionId: null,
        handoffReason: null,
      });
      if (!dispatched.ok) throw new Error(`disparo de ${phase} recusado: ${dispatched.reason}`);
      return dispatched.inputPath;
    }

    const item = { entity: 'work_item', id: 'wi-ciclo-1' } as const;

    runSkill(dispatch('discovery'), [
      { type: 'discovery.recorded', discovery_id: created.discoveryId, title: 'Fila de importacao trava sem sinal', target_repo: 'atlas' },
      { type: 'plan.recorded', plan_id: 'pln-ciclo-1', discovery_id: created.discoveryId, title: 'Tornar observavel' },
      { type: 'gate.confirmed', subject: { entity: 'discovery', id: created.discoveryId }, condition: 'o repo alvo e atlas', confirmed_by: 'dono do repo' },
      { type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery', outcome: 'done' },
    ]);
    service.scanOutbox();

    runSkill(dispatch('plano', { planId: 'pln-ciclo-1' }), [
      {
        type: 'work_item.recorded',
        work_item_id: item.id,
        plan_id: 'pln-ciclo-1',
        item_type: 'issue',
        title: 'Expor estado da fila',
        target_repo: 'atlas',
      },
      {
        type: 'decision.recorded',
        subject: { entity: 'plan', id: 'pln-ciclo-1' },
        decision: 'expor o estado antes de mexer no consumo',
        confirmed_by: 'dono do repo',
      },
      { type: 'phase.completed', subject: { entity: 'plan', id: 'pln-ciclo-1' }, phase: 'plano', outcome: 'done' },
    ]);
    service.scanOutbox();

    // Implementar: o que dá para conferir é o check que ela escreveu e rodou.
    runSkill(dispatch('implementar', { planId: 'pln-ciclo-1', workItemId: item.id }), [
      { type: 'verification.recorded', subject: item, verification_kind: 'check', state: 'passed', ref: 'npm test' },
      { type: 'phase.completed', subject: item, phase: 'implementar', outcome: 'done' },
    ]);
    service.scanOutbox();

    // Validar: o PR existe (gesto humano) e ainda não foi verificado.
    runSkill(dispatch('validar', { planId: 'pln-ciclo-1', workItemId: item.id }), [
      { type: 'verification.recorded', subject: item, verification_kind: 'pull-request', state: 'pending', ref: 'https://exemplo/pr/128' },
      { type: 'artifact.recorded', owner: item, artifact_kind: 'review-report', location: 'disk', path: 'C:/tmp/review.md' },
      { type: 'phase.completed', subject: item, phase: 'validar', outcome: 'done' },
    ]);
    service.scanOutbox();

    // Documentar: o ponteiro do documento, no repo âncora (D-8).
    runSkill(dispatch('documentar', { planId: 'pln-ciclo-1', workItemId: item.id }), [
      { type: 'artifact.recorded', owner: item, artifact_kind: 'adr', location: 'repo', repo: 'atlas', path: 'docs/adr/0007.md' },
      { type: 'phase.completed', subject: item, phase: 'documentar', outcome: 'done' },
    ]);
    service.scanOutbox();

    // Concluir: a MESMA referência de PR, agora verificada.
    runSkill(dispatch('concluir', { planId: 'pln-ciclo-1', workItemId: item.id }), [
      { type: 'verification.recorded', subject: item, verification_kind: 'pull-request', state: 'passed', ref: 'https://exemplo/pr/128' },
      { type: 'phase.completed', subject: item, phase: 'concluir', outcome: 'done', summary: 'PR mergeado e verificado.' },
    ]);

    const view = cardView(service.scanOutbox().snapshot, created.discoveryId);
    expect(view).not.toBeNull();
    if (view === null) return;

    const doItem = view.phases.filter((phase) => phase.subject.id === item.id);
    expect(doItem.map((phase) => phase.phase).sort()).toEqual(['concluir', 'documentar', 'implementar', 'validar']);
    expect(doItem.every((phase) => phase.outcome === 'done' && phase.completedAt !== null)).toBe(true);
    // Nenhuma trava sobrou: cada `phase.completed` solta a sua, e o disparo
    // seguinte só foi possível por causa disso.
    expect(view.lock).toBeNull();

    // A evidência de D-4 chegou ao card — e a segunda declaração do MESMO PR
    // atualizou o estado em vez de empilhar um segundo.
    const pr = view.verifications.filter((verification) => verification.verificationKind === 'pull-request');
    expect(pr).toHaveLength(1);
    expect(pr[0].state).toBe('passed');
    expect(verificationLines(view).map((line) => line.text)).toEqual(
      expect.arrayContaining(['verificação passou', 'PR mergeado e verificado']),
    );
    expect(view.signals.map((signal) => signal.label)).not.toContain('não consegui ler');
  });

  it('fase que promete e não cumpre é RECUSADA na ingestão — não entra pela metade', () => {
    const created = service.createDiscovery({ title: 'Card com validar incompleta', problem: null, targetRepo: 'atlas', scopeRepos: [], tracker: null });
    if (!created.ok) return;

    // Um `result.json` escrito à mão (o emissor recusaria emiti-lo): fase
    // `validar` bem-sucedida que não declara o que verificou. Antes de B7 isto
    // entrava calado e o card dizia "validar — concluída" sem nada por trás.
    const incompleto = join(root, 'outbox', 'validar-sem-verificacao.json');
    writeFileSync(
      incompleto,
      JSON.stringify({
        contract_version: '1.0.0',
        kind: 'esteira.result',
        run: { run_id: 'run-incompleto', phase: 'validar', status: 'success', started_at: '2026-08-04T14:00:00.000Z', finished_at: '2026-08-04T14:20:00.000Z', failure: null },
        actor: { tool: 'esteira-donel', tool_version: '3.0.0' },
        subject: { discovery_id: created.discoveryId },
        facts: [{ type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'validar', outcome: 'done' }],
      }),
      'utf8',
    );

    const view = cardView(service.scanOutbox().snapshot, created.discoveryId);
    expect(view?.signals.map((signal) => signal.label)).toContain('não consegui ler');
    expect(view?.ingestErrors[0].issues.some((issue) => issue.code === 'missing_required_fact')).toBe(true);
    // E a fase NÃO aparece como concluída: o documento inteiro foi recusado.
    expect(view?.phases).toHaveLength(0);
  });

  it('documento fora do contrato vira ERRO VISÍVEL no card, com caminho e motivo', () => {
    const created = service.createDiscovery({ title: 'Card que recebe lixo', problem: null, targetRepo: null, scopeRepos: [], tracker: null });
    if (!created.ok) return;

    // Um "result.json" que um lado escreveu com um campo que o outro não
    // conhece — exatamente o desencontro que originou a spec.
    const rogue = join(root, 'outbox', 'rogue.json');
    writeFileSync(
      rogue,
      JSON.stringify({
        contract_version: '1.0.0',
        kind: 'esteira.result',
        run: { run_id: 'run-rogue', phase: 'discovery', status: 'success', started_at: '2026-08-04T14:00:00.000Z', finished_at: '2026-08-04T14:10:00.000Z', failure: null },
        actor: { tool: 'esteira-donel', tool_version: '2.1.0' },
        subject: { discovery_id: created.discoveryId },
        facts: [
          { type: 'discovery.recorded', discovery_id: created.discoveryId, title: 'Card que recebe lixo', fanout_cards: ['card-1'] },
          { type: 'phase.completed', subject: { entity: 'discovery', id: created.discoveryId }, phase: 'discovery', outcome: 'done' },
        ],
      }),
      'utf8',
    );

    const state = service.scanOutbox();
    expect(state.rejectedOnLastScan).toBe(1);

    const view = cardView(state.snapshot, created.discoveryId);
    expect(view?.signals.map((signal) => signal.label)).toContain('não consegui ler');
    expect(view?.ingestErrors[0].resultPath).toBe(rogue);
    expect(view?.ingestErrors[0].issues.some((issue) => issue.path.includes('fanout_cards'))).toBe(true);
    // E nada do documento recusado entrou: o app não aproveita meia verdade.
    expect(view?.phases).toHaveLength(0);
    expect(readFileSync(rogue, 'utf8').length).toBeGreaterThan(0); // o arquivo continua lá
  });
});
