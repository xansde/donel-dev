import { describe, expect, it } from 'vitest';
import { isRealClaudeHome, refuseIfRealClaudeHome, type CredentialGuardDeps } from './accountsCredentialGuard';

// G2 (batch n3) — prova da guarda. Não é possível validar isto rodando
// `npm run test:smoke` (regra 1 do batch: nunca rodar test:smoke/test:smoke:dev
// neste worktree) — este arquivo vitest É a prova: `homedir`/`platform` são
// injetados, então nenhum teste aqui depende (nem escreve) na máquina real.

const WIN_DEPS_HOME = (home: string): CredentialGuardDeps => ({ homedir: () => home, platform: 'win32' });
const LINUX_DEPS_HOME = (home: string): CredentialGuardDeps => ({ homedir: () => home, platform: 'linux' });

describe('isRealClaudeHome (puro)', () => {
  it('detecta o candidato igual a <homedir>/.claude (a forma canônica do bug)', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:\\Users\\dono\\.claude', deps)).toBe(true);
  });

  it('detecta o candidato igual ao próprio homedir() (a outra forma do bug histórico — "saía direto de homedir()")', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:\\Users\\dono', deps)).toBe(true);
  });

  it('NÃO recusa um tmpdir isolado legítimo (o caso comum de todo smoke de conta)', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    const tmpClaudeHome = 'C:\\Users\\dono\\AppData\\Local\\Temp\\donel-accounts-smoke-switch-ab12cd\\.claude';
    expect(isRealClaudeHome(tmpClaudeHome, deps)).toBe(false);
  });

  // CRÍTICO: os.tmpdir() do Windows mora DENTRO de homedir()
  // (...\AppData\Local\Temp) — um check por prefixo/startsWith contra
  // homedir() sozinho pegaria todo tmpdir legítimo como falso positivo e a
  // guarda nunca deixaria nenhum smoke rodar. A comparação tem de ser por
  // IGUALDADE, não por prefixo.
  it('não trata "está dentro de homedir()" como real — só igualdade exata conta (senão nenhum tmpdir do Windows passaria)', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:\\Users\\dono\\AppData\\Local\\Temp\\algo', deps)).toBe(false);
  });

  it('não recusa um subdiretório do .claude real (ex.: projects) — só a igualdade exata é o alvo', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:\\Users\\dono\\.claude\\projects', deps)).toBe(false);
  });

  it('normaliza capitalização no Windows (filesystem case-insensitive) — detecta mesmo com letras diferentes', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('c:\\USERS\\DONO\\.CLAUDE', deps)).toBe(true);
  });

  it('normaliza separador final (trailing slash) — detecta mesmo com barra sobrando', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:\\Users\\dono\\.claude\\', deps)).toBe(true);
  });

  it('normaliza separadores mistos (/ vs \\) — detecta mesmo com estilo Unix num path Windows', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(isRealClaudeHome('C:/Users/dono/.claude', deps)).toBe(true);
  });

  it('plataforma não-Windows: comparação é case-SENSITIVE (não normaliza capitalização)', () => {
    const deps = LINUX_DEPS_HOME('/home/dono');
    expect(isRealClaudeHome('/home/dono/.claude', deps)).toBe(true);
    expect(isRealClaudeHome('/home/DONO/.claude', deps)).toBe(false); // maiúsculo é OUTRO path no Linux
  });

  it('tmpdir isolado no Linux também não é falso positivo', () => {
    const deps = LINUX_DEPS_HOME('/home/dono');
    expect(isRealClaudeHome('/tmp/donel-accounts-smoke-switch-ab12cd/.claude', deps)).toBe(false);
  });
});

describe('refuseIfRealClaudeHome (puro)', () => {
  it('lança com mensagem clara quando o candidato é a pasta .claude real', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(() => refuseIfRealClaudeHome('C:\\Users\\dono\\.claude', deps)).toThrow(/recusando.*credencial real/i);
  });

  it('lança quando o candidato é o próprio homedir() real', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(() => refuseIfRealClaudeHome('C:\\Users\\dono', deps)).toThrow(/recusando/i);
  });

  it('a mensagem de erro inclui o path candidato, pra facilitar diagnóstico', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    expect(() => refuseIfRealClaudeHome('C:\\Users\\dono\\.claude', deps)).toThrow(/C:\\Users\\dono\\\.claude/);
  });

  it('NÃO lança para um tmpdir isolado legítimo — é exatamente o caso que todo smoke de conta precisa continuar passando', () => {
    const deps = WIN_DEPS_HOME('C:\\Users\\dono');
    const tmpClaudeHome = 'C:\\Users\\dono\\AppData\\Local\\Temp\\donel-accounts-smoke-mcp-xy9z\\.claude';
    expect(() => refuseIfRealClaudeHome(tmpClaudeHome, deps)).not.toThrow();
  });

  it('sem deps explícitas usa os.homedir()/process.platform reais — smoke test da assinatura default (nunca lê nem grava nada)', () => {
    // Não afirma nada sobre o valor (a máquina que roda o CI pode ter
    // qualquer homedir) — só prova que a chamada com a assinatura default
    // não lança em si mesma por erro de wiring (ex.: parâmetro undefined).
    expect(() => isRealClaudeHome('C:\\um\\path\\que\\nao\\e\\home\\nenhum\\.claude')).not.toThrow();
  });
});
