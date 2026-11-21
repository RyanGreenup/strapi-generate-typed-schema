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

import type { ContentType } from "./content-types.js";

import { ERROR_SCHEMA, pascalCase, schemaNames } from "./names.js";

interface SchemasInput {
  cacheDirectory: string;
  contentTypes: ContentType[];
  projectDirectory: string;
}

const entrySource = (contentTypes: ContentType[]): string => {
  const aliases = contentTypes.flatMap(({ uid, kind, draftAndPublish }) => {
    const names = schemaNames(uid);
    const prefix = pascalCase(uid);
    const argument = JSON.stringify(uid);
    const alias = (name: string, generic: string): [string, string] => [
      name,
      `type ${name} = ${generic}<${argument}>;`,
    ];
    const types = [
      alias(`${prefix}Document`, "RestAnyDocument"),
      alias(names.one, "RestAnyFindOne"),
      alias(names.update, "RestUpdateBody"),
      alias(`${prefix}PublishedUpdateRequest`, "RestPublishedUpdateBody"),
    ];
    if (draftAndPublish) {
      types.push(alias(`${prefix}DraftUpdateRequest`, "RestDraftUpdateBody"));
    }
    if (kind !== "singleType") {
      types.push(
        alias(names.list, "RestAnyFind"),
        alias(names.create, "RestCreateBody"),
        alias(`${prefix}PublishedCreateRequest`, "RestPublishedCreateBody"),
      );
      if (draftAndPublish) {
        types.push(alias(`${prefix}DraftCreateRequest`, "RestDraftCreateBody"));
      }
    }
    return types;
  });
  const names = [...aliases.map(([name]) => name), ERROR_SCHEMA];
  return String.raw`import typia from "typia";
import type { RestAnyDocument, RestAnyFind, RestAnyFindOne, RestCreateBody, RestDraftCreateBody, RestDraftUpdateBody, RestPublishedCreateBody, RestPublishedUpdateBody, RestError, RestUpdateBody } from "./rest-types.ts";
// Declared here so that the file needs no Node.js type package.
declare const process: { stdout: { write(text: string): void } };
${aliases.map(([, declaration]) => declaration).join("\n")}
const generated = typia.json.schemas<[${names.join(", ")}], "3.1">();
const schemas = generated.components.schemas ?? {};
const names = ${JSON.stringify(names)};
// Keep public aliases when typia emits a union inline; referenced state objects are renamed.
for (const [index, name] of names.entries()) {
  const schema = generated.schemas[index]!;
  if (!("$ref" in schema)) schemas[name] ??= schema;
}
process.stdout.write("\n" + JSON.stringify(schemas) + "\n");
`;
};

/** Resolve dependencies relative to the generator or the consuming Strapi project. */
const packageDirectory = (
  name: string,
  from: string = import.meta.url,
): string => path.dirname(createRequire(from).resolve(`${name}/package.json`));

const checkProject = async (projectDirectory: string): Promise<string> => {
  const types = path.join(
    projectDirectory,
    "types/generated/contentTypes.d.ts",
  );
  try {
    await access(types);
  } catch {
    throw new Error(
      `${types} does not exist. Run "strapi ts:generate-types" in the project first.`,
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
 * Stage the compiler beside its dependencies without changing the Strapi project.
 * @param input - Project, content types and writable compiler cache.
 * @returns A temporary directory that the caller must remove.
 * @throws If dependencies, generated declarations or cache access are missing.
 */
const createWorkDirectory = async (input: SchemasInput): Promise<string> => {
  const { projectDirectory, cacheDirectory, contentTypes } = input;
  const strapi = await checkProject(projectDirectory);
  const parent = path.join(cacheDirectory, "work");
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(path.join(parent, "run-"));
  const modules = path.join(work, "node_modules");
  await mkdir(path.join(modules, "@strapi"), { recursive: true });
  const tsconfig = {
    compilerOptions: {
      module: "NodeNext",
      rewriteRelativeImportExtensions: true,
      skipLibCheck: true,
      strict: true,
      target: "ES2024",
      types: [],
    },
    include: [
      "./entry.ts",
      path.join(projectDirectory, "types/generated/*.d.ts"),
    ],
  };
  // ttsc finds the typia plugin and the compiler through this manifest.
  const manifest = {
    dependencies: { typescript: "*", typia: "*" },
    private: true,
    type: "module",
  };
  await Promise.all([
    symlink(packageDirectory("typia"), path.join(modules, "typia")),
    symlink(
      packageDirectory("@typescript/native"),
      path.join(modules, "typescript"),
    ),
    symlink(strapi, path.join(modules, "@strapi", "strapi")),
    copyFile(
      new URL("../templates/rest-types.ts", import.meta.url),
      path.join(work, "rest-types.ts"),
    ),
    writeFile(path.join(work, "entry.ts"), entrySource(contentTypes)),
    writeFile(path.join(work, "tsconfig.json"), JSON.stringify(tsconfig)),
    writeFile(path.join(work, "package.json"), JSON.stringify(manifest)),
  ]);

  return work;
};

export { createWorkDirectory, packageDirectory };
export type { SchemasInput };
