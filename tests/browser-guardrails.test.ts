// Navegador integrado — what stops the agent without the owner watching. A hole here would not show up using the app.
import { describe, expect, it } from 'vitest';
import { agentMayNavigate, isLockedLabel, keyEffect, lockedAction, lockedKeyAction, parseDomainList, sensitiveField, type DomainRules, type ElementFacts } from '../src/shared/browser/guardrails';
import { parseKeyCombo } from '../src/shared/browser/keys';
import { refusedUploadFile, refusedUploadFolder } from '../src/shared/browser/upload';

const field = (attributes: Record<string, string>, extra: Partial<ElementFacts> = {}): ElementFacts => ({ tag: 'input', attributes, role: 'textbox', name: '', ...extra });
const button = (name: string, extra: Partial<ElementFacts> = {}): ElementFacts => ({ tag: 'button', attributes: {}, role: 'button', name, ...extra });

describe('trava', () => {
  it('reconhece senha e cartão pelo que o campo declara', () => {
    expect(sensitiveField(field({ type: 'password' }))).toBe('senha');
    expect(sensitiveField(field({ type: 'text', autocomplete: 'current-password' }))).toBe('senha');
    expect(sensitiveField(field({ autocomplete: 'section-pagamento cc-number' }))).toBe('cartão');
    expect(sensitiveField(field({ autocomplete: 'cc-exp-month' }, { tag: 'select', role: 'combobox' }))).toBe('cartão');
    expect(sensitiveField(field({ name: 'cardNumber' }))).toBe('cartão');
    expect(sensitiveField(field({ id: 'card_cvc' }))).toBe('cartão');
    expect(sensitiveField(field({}, { name: 'Código de segurança' }))).toBe('cartão');
    expect(sensitiveField(field({ placeholder: 'Número do cartão' }))).toBe('cartão');
    expect(sensitiveField(field({ 'aria-label': 'Sua senha' }))).toBe('senha');
    expect(sensitiveField(field({ name: 'user_pwd' }))).toBe('senha');
  });

  it('não trava campo comum, busca nem o que não se digita', () => {
    expect(sensitiveField(field({ name: 'email', autocomplete: 'email' }))).toBeNull();
    expect(sensitiveField(field({ type: 'search', placeholder: 'Buscar cartões' }))).toBeNull();
    expect(sensitiveField(field({ name: 'q' }, { role: 'searchbox', name: 'Buscar senha do wifi' }))).toBeNull();
    expect(sensitiveField(field({ type: 'checkbox', name: 'lembrar_senha' }))).toBeNull();
    expect(sensitiveField(field({ name: 'spinner' }))).toBeNull();
  });

  it('trava comprar, pagar e excluir, com e sem acento, em pt e en', () => {
    for (const label of ['Comprar agora', 'PAGAR', '→ Pagar R$ 10', 'Excluir conta', 'Delete repository', 'Buy now', 'Pay $5', 'Finalizar compra', 'Confirmar pagamento', 'Place your order', 'Fazer PIX', 'Confirmar exclusão']) {
      expect(isLockedLabel(label), label).toBe(true);
    }
    for (const label of ['Como comprar', 'Formas de pagamento', 'Payment methods', 'Adicionar ao carrinho', 'Salvar', 'Buying guide', 'Ver pedido']) {
      expect(isLockedLabel(label), label).toBe(false);
    }
  });

  it('olha botão, link e submit; não olha campo nem checkbox', () => {
    expect(lockedAction(button('Pagar agora'))).toBe('Pagar agora');
    expect(lockedAction(button('Comprar', { tag: 'a', role: 'link' }))).toBe('Comprar');
    expect(lockedAction(field({ type: 'submit', value: 'Finalizar pedido' }, { role: 'button', name: '' }))).toBe('Finalizar pedido');
    expect(lockedAction(button('', { attributes: { 'aria-label': 'Excluir' } }))).toBe('Excluir');
    expect(lockedAction(field({}, { name: 'Pagar' }))).toBeNull();
    expect(lockedAction(field({ type: 'checkbox' }, { role: 'checkbox', name: 'Excluir itens antigos' }))).toBeNull();
  });

  it('tecla: letra e colar escrevem, Enter e Espaço acionam, Enter num campo aperta o botão do formulário', () => {
    const effect = (combo: string) => {
      const parsed = parseKeyCombo(combo);
      return parsed.ok ? keyEffect(parsed.events) : null;
    };
    expect(effect('a')).toEqual({ types: true, activates: false });
    expect(effect('Ctrl+V')).toEqual({ types: true, activates: false });
    expect(effect('Enter')).toEqual({ types: false, activates: true });
    expect(effect('Espaço')).toEqual({ types: true, activates: true });
    expect(effect('Tab')).toEqual({ types: false, activates: false });
    expect(lockedKeyAction(field({ name: 'nome' }, { formSubmitLabel: 'Pagar agora' }))).toBe('Pagar agora');
    expect(lockedKeyAction(field({ name: 'nome' }, { formSubmitLabel: 'Entrar' }))).toBeNull();
  });
});

