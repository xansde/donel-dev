// T020/T038 (015-jobu-pet) - the `pet:*` handlers of the main (since US5, the whole contract). Two checks on every message, in this
// order: WHO sent it (`pet:tabs` only from the main window, the gestures only from the pet window)
// and WHAT it carries (the `isValid...` guards). Anything that fails either is dropped silently.
import { describe, expect, it } from 'vitest';
import { PET_CHANNELS } from '../src/shared/pet/ipc';
import { registerPetIpcHandlers, type PetIpcService } from '../src/main/pet/pet-ipc';

type Listener = (event: { sender: { id: number } }, ...args: unknown[]) => void;

const MAIN_ID = 1;
const PET_ID = 2;
const STRANGER_ID = 3;

function setup(over: { service?: PetIpcService | null } = {}) {
  const listeners = new Map<string, Listener>();
  const calls: string[] = [];
  const service: PetIpcService = {
    onTabs: (payload) => void calls.push(`tabs:${JSON.stringify(payload)}`),
    isPetSender: (sender) => sender.id === PET_ID,
    handleReady: () => void calls.push('ready'),
    handleInteractive: (interactive) => void calls.push(`interactive:${interactive}`),
    handleClick: () => void calls.push('click'),
    handleOpen: (target) => void calls.push(`open:${JSON.stringify(target)}`),
    handleListOpen: (open) => void calls.push(`list-open:${open}`),
    handleContextMenu: (at) => void calls.push(`context-menu:${JSON.stringify(at)}`),
    handleDragStart: (point) => void calls.push(`drag-start:${JSON.stringify(point)}`),
    handleDragMove: (point) => void calls.push(`drag-move:${JSON.stringify(point)}`),
    handleDragEnd: (point) => void calls.push(`drag-end:${JSON.stringify(point)}`),
    handleResizeStep: (direction) => void calls.push(`resize-step:${direction}`),
  };
  registerPetIpcHandlers({
    ipcMain: { on: (channel, listener) => void listeners.set(channel, listener as Listener) },
    getService: () => (over.service === undefined ? service : over.service),
    isMainSender: (sender) => sender.id === MAIN_ID,
  });
  const send = (channel: string, senderId: number, ...args: unknown[]): void => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`no listener for ${channel}`);
    listener({ sender: { id: senderId } }, ...args);
  };
  return { listeners, calls, send, service };
}

describe('registerPetIpcHandlers', () => {
  it('listens to exactly the channels that come from a window: the whole contract of the pet', () => {
    const { listeners } = setup();
    expect([...listeners.keys()].sort()).toEqual(
      [
        PET_CHANNELS.interactive,
        PET_CHANNELS.ready,
        PET_CHANNELS.tabs,
        PET_CHANNELS.click,
        PET_CHANNELS.open,
        PET_CHANNELS.listOpen,
        PET_CHANNELS.contextMenu,
        PET_CHANNELS.dragStart,
        PET_CHANNELS.dragMove,
        PET_CHANNELS.dragEnd,
        PET_CHANNELS.resizeStep,
      ].sort(),
    );
  });
});

describe('pet:tabs', () => {
  const valid = { activePtyId: 'pty-a', sessions: [{ ptyId: 'pty-a', name: 'atlas' }] };

  it('from the main window with a valid payload reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.tabs, MAIN_ID, valid);
    expect(calls).toEqual([`tabs:${JSON.stringify(valid)}`]);
  });

  it('from any other window (the pet included) is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.tabs, PET_ID, valid);
    send(PET_CHANNELS.tabs, STRANGER_ID, valid);
    expect(calls).toEqual([]);
  });

  it('with an invalid payload is ignored, whatever the sender', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.tabs, MAIN_ID, null);
    send(PET_CHANNELS.tabs, MAIN_ID, { activePtyId: 7, sessions: [] });
    send(PET_CHANNELS.tabs, MAIN_ID, { activePtyId: null, sessions: [{ ptyId: '' }] });
    send(PET_CHANNELS.tabs, MAIN_ID);
    expect(calls).toEqual([]);
  });

  it('with no service (before the main window is shown, or after it closed) does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.tabs, MAIN_ID, valid)).not.toThrow();
  });
});

describe('pet:ready', () => {
  it('from the pet window reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.ready, PET_ID);
    expect(calls).toEqual(['ready']);
  });

  it('from the main window or anyone else is ignored (a stale window of a previous round included)', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.ready, MAIN_ID);
    send(PET_CHANNELS.ready, STRANGER_ID);
    expect(calls).toEqual([]);
  });

  it('with no service does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.ready, PET_ID)).not.toThrow();
  });
});

