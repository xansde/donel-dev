// Spec 010 (D-10) — o walker do TESTE DE CONTRATO, compartilhado pelos dois
// contratos da esteira: `result.json` (a volta) e `run-input.json` (a ida).
//
// Ele percorre um JSON Schema e emite os caminhos canonicos declarados, e faz o
// mesmo sobre um documento real (contando so valor NAO-NULO). Comparar os dois
// conjuntos e o que impede um campo de existir de um lado so — o mecanismo que
// faltava em 03/08, quando o app lia um campo que a skill nunca gravou.
//
// Nao e arquivo de teste (nao casa com `tests/**/*.test.ts`): e helper.

export type JsonNode = Record<string, unknown>;

export interface SchemaWalker {
  /** Caminhos canonicos declarados pelo schema, ex.: `run.status`, `facts[plan.recorded].title`. */
  readonly schemaPaths: Set<string>;
  /** Mesma notacao, agora sobre um documento real. */
  collectValuePaths(node: JsonNode, prefix: string, out: Set<string>): void;
}

export function createSchemaWalker(schema: JsonNode): SchemaWalker {
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

  function discriminantOf(branch: JsonNode): string | null {
    const properties = branch.properties as Record<string, JsonNode>;
    const type = properties?.type;
    return typeof type?.const === 'string' ? type.const : null;
  }

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

  return { schemaPaths, collectValuePaths };
}
