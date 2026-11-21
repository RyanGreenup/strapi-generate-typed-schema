import ts from "typescript";

const objectValue = (
  node: ts.ObjectLiteralExpression,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const property of node.properties) {
    const { name } = property;
    if (
      name !== undefined &&
      (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
    ) {
      result[name.text] = ts.isPropertyAssignment(property)
        ? staticValue(property.initializer)
        : undefined;
    }
  }
  return result;
};

/** Read a route literal without executing code; computed values stay undefined. */
function staticValue(node: ts.Expression | undefined): unknown {
  if (node === undefined) {
    return undefined;
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return staticValue(node.expression);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return objectValue(node);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(staticValue);
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.TrueKeyword
  ) {
    return node.kind === ts.SyntaxKind.TrueKeyword;
  }
  return undefined;
}

export { staticValue };