describe('vigia de domínio', () => {
  const only = (typed: string): DomainRules => ({ mode: 'only', domains: parseDomainList(typed).domains });
  const except = (typed: string): DomainRules => ({ mode: 'except', domains: parseDomainList(typed).domains });

  it('lê o que o dono digitou', () => {
    expect(parseDomainList('https://www.Exemplo.com/caminho?x=1, *.outro.com.br\nlocalhost:5173 127.0.0.1')).toEqual({
      domains: ['www.exemplo.com', 'outro.com.br', 'localhost', '127.0.0.1'],
      invalid: [],
    });
    expect(parseDomainList('semponto a*b.com').invalid).toEqual(['semponto', 'a*b.com']);
  });

  it('padrão libera tudo; só-estes vale para o domínio e os subdomínios, e nada mais', () => {
    expect(agentMayNavigate({ mode: 'all', domains: [] }, 'https://qualquer.com/')).toBe(true);
    const rules = only('exemplo.com');
    expect(agentMayNavigate(rules, 'https://exemplo.com/a')).toBe(true);
    expect(agentMayNavigate(rules, 'https://app.exemplo.com/')).toBe(true);
    expect(agentMayNavigate(rules, 'https://EXEMPLO.com./')).toBe(true);
    expect(agentMayNavigate(rules, 'about:blank')).toBe(true);
    expect(agentMayNavigate(rules, 'https://outro.com/')).toBe(false);
    expect(agentMayNavigate(rules, 'https://exemplo.com.evil.com/')).toBe(false);
    expect(agentMayNavigate(rules, 'https://evilexemplo.com/')).toBe(false);
    expect(agentMayNavigate(rules, 'https://exemplo.com@evil.com/')).toBe(false);
    expect(agentMayNavigate(rules, 'file:///C:/segredo.txt')).toBe(false);
  });

  it('menos-estes bloqueia o domínio e os subdomínios', () => {
    const rules = except('banco.com');
    expect(agentMayNavigate(rules, 'https://outro.com/')).toBe(true);
    expect(agentMayNavigate(rules, 'https://banco.com/')).toBe(false);
    expect(agentMayNavigate(rules, 'https://www.banco.com./extrato')).toBe(false);
  });
});

describe('envio de arquivo', () => {
  const context = { home: 'C:\\Users\\dono', userData: 'C:\\Users\\dono\\AppData\\Roaming\\donel-dev' };

  it('a pasta autorizada nunca é a raiz nem a casa inteira (as de credenciais, ver browser-upload-grants)', () => {
    expect(refusedUploadFolder('C:\\Users\\dono\\Documents\\envios', context)).toBeNull();
    expect(refusedUploadFolder('C:\\', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users', context)).not.toBeNull();
  });

  it('só sai arquivo comum de dentro da pasta', () => {
    expect(refusedUploadFile('contrato.pdf')).toBeNull();
    expect(refusedUploadFile('notas\\2026\\nota.xml')).toBeNull();
    expect(refusedUploadFile('..\\fora.txt')).not.toBeNull();
    expect(refusedUploadFile('a\\..\\..\\fora.txt')).not.toBeNull();
    expect(refusedUploadFile('D:\\outro\\disco.txt')).not.toBeNull();
    expect(refusedUploadFile('')).not.toBeNull();
    expect(refusedUploadFile('.credentials.json')).not.toBeNull();
    expect(refusedUploadFile('.env.local')).not.toBeNull();
    expect(refusedUploadFile('.git\\config')).not.toBeNull();
    expect(refusedUploadFile('chaves\\id_ed25519')).not.toBeNull();
    expect(refusedUploadFile('certificado.pfx')).not.toBeNull();
  });
});
