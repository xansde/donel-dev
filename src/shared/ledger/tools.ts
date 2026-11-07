// Ledger com prova (item 19) — the `tarefa_*` tools of the MCP server `donel`: definitions and argument
// validation, pure. The main runs them (`src/main/ledger-store.ts`): the session's place and role come from
// the board (the same answer as `sessao_quem_sou`), never from the arguments, so a session cannot pose as
// the Revisor or as the owner.

import {
  FOR_OWNER_LIMITS,
  MAX_CHECKS,
  MAX_OPTIONS,
  MAX_PROOFS,
  MAX_PROOF_TEXT_CHARS,
  MAX_REQUEST_CHARS,
  MAX_SLACK_FILE_NAME_CHARS,
  MAX_SLACK_FILE_PATH_CHARS,
  MAX_SLACK_TEXT_CHARS,
  MAX_TITLE_CHARS,
  MAX_ASKED_BY_CHARS,
  MIN_OPTIONS,
  type LedgerCheck,
  type LedgerForOwner,
  type LedgerOption,
  type LedgerRisk,
  type LedgerViewState,
  type LedgerVisual,
} from './contract';

/** A proof as the session sends it. A file is a path on the session's computer; the main copies it in. */
export type ProofInput =
  | { readonly tipo: 'arquivo'; readonly caminho: string }
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'link'; readonly url: string };

export type LedgerToolCall =
  | {
      readonly tool: 'tarefa_criar';
      readonly pedido: string;
      readonly criterio: string;
      readonly prazo: string;
      readonly dono?: string;
      readonly risco: LedgerRisk;
      readonly quadro?: string;
      readonly titulo?: string;
      /** Pedir pelo Oráculo: o pedido do dono de onde a tarefa nasceu (`pd-…`). */
      readonly pedidoDoDono?: string;
      /** 06/11 — a tarefa que esta substitui: cancelada na mesma hora. */
      readonly substitui?: string;
      /** 07/11 — a pessoa de quem veio o pedido ("dono", "Gabriel Horst (Slack)", "sinal do Curador: PR #219"). */
      readonly quemPediu?: string;
    }
  | { readonly tool: 'tarefa_assumir'; readonly id: string }
  | { readonly tool: 'tarefa_entregar'; readonly id: string; readonly provas: readonly ProofInput[]; readonly nota?: string; readonly paraODono?: LedgerForOwner; readonly feitoPor?: string }
  | { readonly tool: 'tarefa_aceitar'; readonly id: string }
  | { readonly tool: 'tarefa_rejeitar'; readonly id: string; readonly motivo: string }
  | { readonly tool: 'tarefa_listar'; readonly estado?: LedgerViewState; readonly todos?: boolean; readonly quadro?: string; readonly situacao?: LedgerListScope }
  | { readonly tool: 'tarefa_ver'; readonly id: string }
  | { readonly tool: 'tarefa_transferir'; readonly id: string; readonly para: string; readonly motivo: string }
  | { readonly tool: 'tarefa_cancelar'; readonly id: string; readonly motivo: string }
  | {
      readonly tool: 'carta_slack';
      readonly destino: string;
      readonly destinoNome?: string;
      readonly thread?: string;
      /** The message, or (with `arquivo`) the file's comment. */
      readonly texto: string;
      readonly motivo: string;
      /** An upload: the local path and the name in Slack. */
      readonly arquivo?: string;
      readonly arquivoNome?: string;
    };

export type LedgerToolName = LedgerToolCall['tool'];

const ID = { type: 'string', description: 'Id da tarefa (tarefa_listar).' };
const BOARD = { type: 'string', description: 'Só o Líder único (que não tem quadro): o quadro, pelo nome ou pela pasta do projeto. As outras sessões usam sempre o próprio.' };
const STATES: readonly LedgerViewState[] = ['aberta', 'em-execucao', 'entregue', 'aceita', 'rejeitada', 'cancelada'];

