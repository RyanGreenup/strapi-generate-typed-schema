import ts from "typescript";

import { declarationLiteral } from "./declaration-literal.js";
import { toRecord } from "./json.js";

type Facts = Record<string, unknown>;
type Replace = (node: ts.TypeNode, replacement: string) => void;

const descriptorName = (node: ts.TypeReferenceNode): string | undefined => {
  if (!ts.isQualifiedName(node.typeName)) {
    return undefined;
  }
  const { left, right } = node.typeName;
  return ts.isQualifiedName(left) &&
    ts.isIdentifier(left.left) &&
    left.left.text === "Schema" &&
    left.right.text === "Attribute"
    ? right.text
    : undefined;
};

const effectiveBound = (
  bound: string | number,
  type: unknown,
): number | undefined => {
  const number = Number(bound);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return type === "integer" ? Math.trunc(number) : number;
};

const addBounds = (
  facts: Facts,
  node: ts.TypeReferenceNode,
  replace: Replace,
): void => {
  const bounds = toRecord(declarationLiteral(node.typeArguments?.[0]));
  const numeric = ["integer", "float", "decimal"].includes(
    String(facts["type"]),
  );
  const effective: Record<string, number | undefined> = {};
  let changed = false;
  for (const key of ["min", "max"]) {
    const bound = bounds[key];
    if (typeof bound === "number" || typeof bound === "string") {
      facts[key] = bound;
      effective[key] = effectiveBound(bound, facts["type"]);
      changed ||= effective[key] !== bound;
    }
  }
  // Strapi casts finite bounds at validation time. Its TS numeric descriptor
  // intersects string-valued SetMinMax operands down to never. Give typia the
  // effective numbers; facts above still carry the exact configured literals.
  if (numeric && changed) {
    replace(node, `Schema.Attribute.SetMinMax<${JSON.stringify(effective)}>`);
  }
};

const addMediaKinds = (
  facts: Facts,
  argument: ts.TypeNode | undefined,
): void => {
  if (argument !== undefined) {
    const kinds = ts.isUnionTypeNode(argument) ? argument.types : [argument];
    const values = kinds.map((kind) => declarationLiteral(kind));
    if (values.every((value) => typeof value === "string")) {
      facts["allowedTypes"] = values;
    }
  }
};

const addOperand = (
  facts: Facts,
  node: ts.TypeNode,
  replace: Replace,
): void => {
  if (!ts.isTypeReferenceNode(node)) {
    return;
  }
  const name = descriptorName(node);
  if (name === undefined) {
    return;
  }
  facts["type"] ??= name.toLowerCase();
  switch (name) {
    case "Component": {
      facts["repeatable"] =
        declarationLiteral(node.typeArguments?.[1]) === true;
      break;
    }
    case "Required":
    case "Unique": {
      facts[name.toLowerCase()] = true;
      break;
    }
    case "DefaultTo": {
      const value = declarationLiteral(node.typeArguments?.[0]);
      if (value !== undefined) {
        facts["default"] = value;
      }
      break;
    }
    case "SetMinMax": {
      addBounds(facts, node, replace);
      break;
    }
    case "Media": {
      addMediaKinds(facts, node.typeArguments?.[0]);
      break;
    }
    default: {
      break;
    }
  }
};

/** Strapi emits the base descriptor first, followed by modifier intersections. */
const attributeFacts = (node: ts.TypeNode, replace: Replace): Facts => {
  const facts: Facts = {};
  const operands = ts.isIntersectionTypeNode(node) ? node.types : [node];
  for (const operand of operands) {
    addOperand(facts, operand, replace);
  }
  return facts;
};

export { attributeFacts };
export type { Facts, Replace };
