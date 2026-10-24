import { describe, expect, it, vi } from 'vitest';
import { createHookBridge } from '../src/main/hook-bridge';
import { SessionSemaphoreManager } from '../src/main/session-semaphore-manager';

// Mindscape, fatia 03 — `onTurnEnded` feeds the post-it written by the session.
// It fires on `Stop` and `StopFailure`, on both transports, with the payload's
// `last_assistant_message` (or `null` when the field is missing or empty).

type Ended = { ptyId: string; text: string | null };

async function postLegacy(port: number, body: unknown): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function postBridge(port: number, token: string, event: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/h/${event}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Donel-Token': token },
    body: JSON.stringify(body),
  });
}

describe('SessionSemaphoreManager.onTurnEnded — legacy server', () => {
  it('fires on Stop and StopFailure with the payload text, null when missing; not on other hooks', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();
    try {
      const ended: Ended[] = [];
      manager.onTurnEnded((ptyId, text) => ended.push({ ptyId, text }));
      manager.registerSession('pty-1', 'sess-a');

      await postLegacy(port, { hook_event_name: 'UserPromptSubmit', session_id: 'sess-a' });
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a', last_assistant_message: 'Pronto.' });
      await postLegacy(port, { hook_event_name: 'StopFailure', session_id: 'sess-a', last_assistant_message: 'Falhou no meio.' });
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a' });
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a', last_assistant_message: '' });

      expect(ended).toEqual([
        { ptyId: 'pty-1', text: 'Pronto.' },
        { ptyId: 'pty-1', text: 'Falhou no meio.' },
        { ptyId: 'pty-1', text: null },
        { ptyId: 'pty-1', text: null },
      ]);
    } finally {
      manager.dispose();
    }
  });

  it('passes the transcript_path of the payload (null when missing) for the tail fallback', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();
    try {
      const paths: (string | null)[] = [];
      manager.onTurnEnded((_ptyId, _text, transcriptPath) => paths.push(transcriptPath));
      manager.registerSession('pty-1', 'sess-a');
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a', transcript_path: 'C:/x/sess-a.jsonl' });
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a' });
      expect(paths).toEqual(['C:/x/sess-a.jsonl', null]);
    } finally {
      manager.dispose();
    }
  });

  it('unsubscribe stops the notifications', async () => {
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const port = await manager.start();
    try {
      const ended: Ended[] = [];
      const unsubscribe = manager.onTurnEnded((ptyId, text) => ended.push({ ptyId, text }));
      manager.registerSession('pty-1', 'sess-a');
      unsubscribe();
      await postLegacy(port, { hook_event_name: 'Stop', session_id: 'sess-a', last_assistant_message: 'x' });
      expect(ended).toEqual([]);
    } finally {
      manager.dispose();
    }
  });
});

describe('SessionSemaphoreManager.onTurnEnded — hook bridge', () => {
  it('fires on Stop and StopFailure from the bridge payload', async () => {
    const bridge = createHookBridge();
    const { port } = await bridge.start();
    const manager = new SessionSemaphoreManager({ getRecentLines: () => [] });
    const detach = manager.attachBridge(bridge);
    try {
      const ended: Ended[] = [];
      manager.onTurnEnded((ptyId, text) => ended.push({ ptyId, text }));
      const token = bridge.registerSession('pty-1');
      manager.registerSession('pty-1', 'sess-a');

      await postBridge(port, token, 'Stop', { session_id: 'sess-a', last_assistant_message: 'Pela ponte.' });
      await vi.waitFor(() => expect(ended).toHaveLength(1));
      await postBridge(port, token, 'StopFailure', { session_id: 'sess-a' });
      await vi.waitFor(() => expect(ended).toHaveLength(2));
      await postBridge(port, token, 'PostToolUse', { session_id: 'sess-a' });

      expect(ended).toEqual([
        { ptyId: 'pty-1', text: 'Pela ponte.' },
        { ptyId: 'pty-1', text: null },
      ]);
    } finally {
      detach();
      manager.dispose();
      await bridge.close();
    }
  });
});
