import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";

import { schemaRef, visitSchemaRefs } from "./schema-names.js";

type States = Partial<Record<NonNullable<SchemaRoot["state"]>, string>>;

const retainDocument = (
  states: States,
  retained: Map<string, JsonSchema>,
  retain: (name: string) => void,
): void => {
  const { document, published, draft } = states;
  if (document === undefined || retained.has(document)) {
    return;
  }
  const used = [draft, published].filter(
    (name): name is string => name !== undefined && retained.has(name),
  );
  const [only] = used;
  if (only !== undefined && used.length === 1) {
    retained.set(document, { $ref: schemaRef(only) });
  } else if (used.length > 1) {
    retain(document);
  }
};

/** Keep API contracts even for disabled routes. Compiler probes alone are not client schemas. */
const publicSchemas = (
  schemas: Record<string, JsonSchema>,
  roots: SchemaRoot[],
  contentTypes: ContentType[],
): Record<string, JsonSchema> => {
  const apis = new Set(contentTypes.map(({ uid }) => uid));
  const statesByUid = new Map<string, States>();
  const retained = new Map<string, JsonSchema>();
  const retain = (name: string): void => {
    if (retained.has(name)) {
      return;
    }
    const schema = schemas[name];
    if (schema === undefined) {
      throw new Error(`Missing public schema: ${name}`);
    }
    retained.set(name, schema);
    visitSchemaRefs(schema, schemas, retain);
  };
  for (const { name, uid, state } of roots) {
    if (uid === undefined || apis.has(uid)) {
      retain(name);
    }
    if (uid !== undefined && state !== undefined) {
      const states = statesByUid.get(uid) ?? {};
      states[state] = name;
      statesByUid.set(uid, states);
    }
  }
  // A component populated only by published owners must not acquire a draft
  // alternative just because the compiler probed its draft type for identity.
  for (const states of statesByUid.values()) {
    retainDocument(states, retained, retain);
  }
  return Object.fromEntries(retained);
};

export { publicSchemas };
