// FIX (auditoria rodada 5, achados alta/media do Fix 1 — TerminalPane.tsx) —
// função pura extraída de `TerminalPane.tsx` pra ser testável em isolamento
// (TDD com escopo — bugfix de produção; a auditoria apontou que TODA a
// lógica do Fix 1 vivia inline em `spawnSession`, sem cobertura além de um
// smoke Playwright caro que, além disso, estava falhando).
//
// CAUSA RAIZ do achado alta original: o match usava só a string 'trust this
// folder' (primeira linha pintada do diálogo), que aparece ANTES do CLI
// terminar de desenhar e armar o leitor de stdin — um `\r` disparado nesse
// instante é engolido. Exigir as DUAS linhas do RODAPÉ interativo
// ('Enter to confirm' + '2. No, exit') garante que o diálogo já está
// totalmente pintado e pronto pra receber input, e — efeito colateral
// desejado (achado media "janela sem SessionStart") — é uma assinatura
// praticamente impossível de aparecer por acidente num prompt digitado pelo
// usuário ou citado numa resposta do modelo.

import { lineText, type LineInput } from './screenLine';

/** Rodapé interativo do diálogo de confiança — só aparece quando ele já terminou de desenhar. Igual em 2.1.293 ("Enter to confirm · Esc to cancel"). */
export const TRUST_DIALOG_CONFIRM_MARKER = 'Enter to confirm';
/** Opção do diálogo no CLI ANTIGO ("2. No, exit"). A 2.1.293 não numera as opções — ver `TRUST_DIALOG_OPTION_MARKERS`. */
export const TRUST_DIALOG_EXIT_MARKER = '2. No, exit';

/**
 * Marcadores do CORPO do diálogo de confiança (014 / R6): a 2.1.293 desenha
 * "Quick safety check: …" e as opções "No, exit" / "Yes, I trust this folder"
 * SEM numeração. Basta UM, somado ao rodapé — dois grupos de evidência
 * independentes e nenhum deles digitável por acidente junto do outro.
 */
export const TRUST_DIALOG_BODY_MARKERS: readonly string[] = [
  'Quick safety check',
  'Yes, I trust this folder',
  TRUST_DIALOG_EXIT_MARKER,
];

/** Corpo do diálogo "external imports" (CLAUDE.md que importa arquivos de fora da pasta). Exige as DUAS partes. */
const EXTERNAL_IMPORTS_TITLE = /external\b.*\bimports?\b/i;
const EXTERNAL_IMPORTS_OPTION = /\b(allow|disable)\b.*\bexternal imports?\b/i;

export type TrustDialogKind = 'trust' | 'external-imports';

/**
 * Qual diálogo de confiança está na tela, ou `null`. Pura, sem I/O. Varre TODAS
 * as linhas, em qualquer ordem, e usa o texto COMPLETO (inclusive o que está
 * em dim): o rodapé do diálogo pode ser desenhado dim e perdê-lo derrubaria a
 * detecção — a defesa contra falso positivo é a exigência de rodapé + corpo,
 * não o atributo.
 *
 * O rodapé é obrigatório: o corpo aparece ANTES de o CLI armar o leitor de
 * stdin, e um Enter (CR) nesse instante é engolido (achado alta da auditoria rodada 5).
 */
export function trustDialogKind(lines: readonly LineInput[]): TrustDialogKind | null {
  let confirm = false;
  let body = false;
  let externalTitle = false;
  let externalOption = false;
  for (const raw of lines) {
    const line = lineText(raw);
    if (line.includes(TRUST_DIALOG_CONFIRM_MARKER)) confirm = true;
    if (TRUST_DIALOG_BODY_MARKERS.some((marker) => line.includes(marker))) body = true;
    if (EXTERNAL_IMPORTS_TITLE.test(line)) externalTitle = true;
    if (EXTERNAL_IMPORTS_OPTION.test(line)) externalOption = true;
  }
  if (!confirm) return null;
  if (body) return 'trust';
  if (externalTitle && externalOption) return 'external-imports';
  return null;
}

/** `true` quando algum diálogo de confiança (pasta ou "external imports") está inteiramente pintado. */
export function isTrustDialogVisible(lines: readonly LineInput[]): boolean {
  return trustDialogKind(lines) !== null;
}
