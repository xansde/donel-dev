# esteira-dev — o pacote portátil

Este diretório é o pacote **portátil** da Esteira: tudo que precisa poder sair
do donel-dev um dia sem levar o app junto. Onda 1 da rodada de execução
(spec `specs/012-esteira-4/execucao.md`) traz o contrato; itens seguintes da
mesma rodada trazem o validador e as skills soltas.

## `contract/v1/`

O JSON Schema da esteira — `esteira-result.schema.json` (o que uma fase
DEVOLVE) e `esteira-run-input.schema.json` (o que o app ENTREGA a uma fase) —
mais o golden corpus (`examples/` e `input-examples/`) que os dois lados usam
como fixture de teste.

**REGRA DURA: a fonte do contrato é AQUI.** O app (`src/shared/esteira/`) e o
fork da skill (`skills/esteira-donel-3.0.0/tools/esteira_contract.py`) LEEM
esta cópia — nenhum dos dois guarda uma cópia própria do schema.

Duas cópias coexistindo "por compatibilidade" foi exatamente o defeito que
originou o desencontro de campo entre app e skill registrado na spec 010
(D-3): o app lia um campo que a skill nunca gravava, e nada comparava as duas
pontas contra o MESMO arquivo. Antes desta inversão, o contrato morava dentro
de `src/shared/esteira/contract/v1/` só porque o fork da skill morava dentro
do donel-dev — um caminho relativo que existia por acidente de vizinhança, não
por decisão. Agora ele mora aqui, e um teste (`tests/esteiraContractPackageLocation.test.ts`)
garante que nenhuma segunda cópia do schema volta a aparecer em `src/`.
