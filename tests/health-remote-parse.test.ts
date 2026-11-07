// Saúde das VPS — the parser of the remote read: a VPS that did not answer must never look healthy.

import { describe, expect, it } from 'vitest';
import { parseRemoteHealthOutput } from '../src/shared/health/remote';

const FULL = [
  'Welcome to Ubuntu', // a login profile may print anything
  'DONEL_HEALTH mem 8000000 2000000',
  'DONEL_HEALTH swap 8000000 6000000',
  'DONEL_HEALTH disk 100000000 30000000',
  'DONEL_HEALTH load 0.42 0.38 0.30',
  'DONEL_HEALTH cpus 4',
  'DONEL_HEALTH sessions 3',
  'DONEL_HEALTH end',
  '',
].join('\r\n');

describe('parseRemoteHealthOutput', () => {
  it('reads every field, in bytes', () => {
    expect(parseRemoteHealthOutput(FULL)).toEqual({
      ram: { totalBytes: 8000000 * 1024, freeBytes: 2000000 * 1024 },
      swap: { totalBytes: 8000000 * 1024, freeBytes: 6000000 * 1024 },
      disk: { totalBytes: 100000000 * 1024, freeBytes: 30000000 * 1024 },
      load: { one: 0.42, five: 0.38, fifteen: 0.3 },
      cpus: 4,
      sessions: 3,
    });
  });

  it('is null when the answer did not reach the end (ssh down, timeout, cut short)', () => {
    expect(parseRemoteHealthOutput('')).toBeNull();
    expect(parseRemoteHealthOutput(FULL.split('DONEL_HEALTH end')[0])).toBeNull();
  });

  it('turns a missing or garbled field into null without dropping the others', () => {
    const reading = parseRemoteHealthOutput(
      ['DONEL_HEALTH mem  ', 'DONEL_HEALTH disk 10 20', 'DONEL_HEALTH load abc', 'DONEL_HEALTH cpus ', 'DONEL_HEALTH sessions 0', 'DONEL_HEALTH end'].join('\n'),
    );
    expect(reading).toEqual({ ram: null, swap: null, disk: null, load: null, cpus: null, sessions: 0 });
  });
});
