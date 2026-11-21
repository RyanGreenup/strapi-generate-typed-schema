import ts from "typescript";

const primitive = (value: ts.LiteralTypeNode["literal"]): unknown => {
  if (ts.isStringLiteralLike(value)) {
    return value.text;
  }
  if (ts.isNumericLiteral(value)) {
    return Number(value.text);
  }
  if (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
    return value.operator === ts.SyntaxKind.MinusToken
      ? -Number(value.operand.text)
      : undefined;
  }
  if (value.kind === ts.SyntaxKind.NullKeyword) {
    // oxlint-disable-next-line unicorn/no-null -- null is a concrete JSON default.
    return null;
  }
  if (
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return value.kind === ts.SyntaxKind.TrueKeyword;
  }
  return undefined;
};

// One unknown member invalidates the entire default: a partial object isn't its value.
const objectLiteral = (node: ts.TypeLiteralNode): unknown => {
  const entries: [string, unknown][] = [];
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || member.questionToken !== undefined) {
      return undefined;
    }
    const { name } = member;
    const value = declarationLiteral(member.type);
    if (
      value === undefined ||
      !(
        ts.isIdentifier(name) ||
        ts.isStringLiteralLike(name) ||
        ts.isNumericLiteral(name)
      )
    ) {
      return undefined;
    }
    entries.push([name.text, value]);
  }
  return Object.fromEntries(entries);
};

/** Decode the closed JSON literal types emitted by Strapi, never a function or widened type. */
function declarationLiteral(node: ts.TypeNode | undefined): unknown {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return declarationLiteral(node.type);
  }
  if (ts.isLiteralTypeNode(node)) {
    return primitive(node.literal);
  }
  if (ts.isTupleTypeNode(node)) {
    const items = node.elements.map((element) => declarationLiteral(element));
    return items.includes(undefined) ? undefined : items;
  }
  return ts.isTypeLiteralNode(node) ? objectLiteral(node) : undefined;
}

export { declarationLiteral };
