import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSUMED_PATHS, FACT_TYPES, parseEsteiraResultText } from '../src/shared/esteira/contract/resultContract';

// Spec 010 (D-10) — TESTE DE CONTRATO, lado APP.
//
// Este e o mecanismo que impede um campo de existir de um so lado. O bug de
// 03/08 (evidencia 1 da spec) foi exatamente isso: o app lia
// `outputs.plan_cards[]`, campo que a skill 2.1.0 nunca gravou, e traduziu a
// ausencia em "fase nao realizada". Nenhum dos dois lados estava errado
// sozinho — o que faltava era um lugar onde os dois fossem confrontados.
//
// Sao tres amarras sobre o MESMO arquivo canonico
// (`src/shared/esteira/contract/v1/esteira-result.schema.json`):
//
//   1. schema x parser  — o conjunto de campos declarados no schema e o
//      conjunto que o app promete ler (CONSUMED_PATHS) tem que ser IGUAL.
//      Campo lido e nao declarado reprova; campo declarado e nao lido tambem.
//   2. schema x corpus  — todo campo declarado aparece com valor NAO-NULO em
//      pelo menos um exemplo do golden corpus. Campo que ninguem nunca
//      preencheu e campo que ninguem nunca vai gravar.
//   3. corpus x parser  — todo exemplo do corpus e aceito pelo parser.
//
// O lado da skill (fork `esteira-donel-3.0.0`) roda o espelho disto: le o mesmo
// schema, valida o que grava contra ele, e confronta os campos que ESCREVE com
// os campos declarados. O corpus e o mesmo arquivo, copiado com hash conferido.
// Desenho completo em `specs/010-esteira-donel/passo-zero.md`.

const CONTRACT_DIR = fileURLToPath(new URL('../src/shared/esteira/contract/v1/', import.meta.url));
const SCHEMA_PATH = `${CONTRACT_DIR}esteira-result.schema.json`;
const EXAMPLES_DIR = `${CONTRACT_DIR}examples/`;

type JsonNode = Record<string, unknown>;

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonNode;

function resolveRef(node: JsonNode): JsonNode {
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  const key = ref.replace('#/$defs/', '');
  const defs = schema.$defs as Record<string, JsonNode>;
  return resolveRef(defs[key]);
}

/** `oneOf: [<algo>, {type: "null"}]` e um campo anulavel — o que interessa e o lado nao-nulo. */
function unwrapNullable(node: JsonNode): JsonNode {
  const oneOf = node.oneOf;
  if (!Array.isArray(oneOf)) return node;
  const nonNull = oneOf.filter((entry) => (entry as JsonNode).type !== 'null') as JsonNode[];
  if (nonNull.length !== 1) return node;
  return resolveRef(nonNull[0]);
}

function isObjectNode(node: JsonNode): boolean {
  return node.type === 'object' && typeof node.properties === 'object' && node.properties !== null;
}

/** Percorre o schema e emite os caminhos canonicos declarados. */
function collectSchemaPaths(node: JsonNode, prefix: string, out: Set<string>): void {
  const properties = node.properties as Record<string, JsonNode>;
  for (const [key, rawChild] of Object.entries(properties)) {
    const child = unwrapNullable(resolveRef(rawChild));
    const path = `${prefix}${key}`;

    if (child.type === 'array') {
      const items = unwrapNullable(resolveRef(child.items as JsonNode));
      const branches = Array.isArray(items.oneOf) ? (items.oneOf as JsonNode[]).map(resolveRef) : [items];
      for (const branch of branches) {
        if (!isObjectNode(branch)) {
          out.add(`${path}[]`);
          continue;
        }
        // Uniao discriminada (os fatos): o `const` do discriminante nomeia o ramo.
        const discriminant = discriminantOf(branch);
        collectSchemaPaths(branch, discriminant === null ? `${path}[].` : `${path}[${discriminant}].`, out);
      }
      continue;
    }

    if (isObjectNode(child)) {
      collectSchemaPaths(child, `${path}.`, out);
      continue;
    }

    out.add(path);
  }
}

function discriminantOf(branch: JsonNode): string | null {
  const properties = branch.properties as Record<string, JsonNode>;
  const type = properties?.type;
  return typeof type?.const === 'string' ? type.const : null;
}

/** Mesma notacao, agora sobre um documento real: so conta campo com valor NAO-NULO. */
function collectValuePaths(node: JsonNode, prefix: string, out: Set<string>): void {
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    const path = `${prefix}${key}`;

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
          const discriminant = (entry as JsonNode).type;
          const base = typeof discriminant === 'string' ? `${path}[${discriminant}].` : `${path}[].`;
          collectValuePaths(entry as JsonNode, base, out);
        } else {
          out.add(`${path}[]`);
        }
      }
      continue;
    }

    if (typeof value === 'object') {
      collectValuePaths(value as JsonNode, `${path}.`, out);
      continue;
    }

    out.add(path);
  }
}

const schemaPaths = new Set<string>();
collectSchemaPaths(schema, '', schemaPaths);

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));
const examples = exampleFiles.map((name) => ({ name, text: readFileSync(`${EXAMPLES_DIR}${name}`, 'utf8') }));

describe('contrato result.json — schema x parser', () => {
  it('o schema declara pelo menos o envelope e os fatos (guarda contra walker quebrado)', () => {
    expect(schemaPaths.size).toBeGreaterThan(50);
    expect(schemaPaths.has('run.status')).toBe(true);
    expect(schemaPaths.has('facts[work_item.recorded].item_type')).toBe(true);
  });

  it('todo campo declarado no schema e lido pelo app', () => {
    const consumed = new Set(CONSUMED_PATHS);
    const declaredButNotConsumed = [...schemaPaths].filter((path) => !consumed.has(path)).sort();
    expect(declaredButNotConsumed).toEqual([]);
  });

  it('todo campo lido pelo app esta declarado no schema', () => {
    const consumedButNotDeclared = CONSUMED_PATHS.filter((path) => !schemaPaths.has(path)).sort();
    expect(consumedButNotDeclared).toEqual([]);
  });

  it('CONSUMED_PATHS nao tem duplicata', () => {
    expect(new Set(CONSUMED_PATHS).size).toBe(CONSUMED_PATHS.length);
  });
});

describe('contrato result.json — schema x golden corpus', () => {
  it('o corpus existe', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it('todo campo declarado aparece com valor nao-nulo em algum exemplo', () => {
    const covered = new Set<string>();
    for (const example of examples) {
      collectValuePaths(JSON.parse(example.text) as JsonNode, '', covered);
    }
    const uncovered = [...schemaPaths].filter((path) => !covered.has(path)).sort();
    expect(uncovered).toEqual([]);
  });

  it('todo tipo de fato aparece em algum exemplo', () => {
    const seen = new Set<string>();
    for (const example of examples) {
      const doc = JSON.parse(example.text) as { facts: { type: string }[] };
      for (const fact of doc.facts) seen.add(fact.type);
    }
    const missing = FACT_TYPES.filter((type) => !seen.has(type)).sort();
    expect(missing).toEqual([]);
  });
});

describe('contrato result.json — corpus x parser', () => {
  it.each(exampleFiles)('%s e aceito pelo parser', (name) => {
    const example = examples.find((entry) => entry.name === name);
    const parsed = parseEsteiraResultText(example!.text);
    if (!parsed.ok) {
      throw new Error(`${name} recusado: ${JSON.stringify(parsed.issues, null, 2)}`);
    }
    expect(parsed.ok).toBe(true);
  });
});
