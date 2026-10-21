// T009 (015-jobu-pet) - `pet` in the config store: defaults, sanitize, DTO and the way an older
// build keeps the key (R20). The exact-shape tests of config-store.test.ts carry `pet` too.
import { describe, expect, it } from 'vitest';
import {
  defaultAppConfig,
  defaultPetPrefs,
  mergeConfigForWrite,
  sanitizeAppConfig,
  sanitizePetPrefs,
  toAppConfigDto,
  type AppConfig,
} from '../src/main/config-store';

const ROOTS = ['C:\\Users\\fake\\seazone'];
const defaults = (): AppConfig => defaultAppConfig(ROOTS);

describe('pet config defaults', () => {
  it('is off, with no remembered position and the Medium size (140)', () => {
    expect(defaultPetPrefs()).toEqual({ enabled: false, placement: null, size: 140 });
    expect(defaults().pet).toEqual({ enabled: false, placement: null, size: 140 });
  });

  it('goes to the renderer in the DTO', () => {
    expect(toAppConfigDto(defaults()).pet).toEqual({ enabled: false, placement: null, size: 140 });
  });

  it('every call returns a fresh object (no shared mutable default)', () => {
    expect(defaultPetPrefs()).not.toBe(defaultPetPrefs());
  });
});

describe('sanitizePetPrefs', () => {
  it('keeps a valid value as is', () => {
    expect(sanitizePetPrefs({ enabled: true, placement: { x: 1830, y: 1040 }, size: 200 })).toEqual({
      enabled: true,
      placement: { x: 1830, y: 1040 },
      size: 200,
    });
  });

  it('enabled must be a boolean, otherwise the field falls back to false', () => {
    expect(sanitizePetPrefs({ enabled: 'yes' }).enabled).toBe(false);
    expect(sanitizePetPrefs({ enabled: 1 }).enabled).toBe(false);
    expect(sanitizePetPrefs({ enabled: null }).enabled).toBe(false);
    expect(sanitizePetPrefs({ enabled: false }).enabled).toBe(false);
    expect(sanitizePetPrefs({ enabled: true }).enabled).toBe(true);
  });

  it('placement is null or a point with finite x and y', () => {
    expect(sanitizePetPrefs({ placement: null }).placement).toBeNull();
    expect(sanitizePetPrefs({ placement: { x: 0, y: 0 } }).placement).toEqual({ x: 0, y: 0 });
    expect(sanitizePetPrefs({ placement: { x: -1920, y: 1040.5 } }).placement).toEqual({ x: -1920, y: 1040.5 });
  });

  it('a malformed placement becomes null (back to the default position), never a half point', () => {
    for (const bad of [
      { x: Number.NaN, y: 1 },
      { x: 1, y: Number.POSITIVE_INFINITY },
      { x: 1 },
      { y: 1 },
      { x: '1', y: '2' },
      'x',
      42,
      [],
      [1, 2],
      true,
      undefined,
    ]) {
      expect(sanitizePetPrefs({ placement: bad }).placement).toBeNull();
    }
  });

  it('placement drops keys it does not know', () => {
    expect(sanitizePetPrefs({ placement: { x: 1, y: 2, monitor: 3 } }).placement).toEqual({ x: 1, y: 2 });
  });

  it('size is limited to 80-320', () => {
    expect(sanitizePetPrefs({ size: 50 }).size).toBe(80);
    expect(sanitizePetPrefs({ size: 80 }).size).toBe(80);
    expect(sanitizePetPrefs({ size: 200 }).size).toBe(200);
    expect(sanitizePetPrefs({ size: 320 }).size).toBe(320);
    expect(sanitizePetPrefs({ size: 5000 }).size).toBe(320);
    expect(sanitizePetPrefs({ size: -3 }).size).toBe(80);
  });

  it('size is a whole number', () => {
    expect(sanitizePetPrefs({ size: 143.6 }).size).toBe(144);
  });

  it('a size that is not a finite number falls back to 140', () => {
    for (const bad of ['200', null, undefined, true, {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sanitizePetPrefs({ size: bad }).size).toBe(140);
    }
  });

  it('falls back field by field: a bad field does not take the good ones with it', () => {
    expect(sanitizePetPrefs({ enabled: true, size: 'big', placement: { x: 1 } })).toEqual({ enabled: true, placement: null, size: 140 });
    expect(sanitizePetPrefs({ enabled: 'x', size: 260, placement: { x: 5, y: 6 } })).toEqual({
      enabled: false,
      placement: { x: 5, y: 6 },
      size: 260,
    });
  });

  it('falls back to the defaults when the whole value is missing or not an object', () => {
    for (const bad of [undefined, null, 'x', 42, [], true]) {
      expect(sanitizePetPrefs(bad)).toEqual({ enabled: false, placement: null, size: 140 });
    }
  });

  it('uses the fallback it is given, not always the global defaults', () => {
    const fallback = { enabled: true, placement: { x: 9, y: 9 }, size: 100 };
    expect(sanitizePetPrefs(undefined, fallback)).toEqual(fallback);
    expect(sanitizePetPrefs({ size: 'x' }, fallback).size).toBe(100);
    expect(sanitizePetPrefs({ enabled: 'x' }, fallback).enabled).toBe(true);
  });

  it('does not mutate what it is given', () => {
    const input = { enabled: true, placement: { x: 1, y: 2 }, size: 150 };
    sanitizePetPrefs(input);
    expect(input).toEqual({ enabled: true, placement: { x: 1, y: 2 }, size: 150 });
  });
});

describe('pet in sanitizeAppConfig', () => {
  it('reads the stored value', () => {
    const sanitized = sanitizeAppConfig({ pet: { enabled: true, placement: { x: 10, y: 20 }, size: 200 } }, defaults());
    expect(sanitized.pet).toEqual({ enabled: true, placement: { x: 10, y: 20 }, size: 200 });
  });

  it('a config from before the pet (no `pet` key) loads with the defaults and keeps everything else', () => {
    const sanitized = sanitizeAppConfig({ version: 1, projectRoots: ['C:\\meu\\root'], favorites: ['C:\\meu\\projeto'] }, defaults());
    expect(sanitized.pet).toEqual({ enabled: false, placement: null, size: 140 });
    expect(sanitized.projectRoots).toEqual(['C:\\meu\\root']);
    expect(sanitized.favorites).toEqual(['C:\\meu\\projeto']);
  });

  it('is not an unknown field: a build that knows `pet` never parks it in unknownFields', () => {
    const sanitized = sanitizeAppConfig({ pet: { enabled: true } }, defaults());
    expect(sanitized.unknownFields).toEqual({});
  });

  it('a stored `pet` that is garbage falls back to the defaults without breaking the rest', () => {
    const sanitized = sanitizeAppConfig({ pet: 'lixo', favorites: ['C:\\ok'] }, defaults());
    expect(sanitized.pet).toEqual({ enabled: false, placement: null, size: 140 });
    expect(sanitized.favorites).toEqual(['C:\\ok']);
  });
});

describe('pet and the other channels (R20)', () => {
  it('an older build (schema without `pet`) keeps the key in unknownFields and writes it back', () => {
    const { pet: _pet, ...oldDefaults } = defaults();
    const oldSchema = oldDefaults as unknown as AppConfig;
    const stored = { pet: { enabled: true, placement: { x: 10, y: 20 }, size: 200 } };

    const sanitized = sanitizeAppConfig(stored, oldSchema);
    expect(sanitized.unknownFields).toEqual({ pet: { enabled: true, placement: { x: 10, y: 20 }, size: 200 } });

    // the older build rewrites the file without having touched `pet`: the key survives, at the top level
    const written = mergeConfigForWrite({}, sanitized, sanitized);
    expect(written.pet).toEqual({ enabled: true, placement: { x: 10, y: 20 }, size: 200 });
    expect('unknownFields' in written).toBe(false);
  });

  it('this build only overwrites `pet` on disk when this session changed it (read-merge-write)', () => {
    const baseline = defaults();
    const diskRaw = { ...baseline, pet: { enabled: true, placement: { x: 7, y: 8 }, size: 260 } };

    // `pet` untouched by this session: the fresher value on disk (another channel) wins
    expect(mergeConfigForWrite(diskRaw, baseline, { ...baseline, favorites: ['C:\\x'] }).pet).toEqual({
      enabled: true,
      placement: { x: 7, y: 8 },
      size: 260,
    });

    // `pet` changed by this session: it overwrites
    const changed = { ...baseline, pet: { enabled: true, placement: null, size: 100 } };
    expect(mergeConfigForWrite(diskRaw, baseline, changed).pet).toEqual({ enabled: true, placement: null, size: 100 });
  });
});
