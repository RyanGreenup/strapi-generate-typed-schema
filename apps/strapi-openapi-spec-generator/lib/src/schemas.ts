import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";

import type { JsonSchema } from "./document.js";
import type { SchemasInput } from "./work-directory.js";

import { applyConditions } from "./conditions.js";
import { parseJsonObject } from "./json.js";
import { renameSchemas } from "./schema-names.js";
import { createWorkDirectory, packageDirectory } from "./work-directory.js";

/**
 * Run the compiler in `work` using the plugin in `cacheDirectory`.
 * @returns The schemas from the launcher's last output line, after compiler logs.
 * @throws If the launcher fails or its output is not JSON.
 */
const runEntry = async (
  work: string,
  cacheDirectory: string,
): Promise<Record<string, unknown>> => {
  const ttsx = path.join(packageDirectory("ttsc"), "lib/launcher/ttsx.js");
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
  const [stdout, stderr] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);
  if (child.exitCode !== 0) {
    throw new Error(`The schemas could not be generated.\n${stderr}${stdout}`);
  }
  const output = stdout.trim();
  return parseJsonObject(output.slice(output.lastIndexOf("\n") + 1));
};

/**
 * Compile the project's declarations and apply conditions found only in model JSON.
 * @param input - Project, content types and compiler cache.
 * @param warnings - Receives diagnostics for unsupported conditions.
 * @returns The named request and response schemas.
 * @throws If staging, compilation or model parsing fails.
 */
const generateSchemas = async (
  input: SchemasInput,
  warnings: string[],
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
