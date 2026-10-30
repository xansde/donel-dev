import { describe, expect, it } from 'vitest';
import {
  parseStatusLinePayload,
  resolveSessionMeter,
  sameStatusLineReading,
  statusLineContext,
  statusLineForSession,
  statusLineRateLimitPercents,
} from '../src/shared/statusLine';

// Ponte da statusline — parte pura. O payload de exemplo segue o "Full JSON
// schema" de https://code.claude.com/docs/en/statusline (conferido em
// 2026-10-30, CLI 2.1.314).

const FULL = {
  cwd: 'C:/repo',
  session_id: 'sess-1',
  session_name: 'ponte da statusline',
  prompt_id: '550e8400-e29b-41d4-a716-446655440000',
  transcript_path: 'C:/Users/x/.claude/projects/p/sess-1.jsonl',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  workspace: {
    current_dir: 'C:/repo',
    project_dir: 'C:/repo',
    added_dirs: [],
    git_worktree: 'feature-xyz',
    repo: { host: 'github.com', owner: 'xansde', name: 'donel-dev' },
  },
  version: '2.1.314',
  output_style: { name: 'default' },
  cost: { total_cost_usd: 0.01234, total_duration_ms: 45000, total_api_duration_ms: 2300, total_lines_added: 156, total_lines_removed: 23 },
  context_window: {
    total_input_tokens: 15500,
    total_output_tokens: 1200,
    context_window_size: 200000,
    used_percentage: 8,
    remaining_percentage: 92,
    current_usage: { input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000 },
  },
  exceeds_200k_tokens: false,
  prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: 1738429200, requests: 14, hit_ratio: 0.91 },
  fast_mode: false,
  effort: { level: 'high' },
  thinking: { enabled: true },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
  },
  agent: { name: 'security-reviewer' },
  pr: { number: 1234, url: 'https://github.com/xansde/donel-dev/pull/1234', review_state: 'pending' },
  worktree: { name: 'my-feature', path: 'C:/repo/.claude/worktrees/my-feature', branch: 'worktree-my-feature', original_cwd: 'C:/repo', original_branch: 'main' },
};

