import { describe, expect, it } from 'vitest';
import { maskSecrets } from '../src/main/celular/mask';

// Ledger no celular — a command output goes to the phone: a password inside a connection URL or a `curl -u`
// must not leave the PC. Secrets built by concatenation so the repo's own scanners do not take them for real keys.

const PASS = 'S3nha' + 'F0rte';

describe('máscara do celular', () => {
  it.each([
    ['URL do Postgres no .env', `DATABASE_URL=postgres://user:${PASS}@db.local:5432/app`, 'DATABASE_URL=postgres://user:••••••@db.local:5432/app'],
    ['URL com senha que tem @', `redis://admin:${PASS}@x@cache:6379`, 'redis://admin:••••••@cache:6379'],
    ['URL https com credencial', `git clone https://bot:${PASS}@github.com/org/repo.git`, 'git clone https://bot:••••••@github.com/org/repo.git'],
    ['curl -u', `curl -u admin:${PASS} https://api.local`, 'curl -u admin:•••••• https://api.local'],
    ['curl --user=', `curl --user=admin:${PASS} https://api.local`, 'curl --user=admin:•••••• https://api.local'],
    ['curl -u entre aspas', `curl -u "admin:${PASS}" https://api.local`, 'curl -u "admin:••••••" https://api.local'],
  ])('%s: a senha vira ••••••', (_name, input, expected) => {
    const out = maskSecrets(input);
    expect(out).not.toContain(PASS);
    expect(out).toBe(expected);
  });

  it('endereço sem credencial e scp do git passam intactos', () => {
    for (const plain of ['https://example.com:8080/caminho', 'git@github.com:org/repo.git', 'ssh -p 22 root@vps', 'ls -u']) {
      expect(maskSecrets(plain)).toBe(plain);
    }
  });
});
