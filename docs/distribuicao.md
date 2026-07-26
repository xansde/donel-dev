# Distribuição — como o app chega aos colegas

Decidido em 26/07/2026. O requisito não era "mandar o app uma vez": era
**publicar quantas vezes quiser com o mesmo esforço**, e o colega sempre achar a
versão atual no mesmo lugar.

## O desenho

**Pasta compartilhada no Google Drive da Seazone**, com o instalador em **nome
fixo**:

```
Meu Drive/Donel Dev/            ← este é o link que você manda, uma vez só
  Donel-Dev-Setup.exe           ← nome FIXO: sempre a versão atual
  LEIA-ME.md                    ← gerado (versão, data, SHA256, como instalar)
  CHANGELOG.md                  ← o que mudou, em linguagem de quem usa
  versoes/                      ← 3 últimas, para voltar atrás
```

Publicar é **um comando**:

```powershell
npm run publicar
```

O `scripts/publicar.ps1` faz: `npm run dist` → arquiva a versão que está saindo
→ copia o instalador novo **sobre** o nome fixo → gera o `LEIA-ME.md` com versão,
data, tamanho e SHA256 do build → garante a seção do CHANGELOG (rascunho tirado
dos commits `feat:`/`fix:` desde a última publicação) → cria a tag local
`publicado/<data>` → imprime o rascunho do aviso.

**Nada é enviado a ninguém.** O script imprime o texto; mandar no Slack é ato
seu. (`~/.claude/CLAUDE.md`: automação gera rascunho ≠ envia.)

### Por que nome fixo, e por que copiar *sobre* o arquivo

O link estável é o da **pasta** — mas quem salva o link do *arquivo* também
continua funcionando, porque `Copy-Item -Force` escreve sobre o arquivo
existente em vez de apagar e recriar. O Google Drive trata isso como nova
revisão do mesmo arquivo, preservando o file ID. Se o script apagasse primeiro,
todo link direto morreria a cada publicação.

## Passo único, uma vez só (ato do Alexandre)

1. Instalar o **Google Drive para Desktop** e entrar com
   `alexandre.lentz@seazone.com.br` (não a conta pessoal — ver abaixo).
2. Criar a pasta **`Donel Dev`** no *Meu Drive* e compartilhar com os colegas
   como **Leitor**.
3. Rodar uma vez com o caminho — **forma posicional, sem `-Destino`**:
   `npm run publicar -- "G:\Meu Drive\Donel Dev"`

O caminho fica gravado em `scripts/publicar.local.json` (gitignored) e das
próximas vezes basta `npm run publicar`.

> **Por que sem `-Destino`:** medido em 26/07 — o npm no Windows engole
> argumentos que começam com um traço só. `npm run publicar -- -Destino "X"
> -SkipBuild` chegou ao script como apenas `X`, e o `-SkipBuild` foi
> silenciosamente perdido (o script empacotou quando não devia). Daí o caminho
> ser passado por posição e o `-SkipBuild` ter virado um script próprio:
> **`npm run publicar:rapido`** publica o instalador que já está em `release\`
> sem empacotar de novo.

## O que foi descartado, e por quê

| Canal | Por que não |
|---|---|
| **OneDrive desta máquina** | É conta **pessoal** (`xansde@gmail.com`, `OneDriveConsumer` no registro) — não a Seazone. Distribuição interna não sai de conta pessoal. |
| **GitHub Release no repo privado** | Exigiria dar acesso de leitura ao repo — ou seja, **ao código** — para cada colega. E o repo é da conta pessoal `xansde`, não da org `seazone-tech`. |
| **Repo público só de releases** | Publicaria binário interno na internet aberta. Decisão que não se toma de passagem. |
| **electron-updater com feed interno** | É o **destino certo** se a coisa pegar (app se atualiza sozinho, `provider: generic` apontando para URL interna no EKS/Cloudflare). Custa infra nova + implementação — não entra por tabela, entra como feature. |

## Dívidas conhecidas desta distribuição

1. **Instalador sem assinatura digital.** Todo colega vai ver "O Windows
   protegeu o seu PC" e precisar de *Mais informações → Executar assim mesmo*.
   Está documentado no LEIA-ME com o motivo e com o SHA256 para conferência.
   Resolver custa certificado de code signing (OV exige token em hardware/HSM
   desde 2023) — decisão de custo, não técnica.
2. **Sem atualização automática.** O colega só sabe que saiu versão nova quando
   você avisa.
3. **Ícone padrão do Electron.** Num instalador já não assinado, ícone genérico
   piora a percepção de confiança. Basta um `.ico` em `build/icon.ico` quando o
   design entregar.
4. **O script não verifica o compartilhamento da pasta** — se você esquecer de
   dar acesso a alguém, ele publica em silêncio e o colega não consegue baixar.
   O relatório final lembra de conferir.

## Segurança do que é distribuído

Verificado em 26/07 no build 0.1.0: o `app.asar` contém **apenas** `out/`
(main, preload, renderer) e o `package.json` — nenhum `.env`, nenhuma chave,
nenhum token. `docs/` e `scripts/` foram excluídos no `electron-builder.yml`
justamente porque o `publicar.local.json` (caminho local de quem publica)
viajaria dentro do instalador de todo mundo.

O app **não embute credencial nenhuma**: cada colega faz o próprio `/login` no
terminal, e as sessões ficam no `~/.claude` da máquina dele.