describe('parseStatusLinePayload', () => {
  it('lê os campos do schema oficial', () => {
    const s = parseStatusLinePayload(FULL, 1000);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      receivedAt: 1000,
      apiActivityAt: 1000,
      sessionId: 'sess-1',
      sessionName: 'ponte da statusline',
      version: '2.1.314',
      model: { id: 'claude-opus-5-5', displayName: 'Opus' },
      contextWindow: { totalInputTokens: 15500, totalOutputTokens: 1200, windowSize: 200000, usedPercentage: 8, remainingPercentage: 92, hasCurrentUsage: true },
      cost: { totalCostUsd: 0.01234, totalDurationMs: 45000, totalApiDurationMs: 2300, linesAdded: 156, linesRemoved: 23 },
      rateLimits: { fiveHour: { usedPercentage: 23.5, resetsAt: 1738425600 }, sevenDay: { usedPercentage: 41.2, resetsAt: 1738857600 }, spendLimit: null },
      effortLevel: 'high',
      fastMode: false,
      thinkingEnabled: true,
      exceeds200kTokens: false,
      agentName: 'security-reviewer',
      outputStyle: 'default',
      gitWorktree: 'feature-xyz',
      repo: { host: 'github.com', owner: 'xansde', name: 'donel-dev' },
      worktree: { name: 'my-feature', branch: 'worktree-my-feature', originalBranch: 'main' },
      pr: { number: 1234, url: 'https://github.com/xansde/donel-dev/pull/1234', reviewState: 'pending', kind: null },
      promptCache: { warm: true, hitRatio: 0.91, expiresAt: 1738429200 },
    });
  });

  it('não retém o que não é número nem nome (cwd, transcript_path, prompt_id)', () => {
    const s = parseStatusLinePayload(FULL, 1) as unknown as Record<string, unknown>;
    const json = JSON.stringify(s);
    expect(json).not.toContain('transcript_path');
    expect(json).not.toContain('sess-1.jsonl');
    expect(json).not.toContain('550e8400');
  });

  it('não-objeto vira null', () => {
    expect(parseStatusLinePayload(null, 1)).toBeNull();
    expect(parseStatusLinePayload('x', 1)).toBeNull();
    expect(parseStatusLinePayload([1], 1)).toBeNull();
  });

  it('sem rate_limits (provedor de terceiros, plano sem assinatura) → rateLimits null', () => {
    const { rate_limits: _drop, ...rest } = FULL;
    expect(parseStatusLinePayload(rest, 1)?.rateLimits).toBeNull();
  });

  it('cada janela pode faltar sozinha; spend_limit opcional com dólares opcionais', () => {
    const s = parseStatusLinePayload({ rate_limits: { seven_day: { used_percentage: 10 }, spend_limit: { used_percentage: 62.8, resets_at: 10 } } }, 1);
    expect(s?.rateLimits).toEqual({
      fiveHour: null,
      sevenDay: { usedPercentage: 10, resetsAt: null },
      spendLimit: { usedPercentage: 62.8, resetsAt: 10, usedUsd: null, limitUsd: null, period: null },
    });
  });

  it('tipos errados e valores absurdos viram null, sem derrubar o resto', () => {
    const s = parseStatusLinePayload(
      {
        session_id: 42,
        model: { id: '' },
        context_window: { total_input_tokens: 'muito', context_window_size: -1, current_usage: null, used_percentage: null },
        rate_limits: { five_hour: { used_percentage: Number.NaN } },
        pr: { number: 0, url: 'javascript:alert(1)' },
        session_name: 'x'.repeat(600),
      },
      1,
    );
    expect(s).toMatchObject({
      sessionId: null,
      model: null,
      contextWindow: { totalInputTokens: null, windowSize: null, usedPercentage: null, hasCurrentUsage: false },
      rateLimits: null,
      pr: null,
      sessionName: null,
    });
  });

  it('pr com url que não é http(s) guarda o número sem a url', () => {
    expect(parseStatusLinePayload({ pr: { number: 7, url: 'file:///c:/x' } }, 1)?.pr).toEqual({ number: 7, url: null, reviewState: null, kind: null });
  });
});

describe('sameStatusLineReading', () => {
  it('ignora os carimbos de tempo', () => {
    expect(sameStatusLineReading(parseStatusLinePayload(FULL, 1), parseStatusLinePayload(FULL, 2))).toBe(true);
  });

  it('percebe mudança de valor', () => {
    const other = { ...FULL, cost: { ...FULL.cost, total_cost_usd: 0.5 } };
    expect(sameStatusLineReading(parseStatusLinePayload(FULL, 1), parseStatusLinePayload(other, 1))).toBe(false);
  });

  it('null só é igual a null', () => {
    expect(sameStatusLineReading(null, null)).toBe(true);
    expect(sameStatusLineReading(null, parseStatusLinePayload(FULL, 1))).toBe(false);
  });
});

describe('statusLineContext', () => {
  it('tokens de entrada e janela da última resposta', () => {
    expect(statusLineContext(parseStatusLinePayload(FULL, 1))).toEqual({ usedTokens: 15500, windowSize: 200000 });
  });

  it('current_usage null (antes da 1ª chamada, logo depois de /compact) → sem leitura', () => {
    const s = parseStatusLinePayload({ context_window: { total_input_tokens: 0, context_window_size: 200000, current_usage: null } }, 1);
    expect(statusLineContext(s)).toBeNull();
  });

  it('sem leitura → null', () => {
    expect(statusLineContext(null)).toBeNull();
    expect(statusLineContext(parseStatusLinePayload({}, 1))).toBeNull();
  });
});

