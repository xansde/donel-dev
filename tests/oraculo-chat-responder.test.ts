import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCelularLocalStore } from '../src/oraculo/celular-local';
import { chatResponder } from '../src/oraculo/chat-responder';

// O Líder responde ao celular pelo chat_lider.py, sem o Supabase. O que não pode: a resposta repetida (o script tenta
// de novo depois de um timeout) entrar duas vezes; a resposta ir para a mensagem errada; a mensagem solta do Líder ou o
// "ultima" ficarem sem caminho, presos ao Supabase.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-resp-'));
  dirs.push(dir);
  let t = Date.parse('2026-11-18T23:00:00Z');
  const s = createCelularLocalStore(join(dir, 'celular-local.json'), () => (t += 1000));
  s.addChat('aaaaaaaa-1111-4222-8333-444455556666', 'primeira');
  s.addChat('bbbbbbbb-1111-4222-8333-444455556666', 'segunda');
  return s;
}

describe('chat-responder (o Líder responde pelo script, sem Supabase)', () => {
  it('a resposta repetida sem id entra uma vez, na mensagem certa', () => {
    const s = store();
    const a = chatResponder(s, { em_resposta_a: 'aaaaaaaa', texto: 'oi' });
    const b = chatResponder(s, { em_resposta_a: 'aaaaaaaa', texto: 'oi' });
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const linhas = s.conversa(50);
    expect(linhas.filter((l) => l.autor === 'lider')).toHaveLength(1);
    expect(linhas.find((l) => l.id.startsWith('aaaaaaaa'))?.estado).toBe('respondida');
    expect(linhas.find((l) => l.id.startsWith('bbbbbbbb'))?.estado).toBe('na-fila');
  });

  it('"ultima" responde a mensagem mais nova do dono', () => {
    const s = store();
    const r = chatResponder(s, { em_resposta_a: 'ultima', texto: 'para a segunda' });
    expect(r.body.em_resposta_a).toBe('bbbbbbbb-1111-4222-8333-444455556666');
  });

  it('sem em_resposta_a, é uma mensagem solta do Líder, que não responde nenhuma', () => {
    const s = store();
    const r = chatResponder(s, { em_resposta_a: null, texto: 'aviso do Líder' });
    expect(r.status).toBe(200);
    const linhas = s.conversa(50);
    expect(linhas[linhas.length - 1]).toMatchObject({ autor: 'lider', em_resposta_a: null, texto: 'aviso do Líder' });
    expect(linhas.filter((l) => l.autor === 'dono').every((l) => l.estado === 'na-fila')).toBe(true);
    expect(chatResponder(s, { texto: 'aviso do Líder' }).body.id).toBe(r.body.id);
  });

  it('id curto, ambíguo ou de ninguém é recusado sem gravar', () => {
    const s = store();
    expect(chatResponder(s, { em_resposta_a: 'aaaa', texto: 'x' }).status).toBe(400);
    expect(chatResponder(s, { em_resposta_a: 'cccccccc', texto: 'x' }).status).toBe(404);
    expect(chatResponder(s, { em_resposta_a: 'aaaaaaaa', texto: '' }).status).toBe(400);
    expect(s.conversa(50).filter((l) => l.autor === 'lider')).toHaveLength(0);
  });
});
