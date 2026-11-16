import type { JsonSchema } from "./document.js";

import { toRecord } from "./json.js";

/* oxlint-disable unicorn/no-null -- JSONlogic represents missing variables as null. */
type Predicate = boolean | JsonSchema;
interface Truth {
  yes: Predicate;
  no: Predicate;
}
interface ConditionContext {
  attributes: JsonSchema;
  mode: "create" | "update" | "response";
}
interface Operand {
  key: string;
  value: unknown;
}
interface Match {
  predicate: Predicate;
  test: (value: unknown) => boolean;
}

const all = (rules: Predicate[]): Predicate => ({ allOf: rules });
const any = (rules: Predicate[]): Predicate => ({ anyOf: rules });
const owns = (key: string): JsonSchema => ({ required: [key] });
const scalar = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean"].includes(typeof value);
const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);
const enumeration = (values: unknown[]): Predicate =>
  values.length === 0 ? false : { enum: values };

// Missing response discriminators are unknown: fields/populate may have omitted them.
// Create sees schema defaults; update sees only the written data, not stored values.
const atom = (key: string, match: Match, context: ConditionContext): Truth => {
  const present = all([owns(key), { properties: { [key]: match.predicate } }]);
  const absent: Predicate = { not: owns(key) };
  const no = all([
    owns(key),
    { properties: { [key]: { not: match.predicate } } },
  ]);
  if (context.mode === "response") {
    return { yes: present, no };
  }
  const attribute = toRecord(context.attributes[key]);
  const missing =
    context.mode === "create" && "default" in attribute
      ? attribute["default"]
      : null;
  return match.test(missing)
    ? { yes: any([present, absent]), no }
    : { yes: present, no: any([no, absent]) };
};

const variable = (
  value: unknown,
  context: ConditionContext,
): string | undefined => {
  const record = toRecord(value);
  const { var: key } = record;
  return Object.keys(record).length === 1 &&
    typeof key === "string" &&
    key in context.attributes
    ? key
    : undefined;
};

const operand = (
  args: unknown[],
  operator: string,
  context: ConditionContext,
): Operand | undefined => {
  const [left, right] = args;
  const key = variable(left, context);
  if (key !== undefined) {
    return { key, value: right };
  }
  const reversed = operator === "in" ? undefined : variable(right, context);
  return reversed === undefined ? undefined : { key: reversed, value: left };
};

const looselyEqual = (entry: unknown, value: unknown): boolean => {
  if (entry === null || value === null || typeof entry === typeof value) {
    return entry === value;
  }
  return scalar(entry) && Number(entry) === Number(value);
};

// JSONlogic's == coerces primitive operands. Compile a finite enum exactly;
// for open domains accept only comparisons whose coercions remain representable.
const looseMatch = (
  attribute: JsonSchema,
  value: unknown,
  equal: Match["test"],
): Predicate | undefined => {
  const { enum: values, type } = attribute;
  if (isUnknownArray(values)) {
    return enumeration([...values, null].filter((entry) => equal(entry)));
  }
  if (value === null) {
    return { const: value };
  }
  if (type === "boolean") {
    return enumeration([true, false].filter((entry) => equal(entry)));
  }
  const number = Number(value);
  if (["integer", "float", "decimal"].includes(String(type))) {
    return Number.isFinite(number) ? { const: number } : false;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return Number.isFinite(number)
    ? {
        enum: [value, number, ...[true, false].filter((entry) => equal(entry))],
      }
    : { const: value };
};

const equality = (
  comparison: Operand,
  operator: string,
  context: ConditionContext,
): Truth | undefined => {
  const { key, value } = comparison;
  if (!["==", "!=", "===", "!=="].includes(operator) || !scalar(value)) {
    return undefined;
  }
  const loose = operator === "==" || operator === "!=";
  const test = (entry: unknown): boolean =>
    loose ? looselyEqual(entry, value) : entry === value;
  const predicate = loose
    ? looseMatch(toRecord(context.attributes[key]), value, test)
    : { const: value };
  if (predicate === undefined) {
    return undefined;
  }
  const truth = atom(key, { predicate, test }, context);
  return operator === "!=" || operator === "!=="
    ? { yes: truth.no, no: truth.yes }
    : truth;
};

const membership = (
  comparison: Operand,
  context: ConditionContext,
): Truth | undefined => {
  const { key, value } = comparison;
  if (!isUnknownArray(value) || !value.every((entry) => scalar(entry))) {
    return undefined;
  }
  return atom(
    key,
    {
      predicate: enumeration(value),
      test: (entry) => value.includes(entry),
    },
    context,
  );
};

const logical = (
  args: unknown[],
  operator: string,
  compile: (rule: unknown) => Truth | undefined,
): Truth | undefined => {
  if (args.length === 0) {
    return undefined;
  }
  const terms: Truth[] = [];
  for (const arg of args) {
    const term = compile(arg);
    if (term === undefined) {
      return undefined;
    }
    terms.push(term);
  }
  const yes = terms.map((term) => term.yes);
  const no = terms.map((term) => term.no);
  return operator === "and"
    ? { yes: all(yes), no: any(no) }
    : { yes: any(yes), no: all(no) };
};

const binary = (
  args: unknown[],
  operator: string,
  context: ConditionContext,
): Truth | undefined => {
  if (args.length !== 2) {
    return undefined;
  }
  const comparison = operand(args, operator, context);
  if (comparison === undefined) {
    return undefined;
  }
  return operator === "in"
    ? membership(comparison, context)
    : equality(comparison, operator, context);
};

const compilePredicate = (
  rule: unknown,
  context: ConditionContext,
): Truth | undefined => {
  if (typeof rule === "boolean") {
    return { yes: rule, no: !rule };
  }
  const entries = Object.entries(toRecord(rule));
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    return undefined;
  }
  const [operator, raw] = entry;
  const args = isUnknownArray(raw) ? raw : [raw];
  if (operator === "and" || operator === "or") {
    return logical(args, operator, (argument) =>
      compilePredicate(argument, context),
    );
  }
  if (operator === "!" && args.length === 1) {
    const [argument] = args;
    const term = compilePredicate(argument, context);
    return term === undefined ? undefined : { yes: term.no, no: term.yes };
  }
  return binary(args, operator, context);
};

export { compilePredicate };
export type { ConditionContext };

/* oxlint-enable unicorn/no-null */
