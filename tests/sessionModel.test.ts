import { describe, expect, it } from 'vitest';
import { contextWindowForModelId, contextZoneForModelId, SMART_ZONE_TOKENS } from '../src/shared/contextWindow';
import { formatModelLabel, modelIdFromLine, resolveSessionModel } from '../src/shared/sessionModel';

// Issue #21 — o rodapé (e o denominador do medidor de contexto) passa a mostrar
// o modelo que a sessão em foco usa DE FATO: o `message.model` da última
// resposta do assistente no transcript. O modelo do launch é só o ponto de
// partida até a primeira resposta.

/** Linha `assistant` como o CLI grava: o id do modelo fica em `message.model`. */
const assistantLine = (model: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    ...extra,
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1 } },
  });

describe('modelIdFromLine', () => {
  it('lê o `message.model` de uma linha do assistente', () => {
    expect(modelIdFromLine(assistantLine('claude-opus-5-5'))).toBe('claude-opus-5-5');
  });

  it('ignora a resposta sintética do CLI (`<synthetic>`, erro de API / comando local) — não é modelo', () => {
    expect(modelIdFromLine(assistantLine('<synthetic>'))).toBeNull();
  });

  it('ignora turno de subagente (isSidechain): o modelo dele não é o da sessão', () => {
    expect(modelIdFromLine(assistantLine('claude-haiku-5-5', { isSidechain: true }))).toBeNull();
  });

  it('ignora linhas que não são do assistente', () => {
    expect(modelIdFromLine(JSON.stringify({ type: 'user', message: { role: 'user', model: 'claude-opus-5-5', content: 'oi' } }))).toBeNull();
    expect(modelIdFromLine(JSON.stringify({ type: 'custom-title', customTitle: 'x' }))).toBeNull();
  });

  it('linha sem `model`, com tipo errado ou vazio → null', () => {
    expect(modelIdFromLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [] } }))).toBeNull();
    expect(modelIdFromLine(assistantLine(42))).toBeNull();
    expect(modelIdFromLine(assistantLine('   '))).toBeNull();
  });

  it('JSON cortado (primeira linha da cauda) e lixo não lançam', () => {
    expect(modelIdFromLine('del":"claude-opus-5-5"}}')).toBeNull();
    expect(modelIdFromLine('')).toBeNull();
    expect(modelIdFromLine('null')).toBeNull();
  });
});

describe('contextWindowForModelId', () => {
  it('modelos atuais (fable, opus, sonnet, haiku 5.x) têm janela de 1M', () => {
    for (const id of ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5']) {
      expect(contextWindowForModelId(id), id).toBe(1_000_000);
    }
  });

  it('geração 4.6+ também é 1M; 4.5 e anteriores são 200k (Haiku 4.5 incluído)', () => {
    expect(contextWindowForModelId('claude-opus-4-8')).toBe(1_000_000);
    expect(contextWindowForModelId('claude-opus-4-6')).toBe(1_000_000);
    expect(contextWindowForModelId('claude-sonnet-4-6')).toBe(1_000_000);
    expect(contextWindowForModelId('claude-haiku-4-5')).toBe(200_000);
    expect(contextWindowForModelId('claude-sonnet-4-5')).toBe(200_000);
    expect(contextWindowForModelId('claude-opus-4-1')).toBe(200_000);
    expect(contextWindowForModelId('claude-sonnet-4')).toBe(200_000);
  });

  it('tolera sufixo de data, `[1m]`, maiúsculas e prefixo de provedor', () => {
    expect(contextWindowForModelId('claude-haiku-4-5-20251001')).toBe(200_000);
    expect(contextWindowForModelId('claude-opus-4-6[1m]')).toBe(1_000_000);
    expect(contextWindowForModelId('  Claude-Opus-5-5 ')).toBe(1_000_000);
    expect(contextWindowForModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(200_000);
    expect(contextWindowForModelId('claude-opus-4-5@20251101')).toBe(200_000);
  });

  it('nomenclatura antiga (claude-3-5-sonnet) é 200k', () => {
    expect(contextWindowForModelId('claude-3-5-sonnet-20241022')).toBe(200_000);
    expect(contextWindowForModelId('claude-3-haiku-20240307')).toBe(200_000);
  });

  it('aceita o próprio alias (o valor do launch)', () => {
    expect(contextWindowForModelId('opus')).toBe(1_000_000);
    expect(contextWindowForModelId('haiku')).toBe(200_000);
  });

  it('id desconhecido (modelo de provedor, lixo) → null, nunca um palpite', () => {
    expect(contextWindowForModelId('glm-4.6')).toBeNull();
    expect(contextWindowForModelId('gpt-5')).toBeNull();
    expect(contextWindowForModelId('')).toBeNull();
    expect(contextWindowForModelId('claude-unknown-9')).toBeNull();
  });
});

describe('contextZoneForModelId', () => {
  it('é min(smart zone, janela): 300k em modelo de 1M, 200k em modelo de 200k', () => {
    expect(contextZoneForModelId('claude-opus-5-5')).toBe(SMART_ZONE_TOKENS);
    expect(contextZoneForModelId('claude-haiku-4-5-20251001')).toBe(200_000);
  });

  it('desconhecido → null', () => {
    expect(contextZoneForModelId('glm-4.6')).toBeNull();
  });
});

describe('formatModelLabel', () => {
  it('encurta o id do Claude para família + versão', () => {
    expect(formatModelLabel('claude-opus-5-5')).toBe('opus 5.5');
    expect(formatModelLabel('claude-fable-5')).toBe('fable 5');
    expect(formatModelLabel('claude-haiku-4-5-20251001')).toBe('haiku 4.5');
    expect(formatModelLabel('claude-3-5-sonnet-20241022')).toBe('sonnet 3.5');
  });

  it('alias fica como está (é o que o Launcher mostra)', () => {
    expect(formatModelLabel('opus')).toBe('opus');
  });

  it('id desconhecido aparece cru (sem espaços nas pontas), em vez de ser escondido', () => {
    expect(formatModelLabel(' glm-4.6 ')).toBe('glm-4.6');
  });
});

describe('resolveSessionModel', () => {
  it('sem resposta ainda: mostra o modelo do launch e usa a régua dele (ponto de partida)', () => {
    expect(resolveSessionModel(null, 'sonnet')).toEqual({ label: 'sonnet', contextZone: 300_000 });
    expect(resolveSessionModel(undefined, 'haiku')).toEqual({ label: 'haiku', contextZone: 200_000 });
  });

  it('depois da primeira resposta: o modelo do transcript vence o do launch (ex. `/model` no CLI)', () => {
    expect(resolveSessionModel('claude-haiku-4-5-20251001', 'opus')).toEqual({ label: 'haiku 4.5', contextZone: 200_000 });
    expect(resolveSessionModel('claude-opus-5-5', 'haiku')).toEqual({ label: 'opus 5.5', contextZone: 300_000 });
  });

  it('modelo desconhecido: mostra o id cru e cai na smart zone inteira (não quebra, não some)', () => {
    expect(resolveSessionModel('glm-4.6', 'haiku')).toEqual({ label: 'glm-4.6', contextZone: SMART_ZONE_TOKENS });
  });
});
