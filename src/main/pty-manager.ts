import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { IPty } from 'node-pty';
import { spawn } from 'node-pty';
import { stripAnsi } from './ansi';

// PtyManager (main process) — plan.md "Arquitetura de processos" + ponto 8.
// Responsável por spawn/kill/resize de PTYs via node-pty (ConPTY no Windows),
// batching do output (~16ms, plan.md linha 39) e um ring buffer de ~50 linhas
// (ANSI stripado) por PTY para o hover-preview de sessões (chega em T007+;
// aqui só o mecanismo fica pronto, exposto via IPC sob demanda).

const BATCH_INTERVAL_MS = 16;
const RING_BUFFER_LINES = 50;

interface PtyRecord {
  id: string;
  pty: IPty;
  pendingChunks: string[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  ringBuffer: string[];
  /** Cauda ainda sem quebra de linha (bytes crus, ANSI stripado só ao fechar a linha). */
  rawTail: string;
}

export interface PtyCreateOptions {
  cols: number;
  rows: number;
  cwd?: string;
}

export type PtyDataListener = (ptyId: string, data: string) => void;
export type PtyExitListener = (ptyId: string, exitCode: number, signal?: number) => void;

/** Shell da aba de terminal livre (FR-008): PowerShell sem banner de logo. */
const FREE_TERMINAL_SHELL = 'powershell.exe';
const FREE_TERMINAL_ARGS = ['-NoLogo'];

export class PtyManager {
  private readonly ptys = new Map<string, PtyRecord>();
  private readonly dataListeners = new Set<PtyDataListener>();
  private readonly exitListeners = new Set<PtyExitListener>();

  onData(listener: PtyDataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: PtyExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  create(options: PtyCreateOptions): string {
    const id = randomUUID();
    const ptyProcess = spawn(FREE_TERMINAL_SHELL, FREE_TERMINAL_ARGS, {
      name: 'xterm-color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd ?? os.homedir(),
      env: process.env as Record<string, string>,
    });

    const record: PtyRecord = {
      id,
      pty: ptyProcess,
      pendingChunks: [],
      flushTimer: null,
      ringBuffer: [],
      rawTail: '',
    };
    this.ptys.set(id, record);

    ptyProcess.onData((chunk) => {
      record.pendingChunks.push(chunk);
      this.appendToRingBuffer(record, chunk);
      this.scheduleFlush(record);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (record.flushTimer) clearTimeout(record.flushTimer);
      this.flush(record);
      this.ptys.delete(id);
      for (const listener of this.exitListeners) listener(id, exitCode, signal);
    });

    return id;
  }

  input(id: string, data: string): void {
    this.ptys.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.ptys.get(id)?.pty.resize(cols, rows);
  }

  kill(id: string): void {
    const record = this.ptys.get(id);
    if (!record) return;
    if (record.flushTimer) clearTimeout(record.flushTimer);
    record.pty.kill();
    this.ptys.delete(id);
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  getPreview(id: string): string[] {
    return this.ptys.get(id)?.ringBuffer.slice(-RING_BUFFER_LINES) ?? [];
  }

  private scheduleFlush(record: PtyRecord): void {
    if (record.flushTimer) return;
    record.flushTimer = setTimeout(() => {
      record.flushTimer = null;
      this.flush(record);
    }, BATCH_INTERVAL_MS);
  }

  private flush(record: PtyRecord): void {
    if (record.pendingChunks.length === 0) return;
    const data = record.pendingChunks.join('');
    record.pendingChunks = [];
    for (const listener of this.dataListeners) listener(record.id, data);
  }

  private appendToRingBuffer(record: PtyRecord, chunk: string): void {
    const combined = record.rawTail + chunk;
    const lines = combined.split(/\r?\n/);
    record.rawTail = lines.pop() ?? '';
    if (lines.length === 0) return;

    record.ringBuffer.push(...lines.map(stripAnsi));
    if (record.ringBuffer.length > RING_BUFFER_LINES) {
      record.ringBuffer.splice(0, record.ringBuffer.length - RING_BUFFER_LINES);
    }
  }
}
