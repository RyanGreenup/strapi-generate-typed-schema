import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";

import type { JsonSchema } from "./document.js";
import type { SchemasInput } from "./work-directory.js";

import { applyConditions } from "./conditions.js";
import { parseJsonObject, toRecord } from "./json.js";
import { renameSchemas } from "./schema-names.js";
import { createWorkDirectory, packageDirectory } from "./work-directory.js";

/**
 * Compile and run the entry file of a work directory.
 *
 * @param work - The work directory.
 * @param cacheDirectory - The cache directory, which keeps the compiled typia plugin.
 * @returns The component schemas that the entry file printed.
 * @throws {Error} When the compiler reports an error.
 */
const runEntry = async (
  work: string,
  cacheDirectory: string,
): Promise<Record<string, JsonSchema>> => {
  const ttsx = path.join(
    packageDirectory("ttsc", import.meta.url),
    "lib",
    "launcher",
    "ttsx.js",
  );
  const child = spawn(
    process.execPath,
    [
      ttsx,
      "--cache-dir",
      path.join(cacheDirectory, "ttsc"),
      "--project",
      path.join(work, "tsconfig.json"),
      path.join(work, "entry.ts"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  const [stdout, stderr] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
  ]);
  // The "close" event carries the exit code and the signal.
  const closeEvent: unknown[] = await closed;
  if (closeEvent[0] !== 0) {
    throw new Error(`The schemas could not be generated.\n${stderr}${stdout}`);
  }
  // The entry file prints the schemas as the last line.
  const schemas = parseJsonObject(stdout.trim().split("\n").at(-1) ?? "{}");

  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, toRecord(schema)]),
  );
};

/**
 * Generate the JSON Schema of every request and response body of a Strapi project.
 *
 * The first run on a machine compiles the typia plugin, which takes a few minutes.
 *
 * @param input - The project, its content types and the cache directory.
 * @returns The component schemas by name.
 * @throws {Error} When the project is not ready or its types do not compile.
 */
const generateSchemas = async (
  input: SchemasInput,
  warnings: string[] = [],
): Promise<Record<string, JsonSchema>> => {
  const work = await createWorkDirectory(input);
  try {
    const schemas = renameSchemas(await runEntry(work, input.cacheDirectory));
    warnings.push(
      ...(await applyConditions(
        input.projectDirectory,
        input.contentTypes,
        schemas,
      )),
    );
    return schemas;
  } finally {
    await rm(work, { force: true, recursive: true });
  }
};

export { generateSchemas };