/**
 * 06/11 — which tasks `tarefa_listar` shows. `vivas` (the default without `estado`): not closed and with an owner
 * place that can still work; `orfas`: not closed, the owner place closed, out of the board or never started;
 * `todas`: the whole history (the default with `estado`).
 */
export type LedgerListScope = 'vivas' | 'orfas' | 'todas';
const LIST_SCOPES: readonly LedgerListScope[] = ['vivas', 'orfas', 'todas'];

export const LEDGER_TOOLS = [
  {
    name: 'tarefa_criar',
    title: 'Criar tarefa no Oráculo Harrow',
    description:
      'Registra uma tarefa entre lugares do quadro: um título humano, a frase literal de quem pediu, o critério de pronto, o prazo, o lugar dono do trabalho e o risco. Nasce "aberta". Risco baixo pode ser aceito por um lugar com papel Revisor; risco alto espera o dono. Risco baixo só vale quando quem cria não é o dono do trabalho nem foi aberto por ele; senão a tarefa nasce em risco alto. ' +
      'Quando sobe ao dono (risco alto): difícil de desfazer (main, repo público, apagar, credencial, conta, dinheiro); toca outra pessoa ou algo de fora; gasta o que é do dono (limite de conta, VPS, a hora dele); muda a forma do que ele vê e há 2 jeitos bons (sobe com protótipo, nunca com descrição); contradiz o que ele disse ou sai do pedido. ' +
      'Não sobe: só uma opção defensável (decida e registre o porquê); escolha técnica reversível dentro do pedido; resposta já escrita em CLAUDE.md, ADR, memória ou decisão anterior; bug corrigido com teste; risco baixo que o Revisor aceita. Teste: sem uma pergunta numa frase, 2 opções reais e uma recomendação, a decisão não está pronta para subir.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: `Nome humano da tarefa, até ${MAX_TITLE_CHARS} caracteres, sem código. Ex.: "Fase 2 da VPS: senhas e logins".` },
        pedido: { type: 'string', description: 'A frase LITERAL de quem pediu, sem resumir.' },
        criterio: { type: 'string', description: 'Pronto quando… (o que a prova tem de mostrar).' },
        prazo: { type: 'string', description: 'Data AAAA-MM-DD.' },
        dono: { type: 'string', description: 'Id do lugar que faz o trabalho (sessao_listar); padrão: o seu. Líder, Curador e Pesquisa dizem sempre o lugar que faz o trabalho, nunca o próprio.' },
        substitui: { type: 'string', description: 'Id da tarefa que esta substitui (tarefa_listar): ela é cancelada na hora, com o motivo "substituída pela" nova. Vale a regra de quem cancela; sem ela, nada é criado.' },
        risco: { type: 'string', enum: ['baixo', 'alto'] },
        quadro: BOARD,
        pedidoDoDono: { type: 'string', description: 'Quando a tarefa nasce de um "◆ Pedido do dono pelo Oráculo", o id que veio nele (pd-…): o dono vê no celular que o pedido virou esta tarefa.' },
        quemPediu: {
          type: 'string',
          description: `A PESSOA de quem veio o pedido, nunca um papel: "dono" (o dono do Donel), alguém do Slack pelo nome ("Gabriel Horst (Slack)") ou a fonte de um sinal ("sinal do Curador: PR #219"). Até ${MAX_ASKED_BY_CHARS} caracteres. É o que o registro mostra em "quem pediu"; sem ele, a coluna fica "não registrado" (nada é deduzido de quem criou).`,
        },
      },
      required: ['pedido', 'criterio', 'prazo', 'risco'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_assumir',
    title: 'Assumir tarefa',
    description: 'O lugar dono começa (ou retoma, depois de rejeitada) a tarefa: vai para "em execução".',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'tarefa_entregar',
    title: 'Entregar tarefa com prova',
    description:
      `Marca a tarefa como entregue. Sem prova é recusada. Provas (1 a ${MAX_PROOFS}): {"tipo":"arquivo","caminho":"C:/…/print.png"} (print, vídeo ou protótipo .html neste computador; o app copia para o Oráculo Harrow), {"tipo":"texto","texto":"saída do comando"} ou {"tipo":"link","url":"https://… (o CI)"}. Quem entrega não aceita a própria entrega. ` +
      'Protótipo: um .html AUTOCONTIDO (CSS, JS e imagens dentro dele, até 2 MB), que roda isolado dentro da carta, sem rede; aponte-o como visual ({"prova": n}) quando a decisão muda algo que o dono vê. ' +
      `"paraODono" é a carta que o dono lê para decidir em 5 segundos, sem abrir link; obrigatório no risco alto. Traz a pergunta, um resumo, de ${MIN_OPTIONS} a ${MAX_OPTIONS} opções com nome e efeito (exatamente uma recomendada), o porquê dela, o risco e o visual (qual print mostrar). ` +
      'Escreva para um humano: o texto é recusado se tiver id de tarefa ou de lugar, branch, hash, número de PR, caminho, link ou crases. O técnico vai nas provas. ' +
      'Quando o dono escreve na carta ("◆ Do dono, na carta…"), responda entregando a mesma tarefa de novo, com a carta atualizada: ela continua esperando o dono.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        provas: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PROOFS,
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['arquivo', 'texto', 'link'] },
              caminho: { type: 'string', description: 'arquivo: caminho absoluto do print, vídeo ou protótipo (png, jpg, gif, webp, mp4, webm, mov, ou html autocontido de até 2 MB).' },
              texto: { type: 'string', description: 'texto: a saída do comando.' },
              url: { type: 'string', description: 'link: http(s), ex. a execução do CI.' },
            },
            required: ['tipo'],
            additionalProperties: false,
          },
        },
        nota: { type: 'string', description: 'O que foi feito, em uma ou duas frases (opcional).' },
        feitoPor: { type: 'string', description: 'Quando outro lugar fez o trabalho e você só entrega: o id dele (sessao_listar). Ele fica no registro como quem fez, e também não decide a entrega.' },
        paraODono: {
          type: 'object',
          description: 'A carta do dono: a frente decide, o verso explica. Texto de gente, sem código.',
          properties: {
            titulo: { type: 'string', description: `Sobrescreve o título da tarefa nesta carta (até ${MAX_TITLE_CHARS}).` },
            pergunta: { type: 'string', description: `O que o dono decide, numa frase (até ${FOR_OWNER_LIMITS.question}). Ex.: "A VPS já tem todos os acessos. Aceito a fase 2?"` },
            resumo: { type: 'string', description: `O que aconteceu (até ${FOR_OWNER_LIMITS.summary}).` },
            opcoes: {
              type: 'array',
              minItems: MIN_OPTIONS,
              maxItems: MAX_OPTIONS,
              items: {
                type: 'object',
                properties: {
                  rotulo: { type: 'string', description: `Nome do caminho, vira o botão (até ${FOR_OWNER_LIMITS.label}). Ex.: "Aceitar com ressalva".` },
                  efeito: { type: 'string', description: `O que acontece se o dono escolher (até ${FOR_OWNER_LIMITS.effect}).` },
                  risco: { type: 'string', description: `O risco deste caminho (até ${FOR_OWNER_LIMITS.optionRisk}).` },
                  fecha: { type: 'string', enum: ['aceita', 'rejeitada'], description: 'Como a tarefa fecha com este caminho.' },
                  recomendada: { type: 'boolean', description: 'Exatamente uma opção é a recomendada.' },
                },
                required: ['rotulo', 'efeito', 'fecha'],
                additionalProperties: false,
              },
            },
            porque: { type: 'string', description: `Por que a recomendada (até ${FOR_OWNER_LIMITS.why}).` },
            risco: { type: 'string', description: `A frase do risco desta tarefa (até ${FOR_OWNER_LIMITS.risk}).` },
            visual: {
              type: 'object',
              description: `Obrigatório quando há print, vídeo ou protótipo. {"prova": n} (1 = a primeira prova), {"antes": n, "depois": m}, ou, sem tela, {"checagens": [{"nome", "ok", "frase"}]} (1 a ${MAX_CHECKS}).`,
              properties: {
                prova: { type: 'integer', minimum: 1, maximum: MAX_PROOFS },
                antes: { type: 'integer', minimum: 1, maximum: MAX_PROOFS },
                depois: { type: 'integer', minimum: 1, maximum: MAX_PROOFS },
                checagens: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { nome: { type: 'string' }, ok: { type: 'boolean' }, frase: { type: 'string' } },
                    required: ['nome', 'ok', 'frase'],
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
          },
          required: ['pergunta', 'resumo', 'opcoes', 'porque', 'risco'],
          additionalProperties: false,
        },
      },
      required: ['id', 'provas'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_aceitar',
    title: 'Aceitar entrega',
    description:
      'Aceita uma entrega. ANTES, leia a prova com tarefa_ver (sem isso o aceite é recusado) e confira que ela mostra o critério. Só um lugar com papel Revisor, só risco baixo, só do seu quadro e de fora da cadeia de quem entregou (não aberto por ele nem abaixo dele); quem entregou nunca aceita. O resto espera o dono.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'tarefa_rejeitar',
    title: 'Rejeitar entrega',
    description: 'Rejeita uma entrega com motivo, depois de ler a prova com tarefa_ver (mesma regra de quem aceita). O lugar dono pode assumir de novo.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, motivo: { type: 'string', description: 'O que falta ou está errado.' } },
      required: ['id', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_transferir',
    title: 'Passar a tarefa a outro lugar',
    description:
      'Troca o lugar dono de uma tarefa (aberta, em execução, rejeitada ou entregue), com motivo; o registro guarda quem passou, de quem e para quem. Em execução, ela volta a "aberta" e o novo dono assume com tarefa_assumir. ' +
      'Quem pode: o Líder, o lugar dono atual ou, quando o lugar dono está fechado, saiu do quadro ou não começou, a sessão que vai fazer o trabalho, passando a si mesma ("para": "seu"). O destino é um lugar deste quadro (sessao_listar) ou "lider" (o Líder único, que fica dono dela); o Líder único passa a um lugar que ele alcança no quadro da tarefa, ou a si mesmo ("seu"). Um lugar que fecha com tarefa aberta, em execução ou rejeitada passa-a sozinho a quem está acima dele, ou ao Líder único.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        para: { type: 'string', description: 'Id do lugar que fica com a tarefa (sessao_listar), "lider" (o Líder único) ou "seu".' },
        motivo: { type: 'string', description: 'Por que a tarefa muda de dono (ex.: o lugar dono fechou).' },
      },
      required: ['id', 'para', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_cancelar',
    title: 'Cancelar tarefa ou carta',
    description:
      'Encerra de vez uma tarefa que não vai mais acontecer, com motivo: uma carta de Slack substituída por outra (aceita e nunca enviada, ou ainda esperando o dono), um trabalho que ninguém vai fazer. Cancelada, a carta não libera envio e a tarefa não se assume de novo; o histórico fica. Quem pode: o Líder, o lugar dono ou o dono. Tarefa aceita (fora carta não enviada) não se cancela.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, motivo: { type: 'string', description: 'Por que acaba (ex.: substituída pela carta nova).' } },
      required: ['id', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'tarefa_listar',
    title: 'Listar tarefas do Oráculo Harrow',
    description:
      'As tarefas do quadro deste projeto (ou de todos), com estado, dono, prazo, risco e o resumo da última entrega, e a faixa de números do quadro. A prova inteira se lê com tarefa_ver. ' +
      'Por padrão, só as vivas: nem fechadas (aceitas, canceladas, cartas rejeitadas) nem órfãs, nem cartas de Slack aceitas que ainda esperam o envio (contadas à parte, em "esperandoEnvio"; seguem liberando um envio). Órfã é a tarefa não fechada cujo lugar dono fechou, saiu do quadro ou não começou: passe-a adiante com tarefa_transferir ou encerre com tarefa_cancelar. Nada se apaga: "situacao" "todas" mostra o histórico inteiro.',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: STATES },
        situacao: { type: 'string', enum: LIST_SCOPES, description: 'vivas (padrão sem estado), orfas ou todas (padrão com estado).' },
        todos: { type: 'boolean', description: 'true: de todos os quadros (padrão: só o deste projeto).' },
        quadro: BOARD,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tarefa_ver',
    title: 'Ver tarefa e prova',
    description:
      'Uma tarefa inteira, com a prova da última entrega: o texto completo, o link e, para print ou vídeo, o caminho do arquivo copiado (o primeiro print vem também como imagem). Quem decide (tarefa_aceitar, tarefa_rejeitar) lê a prova aqui antes.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'carta_slack',
    title: 'Pedir ao dono para mandar mensagem no Slack',
    description:
      'Toda mensagem ao Slack em nome do dono (canal, pessoa ou thread; por MCP do Slack, Composio, curl ou script) precisa ANTES desta carta aceita pelo dono: sem ela o Donel Dev bloqueia o envio. A carta leva o destino, a thread, o texto EXATO e o motivo, e espera o dono no Oráculo Harrow (desktop e celular). Aceita: envie o mesmo texto ao mesmo destino e thread, uma vez só. Rejeitada: não envie; o motivo diz o ajuste; crie outra carta. Veja a decisão com tarefa_ver. Para mandar um ARQUIVO, a carta leva também "arquivo" (o caminho local, exatamente como vai na ferramenta de upload do MCP do Slack) e o texto é o comentário do arquivo; aceita, libera um upload só desse arquivo.',
    inputSchema: {
      type: 'object',
      properties: {
        destino: { type: 'string', description: 'O canal ou a pessoa EXATAMENTE como vai no campo da ferramenta de envio (ex.: o id C0123ABC, ou #produto se a ferramenta usa o nome).' },
        destinoNome: { type: 'string', description: 'Como o dono reconhece o destino (ex.: #produto, Fulana). Opcional.' },
        thread: { type: 'string', description: 'O thread_ts, quando a mensagem é resposta numa thread.' },
        texto: { type: 'string', description: 'A mensagem exata, caractere por caractere, como vai ser enviada.' },
        motivo: { type: 'string', description: 'Por que a mensagem vai, em uma frase para o dono.' },
        arquivo: { type: 'string', description: 'Só para mandar arquivo: o caminho local, EXATAMENTE como vai no campo de caminho da ferramenta de upload. Com ele, "texto" é o comentário do arquivo.' },
        arquivoNome: { type: 'string', description: 'Só com "arquivo": o nome que aparece no Slack, se for outro que não o fim do caminho. Opcional.' },
      },
      required: ['destino', 'texto', 'motivo'],
      additionalProperties: false,
    },
  },
] as const;

const NAMES: ReadonlySet<string> = new Set(LEDGER_TOOLS.map((tool) => tool.name));

export function isLedgerToolName(name: string): name is LedgerToolName {
  return NAMES.has(name);
}

export type ParsedLedgerCall = { readonly ok: true; readonly call: LedgerToolCall } | { readonly ok: false; readonly reason: string };

function text(value: unknown, field: string, max: number, required: boolean): string | undefined | { error: string } {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) return { error: `"${field}" é obrigatório (texto).` };
  if (value.length > max) return { error: `"${field}" longo demais (máximo ${max} caracteres).` };
  return value;
}

