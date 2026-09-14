@echo off
rem 011-contas-e-provedores, etapa 3, Fases 1 e 2 - `claude` FALSO usado
rem so pelos smokes accounts-add-login.spec.ts e accounts-fase-2.spec.ts (regra
rem dura: nunca abrir o CLI real em teste). O seam DONEL_CLAUDE_EXECUTABLE_FIXTURE
rem (main/index.ts) aponta pra este arquivo; ele so repassa pro companheiro .mjs,
rem que faz o trabalho de verdade: na aba de login, grava credencial falsa e fica
rem vivo; numa aba comum (sem CLAUDE_CONFIG_DIR), so fica vivo.
node "%~dp0fake-claude-login.mjs" %*
exit /b %errorlevel%
