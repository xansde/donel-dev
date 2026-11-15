import { describe, expect, it } from 'vitest';
import { buildRemoteSetupScript } from '../src/main/remote-session';
import { planLaunchPermission, SUPER_BYPASS_ENV } from '../src/shared/launchPermission';
import { buildLauncherArgs } from '../src/renderer/src/launchArgsForProvider';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation } from '../src/shared/mindscape/model';
import { spawnFactsOf } from '../src/shared/mindscape/reach';
import { renewalLaunchArgs } from '../src/shared/sessionRenewal';

// Dono, 09/11 (t-66cb0ce4): "Vejo que as sessões orquestradoras nunca são o super bypass permissions. Deveria ser".
// Super bypass = `--permission-mode bypassPermissions` AND `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1`.
// An orchestrator born without it stops on a permission prompt that only the owner, inside its tab, can answer: the
// Theo renewed in flight came back in manual mode and stalled (09/11 16h39). Every role × every way of being born,
// on this computer (env of the PTY) and on a remote place (the claude.sh the VPS runs).

const ATLAS = 'C:/proj/atlas';
const OPENER = 'place:theo';
const DAUGHTER = 'place:dalton';

/** The argv each way of being born hands the main, as App.tsx builds it (role/default permission, not bypass). */
function bornArgs(path: 'dono' | 'sessao_abrir' | 'renovada'): string[] {
  const launch = buildLauncherArgs({ providerId: undefined, model: 'opus', effort: 'high', permissionMode: 'acceptEdits', sessionName: path === 'sessao_abrir' ? 'filha' : '' });
  if (path !== 'renovada') return launch;
  // The chat reads "default" when the transcript records no mode change — what the Theo renewed with.
  return renewalLaunchArgs([...launch, '--session-id', 'old'], 'default');
}

function claudeShOf(claudeArgs: readonly string[]): string {
  const sid = '11111111-2222-4333-8444-555555555555';
  const meta = { sid, hookToken: 't', hookPort: 1, mcpToken: null, mcpPort: null, localCwd: 'C:\\p', projectName: 'p', name: 'p', launchArgs: [], createdAt: '' };
  const script = buildRemoteSetupScript({ sid, homeRelativeDir: 'p', repoUrl: null, branch: null, files: [], claudeArgs, meta });
  return Buffer.from(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > "\$S"\/'claude\.sh'/.exec(script)![1], 'base64').toString('utf8');
}

function modesOf(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (arg === '--permission-mode' ? [args[i + 1]!] : arg.startsWith('--permission-mode=') ? [arg.slice(18)] : []));
}

/** The session that opened another (sessao_abrir arrow) — the Theo: its role is its own, not the Líder. */
const theoDoc = (() => {
  let doc = addPlace(emptyMindscapeDoc(), ATLAS, { id: OPENER, roleId: 'theo-west' });
  doc = addPlace(doc, ATLAS, { id: DAUGHTER, roleId: 'dev', by: 'session' });
  doc = setPlaceConversation(doc, ATLAS, OPENER, 'conv-theo');
  doc = setPlaceConversation(doc, ATLAS, DAUGHTER, 'conv-dalton');
  return addLink(doc, ATLAS, { id: 'l1', from: OPENER, to: DAUGHTER, arrow: true, by: 'session', opened: true });
})();

const ORCHESTRATORS = [
  { papel: 'Líder do quadro', facts: { roleId: 'lider' } },
  { papel: 'Líder único (Jobu)', facts: { roleId: 'lider', leaderOfAll: true } },
  { papel: 'Líder único sem o papel resolvido', facts: { leaderOfAll: true } },
  { papel: 'sessão que abriu outras (Theo West)', facts: spawnFactsOf(theoDoc, { sessionId: 'conv-theo' }) },
  // Started by the owner on its place, before any conversation: the arrows already put it above the Dalton.
  { papel: 'lugar com seta para outro, antes da 1ª conversa', facts: spawnFactsOf(theoDoc, { placeId: OPENER }) },
] as const;

