# Mockup — formato da resposta do spike de research da fase Design (esteira 4.0)

> Fase **Design** do item `wi-esteira4-design-research` · plano
> `pln-esteira4-fase-design` · repo `donel-dev` · 10/08/2026.
>
> Este item é um **spike**: ele "termina numa resposta", e a resposta É a sua
> superfície — este mockup desenha o FORMATO dessa resposta, para que a fase
> Implementar (que vai executar a research) saiba exatamente que forma entregar
> e o dono saiba o que esperar quando for ler. **Forma** deste mockup vence;
> **alcance** (o que a research precisa responder) é do Plano e do Discovery.

## Onde a resposta vive

Um único documento: `specs/012-esteira-4/design-research.md` — irmão de
`catalogo.md`, `conversa.md`, `layout-esteira.md` e `motor.md`, e **insumo
direto** da spec `design.md` que o item irmão vai escrever depois da
ratificação. A research não é a spec: ela termina em RESPOSTAS ratificáveis,
não em texto normativo.

## Esqueleto do documento-resposta

```markdown
# Research — estrutura da fase Design (esteira 4.0)

> Item `wi-esteira4-design-research` · o que este documento é: a RESPOSTA do
> spike, para ratificação do dono antes da spec `design.md`. Cada resposta
> carrega a evidência que a sustenta (fonte lida, com caminho ou URL).

## 0. Insumos lidos
Tabela: fonte → o que se extraiu dela. Obrigatórios (nomeados no Plano):
- mattpocock/skills (como um repo maduro estrutura discovery técnico dirigido)
- As TRÊS rodadas manuais da fase Design da 012, como corpus empírico:
  `.esteira/design/wi-esteira4-catalogo-fases/`, `wi-esteira4-motor-spec/`,
  `wi-esteira4-conversa-spec/` — o que cada uma produziu, o que o dono
  aproveitou na validação, o que ficou sem uso.

## 1. O que a fase Design FAZ por dentro
Resposta à pergunta aberta do Discovery ("a fase menos estruturada").
Passos internos propostos, na ordem, cada um com: insumo → produto → quem
consome. Cobrir o que o Plano já fixou como contorno: discovery técnico da
estrutura-alvo (API, tabelas, tools, infra).

## 2. O que a fase ENTREGA e em que forma
O contorno dado pelo Plano: mapa entregue como HTML com diagramas Mermaid.
A research responde: estrutura desse HTML (seções, tipos de diagrama por tipo
de item), onde ele mora, e como o gate "Você valida o Design" o recebe.

## 3. Como a fase REESCREVE as tasks do Plano
Requisito do Plano: reescrever, NÃO gerar um segundo conjunto que compete.
A research responde: mecânica da reescrita (o que pode mudar, o que é
imutável, como a mudança fica rastreável para a Validar).

## 4. Quando um item é roteado a Design
[D-11]: Design não é oferta livre; zero é o caso comum. A research propõe o
critério OBJETIVO de roteamento que o Plano aplica ("tem decisão de
estrutura a tomar?"), com exemplos reais dos dois lados.

## 5. Perguntas que a research devolve SEM responder
O que só o dono pode fechar — nomeadas uma a uma, no padrão das [P-n],
prontas para a ratificação. Vazio é resposta válida; omissão não é.
```

## Critério de "terminou"

O spike fecha quando as seções 1–4 têm resposta com evidência e a seção 5
está explícita (mesmo que vazia). O documento vai ao dono para ratificação —
só depois disso o item irmão escreve a spec `design.md`.
