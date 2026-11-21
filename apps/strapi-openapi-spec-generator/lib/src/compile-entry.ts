import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";

import type { DiscoveredContentType } from "./content-types.js";
import type { QueryEnums } from "./query-parameters.js";
import type { Emission } from "./schema-identity.js";
import type { MetadataModel } from "./stage-declarations.js";
import type { SchemasInput } from "./work-directory.js";

import { readEmission } from "./schema-identity.js";
import { metadataModels, stageDeclarations } from "./stage-declarations.js";
import {
  createWorkDirectory,
  packageDirectory,
  readDiscovery,
  writeSchemaEntry,
} from "./work-directory.js";

/** Run a staged TypeScript entry with the cached typia plugin. Return its final JSON line or throw with the compiler diagnostics. */
const runEntry = async (
  work: string,
  cacheDirectory: string,
  file: "discovery.ts" | "entry.ts",
): Promise<string> => {
  const ttsx = path.join(packageDirectory("ttsc"), "lib/launcher/ttsx.js");
  const child = spawn(
    process.execPath,
    [
      ttsx,
      "--cache-dir",
      path.join(cacheDirectory, "ttsc"),
      "--project",
      path.join(work, "tsconfig.json"),
      path.join(work, file),
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
  return output.slice(output.lastIndexOf("\n") + 1);
};

interface Compilation {
  emission: Emission;
  contentTypes: DiscoveredContentType[];
  metadata: MetadataModel[];
  queryEnums: QueryEnums;
}

/** Run discovery and schema emission against the same staged declarations. */
const compileProject = async (
  input: SchemasInput,
  sources: MetadataModel[],
): Promise<Compilation> => {
  const work = await createWorkDirectory(input);
  try {
    const declared = await stageDeclarations(input.projectDirectory, work);
    const discovery = await runEntry(
      work,
      input.cacheDirectory,
      "discovery.ts",
    );
    const { models, contentTypes, queryEnums } = readDiscovery(
      input,
      discovery,
    );
    await writeSchemaEntry(work, models);
    const emission = readEmission(
      await runEntry(work, input.cacheDirectory, "entry.ts"),
    );
    return {
      emission,
      contentTypes,
      queryEnums,
      metadata: metadataModels(declared, models, sources),
    };
  } finally {
    await rm(work, { force: true, recursive: true });
  }
};

export { compileProject };
export type { Compilation };
