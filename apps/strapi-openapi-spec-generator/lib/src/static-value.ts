import ts from "typescript";

/** Marks a value that the source code computes, so it is not known without running it. */
const UNKNOWN: unique symbol = Symbol("unknown");

/** A value read from source code without running it. */
type StaticValue =
  | StaticValue[]
  | boolean
  | number
  | string
  | typeof UNKNOWN
  | { [key: string]: StaticValue };

/**
 * Remove the wrappers that do not change a value: parentheses, `as` and `satisfies`.
 *
 * @param node - Any expression.
 * @returns The innermost wrapped expression.
 */
const unwrap = (node: ts.Expression): ts.Expression => {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner)
  ) {
    inner = inner.expression;
  }

  return inner;
};

/**
 * Read the name of an object literal property.
 *
 * @param property - One member of an object literal.
 * @returns The name, or `undefined` for a computed name, a spread or a method.
 */
const propertyName = (
  property: ts.ObjectLiteralElementLike,
): string | undefined => {
  const { name } = property;
  if (
    name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
  ) {
    return name.text;
  }

  return undefined;
};

/**
 * Read an object literal without running it.
 *
 * @param node - The object literal.
 * @returns Its named properties. A property with a computed value is `UNKNOWN`.
 */
const staticObject = (
  node: ts.ObjectLiteralExpression,
): Record<string, StaticValue> => {
  const result: Record<string, StaticValue> = {};
  for (const property of node.properties) {
    const name = propertyName(property);
    if (name !== undefined) {
      result[name] = ts.isPropertyAssignment(property)
        ? // oxlint-disable-next-line no-use-before-define -- the two functions call each other
          staticValue(property.initializer)
        : UNKNOWN;
    }
  }

  return result;
};

/**
 * Read a literal expression without running it.
 *
 * @param node - Any expression.
 * @returns The literal value, or `UNKNOWN` when the expression is not a literal.
 */
const staticValue = (node: ts.Expression): StaticValue => {
  const inner = unwrap(node);
  if (ts.isStringLiteralLike(inner)) {
    return inner.text;
  }
  if (ts.isNumericLiteral(inner)) {
    return Number(inner.text);
  }
  if (ts.isArrayLiteralExpression(inner)) {
    return inner.elements.map((element) => staticValue(element));
  }
  if (ts.isObjectLiteralExpression(inner)) {
    return staticObject(inner);
  }
  const keywords = new Map<ts.SyntaxKind, StaticValue>([
    [ts.SyntaxKind.FalseKeyword, false],
    [ts.SyntaxKind.TrueKeyword, true],
  ]);

  return keywords.get(inner.kind) ?? UNKNOWN;
};

/**
 * Narrow a static value to an object.
 *
 * @param value - Any static value.
 * @returns The object, or `undefined` when `value` is something else.
 */
const asObject = (
  value: StaticValue | undefined,
): Record<string, StaticValue> | undefined =>
  typeof value === "object" && !Array.isArray(value) ? value : undefined;

/**
 * Narrow a static value to a list of strings.
 *
 * @param value - Any static value.
 * @returns The strings, or `undefined` when `value` is not an array.
 */
const asStrings = (value: StaticValue | undefined): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

export { UNKNOWN, asObject, asStrings, staticValue };
export type { StaticValue };
