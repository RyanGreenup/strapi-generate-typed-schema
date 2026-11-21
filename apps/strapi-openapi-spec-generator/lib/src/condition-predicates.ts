import type { JsonSchema } from "./document.js";

import { isUnknownArray, toRecord } from "./json.js";

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
interface Match {
  predicate: Predicate;
  test: (value: unknown) => boolean;
}

const scalar = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";
const enumeration = (values: unknown[]): Predicate =>
  values.length === 0 ? false : { enum: values };

// Missing response discriminators are unknown: fields/populate may have omitted them.
// Create sees schema defaults; update sees only the written data, not stored values.
const atom = (key: string, match: Match, context: ConditionContext): Truth => {
  const yes = {
    allOf: [{ required: [key] }, { properties: { [key]: match.predicate } }],
  };
  const no = {
    allOf: [
      { required: [key] },
      { properties: { [key]: { not: match.predicate } } },
    ],
  };
  if (context.mode === "response") {
    return { yes, no };
  }
  const attribute = toRecord(context.attributes[key]);
  const missing =
    context.mode === "create" && "default" in attribute
      ? attribute["default"]
      : null;
  const absent = { not: { required: [key] } };
  return match.test(missing)
    ? { yes: { anyOf: [yes, absent] }, no }
    : { yes, no: { anyOf: [no, absent] } };
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
    const matches = values.filter((entry) => equal(entry));
    if (value === null) {
      matches.push(null);
    }
    return enumeration(matches);
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

const matchValue = (
  operator: string,
  value: unknown,
  attribute: JsonSchema,
): Match | undefined => {
  if (operator === "in") {
    return isUnknownArray(value) && value.every((entry) => scalar(entry))
      ? {
          predicate: enumeration(value),
          test: (entry) => value.includes(entry),
        }
      : undefined;
  }
  if (!["==", "!=", "===", "!=="].includes(operator) || !scalar(value)) {
    return undefined;
  }
  const loose = operator === "==" || operator === "!=";
  const test = (entry: unknown): boolean =>
    loose ? looselyEqual(entry, value) : entry === value;
  const predicate = loose
    ? looseMatch(attribute, value, test)
    : { const: value };
  return predicate === undefined ? undefined : { predicate, test };
};

const logical = (
  args: unknown[],
  operator: string,
  context: ConditionContext,
): Truth | undefined => {
  if (args.length === 0) {
    return undefined;
  }
  const yes: Predicate[] = [];
  const no: Predicate[] = [];
  for (const arg of args) {
    const term = compilePredicate(arg, context);
    if (term === undefined) {
      return undefined;
    }
    yes.push(term.yes);
    no.push(term.no);
  }
  return operator === "and"
    ? { yes: { allOf: yes }, no: { anyOf: no } }
    : { yes: { anyOf: yes }, no: { allOf: no } };
};

const binary = (
  args: unknown[],
  operator: string,
  context: ConditionContext,
): Truth | undefined => {
  if (args.length !== 2) {
    return undefined;
  }
  const [left, right] = args;
  let key = variable(left, context);
  let value = right;
  if (key === undefined && operator !== "in") {
    key = variable(right, context);
    value = left;
  }
  if (key === undefined) {
    return undefined;
  }
  const match = matchValue(operator, value, toRecord(context.attributes[key]));
  if (match === undefined) {
    return undefined;
  }
  const truth = atom(key, match, context);
  return operator === "!=" || operator === "!=="
    ? { yes: truth.no, no: truth.yes }
    : truth;
};

/** Compile the schemas for a visible and a hidden field, or return undefined for an unsupported rule. */
function compilePredicate(
  rule: unknown,
  context: ConditionContext,
): Truth | undefined {
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
    return logical(args, operator, context);
  }
  if (operator === "!" && args.length === 1) {
    const [argument] = args;
    const term = compilePredicate(argument, context);
    return term === undefined ? undefined : { yes: term.no, no: term.yes };
  }
  return binary(args, operator, context);
}

export { compilePredicate };
export type { ConditionContext };

/* oxlint-enable unicorn/no-null */
