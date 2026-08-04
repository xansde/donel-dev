// Spec 010 / batch B6 — o que sobrou de `openPhaseSession.ts`.
//
// O módulo inteiro decidia o gesto do mapa ANTIGO (que sessão abrir, que
// comando pré-digitar, o prompt de conciliação). Isso saiu com o modelo antigo:
// quem decide o gesto hoje é `Esteira/esteiraSession.ts` + `preparePhase.ts`,
// sobre o store.
//
// O que sobreviveu é o INVARIANTE, e ele não muda de dono: **cada comando com
// o seu próprio Enter, e o Enter é sempre humano** (invariante 2/CA-3). Nada
// que sai daqui contém quebra de linha; a máquina abaixo só garante que os passos
// saem um a um, e que quem chama decide quando o próximo pode sair.

export interface PrimeSequencer {
  /** `true` quando não há mais nada a pré-digitar. */
  readonly done: boolean;
  /** Libera o PRÓXIMO comando (ou `null` se acabou). Quem chama só o faz depois do sinal de "pronto para receber input". */
  next(): string | null;
}

export function createPrimeSequencer(commands: readonly string[]): PrimeSequencer {
  let index = 0;
  return {
    get done(): boolean {
      return index >= commands.length;
    },
    next(): string | null {
      if (index >= commands.length) return null;
      const command = commands[index];
      index += 1;
      return command;
    },
  };
}
