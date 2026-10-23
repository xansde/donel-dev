// T047 (015-jobu-pet, US5, R13) - from the menu model to the template of Electron's native menu. The only job of
// this layer is to carry the labels, the check marks and the separator over, and to hand the chosen ACTION back:
// what the menu says is decided in src/shared/pet/menu.ts, what an action does in the service.
import { describe, expect, it } from 'vitest';
import { buildPetMenu, type PetMenuAction } from '../src/shared/pet/menu';
import { deferUntilMenuClosed, toMenuTemplate } from '../src/main/pet/pet-menu';

describe('toMenuTemplate', () => {
  const entries = buildPetMenu({ silenced: false, captureReleased: false, size: 200, sweeping: false });

  it('keeps the order and the labels, with a separator where the model has one', () => {
    const template = toMenuTemplate(entries, () => undefined);
    expect(template.map((item) => (item.type === 'separator' ? '---' : item.label))).toEqual([
      'Silenciar por 1 hora',
      'Liberar print por 1 minuto',
      'Fazer faxina',
      'Tamanho',
      '---',
      'Voltar ao canto',
      'Esconder',
    ]);
  });

  it('the size submenu has a check mark on the size in use and only on it', () => {
    const template = toMenuTemplate(entries, () => undefined);
    const submenu = template[3]?.submenu;
    if (!Array.isArray(submenu)) throw new Error('the Tamanho entry has no submenu');
    expect(submenu.map((item) => ({ label: item.label, type: item.type, checked: item.checked }))).toEqual([
      { label: 'Pequeno', type: 'checkbox', checked: false },
      { label: 'Médio', type: 'checkbox', checked: false },
      { label: 'Grande', type: 'checkbox', checked: true },
      { label: 'Muito grande', type: 'checkbox', checked: false },
    ]);
  });

  it('clicking an item hands ITS action back, and only that one', () => {
    const chosen: PetMenuAction[] = [];
    const template = toMenuTemplate(entries, (action) => chosen.push(action));
    const click = (item: (typeof template)[number] | undefined): void => {
      if (item?.click === undefined) throw new Error('the item has no click handler');
      (item.click as () => void)();
    };
    click(template[0]);
    click(template[1]);
    click(template[2]);
    click(template[5]);
    click(template[6]);
    const submenu = template[3]?.submenu;
    if (!Array.isArray(submenu)) throw new Error('no submenu');
    click(submenu[3]);
    expect(chosen).toEqual([{ kind: 'silence' }, { kind: 'releaseCapture' }, { kind: 'sweep' }, { kind: 'home' }, { kind: 'hide' }, { kind: 'size', size: 260 }]);
  });

  it('the submenu and the separator have no click of their own', () => {
    const template = toMenuTemplate(entries, () => undefined);
    expect(template[3]?.click).toBeUndefined();
    expect(template[4]).toEqual({ type: 'separator' });
  });

  it('a menu in the other state carries its own words over: "Retomar avisos" and "Bloquear print agora"', () => {
    const template = toMenuTemplate(buildPetMenu({ silenced: true, captureReleased: true, size: 140, sweeping: false }), () => undefined);
    expect(template.slice(0, 2).map((item) => item.label)).toEqual(['Retomar avisos', 'Bloquear print agora']);
  });
});

describe('the item of the sweep while it runs', () => {
  it('is carried over disabled, so the owner cannot start a second sweep', () => {
    const template = toMenuTemplate(buildPetMenu({ silenced: false, captureReleased: false, size: 140, sweeping: true }), () => undefined);
    expect(template[2]).toMatchObject({ label: 'Faxinando…', enabled: false });
    expect(toMenuTemplate(buildPetMenu({ silenced: false, captureReleased: false, size: 140, sweeping: false }), () => undefined)[2]?.enabled).toBe(true);
  });
});

describe('deferUntilMenuClosed', () => {
  const home: PetMenuAction = { kind: 'home' };
  const hide: PetMenuAction = { kind: 'hide' };

  it('runs the action after the choice and then the close (click first)', () => {
    const ran: PetMenuAction[] = [];
    const deferred = deferUntilMenuClosed((action: PetMenuAction) => void ran.push(action));
    deferred.choose(home);
    expect(ran).toEqual([]); // the menu is still open
    deferred.closed();
    expect(ran).toEqual([home]);
  });

  it('runs the action after the close and then the choice (callback first)', () => {
    const ran: PetMenuAction[] = [];
    const deferred = deferUntilMenuClosed((action: PetMenuAction) => void ran.push(action));
    deferred.closed();
    expect(ran).toEqual([]);
    deferred.choose(home);
    expect(ran).toEqual([home]);
  });

  it('never runs when the menu closes with no choice', () => {
    const ran: PetMenuAction[] = [];
    const deferred = deferUntilMenuClosed((action: PetMenuAction) => void ran.push(action));
    deferred.closed();
    deferred.closed();
    expect(ran).toEqual([]);
  });

  it('runs exactly once, whatever repeats afterwards', () => {
    const ran: PetMenuAction[] = [];
    const deferred = deferUntilMenuClosed((action: PetMenuAction) => void ran.push(action));
    deferred.choose(home);
    deferred.closed();
    deferred.closed();
    deferred.choose(hide);
    deferred.closed();
    expect(ran).toEqual([home]);
  });

  it('the last choice before the close wins', () => {
    const ran: PetMenuAction[] = [];
    const deferred = deferUntilMenuClosed((action: PetMenuAction) => void ran.push(action));
    deferred.choose(home);
    deferred.choose(hide);
    deferred.closed();
    expect(ran).toEqual([hide]);
  });
});
