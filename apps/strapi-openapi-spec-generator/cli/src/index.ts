#!/usr/bin/env node

import type { CommandDef } from "citty";

import tab from "@bomb.sh/tab/citty";
import { defineCommand, runMain } from "citty";

const ARG_START_INDEX = 2;

/**
 * Configure a CLI that prints a user-provided message.
 *
 * @returns The configured CLI command definition.
 */
const createCliCommand = (): CommandDef =>
  defineCommand({
    default: "list",
    meta: {
      description: "CLI to generate Strapi API OpenAPI Spec",
      name: "strapi-openapi-spec-generator-cli",
      version: "0.0.1",
    },
    subCommands: {
      list: defineCommand({
        args: {
          message: {
            default: "hello",
            description: "Message to print.",
            type: "string",
          } as const,
        },
        meta: {
          description: "Run the command.",
          name: "list",
        },
        run: ({ args }) => {
          console.log(args.message);
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
