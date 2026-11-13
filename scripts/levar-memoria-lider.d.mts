// Tipos do levar-memoria-lider.mjs para o teste (tests/levar-memoria-lider.test.ts). O script roda em Node puro, sem build.

export interface MemoryConflict {
  /** The file, relative to the memory folder (with `/`). */
  readonly name: string;
  /** Where the old version goes, next to it. */
  readonly savedAs: string;
  /** `save`: it will be (was) saved; `already-saved`: an earlier run saved it; `blocked`: that name holds something else. */
  readonly status: 'save' | 'already-saved' | 'blocked';
}

export interface MemoryReport {
  readonly copied: string[];
  readonly same: string[];
  readonly conflicts: MemoryConflict[];
  readonly addedLines: string[];
  readonly blocked: boolean;
  readonly applied: boolean;
}

export function mergeMemoryIndex(oldText: string, newText: string, renamed?: Readonly<Record<string, string>>): { text: string; added: string[] };
export function carryMemory(oldDir: string, newDir: string, options: { apply: boolean }): MemoryReport;
export function formatReport(report: MemoryReport): string;
