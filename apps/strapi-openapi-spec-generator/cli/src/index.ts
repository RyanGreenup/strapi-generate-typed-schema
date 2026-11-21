#!/usr/bin/env node

import type { DumpOptions } from "@ryangreenup/strapi-openapi-spec-generator-lib";
import type { CommandDef } from "citty";

import tab from "@bomb.sh/tab/citty";
import {
  dump,
  generateSpecification,
} from "@ryangreenup/strapi-openapi-spec-generator-lib";
import { defineCommand, runMain } from "citty";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ARG_START_INDEX = 2;
const JSON_INDENT = 2;

/** The arguments of the `generate` command after citty has parsed them. */
interface GenerateArguments {
  /** Undefined selects the library's default cache directory. */
  cacheDirectory: string | undefined;
  output: string;
  project: string;
  serverUrl: string;
}

/**
 * Generate the OpenAPI document of a Strapi project and write it to a file.
 *
 * @param args - The parsed command line arguments.
 * @returns A promise that resolves when the file is written.
 */
const generate = async (args: GenerateArguments): Promise<void> => {
  const projectDirectory = path.resolve(args.project);
  console.error(
    "Generating schemas. The first run on a machine compiles the typia plugin and takes a few minutes.",
  );
  const { document, warnings } = await generateSpecification({
    projectDirectory,
    serverUrl: args.serverUrl,
    ...(args.cacheDirectory !== undefined && {
      cacheDirectory: path.resolve(args.cacheDirectory),
    }),
  });
  for (const warning of warnings) {
    console.error(`warning: ${warning}`);
  }
  // A relative output path is relative to the project, where the document belongs.
  const outputPath = path.resolve(projectDirectory, args.output);
  await writeFile(
    outputPath,
    `${JSON.stringify(document, undefined, JSON_INDENT)}\n`,
  );
  const operations = Object.values(document.paths).flatMap((methods) =>
    Object.keys(methods),
  );
  console.log(
    `${operations.length} operations, ${Object.keys(document.components.schemas).length} schemas -> ${outputPath}`,
  );
};

const reportError = (error: unknown): void => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
};

const dumpCommand = defineCommand({
  meta: {
    name: "dump",
    description:
      "Export Strapi documents by publication status. Set STRAPI_API_TOKEN to a token with read access.",
  },
  args: {
    out: {
      type: "positional",
      required: true,
      description: "New or empty directory for documents and manifest.json.",
    },
    spec: {
      type: "string",
      required: true,
      description: "Path to the generated OpenAPI JSON file.",
    },
    url: {
      type: "string",
      required: true,
      description: "Strapi instance URL without the REST prefix.",
    },
    media: {
      type: "boolean",
      default: false,
      description: "Download original media files.",
    },
    validate: {
      type: "boolean",
      default: true,
      description: "Validate responses against the specification.",
      negativeDescription: "Skip response schema validation.",
    },
  },
  run: async ({ args }) => {
    try {
      const token = process.env["STRAPI_API_TOKEN"];
      if (token === undefined || token === "") {
        throw new Error("Set STRAPI_API_TOKEN to a token with read access.");
      }
      const specification = JSON.parse(
        await readFile(path.resolve(args.spec), "utf8"),
      ) as DumpOptions["specification"];
      const out = path.resolve(args.out);
      const manifest = await dump({
        specification,
        baseUrl: args.url,
        token,
        out,
        media: args.media,
        validate: args.validate,
      });
      console.log(
        `Documents: ${manifest.entries.length}. Manifest: ${path.join(out, "manifest.json")}`,
      );
    } catch (error: unknown) {
      reportError(error);
    }
  },
});

/**
 * Configure the CLI.
 *
 * @returns The configured CLI command definition.
 */
const createCliCommand = (): CommandDef =>
  defineCommand({
    default: "generate",
    meta: {
      description: "Generate a Strapi OpenAPI specification or dump content.",
      name: "strapi-openapi-spec-generator-cli",
      version: "0.0.1",
    },
    subCommands: {
      dump: dumpCommand,
      generate: defineCommand({
        args: {
          "cache-dir": {
            description:
              "Directory for the compiled typia plugin. Defaults to the user's cache directory.",
            type: "string",
          } as const,
          output: {
            default: "specification.json",
            description: "File to write, relative to the project directory.",
            type: "string",
          } as const,
          project: {
            default: ".",
            description: "Root directory of the Strapi project.",
            type: "positional",
          } as const,
          "server-url": {
            default: "/api",
            description: "The REST prefix of the project (api.rest.prefix).",
            type: "string",
          } as const,
        },
        meta: {
          description:
            "Generate the OpenAPI 3.1 document of a Strapi project's content API.",
          name: "generate",
        },
        run: async ({ args }) => {
          try {
            await generate({
              cacheDirectory: args["cache-dir"],
              output: args.output,
              project: args.project,
              serverUrl: args["server-url"],
            });
          } catch (error: unknown) {
            reportError(error);
          }
        },
      }),
    },
  });

/**
 * Run the CLI command with the provided arguments.
 *
 * @param args - Command line arguments to pass to the CLI.
 * @returns A promise that resolves when the CLI command finishes execution.
 */
const main = async (
  args: string[] = process.argv.slice(ARG_START_INDEX),
): Promise<void> => {
  const command = createCliCommand();
  // Registers the `complete <shell>` subcommand used by the mise enter hooks.
  await tab(command);
  await runMain(command, { rawArgs: args });
};

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}

export { createCliCommand, main };
