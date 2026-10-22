// T061/T062 (015-jobu-pet, US5, FR-034) - the two test seams of the pet window, read from the environment. They
// exist for the smokes and for the real screenshots of the documentation, never for the owner, so only the exact
// value `1` turns either one on: a stray `true`, `0`, an empty string or nothing at all leaves the app as it is.
//
//   DONEL_PET_SMOKE_INVISIBLE=1  the smokes run the Jobu as a ghost: no pixel, no mouse, no focus, no native menu,
//                                so a test never lands on top of the work (and the typing) of whoever is using
//                                the machine while it runs.
//   DONEL_PET_CAPTURABLE=1       the protection against screen captures (FR-034) is never on, so a real print of
//                                the screen can show the Jobu in the documentation.
import { describe, expect, it } from 'vitest';
import { readPetSeams } from '../src/main/pet/pet-seams';

describe('readPetSeams', () => {
  it('with an empty environment both seams are off: the app is the one the owner uses', () => {
    expect(readPetSeams({})).toEqual({ ghost: false, capturable: false });
  });

  it('DONEL_PET_SMOKE_INVISIBLE=1 turns the ghost on and nothing else', () => {
    expect(readPetSeams({ DONEL_PET_SMOKE_INVISIBLE: '1' })).toEqual({ ghost: true, capturable: false });
  });

  it('DONEL_PET_CAPTURABLE=1 turns the capturable override on and nothing else', () => {
    expect(readPetSeams({ DONEL_PET_CAPTURABLE: '1' })).toEqual({ ghost: false, capturable: true });
  });

  it('they are independent: a real print of the documentation turns on only the second', () => {
    expect(readPetSeams({ DONEL_PET_SMOKE_INVISIBLE: '1', DONEL_PET_CAPTURABLE: '1' })).toEqual({ ghost: true, capturable: true });
  });

  it.each(['0', '', 'true', 'TRUE', 'yes', 'on', ' 1', '1 ', '01', '2'])('the value %j is not the one: the seam stays off', (value) => {
    expect(readPetSeams({ DONEL_PET_SMOKE_INVISIBLE: value, DONEL_PET_CAPTURABLE: value })).toEqual({ ghost: false, capturable: false });
  });

  it('an undefined value (a variable that exists and has nothing) is off', () => {
    expect(readPetSeams({ DONEL_PET_SMOKE_INVISIBLE: undefined, DONEL_PET_CAPTURABLE: undefined })).toEqual({ ghost: false, capturable: false });
  });

  it('reads only its own two variables: the rest of the environment is none of its business', () => {
    expect(readPetSeams({ DONEL_SMOKE_NOTIFICATIONS_LOG: '1', DONEL_PET: '1', PET_CAPTURABLE: '1' })).toEqual({ ghost: false, capturable: false });
  });
});
