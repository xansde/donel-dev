// Tipos do levar-memoria-lider.mjs para o teste (tests/levar-memoria-lider.test.ts). O script roda em Node puro, sem build.

export interface MemoryConflict {
  /** The file, relative to the memory folder (with `/`). */
  readonly name: string;
  /** Where the old version goes, next to it. */
  readonly savedAs: string;
  /** `save`: it will be (was) saved; `already-saved`: an earlier run saved it; `blocked`: that name holds something else. */
  readonly status: 'save' | 'already-saved' | 'blocked';
  /** `collision`: the old folder has a file with the `savedAs` name too. */
  readonly reason?: 'collision';
}

/** An old index entry for a file the new index already has, with another text: not added, for the owner to decide. */
export interface IndexConflict {
  /** The file the entry points to (folded, without anchor). */
  readonly link: string;
  readonly old: string;
  readonly new: string;
}

/** A write that failed midway: what was written, what is missing (the index always last). */
export interface PartialWrite {
  readonly written: string[];
  readonly missing: string[];
  readonly failed: string;
  readonly why: string;
}

export interface MemoryReport {
  readonly copied: string[];
  readonly same: string[];
  readonly conflicts: MemoryConflict[];
  readonly indexConflicts: IndexConflict[];
  readonly stopped: { readonly name: string; readonly why: string }[];
  /** Symbolic links of the old folder, not followed. */
  readonly ignored: string[];
  readonly addedLines: string[];
  readonly blocked: boolean;
  readonly applied: boolean;
  readonly partial?: PartialWrite;
}

export function mergeMemoryIndex(oldText: string, newText: string, renamed?: Readonly<Record<string, string>>): { text: string; added: string[]; conflicts: IndexConflict[] };
export function carryMemory(oldDir: string, newDir: string, options: { apply: boolean }): MemoryReport;
export function formatReport(report: MemoryReport): string;
