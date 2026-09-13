@echo off
rem 011-contas-e-provedores, etapa 3, Fase 1, Bloco 2 - `claude` FALSO usado
rem so pelo smoke accounts-add-login.spec.ts (regra dura: nunca abrir o CLI
rem real em teste). O seam DONEL_CLAUDE_EXECUTABLE_FIXTURE (main/index.ts)
rem aponta pra este arquivo; ele so repassa pro companheiro .mjs, que faz o
rem trabalho de verdade (esperar, gravar credencial falsa, ficar vivo).
node "%~dp0fake-claude-login.mjs" %*
exit /b %errorlevel%
