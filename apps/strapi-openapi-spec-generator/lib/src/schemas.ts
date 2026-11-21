import type { DiscoveredContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemasInput } from "./work-directory.js";

import { applyAttributeMetadata } from "./attribute-metadata.js";
import { compileProject } from "./compile-entry.js";
import {
  applyConditions,
  readComponents,
  readExtensions,
} from "./conditions.js";
import { publicSchemas } from "./public-schemas.js";
import { applyRelations } from "./relations.js";
import {
  renameSchemas,
  unnamedSchemas,
  validateSchemaRefs,
} from "./schema-names.js";

/**
 * Compile the project's declarations and apply conditions found only in model JSON.
 * @param input - Project, content types and compiler cache.
 * @param warnings - Receives diagnostics for unsupported conditions.
 * @returns The named schemas and selectable fields of each API content type.
 * @throws If staging, compilation or model parsing fails.
 */
const generateSchemas = async (
  input: Omit<SchemasInput, "components">,
  warnings: string[],
): Promise<{
  schemas: Record<string, JsonSchema>;
  contentTypes: DiscoveredContentType[];
}> => {
  const components = await readComponents(input.projectDirectory);
  const project = { ...input, components };
  const extensions = await readExtensions(input.projectDirectory);
  const models = [...input.contentTypes, ...components, ...extensions];
  const { emission, contentTypes, metadata } = await compileProject(
    project,
    models,
  );
  const schemas = renameSchemas(emission.schemas, emission.roots);
  warnings.push(...applyConditions(models, emission.roots, schemas));
  applyRelations(models, emission.roots, schemas);
  warnings.push(...applyAttributeMetadata(metadata, emission.roots, schemas));
  const result = publicSchemas(schemas, emission.roots, input.contentTypes);
  validateSchemaRefs(result);
  const unnamed = unnamedSchemas(result);
  if (unnamed.length > 0) {
    warnings.push(
      `Schemas kept typia's generated names because no model role covers them: ${unnamed.join(", ")}`,
    );
  }
  return { schemas: result, contentTypes };
};

export { generateSchemas };
