import { describe, expect, it } from 'vitest';
import { computeClockTier } from '../design-system/src/lib/homologationClock';

// 009-modo-dev-v3, extensão 6 (`HomologationClock`) — a janela de 24h da
// homologação, medida em `Modo Dev v3.dc.html:852-863` (`clockData`) e
// conferida em `design/modo-dev-v3-verificacao.md` §1. O componente React
// NUNCA chama `Date.now()`: quem chama passa `deadline`/`now`, e a
// aritmética/degrau vivem aqui, puros, para dar teste determinístico.

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-07-29T09:00:00Z').getTime();

function deadlineIn(hours: number): number {
  return NOW + hours * HOUR;
}

describe('computeClockTier — degraus', () => {
  it('tranquilo: > 12h, --zone-ok, sem pulso', () => {
    const r = computeClockTier(deadlineIn(18.5), NOW);
    expect(r.tier).toBe('tranquilo');
    expect(r.colorVar).toBe('var(--zone-ok)');
    expect(r.pulse).toBe('none');
    expect(r.note).toBe('janela de 24h aberta — homologar antes do prazo mantém o merge.');
  });

  it('atenção: 4–12h, --state-waiting, sem pulso', () => {
    const r = computeClockTier(deadlineIn(7.2), NOW);
    expect(r.tier).toBe('atencao');
    expect(r.colorVar).toBe('var(--state-waiting)');
    expect(r.pulse).toBe('none');
    expect(r.note).toBe('menos de meia janela — homologue hoje ou o merge é desfeito.');
  });

  it('urgente: 0–4h, --state-permission, pisca', () => {
    const r = computeClockTier(deadlineIn(1.6), NOW);
    expect(r.tier).toBe('urgente');
    expect(r.colorVar).toBe('var(--state-permission)');
    expect(r.pulse).toBe('blink');
    expect(r.note).toBe('reta final — passando do prazo, o merge é desfeito automaticamente.');
  });

  it('estourado: <= 0h, --state-error, pisca rápido', () => {
    const r = computeClockTier(deadlineIn(0), NOW);
    expect(r.tier).toBe('estourado');
    expect(r.colorVar).toBe('var(--state-error)');
    expect(r.pulse).toBe('blink-fast');
    expect(r.note).toBe('prazo estourado — reversão automática em curso, o PR volta a staging zerado.');
  });

  it('estourado também quando o prazo já passou (deadline no passado)', () => {
    const r = computeClockTier(deadlineIn(-3), NOW);
    expect(r.tier).toBe('estourado');
    expect(r.hoursLeft).toBeLessThan(0);
  });

  it('fronteiras: exatamente 12h ainda é atenção, exatamente 4h ainda é urgente (o mockup usa `>`, não `>=`)', () => {
    expect(computeClockTier(deadlineIn(12), NOW).tier).toBe('atencao');
    expect(computeClockTier(deadlineIn(4), NOW).tier).toBe('urgente');
    expect(computeClockTier(deadlineIn(0), NOW).tier).toBe('estourado');
  });
});

describe('computeClockTier — relativeLabel (mockup: "faltam Xh YYmin" / "prazo vencido")', () => {
  it('formata horas e minutos com padding de dois dígitos', () => {
    // 18.5h faltando = 18h 30min
    expect(computeClockTier(deadlineIn(18.5), NOW).relativeLabel).toBe('faltam 18h 30min');
  });

  it('minutos de um dígito ganham zero à esquerda', () => {
    // 1.6h = 1h 36min... usar um valor que dá minuto < 10: 1h05
    const r = computeClockTier(NOW + (1 * 60 + 5) * 60 * 1000, NOW);
    expect(r.relativeLabel).toBe('faltam 1h 05min');
  });

  it('prazo vencido quando o degrau é estourado', () => {
    expect(computeClockTier(deadlineIn(0), NOW).relativeLabel).toBe('prazo vencido');
    expect(computeClockTier(deadlineIn(-5), NOW).relativeLabel).toBe('prazo vencido');
  });
});

describe('computeClockTier — percent (mockup: `Math.max(2, Math.min(100, (left/24)*100))`)', () => {
  it('proporcional à janela de 24h', () => {
    expect(computeClockTier(deadlineIn(12), NOW).percent).toBe(50);
    expect(computeClockTier(deadlineIn(24), NOW).percent).toBe(100);
  });

  it('nunca abaixo de 2%, mesmo com a janela quase zerada — a barra nunca some de vez', () => {
    expect(computeClockTier(deadlineIn(0.001), NOW).percent).toBe(2);
    expect(computeClockTier(deadlineIn(0), NOW).percent).toBe(2);
    expect(computeClockTier(deadlineIn(-10), NOW).percent).toBe(2);
  });

  it('nunca acima de 100%, mesmo com prazo além da janela de 24h', () => {
    expect(computeClockTier(deadlineIn(48), NOW).percent).toBe(100);
  });
});

describe('computeClockTier — aceita Date além de epoch ms', () => {
  it('produz o mesmo resultado com Date ou number', () => {
    const asNumber = computeClockTier(deadlineIn(7.2), NOW);
    const asDate = computeClockTier(new Date(deadlineIn(7.2)), new Date(NOW));
    expect(asDate).toEqual(asNumber);
  });
});