describe('sessão orquestradora nasce em super bypass', () => {
  for (const { papel, facts } of ORCHESTRATORS) {
    for (const path of ['dono', 'sessao_abrir', 'renovada'] as const) {
      it(`${papel} × ${path}: bypass no argv e a env, no PC e na VPS`, () => {
        const plan = planLaunchPermission(bornArgs(path), facts, 'acceptEdits');
        expect(modesOf(plan.args)).toEqual(['bypassPermissions']);
        expect(plan.env).toEqual(SUPER_BYPASS_ENV);
        expect(plan.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS).toBe('1');
        const claudeSh = claudeShOf(plan.args);
        expect(claudeSh).toContain('export CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1');
        expect(claudeSh).toContain(`'--permission-mode' 'bypassPermissions'`);
      });
    }
  }

  it('um Líder que o dono pôs em plan ou auto com Shift+Tab e renovou volta em super bypass', () => {
    const renewed = renewalLaunchArgs(['--model', 'opus', '--permission-mode', 'auto', '--session-id', 'old'], 'plan');
    const plan = planLaunchPermission(renewed, { roleId: 'lider' }, undefined);
    expect(modesOf(plan.args)).toEqual(['bypassPermissions']);
    expect(plan.env).toEqual(SUPER_BYPASS_ENV);
  });

  it('a filha que não abriu ninguém segue o modo do papel; só a mãe é orquestradora', () => {
    expect(spawnFactsOf(theoDoc, { sessionId: 'conv-dalton' })).toEqual({ roleId: 'dev', directsOthers: false });
    const plan = planLaunchPermission(bornArgs('dono'), spawnFactsOf(theoDoc, { sessionId: 'conv-dalton' }), undefined);
    expect(modesOf(plan.args)).toEqual(['acceptEdits']);
    expect(plan.env).toEqual({});
  });

  // t-2a9060dd (14/11, ps da VPS): o Revisor e o Dev renovados em voo nasciam `claude --permission-mode default
  // --session-id <novo>` e paravam em cada comando. Regra do dono: toda sessão num lugar remoto nasce em super bypass.
  for (const papel of ['dev', 'revisor', 'pesquisa'] as const) {
    it(`${papel} num lugar remoto nasce em super bypass, nova, aberta por outra ou renovada`, () => {
      // A tab reattached after an update has no launch args: its renewal carried only the "default" the chat read.
      const reattachedRenewal = ['--permission-mode', 'default', '--session-id', 'novo'];
      for (const argv of [bornArgs('dono'), bornArgs('sessao_abrir'), bornArgs('renovada'), reattachedRenewal]) {
        const plan = planLaunchPermission(argv, { roleId: papel, remote: true }, undefined);
        expect(modesOf(plan.args)).toEqual(['bypassPermissions']);
        expect(plan.env).toEqual(SUPER_BYPASS_ENV);
        const claudeSh = claudeShOf(plan.args);
        expect(claudeSh).toContain('export CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1');
        expect(claudeSh).toContain(`'--permission-mode' 'bypassPermissions'`);
      }
    });
  }

  it('qualquer sessão lançada em bypass ganha a env também no PC (antes só a VPS tinha)', () => {
    const plan = planLaunchPermission(['--model', 'opus', '--permission-mode', 'bypassPermissions'], { roleId: 'dev' }, undefined);
    expect(modesOf(plan.args)).toEqual(['bypassPermissions']);
    expect(plan.env).toEqual(SUPER_BYPASS_ENV);
    // Without a mode in the argv, the CLI user default still decides (T018), and a bypass default carries the env.
    expect(planLaunchPermission(['--model', 'opus'], {}, 'bypassPermissions').env).toEqual(SUPER_BYPASS_ENV);
    expect(modesOf(planLaunchPermission(['--model', 'opus'], {}, undefined).args)).toEqual(['default']);
  });
});
