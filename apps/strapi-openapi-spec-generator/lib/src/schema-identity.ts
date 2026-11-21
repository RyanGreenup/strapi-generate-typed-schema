import type { ConditionContext } from "./condition-predicates.js";

import { isUnknownArray, parseJsonObject, toRecord } from "./json.js";

/** The generator's model identity paired with the schema typia emitted for that type. */
interface SchemaRoot {
  name: string;
  uid?: string;
  mode?: ConditionContext["mode"];
  state?: "document" | "published" | "draft";
  schema: unknown;
}

interface Emission {
  schemas: Record<string, unknown>;
  roots: SchemaRoot[];
}

const isRoot = (value: unknown): value is SchemaRoot => {
  const { name, uid, mode, state, schema } = toRecord(value);
  return (
    typeof name === "string" &&
    name !== "" &&
    (uid === undefined || typeof uid === "string") &&
    (mode === undefined ||
      mode === "create" ||
      mode === "update" ||
      mode === "response") &&
    (state === undefined ||
      state === "document" ||
      state === "draft" ||
      state === "published") &&
    (typeof schema === "boolean" ||
      (schema !== null && typeof schema === "object" && !Array.isArray(schema)))
  );
};

/** Reject incomplete compiler output rather than publish a document without its contract. */
const readEmission = (output: string): Emission => {
  const { schemas, roots } = parseJsonObject(output);
  if (
    schemas === null ||
    typeof schemas !== "object" ||
    Array.isArray(schemas) ||
    !isUnknownArray(roots) ||
    !roots.every((entry) => isRoot(entry))
  ) {
    throw new Error(
      "Invalid schema compiler output: expected component schemas and named roots",
    );
  }
  return { schemas: toRecord(schemas), roots };
};

export { readEmission };
export type { Emission, SchemaRoot };
