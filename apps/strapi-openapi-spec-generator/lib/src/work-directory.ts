import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ContentType } from "./content-types.js";

import { ERROR_SCHEMA, schemaNames } from "./names.js";

/** Everything `generateSchemas` needs. */
interface SchemasInput {
  /** Directory for the compiled typia plugin and the work directories. */
  cacheDirectory: string;
  contentTypes: ContentType[];
  /** The root directory of the Strapi project. */
  projectDirectory: string;
}

const TYPES_TEMPLATE = fileURLToPath(
  new URL("../templates/rest-types.ts", import.meta.url),
);

/**
 * Write the TypeScript file that typia compiles into the component schemas.
 *
 * Each alias name becomes a schema name, and `RestError` keeps the name it has in the
 * template. The file prints the schemas as one line of JSON.
 *
 * @param contentTypes - The content types to generate schemas for.
 * @returns The source text of the entry file.
 */
const entrySource = (contentTypes: ContentType[]): string => {
  const aliases = contentTypes.flatMap((contentType) => {
    const names = schemaNames(contentType.uid);
    const uid = JSON.stringify(contentType.uid);
    const shared = [
      `type ${names.one} = RestAnyFindOne<${uid}>;`,
      `type ${names.update} = RestUpdateBody<${uid}>;`,
    ];

    // A single type has no list route and no create route.
    return contentType.kind === "singleType"
      ? shared
      : [
          ...shared,
          `type ${names.list} = RestAnyFind<${uid}>;`,
          `type ${names.create} = RestCreateBody<${uid}>;`,
        ];
  });
  const aliasNames = aliases.map((alias) => alias.split(" ")[1] ?? "");

  return [
    'import typia from "typia";',
    'import type { RestAnyFind, RestAnyFindOne, RestCreateBody, RestError, RestUpdateBody } from "./rest-types.ts";',
    "// Declared here so that the file needs no Node.js type package.",
    "declare const process: { stdout: { write(text: string): void } };",
    ...aliases,
    `const generated = typia.json.schemas<[${[...aliasNames, ERROR_SCHEMA].join(", ")}], "3.1">();`,
    String.raw`process.stdout.write("\n" + JSON.stringify(generated.components.schemas ?? {}) + "\n");`,
    "",
  ].join("\n");
};

/**
 * Find the directory of an installed package.
 *
 * @param name - The package name.
 * @param from - A file inside the package that depends on `name`.
 * @returns The directory that holds the package's package.json.
 */
const packageDirectory = (name: string, from: string): string =>
  path.dirname(createRequire(from).resolve(`${name}/package.json`));

/**
 * Check that the project has what the schemas are generated from.
 *
 * @param projectDirectory - The root directory of the Strapi project.
 * @returns The directory of the project's `@strapi/strapi` package.
 * @throws {Error} When the generated types or the Strapi package are missing.
 */
const checkProject = async (projectDirectory: string): Promise<string> => {
  const types = path.join(projectDirectory, "types", "generated");
  try {
    await access(path.join(types, "contentTypes.d.ts"));
  } catch {
    throw new Error(
      `${types}/contentTypes.d.ts does not exist. Run "strapi ts:generate-types" in the project first.`,
    );
  }
  try {
    return packageDirectory(
      "@strapi/strapi",
      path.join(projectDirectory, "package.json"),
    );
  } catch {
    throw new Error(
      `@strapi/strapi is not installed in ${projectDirectory}. Install the project's dependencies first.`,
    );
  }
};

/**
 * Create the directory that the entry file is compiled in.
 *
 * The directory links to three packages, so that the entry file resolves `typia` and the
 * native TypeScript compiler from this library, and `@strapi/strapi` from the project.
 * The project itself is only read.
 *
 * @param input - The project, its content types and the cache directory.
 * @returns The work directory.
 */
const createWorkDirectory = async (input: SchemasInput): Promise<string> => {
  const strapi = await checkProject(input.projectDirectory);
  const parent = path.join(input.cacheDirectory, "work");
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(path.join(parent, "run-"));
  const modules = path.join(work, "node_modules");
  await mkdir(path.join(modules, "@strapi"), { recursive: true });
  const self = import.meta.url;
  const generatedTypes = path.join(
    input.projectDirectory,
    "types",
    "generated",
    "*.d.ts",
  );
  const tsconfig = {
    compilerOptions: {
      module: "NodeNext",
      rewriteRelativeImportExtensions: true,
      skipLibCheck: true,
      strict: true,
      target: "ES2024",
      types: [],
    },
    include: ["./entry.ts", generatedTypes],
  };
  // ttsc finds the typia plugin and the compiler through this manifest.
  const manifest = {
    dependencies: { typescript: "*", typia: "*" },
    private: true,
    type: "module",
  };
  await Promise.all([
    symlink(packageDirectory("typia", self), path.join(modules, "typia")),
    symlink(
      packageDirectory("@typescript/native", self),
      path.join(modules, "typescript"),
    ),
    symlink(strapi, path.join(modules, "@strapi", "strapi")),
    copyFile(TYPES_TEMPLATE, path.join(work, "rest-types.ts")),
    writeFile(path.join(work, "entry.ts"), entrySource(input.contentTypes)),
    writeFile(path.join(work, "tsconfig.json"), JSON.stringify(tsconfig)),
    writeFile(path.join(work, "package.json"), JSON.stringify(manifest)),
  ]);

  return work;
};

export { createWorkDirectory, entrySource, packageDirectory };
export type { SchemasInput };