describe('statusLineRateLimitPercents', () => {
  const now = 1738425000 * 1000;

  it('arredonda as duas janelas', () => {
    expect(statusLineRateLimitPercents(parseStatusLinePayload(FULL, 1), now)).toEqual({ fiveHour: 24, sevenDay: 41 });
  });

  it('janela que já virou some', () => {
    expect(statusLineRateLimitPercents(parseStatusLinePayload(FULL, 1), 1738425600 * 1000)).toEqual({ fiveHour: null, sevenDay: 41 });
  });

  it('sem nenhuma janela útil → null', () => {
    expect(statusLineRateLimitPercents(parseStatusLinePayload({}, 1), now)).toBeNull();
    expect(statusLineRateLimitPercents(parseStatusLinePayload({ rate_limits: { spend_limit: { used_percentage: 5 } } }, 1), now)).toBeNull();
  });
});

describe('resolveSessionMeter', () => {
  it('sem statusline: comportamento de antes (transcript + launch)', () => {
    expect(resolveSessionMeter({ transcriptModelId: 'claude-haiku-4-5', transcriptTokens: 1000, launchAlias: 'opus', statusLine: null })).toEqual({
      label: 'haiku 4.5',
      contextZone: 200_000,
      usedTokens: 1000,
    });
    expect(resolveSessionMeter({ transcriptModelId: null, transcriptTokens: null, launchAlias: 'opus', statusLine: null })).toEqual({
      label: 'opus',
      contextZone: 300_000,
      usedTokens: null,
    });
  });

  it('com statusline: modelo, tokens e janela oficiais na frente', () => {
    const view = resolveSessionMeter({ transcriptModelId: 'claude-sonnet-5', transcriptTokens: 999, launchAlias: 'sonnet', statusLine: parseStatusLinePayload(FULL, 1) });
    expect(view).toEqual({ label: 'opus 5.5', contextZone: 200_000, usedTokens: 15500 });
  });

  it('modelo de terceiros: a janela dita pelo CLI encurta a régua que a tabela não conhecia', () => {
    const s = parseStatusLinePayload({ model: { id: 'glm-4.6' }, context_window: { total_input_tokens: 50_000, context_window_size: 128_000, current_usage: {} } }, 1);
    expect(resolveSessionMeter({ transcriptModelId: null, transcriptTokens: null, launchAlias: 'opus', statusLine: s })).toEqual({
      label: 'glm-4.6',
      contextZone: 128_000,
      usedTokens: 50_000,
    });
  });

  it('janela grande não passa da smart zone', () => {
    const s = parseStatusLinePayload({ context_window: { total_input_tokens: 10, context_window_size: 1_000_000, current_usage: {} } }, 1);
    expect(resolveSessionMeter({ transcriptModelId: null, transcriptTokens: null, launchAlias: 'opus', statusLine: s }).contextZone).toBe(300_000);
  });

  it('leitura sem current_usage (pós-/compact) cai no transcript para os tokens', () => {
    const s = parseStatusLinePayload({ model: { id: 'claude-opus-5-5' }, context_window: { total_input_tokens: 0, context_window_size: 1_000_000, current_usage: null } }, 1);
    expect(resolveSessionMeter({ transcriptModelId: null, transcriptTokens: 4242, launchAlias: 'opus', statusLine: s })).toEqual({
      label: 'opus 5.5',
      contextZone: 300_000,
      usedTokens: 4242,
    });
  });
});

describe('statusLineForSession', () => {
  const s = parseStatusLinePayload(FULL, 1);

  it('mesma conversa (ou sem id dos dois lados) vale', () => {
    expect(statusLineForSession(s, 'sess-1')).toBe(s);
    expect(statusLineForSession(s, null)).toBe(s);
    const noId = parseStatusLinePayload({ model: { id: 'x' } }, 1);
    expect(statusLineForSession(noId, 'sess-9')).toBe(noId);
  });

  it('leitura de outra conversa (antes do /clear) não vale', () => {
    expect(statusLineForSession(s, 'sess-2')).toBeNull();
  });
});
