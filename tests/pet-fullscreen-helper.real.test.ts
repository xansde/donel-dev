// T050 (015-jobu-pet, US5, R10) - the REAL helper of full screen, not a fake: the script that the watcher gives to
// PowerShell is run for a few seconds and what it prints is read. The watcher swallows every failure of the helper
// (a helper that dies counts as "free", so the Jobu is never left hidden), which also means a script with a syntax
// error would go on "working" in the app, silently, forever: this is the test that fails when the script stops
// being a script. It asks Windows what it really thinks (no app is put in full screen), so the number can be any of
// the states of `SHQueryUserNotificationState`; what it proves is that the P/Invoke works and the loop prints.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FULLSCREEN_HELPER_SCRIPT, FULLSCREEN_POLL_MS, encodePowerShellCommand } from '../src/main/pet/fullscreen-watcher';
import { createFullscreenParser } from '../src/shared/pet/fullscreenState';

describe.skipIf(process.platform !== 'win32')('the real helper (Windows PowerShell + shell32)', () => {
  it('prints the state of the screen as a number, line after line, every 1.5 s, with no error', async () => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(FULLSCREEN_HELPER_SCRIPT)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const lines: string[] = [];
    const arrivals: number[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const complete = stdout.split('\n');
      stdout = complete.pop() ?? '';
      for (const line of complete) {
        lines.push(line.trim());
        arrivals.push(Date.now());
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));

    try {
      // The first line costs the compilation of Add-Type; the second and the third show the cadence.
      const deadline = Date.now() + 40_000;
      while (lines.length < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      child.kill();
    }
    await exited;

    // With its output redirected, Windows PowerShell 5.1 writes the `#< CLIXML` preamble (and the progress of Add-Type) to
    // stderr; that is the format, not a problem. What must not be there is an error record.
    expect(stderr).not.toContain('S="Error"');
    expect(stderr).not.toMatch(/Exception|CategoryInfo|At line:/);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // Every line is a whole number: a state of the screen, or -1 when the call failed.
    for (const line of lines) expect(line).toMatch(/^-?\d+$/);
    // The cadence is the one of the script (a loose bound: the machine may be busy).
    const gap = (arrivals[2] ?? 0) - (arrivals[1] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(FULLSCREEN_POLL_MS - 400);
    expect(gap).toBeLessThan(FULLSCREEN_POLL_MS + 4_000);
    // The call itself worked: -1 would be the helper saying "I could not ask".
    expect(lines.every((line) => line !== '-1')).toBe(true);
    // And what it prints is what the parser reads (the app does not hide the Jobu unless this says 2, 3 or 4).
    const parser = createFullscreenParser();
    expect(parser.push(`${lines.join('\r\n')}\r\n`)).toHaveLength(lines.length);
  }, 60_000);
});