describe('pet:interactive', () => {
  it('from the pet window with a boolean reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.interactive, PET_ID, { interactive: true });
    send(PET_CHANNELS.interactive, PET_ID, { interactive: false });
    expect(calls).toEqual(['interactive:true', 'interactive:false']);
  });

  it('from another window is ignored: only the pet may switch its own click-through', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.interactive, MAIN_ID, { interactive: true });
    send(PET_CHANNELS.interactive, STRANGER_ID, { interactive: true });
    expect(calls).toEqual([]);
  });

  it('with an invalid payload is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.interactive, PET_ID, { interactive: 'yes' });
    send(PET_CHANNELS.interactive, PET_ID, null);
    send(PET_CHANNELS.interactive, PET_ID);
    expect(calls).toEqual([]);
  });
});

describe('pet:click', () => {
  it('from the pet window reaches the service, with no payload', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.click, PET_ID);
    expect(calls).toEqual(['click']);
  });

  it('from the main window or anyone else is ignored: only the pet may say that the Jobu was clicked', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.click, MAIN_ID);
    send(PET_CHANNELS.click, STRANGER_ID);
    expect(calls).toEqual([]);
  });

  it('with no service does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.click, PET_ID)).not.toThrow();
  });
});

describe('pet:open', () => {
  it('from the pet window with a session or the Donel as the target reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'session', ptyId: 'pty-a' } });
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'donel' } });
    expect(calls).toEqual(['open:{"kind":"session","ptyId":"pty-a"}', 'open:{"kind":"donel"}']);
  });

  it('from another window is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.open, MAIN_ID, { target: { kind: 'donel' } });
    send(PET_CHANNELS.open, STRANGER_ID, { target: { kind: 'donel' } });
    expect(calls).toEqual([]);
  });

  it('with an invalid payload is ignored: no target, an unknown kind, a session with no ptyId, the list (that is the screen\'s)', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.open, PET_ID, null);
    send(PET_CHANNELS.open, PET_ID);
    send(PET_CHANNELS.open, PET_ID, { target: null });
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'list' } });
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'session' } });
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'session', ptyId: '' } });
    send(PET_CHANNELS.open, PET_ID, { target: { kind: 'session', ptyId: 42 } });
    expect(calls).toEqual([]);
  });

  it('with no service does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.open, PET_ID, { target: { kind: 'donel' } })).not.toThrow();
  });
});

describe('pet:list-open', () => {
  it('from the pet window with a boolean reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.listOpen, PET_ID, { open: true });
    send(PET_CHANNELS.listOpen, PET_ID, { open: false });
    expect(calls).toEqual(['list-open:true', 'list-open:false']);
  });

  it('from another window is ignored: only the pet may make itself focusable', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.listOpen, MAIN_ID, { open: true });
    send(PET_CHANNELS.listOpen, STRANGER_ID, { open: true });
    expect(calls).toEqual([]);
  });

  it('with an invalid payload is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.listOpen, PET_ID, { open: 'yes' });
    send(PET_CHANNELS.listOpen, PET_ID, null);
    send(PET_CHANNELS.listOpen, PET_ID);
    expect(calls).toEqual([]);
  });
});

describe('pet:context-menu (US5)', () => {
  it('from the pet window with the screen coordinates of the click reaches the service as a point: the menu opens right there', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.contextMenu, PET_ID, { screenX: 1850, screenY: 990 });
    expect(calls).toEqual(['context-menu:{"x":1850,"y":990}']);
  });

  it('with no payload the menu opens where the pointer is: the service gets `null`', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.contextMenu, PET_ID);
    send(PET_CHANNELS.contextMenu, PET_ID, undefined);
    expect(calls).toEqual(['context-menu:null', 'context-menu:null']);
  });

  it('from another window is ignored: only the pet may ask for its own menu', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.contextMenu, MAIN_ID, { screenX: 1, screenY: 2 });
    send(PET_CHANNELS.contextMenu, STRANGER_ID);
    expect(calls).toEqual([]);
  });

  it('with a payload that is not finite coordinates is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.contextMenu, PET_ID, { screenX: '1', screenY: 2 });
    send(PET_CHANNELS.contextMenu, PET_ID, { screenX: Number.NaN, screenY: 2 });
    send(PET_CHANNELS.contextMenu, PET_ID, null);
    send(PET_CHANNELS.contextMenu, PET_ID, 7);
    expect(calls).toEqual([]);
  });

  it('with no service does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.contextMenu, PET_ID)).not.toThrow();
  });
});

