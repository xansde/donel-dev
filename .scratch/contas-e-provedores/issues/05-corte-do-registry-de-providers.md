# Corte mínimo do registry de providers

Type: grilling
Status: resolved
Blocked by: 01

## Question

Qual é o primeiro corte do registry de providers do launcher (modelo T3:
display name + binário + env vars + config dir)? Quais CLIs/provedores entram
primeiro (candidatos: OpenRouter Claude-compatible via env; codex; opencode),
e o que o Donel promete para sessões de CLIs não-Claude — só o terminal (PTY),
ou também indexação/resume/Modo Dev (que hoje assumem Claude Code)?

## Answer

Decidido com o Alexandre (04/08):

1. **Duas classes de provider**, fronteira honesta:
   - **Classe A — Claude-compatible (experiência completa)**: mesmo binário
     `claude` + env vars por provider (`ANTHROPIC_BASE_URL`,
     `ANTHROPIC_AUTH_TOKEN` write-only) + `CLAUDE_CONFIG_DIR` próprio para
     isolar. Transcripts, hooks/semáforo, resume/fork e Modo Dev funcionam sem
     obra, porque o binário é o mesmo.
   - **Classe B — CLIs terceiros (só terminal)**: registry guarda nome +
     binário + env; abrir sessão = aba PTY. Sem indexação/resume/semáforo/
     Modo Dev no primeiro corte (obra por CLI, adiada até demanda real).
2. **Classe B nasce VAZIA**: estrutura pronta no registry, sem piloto — o
   Alexandre não tem codex; povoa quando um CLI real aparecer. V1 lança só com
   a classe A.
3. **Estreia da classe A: OpenRouter** (modelos gratuitos). Chave já existe no
   Bitwarden — referenciada na spec, lida só na implementação, direto do cofre
   para o storage seguro do provider (nunca via chat/arquivo).
4. **WSL verificado (04/08): nada a migrar** — sem env OpenRouter, sem rc, sem
   CLIs de agente; só menções em transcripts antigos. Config do zero no
   Windows.
5. Provider é a **segunda família de mods** (rima com ticket 03): interface
   extraída dos casos concretos, mods in-repo.