function parseProofInput(raw: unknown, index: number): ProofInput | string {
  const where = `prova ${index + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${where}: tem de ser um objeto.`;
  const r = raw as Record<string, unknown>;
  switch (r.tipo) {
    case 'arquivo':
      return typeof r.caminho === 'string' && r.caminho.trim() ? { tipo: 'arquivo', caminho: r.caminho.trim() } : `${where}: "caminho" é obrigatório.`;
    case 'texto':
      return typeof r.texto === 'string' && r.texto.trim() && r.texto.length <= MAX_PROOF_TEXT_CHARS
        ? { tipo: 'texto', texto: r.texto }
        : `${where}: "texto" é obrigatório (até ${MAX_PROOF_TEXT_CHARS} caracteres).`;
    case 'link':
      return typeof r.url === 'string' && r.url.trim() ? { tipo: 'link', url: r.url.trim() } : `${where}: "url" é obrigatório.`;
    default:
      return `${where}: "tipo" tem de ser arquivo, texto ou link.`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function proofNumber(value: unknown, field: string): number | string {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PROOFS ? value - 1 : `"paraODono.visual.${field}" é o número de uma prova (1 a ${MAX_PROOFS}).`;
}

function parseVisualInput(raw: unknown): LedgerVisual | string {
  if (!isRecord(raw)) return '"paraODono.visual" tem de ser um objeto.';
  if (raw.checagens !== undefined) {
    if (!Array.isArray(raw.checagens)) return '"paraODono.visual.checagens" é uma lista.';
    const checks: LedgerCheck[] = [];
    for (const [i, check] of raw.checagens.entries()) {
      if (!isRecord(check) || typeof check.nome !== 'string' || typeof check.ok !== 'boolean' || typeof check.frase !== 'string')
        return `"paraODono.visual.checagens[${i + 1}]" precisa de nome, ok (true/false) e frase.`;
      checks.push({ name: check.nome.trim(), ok: check.ok, sentence: check.frase.trim() });
    }
    return { kind: 'checagens', checks };
  }
  if (raw.antes !== undefined || raw.depois !== undefined) {
    const before = proofNumber(raw.antes, 'antes');
    const after = proofNumber(raw.depois, 'depois');
    if (typeof before === 'string') return before;
    return typeof after === 'string' ? after : { kind: 'antes-depois', before, after };
  }
  const proof = proofNumber(raw.prova, 'prova');
  return typeof proof === 'string' ? proof : { kind: 'prova', proof };
}

/** The shape of "paraODono" (types and required keys). Its rules (counts, limits, plain language, visual) are the contract's. */
function parseForOwnerInput(raw: unknown): LedgerForOwner | string {
  if (!isRecord(raw)) return '"paraODono" tem de ser um objeto.';
  const texts: Record<string, string> = {};
  for (const key of ['pergunta', 'resumo', 'porque', 'risco']) {
    if (typeof raw[key] !== 'string') return `"paraODono.${key}" é obrigatório (texto).`;
    texts[key] = (raw[key] as string).trim();
  }
  if (raw.titulo !== undefined && typeof raw.titulo !== 'string') return '"paraODono.titulo" é texto.';
  if (!Array.isArray(raw.opcoes)) return `"paraODono.opcoes" é uma lista de ${MIN_OPTIONS} a ${MAX_OPTIONS} caminhos.`;
  const options: LedgerOption[] = [];
  for (const [i, option] of raw.opcoes.entries()) {
    const where = `"paraODono.opcoes[${i + 1}]"`;
    if (!isRecord(option) || typeof option.rotulo !== 'string' || typeof option.efeito !== 'string') return `${where} precisa de rotulo e efeito (texto).`;
    if (option.risco !== undefined && typeof option.risco !== 'string') return `${where}: "risco" é texto.`;
    if (option.fecha !== 'aceita' && option.fecha !== 'rejeitada') return `${where}: "fecha" é aceita ou rejeitada.`;
    if (option.recomendada !== undefined && typeof option.recomendada !== 'boolean') return `${where}: "recomendada" é true ou false.`;
    options.push({
      label: option.rotulo.trim(),
      effect: option.efeito.trim(),
      ...(typeof option.risco === 'string' && option.risco.trim() ? { risk: option.risco.trim() } : {}),
      closes: option.fecha,
      ...(option.recomendada ? { recommended: true as const } : {}),
    });
  }
  let visual: LedgerVisual | undefined;
  if (raw.visual !== undefined) {
    const parsed = parseVisualInput(raw.visual);
    if (typeof parsed === 'string') return parsed;
    visual = parsed;
  }
  return {
    ...(typeof raw.titulo === 'string' && raw.titulo.trim() ? { title: raw.titulo.trim() } : {}),
    question: texts.pergunta!,
    summary: texts.resumo!,
    options,
    why: texts.porque!,
    risk: texts.risco!,
    ...(visual ? { visual } : {}),
  };
}

export function parseLedgerToolCall(name: string, rawArgs: unknown): ParsedLedgerCall {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'Argumentos têm de ser um objeto.' };
  const fail = (reason: string): ParsedLedgerCall => ({ ok: false, reason });
  const id = text(args.id, 'id', 120, true);
  const board = text(args.quadro, 'quadro', 260, false);
  if (typeof board === 'object') return fail(board.error);
  const quadro = board?.trim() ? { quadro: board.trim() } : {};
  switch (name) {
    case 'tarefa_criar': {
      const pedido = text(args.pedido, 'pedido', MAX_REQUEST_CHARS, true);
      const criterio = text(args.criterio, 'criterio', MAX_REQUEST_CHARS, true);
      const prazo = text(args.prazo, 'prazo', 40, true);
      const dono = text(args.dono, 'dono', 120, false);
      const titulo = text(args.titulo, 'titulo', MAX_TITLE_CHARS, false);
      const substitui = text(args.substitui, 'substitui', 120, false);
      const quemPediu = text(args.quemPediu, 'quemPediu', MAX_ASKED_BY_CHARS, false);
      for (const value of [pedido, criterio, prazo, dono, titulo, substitui, quemPediu]) if (typeof value === 'object') return fail(value.error);
      if (typeof quemPediu === 'string' && /place:/i.test(quemPediu)) return fail('"quemPediu" é a pessoa que pediu ("dono", "Fulano (Slack)"), nunca o id de um lugar.');
      if (args.risco !== 'baixo' && args.risco !== 'alto') return fail('"risco" tem de ser baixo ou alto.');
      if (args.pedidoDoDono !== undefined && (typeof args.pedidoDoDono !== 'string' || !/^pd-[0-9a-f]{12}$/.test(args.pedidoDoDono))) return fail('"pedidoDoDono" é o id que veio no pedido do dono (pd-…).');
      const fromOwner = typeof args.pedidoDoDono === 'string' ? { pedidoDoDono: args.pedidoDoDono } : {};
      return {
        ok: true,
        call: { tool: 'tarefa_criar', pedido: pedido as string, criterio: criterio as string, prazo: (prazo as string).trim(), ...(typeof dono === 'string' && dono.trim() ? { dono: dono.trim() } : {}), risco: args.risco, ...quadro, ...(typeof titulo === 'string' && titulo.trim() ? { titulo: titulo.trim() } : {}), ...(typeof substitui === 'string' && substitui.trim() ? { substitui: substitui.trim() } : {}), ...(typeof quemPediu === 'string' && quemPediu.trim() ? { quemPediu: quemPediu.trim() } : {}), ...fromOwner },
      };
    }
    case 'tarefa_assumir':
    case 'tarefa_aceitar':
    case 'tarefa_ver':
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      return { ok: true, call: { tool: name, id: id.trim() } };
    case 'tarefa_entregar': {
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      if (!Array.isArray(args.provas) || args.provas.length === 0) return fail('Entrega sem prova é recusada: "provas" precisa de ao menos uma (arquivo, texto ou link).');
      if (args.provas.length > MAX_PROOFS) return fail(`No máximo ${MAX_PROOFS} provas por entrega.`);
      const provas: ProofInput[] = [];
      for (const [index, raw] of args.provas.entries()) {
        const proof = parseProofInput(raw, index);
        if (typeof proof === 'string') return fail(proof);
        provas.push(proof);
      }
      const nota = text(args.nota, 'nota', MAX_REQUEST_CHARS, false);
      if (typeof nota === 'object') return fail(nota.error);
      const feitoPor = text(args.feitoPor, 'feitoPor', 120, false);
      if (typeof feitoPor === 'object') return fail(feitoPor.error);
      const paraODono = args.paraODono === undefined ? undefined : parseForOwnerInput(args.paraODono);
      if (typeof paraODono === 'string') return fail(paraODono);
      return { ok: true, call: { tool: 'tarefa_entregar', id: id.trim(), provas, ...(nota?.trim() ? { nota } : {}), ...(paraODono ? { paraODono } : {}), ...(feitoPor?.trim() ? { feitoPor: feitoPor.trim() } : {}) } };
    }
    case 'tarefa_cancelar':
    case 'tarefa_rejeitar': {
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      const motivo = text(args.motivo, 'motivo', MAX_REQUEST_CHARS, true);
      if (typeof motivo === 'object' || motivo === undefined) return fail(`"motivo" é obrigatório para ${name === 'tarefa_cancelar' ? 'cancelar' : 'rejeitar'}.`);
      return { ok: true, call: { tool: name, id: id.trim(), motivo } };
    }
    case 'tarefa_transferir': {
      if (typeof id === 'object' || id === undefined) return fail('"id" é obrigatório.');
      const para = text(args.para, 'para', 120, true);
      const motivo = text(args.motivo, 'motivo', MAX_REQUEST_CHARS, true);
      if (typeof para === 'object' || para === undefined) return fail('"para" é obrigatório: o lugar que fica com a tarefa, ou "seu".');
      if (typeof motivo === 'object' || motivo === undefined) return fail('"motivo" é obrigatório: por que a tarefa muda de dono.');
      return { ok: true, call: { tool: 'tarefa_transferir', id: id.trim(), para: para.trim(), motivo: motivo.trim() } };
    }
    case 'tarefa_listar': {
      if (args.estado !== undefined && !STATES.includes(args.estado as LedgerViewState)) return fail(`"estado" tem de ser ${STATES.join(', ')}.`);
      if (args.situacao !== undefined && !LIST_SCOPES.includes(args.situacao as LedgerListScope)) return fail(`"situacao" tem de ser ${LIST_SCOPES.join(', ')}.`);
      if (args.todos !== undefined && typeof args.todos !== 'boolean') return fail('"todos" é true ou false.');
      return { ok: true, call: { tool: 'tarefa_listar', ...(args.estado ? { estado: args.estado as LedgerViewState } : {}), ...(args.situacao ? { situacao: args.situacao as LedgerListScope } : {}), ...(args.todos ? { todos: true } : {}), ...quadro } };
    }
    case 'carta_slack': {
      const destino = text(args.destino, 'destino', 200, true);
      const destinoNome = text(args.destinoNome, 'destinoNome', 200, false);
      const thread = text(args.thread, 'thread', 120, false);
      const texto = text(args.texto, 'texto', MAX_SLACK_TEXT_CHARS, true);
      const motivo = text(args.motivo, 'motivo', MAX_REQUEST_CHARS, true);
      const arquivo = text(args.arquivo, 'arquivo', MAX_SLACK_FILE_PATH_CHARS, false);
      const arquivoNome = text(args.arquivoNome, 'arquivoNome', MAX_SLACK_FILE_NAME_CHARS, false);
      for (const value of [destino, destinoNome, thread, texto, motivo, arquivo, arquivoNome]) if (typeof value === 'object') return fail(value.error);
      const caminho = typeof arquivo === 'string' ? arquivo.trim() : '';
      if (!caminho && typeof arquivoNome === 'string' && arquivoNome.trim()) return fail('"arquivoNome" só vai junto com "arquivo" (o caminho).');
      return {
        ok: true,
        call: {
          tool: 'carta_slack',
          destino: (destino as string).trim(),
          ...(typeof destinoNome === 'string' && destinoNome.trim() ? { destinoNome: destinoNome.trim() } : {}),
          ...(typeof thread === 'string' && thread.trim() ? { thread: thread.trim() } : {}),
          texto: texto as string,
          motivo: (motivo as string).trim(),
          ...(caminho ? { arquivo: caminho, ...(typeof arquivoNome === 'string' && arquivoNome.trim() ? { arquivoNome: arquivoNome.trim() } : {}) } : {}),
        },
      };
    }
    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
