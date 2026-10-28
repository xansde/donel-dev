// Novidades da versão — puro: decide o que mostrar a partir da última data vista.

import type { PatchNoteDay } from './notes';

/**
 * Dias mais novos que `lastSeen`, do mais novo para o mais antigo.
 * `lastSeen` nulo (primeira vez nesta máquina) mostra só o dia mais recente:
 * ninguém quer ler o histórico inteiro na estreia.
 */
export function unseenNotes(notes: readonly PatchNoteDay[], lastSeen: string | null): readonly PatchNoteDay[] {
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  if (lastSeen === null) return sorted.slice(0, 1);
  return sorted.filter((day) => day.date > lastSeen);
}

/** A data a gravar como vista depois de mostrar: a mais nova das notas, ou `null` sem notas. */
export function latestNoteDate(notes: readonly PatchNoteDay[]): string | null {
  return notes.reduce<string | null>((max, day) => (max === null || day.date > max ? day.date : max), null);
}

/** "28/10" a partir de `AAAA-MM-DD`. */
export function formatNoteDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}
