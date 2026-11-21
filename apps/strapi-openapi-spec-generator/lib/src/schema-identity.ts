import type { ConditionContext } from "./condition-predicates.js";

import { isUnknownArray, parseJsonObject, toRecord } from "./json.js";

/** The generator's model identity paired with the schema typia emitted for that type. */
interface SchemaRoot {
  name: string;
  uid?: string;
  mode?: ConditionContext["mode"];
  publishedInput?: true;
  /** A published nested update dispatches by id: present = existing, absent = new. */
  componentUpdateDispatch?: true;
  /** The probed input type used by the request wrapper's data property. */
  requestInput?: string;
  state?: "document" | "published" | "draft";
  schema: unknown;
}

interface Emission {
  schemas: Record<string, unknown>;
  roots: SchemaRoot[];
}

const hasValidRole = (value: Record<string, unknown>): boolean => {
  const { mode, publishedInput, componentUpdateDispatch, requestInput } = value;
  return (
    (mode === undefined ||
      mode === "create" ||
      mode === "update" ||
      mode === "response") &&
    (publishedInput === undefined ||
      (publishedInput === true && (mode === "create" || mode === "update"))) &&
    (componentUpdateDispatch === undefined ||
      (componentUpdateDispatch === true &&
        publishedInput === true &&
        mode === "update")) &&
    (requestInput === undefined ||
      (typeof requestInput === "string" &&
        requestInput !== "" &&
        mode === undefined))
  );
};

const isRoot = (value: unknown): value is SchemaRoot => {
  const root = toRecord(value);
  const { name, uid, state, schema } = root;
  return (
    typeof name === "string" &&
    name !== "" &&
    (uid === undefined || typeof uid === "string") &&
    hasValidRole(root) &&
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
