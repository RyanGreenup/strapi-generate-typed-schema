import type { JsonSchema } from "./document.js";

import { toRecord } from "./json.js";
import { walkSchema } from "./schema-traversal.js";

// entity-validator/validators: these six validators call addStringRegexValidator.
const regexTypes: Record<string, true> = {
  string: true,
  text: true,
  richtext: true,
  password: true,
  email: true,
  uid: true,
};

// Strapi calls new RegExp(source) without flags. JSON Schema uses Unicode mode:
// even a pattern legal in both, such as ^..$, changes meaning on astral text.
// Accept ordinary ASCII literals/classes, grouping, repetition and anchors.
// Never turn a different or invalid expression into an enforceable constraint.
const isPortableEscape = (escaped: string | undefined): boolean =>
  escaped !== undefined &&
  String.raw`dswfnrtvx^$\.*+?()[]{}|/-`.includes(escaped);

const isPortableOutsideClass = (
  source: string,
  i: number,
  char: string | undefined,
): boolean => {
  if (char === "[") {
    return source[i + 1] !== "^";
  }
  if (char === "(") {
    return source[i + 1] !== "?" || source[i + 2] === ":";
  }
  return char !== ".";
};

const hasPortableTokens = (source: string): boolean => {
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      if (!isPortableEscape(source[i])) {
        return false;
      }
    } else if (inClass) {
      inClass = char !== "]";
    } else if (isPortableOutsideClass(source, i, char)) {
      inClass = char === "[";
    } else {
      return false;
    }
  }
  return true;
};

const portablePattern = (source: string): boolean => {
  if (/[^\u0020-\u007E]/u.test(source) || !hasPortableTokens(source)) {
    return false;
  }
  try {
    // Compile only; generation never runs project-supplied regular expressions.
    // oxlint-disable-next-line eslint/no-new, eslint/require-unicode-regexp -- Compile in Strapi's legacy mode.
    new RegExp(source);
    // oxlint-disable-next-line eslint/no-new -- Compile in JSON Schema's Unicode mode.
    new RegExp(source, "u");
    return true;
  } catch {
    return false;
  }
};

interface WriteRegex {
  source: unknown;
  portable: boolean;
  skipEmpty: boolean;
  replaceUidFallback: boolean;
}

const writeRegex = (attribute: JsonSchema): WriteRegex | undefined => {
  const { regex, type, required } = attribute;
  if (
    typeof type !== "string" ||
    regexTypes[type] !== true ||
    regex === undefined ||
    regex === ""
  ) {
    // An empty expression matches all strings. A UID still gets its fallback.
    return undefined;
  }
  const isRequired = Boolean(required);
  return {
    source: regex,
    portable: typeof regex === "string" && portablePattern(regex),
    // UID runs a second matches() without excludeEmptyString. Published email
    // also has email().min(1), already represented by its email format.
    skipEmpty: !isRequired && type !== "uid" && type !== "email",
    replaceUidFallback: type === "uid" && Boolean(regex),
  };
};

const applyWriteRegex = (child: JsonSchema, rule: WriteRegex): JsonSchema => {
  const result = toRecord(
    walkSchema(child, {
      copy: true,
      visit: (node) => {
        // In particular, never restore validation to a hidden field's relaxed {}.
        if (node["type"] !== "string") {
          return;
        }
        if (rule.replaceUidFallback) {
          Reflect.deleteProperty(node, "pattern");
        }
        if (!rule.portable) {
          return;
        }
        if (rule.skipEmpty) {
          node["anyOf"] = [{ const: "" }, { pattern: rule.source }];
        } else {
          node["pattern"] = rule.source;
        }
      },
    }),
  );
  if (!rule.portable) {
    result["x-strapi-regex"] = rule.source;
  }
  return result;
};

export { applyWriteRegex, writeRegex };
export type { WriteRegex };