describe('pet:drag-start, pet:drag-move and pet:drag-end (US5)', () => {
  const phases = [
    [PET_CHANNELS.dragStart, 'drag-start'],
    [PET_CHANNELS.dragMove, 'drag-move'],
    [PET_CHANNELS.dragEnd, 'drag-end'],
  ] as const;

  it.each(phases)('%s from the pet window reaches the service with the pointer in screen coordinates', (channel, name) => {
    const { send, calls } = setup();
    send(channel, PET_ID, { screenX: 640.5, screenY: -20 }); // a negative one: a monitor above or to the left
    expect(calls).toEqual([`${name}:{"x":640.5,"y":-20}`]);
  });

  it.each(phases)('%s from the main window or anyone else is ignored: only the pet window can drag the Jobu', (channel) => {
    const { send, calls } = setup();
    send(channel, MAIN_ID, { screenX: 1, screenY: 2 });
    send(channel, STRANGER_ID, { screenX: 1, screenY: 2 });
    expect(calls).toEqual([]);
  });

  it.each(phases)('%s with a payload that is not finite coordinates is ignored', (channel) => {
    const { send, calls } = setup();
    send(channel, PET_ID, { screenX: 'x', screenY: 2 });
    send(channel, PET_ID, { screenX: 1, screenY: Number.POSITIVE_INFINITY });
    send(channel, PET_ID, null);
    send(channel, PET_ID);
    expect(calls).toEqual([]);
  });

  it.each(phases)('%s with no service does nothing and does not throw', (channel) => {
    const { send } = setup({ service: null });
    expect(() => send(channel, PET_ID, { screenX: 1, screenY: 2 })).not.toThrow();
  });
});

describe('pet:resize-step (US5)', () => {
  it('from the pet window with +1 or -1 reaches the service', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.resizeStep, PET_ID, { direction: 1 });
    send(PET_CHANNELS.resizeStep, PET_ID, { direction: -1 });
    expect(calls).toEqual(['resize-step:1', 'resize-step:-1']);
  });

  it('from another window is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.resizeStep, MAIN_ID, { direction: 1 });
    send(PET_CHANNELS.resizeStep, STRANGER_ID, { direction: 1 });
    expect(calls).toEqual([]);
  });

  it('a screen cannot ask for a jump: anything but exactly +1 or -1 is ignored', () => {
    const { send, calls } = setup();
    send(PET_CHANNELS.resizeStep, PET_ID, { direction: 2 });
    send(PET_CHANNELS.resizeStep, PET_ID, { direction: 0 });
    send(PET_CHANNELS.resizeStep, PET_ID, { direction: '1' });
    send(PET_CHANNELS.resizeStep, PET_ID, null);
    send(PET_CHANNELS.resizeStep, PET_ID);
    expect(calls).toEqual([]);
  });

  it('with no service does nothing and does not throw', () => {
    const { send } = setup({ service: null });
    expect(() => send(PET_CHANNELS.resizeStep, PET_ID, { direction: 1 })).not.toThrow();
  });
});

describe('a service that throws', () => {
  it('never escapes into the main process: the handlers swallow and log', () => {
    const boom = new Error('boom');
    const { send } = setup({
      service: {
        onTabs: () => {
          throw boom;
        },
        isPetSender: () => true,
        handleReady: () => {
          throw boom;
        },
        handleInteractive: () => {
          throw boom;
        },
        handleClick: () => {
          throw boom;
        },
        handleOpen: () => {
          throw boom;
        },
        handleListOpen: () => {
          throw boom;
        },
        handleContextMenu: () => {
          throw boom;
        },
        handleDragStart: () => {
          throw boom;
        },
        handleDragMove: () => {
          throw boom;
        },
        handleDragEnd: () => {
          throw boom;
        },
        handleResizeStep: () => {
          throw boom;
        },
      },
    });
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      expect(() => send(PET_CHANNELS.tabs, MAIN_ID, { activePtyId: null, sessions: [] })).not.toThrow();
      expect(() => send(PET_CHANNELS.ready, PET_ID)).not.toThrow();
      expect(() => send(PET_CHANNELS.interactive, PET_ID, { interactive: true })).not.toThrow();
      expect(() => send(PET_CHANNELS.click, PET_ID)).not.toThrow();
      expect(() => send(PET_CHANNELS.open, PET_ID, { target: { kind: 'donel' } })).not.toThrow();
      expect(() => send(PET_CHANNELS.listOpen, PET_ID, { open: true })).not.toThrow();
      expect(() => send(PET_CHANNELS.contextMenu, PET_ID)).not.toThrow();
      expect(() => send(PET_CHANNELS.dragStart, PET_ID, { screenX: 1, screenY: 2 })).not.toThrow();
      expect(() => send(PET_CHANNELS.dragMove, PET_ID, { screenX: 1, screenY: 2 })).not.toThrow();
      expect(() => send(PET_CHANNELS.dragEnd, PET_ID, { screenX: 1, screenY: 2 })).not.toThrow();
      expect(() => send(PET_CHANNELS.resizeStep, PET_ID, { direction: 1 })).not.toThrow();
    } finally {
      console.error = originalError;
    }
    expect(logged).toHaveLength(11);
  });
});
