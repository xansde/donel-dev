// One rule for "this is not a message to the owner's phone", shared by the Oráculo's loopback route
// (`src/oraculo/chat-responder.ts`) and the desktop's transcript reader (`src/main/lider/celular-chat.ts`).
// The owner (19/11, t-d461e003): "Eu prefiro não receber mensagem do que receber uma mensagem vazia tua." A lone "-"
// is the script's stdin placeholder, never a message: `puxar -` (which did not read the stdin) sent it 11 times.

/** True when `text`, trimmed, is empty or only "-": nothing goes to the phone. */
export function isBlankReply(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || trimmed === '-';
}
