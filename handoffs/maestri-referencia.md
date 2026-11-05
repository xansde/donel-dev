# Maestri - referencia de produto

Fontes lidas (WebFetch, 2026-10-23): home https://www.themaestri.app/pt-br ; docs https://www.themaestri.app/pt-br/docs ; https://www.themaestri.app/pt-br/remote ; https://www.themaestri.app/pt-br/windows ; https://www.themaestri.app/pt-br/docs/maestro.
Nota: WebFetch resume a pagina com um modelo pequeno; o texto abaixo e a leitura desse resumo, nao copia literal.

## Proposta de valor
- Tagline "Conecte tudo. Deixe tocar." Canvas infinito para orquestrar agentes de IA: cada agente recebe um papel, agentes se comunicam entre si e o estado do projeto fica visivel no canvas. (https://www.themaestri.app/pt-br)
- Problema apontado: sem orquestracao o usuario vira o gargalo, leva contexto de um agente a outro e guarda o estado so na cabeca. Metafora do maestro. (home)
- NAO e um agente de IA: e a camada de canvas/orquestracao ao redor de Claude Code, Codex ou OpenCode, que o usuario ja precisa ter instalados. (https://www.themaestri.app/pt-br/docs)

## Publico
- Nao definido explicitamente. Menciona "devs que trabalham em varios projetos" (plano Pro), times com licencas por assento, depoimentos de devs e vendas. (home)

## Funcionalidades (home, salvo indicacao)
- Trabalho em equipe: terminais conectados; agentes delegam, perguntam, passam trabalho adiante.
- Papeis: instrucoes reutilizaveis por agente (exemplos: Unslopifier, Bug Whisperer, Vibe Coder, Ship It, Refactor Gremlin, Docs Goblin, Git Wizard, Perf Nerd).
- Chat com agentes: cada terminal tem face de chat (respostas formatadas, diagramas, tabelas, arrastar arquivos ao canvas); varios assuntos com o mesmo agente. Doc: /pt-br/docs/chat (nao lida).
- Canvas infinito: zoom, agrupamento espacial.
- Agentes em qualquer lugar: cada terminal roda Claude Code, Codex, OpenCode ou shell comum.
- Portais: janelas embutidas para sites, simulador iOS, emulador Android ou celular fisico no Mac; agente le a arvore de elementos do app.
- Prompt Composer: compositor flutuante sobre o terminal; "@" aponta terminais, notas, portais; cola screenshots; cada terminal guarda seu rascunho.
- Notas: notas adesivas ligadas a terminais, em Markdown, onde o agente escreve progresso/decisoes.
- Canvases e workspaces separados por projeto, atalhos estilo tmux.
- Diagramas: setas, fluxos, formas a mao.
- Bandas: agrupam terminais, listam quem trabalha e quem precisa de atencao; Maestros no topo.
- Andares: copia isolada do workspace com nova branch e novos terminais; cita copy-on-write APFS (Mac).
- Ombro: companheiro de IA on-device, resume tarefas concluidas e sugere proximos passos em janela flutuante; Apple Foundation Models, macOS 26+.
- Feito para Mac: Swift/SwiftUI, AppKit, Metal, Liquid Glass.
- Privacidade: sem telemetria, dados locais, sem conta obrigatoria; Claude Code/Codex tem politicas proprias e o Maestri nao intercepta o trafego.

## Funcionalidades adicionais (docs e paginas internas)
- Modo Maestro: flag por terminal (Editar Terminal > aba Detalhes > caixa Maestro) que transforma o agente em gerente: recruta terminais conectados abaixo de si, liga a notas, reatribui/ajusta prompt (reinicia o processo), dispensa, provisiona workspaces e andares. Coordenacao principal e por notas compartilhadas; cada recruta conhece nome, responsabilidade e conexoes. Skill `/maestri-manager` carregada via @Maestro no primeiro prompt; `maestri notify` envia notificacao do sistema. Mecanismo interno de mensagens nao detalhado. Maestro enxerga presets de Configuracoes > Agentes e por padrao recruta copias de si. (https://www.themaestri.app/pt-br/docs/maestro)
- Conexao: "cabo animado com fisica" entre dois terminais ou terminal e nota. Arvore de Arquivos embutida no canvas. (docs)
- Maestri Remote: cliente movel (iPhone/iPad/Android) para ver cada agente, aprovar/recusar prompts com um toque, responder com texto/foto, terminal completo via PTY, terminais flutuantes; pareamento por codigo de 6 digitos + certificado fixado, criptografia ponta a ponta, relay que nao le notificacoes; exige Maestri Wire ativado, mesma rede ou rede privada (Tailscale). iOS beta publico via TestFlight; Android 9+ beta fechado. Preco nao informado. (https://www.themaestri.app/pt-br/remote)
- Windows 11 x64 (instalador ou portatil): mesmas funcoes, mais execucao de agentes em WSL, SSH e Docker, e CLI `maestri`. Mesmo formato de workspace entre Mac e Windows; "partituras" importaveis nos dois. A pagina diz tanto "motor em Swift compilado nativamente" quanto "canvas escrito do zero em cima do Electron", sem explicar. (https://www.themaestri.app/pt-br/windows)
- Existe versao Linux (/pt-br/linux, nao lida).

## Vocabulario proprio
Canvas / MaestriCanvas, Workspace, Terminal, Conexao, Nota (adesiva), Arvore de Arquivos, Maestro, Banda, Andar, Partitura, Ficharios, Batuta Search, Rotinas, Ambientes, Ombro, Portal, Papel, Prompt Composer, Maestri Chat, Maestri Wire (para devs), Maestri Remote, Gerenciador de Licencas. (home + indice de docs)
Itens so vistos como titulo no indice de docs, sem conteudo lido: Partituras, Ficharios, Batuta Search, Rotinas, Ambientes, Wire, Atalhos, Solucao de Problemas.

## Precos (home e /windows)
- Gratis: US$0 (a home usa "$"), 1 workspace, agentes ilimitados, canvas infinito, desenho, notas, conexao entre agentes, Ombro.
- Pro: R$95 pagamento unico, workspaces ilimitados, atalhos de navegacao, ate 2 dispositivos, 7 dias gratis.
- Times: licenca com assentos (ate 100; acima, hello@themaestri.app), Gerenciador de Licencas.

## Telas descritas na home
Dois terminais conectados (um envia prompts ao outro); canvas com varios terminais em zoom reduzido; terminal ligado a simulador iPhone, emulador Android e portal de navegador; Prompt Composer flutuando com mencao a agente e nota; diagramas de arquitetura e formas a mao; depoimentos de posts do X; selo Product Hunt.

## Lacunas
- Docs individuais (conexoes, bandas, andares, portais, rotinas, ambientes, partituras, ficharios, wire, chat, composer, atalhos) nao lidos; limite de 5 paginas.
- Protocolo de comunicacao entre agentes nao descrito nas paginas lidas.
- Versao minima de iOS, changelog, requisitos de hardware nao informados.
