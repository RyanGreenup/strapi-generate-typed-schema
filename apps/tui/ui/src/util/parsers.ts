// Parser registration seam for the rich-content exemplars, adapted from
// opencode's module-scope call `addDefaultParsers(parsers.parsers)`
// (.agents/opencode/packages/tui/src/routes/session/index.tsx#L86) fed by
// parsers-config.ts, which fetches 33 grammar .wasm files and .scm queries
// over HTTPS at runtime.
// Kept: the addDefaultParsers hook so consumers can add grammars.
// Dropped: the remote parsers-config catalogue. @opentui/core bundles
// offline wasm parsers (markdown, javascript/typescript, zig) and the
// tree-sitter client registers them automatically on first use, so the
// exemplars need no registration call at all and work offline.
import type { FiletypeParserOptions } from "@opentui/core";

import { addDefaultParsers } from "@opentui/core";

const seen = new Set<string>();

/**
 * Registers extra grammars before the first code, Markdown, or diff render.
 * Later calls skip filetypes registered by earlier calls.
 */
export function registerExtraParsers(parsers: readonly FiletypeParserOptions[]): void {
  const fresh = parsers.filter((parser) => !seen.has(parser.filetype));
  if (fresh.length === 0) return;
  for (const parser of fresh) seen.add(parser.filetype);
  addDefaultParsers(fresh);
}
