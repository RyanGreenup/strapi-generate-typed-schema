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
const portablePattern = (source: string): boolean => {
  if (/[^\x20-\x7e]/u.test(source)) return false;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      const escaped = source[++i];
      if (!escaped || !"dswfnrtvx^$\\.*+?()[]{}|/-".includes(escaped))
        return false;
    } else if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      if (source[i + 1] === "^") return false;
      inClass = true;
    } else if (
      char === "." ||
      (source.startsWith("(?", i) && !source.startsWith("(?:", i))
    ) {
      return false;
    }
  }
  try {
    // Compile only; generation never runs project-supplied regular expressions.
    void new RegExp(source);
    void new RegExp(source, "u");
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
  return {
    source: regex,
    portable: typeof regex === "string" && portablePattern(regex),
    // UID runs a second matches() without excludeEmptyString. Published email
    // also has email().min(1), already represented by its email format.
    skipEmpty: !required && type !== "uid" && type !== "email",
    replaceUidFallback: type === "uid" && Boolean(regex),
  };
};

const applyWriteRegex = (child: JsonSchema, rule: WriteRegex): JsonSchema => {
  const result = toRecord(
    walkSchema(child, {
      copy: true,
      visit: (node) => {
        // In particular, never restore validation to a hidden field's relaxed {}.
        if (node["type"] !== "string") return;
        if (rule.replaceUidFallback) Reflect.deleteProperty(node, "pattern");
        if (!rule.portable) return;
        if (rule.skipEmpty) {
          node["anyOf"] = [{ const: "" }, { pattern: rule.source }];
        } else {
          node["pattern"] = rule.source;
        }
      },
    }),
  );
  if (!rule.portable) result["x-strapi-regex"] = rule.source;
  return result;
};

export { applyWriteRegex, writeRegex };
export type { WriteRegex };
