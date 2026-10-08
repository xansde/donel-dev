@echo off
rem 014-chat T040 - scripted FAKE `claude` for the chat smokes (never the real CLI
rem in tests). DONEL_CLAUDE_EXECUTABLE_FIXTURE points at this file; it just hands
rem the args over to the .mjs companion, which draws the screen and posts hooks.
node "%~dp0fake-claude-chat.mjs" %*
exit /b %errorlevel%
