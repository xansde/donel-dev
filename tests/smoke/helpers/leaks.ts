import { expect } from '@playwright/test';

/** Fails if `secret` appears anywhere in the serialized `payload` (not even truncated). */
export function assertNoLeak(payload: unknown, secret: string): void {
  expect(JSON.stringify(payload)).not.toContain(secret);
}
