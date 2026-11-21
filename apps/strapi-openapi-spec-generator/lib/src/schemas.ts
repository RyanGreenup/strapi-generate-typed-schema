import { rm } from "node:fs/promises";

import type { JsonSchema } from "./document.js";
import type { SchemasInput } from "./work-directory.js";

import { runEntry } from "./compile-entry.js";
import {
  applyConditions,
  readComponents,
  readExtensions,
} from "./conditions.js";
import { publicSchemas } from "./public-schemas.js";
import { readEmission } from "./schema-identity.js";
import {
  renameSchemas,
  unnamedSchemas,
  validateSchemaRefs,
} from "./schema-names.js";
import { createWorkDirectory, writeSchemaEntry } from "./work-directory.js";

/**
 * Compile the project's declarations and apply conditions found only in model JSON.
 * @param input - Project, content types and compiler cache.
 * @param warnings - Receives diagnostics for unsupported conditions.
 * @returns The named request and response schemas.
 * @throws If staging, compilation or model parsing fails.
 */
const generateSchemas = async (
  input: Omit<SchemasInput, "components">,
  warnings: string[],
): Promise<Record<string, JsonSchema>> => {
  const components = await readComponents(input.projectDirectory);
  const project = { ...input, components };
  const work = await createWorkDirectory(project);
  try {
    const discovery = await runEntry(
      work,
      input.cacheDirectory,
      "discovery.ts",
    );
    await writeSchemaEntry(work, project, discovery);
    const emission = readEmission(
      await runEntry(work, input.cacheDirectory, "entry.ts"),
    );
    const schemas = renameSchemas(emission.schemas, emission.roots);
    const extensions = await readExtensions(input.projectDirectory);
    warnings.push(
      ...applyConditions(
        [...input.contentTypes, ...components, ...extensions],
        emission.roots,
        schemas,
      ),
    );
    const result = publicSchemas(schemas, emission.roots, input.contentTypes);
    validateSchemaRefs(result);
    const unnamed = unnamedSchemas(result);
    if (unnamed.length > 0) {
      warnings.push(
        `Schemas kept typia's generated names because no model role covers them: ${unnamed.join(", ")}`,
      );
    }
    return result;
  } finally {
    await rm(work, { force: true, recursive: true });
  }
};

export { generateSchemas };
