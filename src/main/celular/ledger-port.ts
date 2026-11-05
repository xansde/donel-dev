// Ledger no celular — o que o servidor do celular precisa do ledger, e um adaptador de demonstração com a
// mesma forma. O ledger V1 (`src/shared/ledger/`, ferramentas `tarefa_*`, provas em `<userData>/ledger-provas/`,
// aceitar/rejeitar como função pura do main com autor registrado) chega em outro PR; quando chegar, um
// adaptador real implementa esta interface e toma o lugar do de demonstração no `service.ts`.

import type { DecisaoCelular, EntregaCelular } from '../../shared/celular';

export interface DecisaoInput {
  readonly itemId: string;
  readonly decisao: DecisaoCelular;
  /** Obrigatório ao rejeitar. */
  readonly motivo: string | null;
  /** Quem decide pelo celular é sempre o dono: conta como validação humana. */
  readonly autor: 'dono';
  readonly via: 'celular';
}

export type DecisaoOutcome =
  | { readonly ok: true; readonly estado: 'aceita' | 'rejeitada' }
  /** A entrega não existe ou já não espera o dono (outra pessoa decidiu antes, por exemplo). */
  | { readonly ok: false; readonly reason: 'nao-encontrada' | 'ja-decidida' };

/** A prova como arquivo copiado pelo ledger (`filePath` dentro de `ledger-provas/`) ou bytes em memória. */
export type ProvaFonte =
  | { readonly mediaType: string; readonly filePath: string }
  | { readonly mediaType: string; readonly bytes: Uint8Array };

export interface MobileLedgerPort {
  /** `true` enquanto o ledger real não chegou: o celular avisa que é demonstração. */
  readonly demo: boolean;
  /** O que espera o dono: entregues aguardando aceite humano + a amostra do dia dos aceites do Revisor. */
  pendentes(): EntregaCelular[];
  /** Grava a decisão no ledger. Recusa (sem gravar) o que não está mais esperando o dono. */
  decidir(input: DecisaoInput): DecisaoOutcome;
  prova(itemId: string, provaId: string): ProvaFonte | null;
}

// ---------------------------------------------------------------------------
// Demonstração (em memória; volta ao começo quando o app reinicia)

const DEMO_PRINT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220"><rect width="360" height="220" rx="10" fill="#1d1b26"/><rect x="14" y="14" width="332" height="26" rx="6" fill="#2c2838"/><circle cx="30" cy="27" r="5" fill="#d46a5a"/><circle cx="46" cy="27" r="5" fill="#d9b44a"/><circle cx="62" cy="27" r="5" fill="#6aa86a"/><rect x="14" y="54" width="200" height="12" rx="4" fill="#8f86b0"/><rect x="14" y="76" width="300" height="10" rx="4" fill="#4b4560"/><rect x="14" y="94" width="260" height="10" rx="4" fill="#4b4560"/><rect x="14" y="128" width="140" height="64" rx="8" fill="#3d6b55"/><text x="84" y="166" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#e8f2ec">Salvo</text></svg>`;

export interface DemoLedger extends MobileLedgerPort {
  /** Quantas decisões o "ledger" gravou (para o teste do grava-uma-vez). */
  readonly gravacoes: readonly DecisaoInput[];
}

export function createDemoLedger(now: () => number = Date.now): DemoLedger {
  const hoursAgo = (h: number): string => new Date(now() - h * 3_600_000).toISOString();
  const itens: EntregaCelular[] = [
    {
      id: 'demo-1',
      origem: 'esperando-voce',
      naipe: 'martelos',
      titulo: 'Botão de salvar no editor de papéis',
      pedido: 'quero salvar o papel sem fechar a janela',
      criterio: 'Salvar grava e a janela continua aberta, com "Salvo" visível por 2 segundos.',
      quemEntregou: 'Dev (atlas)',
      entregueEm: hoursAgo(1),
      provas: [
        { id: 'p1', tipo: 'imagem', rotulo: 'Print depois de salvar' },
        { id: 'p2', tipo: 'comando', rotulo: 'npm test', texto: ' ✓ tests/roles.test.ts (4)\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)' },
      ],
    },
    {
      id: 'demo-2',
      origem: 'esperando-voce',
      naipe: 'escudos',
      titulo: 'Mensagem entre sessões não duplica',
      pedido: 'a mensagem chegou duas vezes na outra sessão',
      criterio: 'Uma mensagem enviada aparece uma vez só no chat de destino, mesmo com a sessão ocupada.',
      quemEntregou: 'Dev (beacon)',
      entregueEm: hoursAgo(3),
      provas: [{ id: 'p1', tipo: 'link', rotulo: 'PR com o teste', url: 'https://github.com/' }],
    },
    {
      id: 'demo-3',
      origem: 'amostra-revisor',
      naipe: 'livros',
      titulo: 'Glossário ganha "lugar remoto"',
      pedido: 'documenta o que é lugar remoto',
      criterio: 'O termo está no glossário com uma frase e um exemplo.',
      quemEntregou: 'Pesquisa (vega)',
      entregueEm: hoursAgo(20),
      aceitoPor: 'Revisor',
      provas: [{ id: 'p1', tipo: 'comando', rotulo: 'git diff --stat', texto: ' docs/glossario.md | 6 ++++++\n 1 file changed, 6 insertions(+)' }],
    },
    {
      id: 'demo-4',
      origem: 'esperando-voce',
      naipe: 'coroas',
      titulo: 'Escolher a porta do app do celular',
      pedido: 'decide você a porta, mas me mostra',
      criterio: 'A porta fica fixa e aparece nas Preferências.',
      quemEntregou: 'Dev (atlas)',
      entregueEm: hoursAgo(26),
      provas: [{ id: 'p1', tipo: 'comando', rotulo: 'Endereço', texto: 'http://100.x.y.z:47815' }],
    },
  ];
  const decididas = new Map<string, 'aceita' | 'rejeitada'>();
  const gravacoes: DecisaoInput[] = [];

  return {
    demo: true,
    gravacoes,
    pendentes: () => itens.filter((item) => !decididas.has(item.id)),
    decidir(input) {
      const item = itens.find((i) => i.id === input.itemId);
      if (!item) return { ok: false, reason: 'nao-encontrada' };
      if (decididas.has(item.id)) return { ok: false, reason: 'ja-decidida' };
      const estado = input.decisao === 'aceitar' ? 'aceita' : 'rejeitada';
      decididas.set(item.id, estado);
      gravacoes.push(input);
      return { ok: true, estado };
    },
    prova(itemId, provaId) {
      if (itemId === 'demo-1' && provaId === 'p1') return { mediaType: 'image/svg+xml', bytes: new TextEncoder().encode(DEMO_PRINT) };
      return null;
    },
  };
}
