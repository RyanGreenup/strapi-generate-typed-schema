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

import type { ContentType, DiscoveredContentType } from "./content-types.js";
import type { QueryEnums } from "./query-parameters.js";
import type { Model } from "./schema-probes.js";

import { isUnknownArray, parseJsonObject, toRecord } from "./json.js";
import { ERROR_SCHEMA } from "./names.js";
import { modelProbes } from "./schema-probes.js";

interface SchemasInput {
  cacheDirectory: string;
  components: { uid: string; attributes: Record<string, unknown> }[];
  contentTypes: ContentType[];
  projectDirectory: string;
}

// The second compiler pass must instantiate templates with UID literals. Typia
// can otherwise materialize a different object for a conditional generic root.
const discoverySource = ({
  contentTypes,
  components,
}: SchemasInput): string => {
  const owners = [...contentTypes, ...components]
    .map(({ uid }) => JSON.stringify(uid))
    .join(" | ");
  const selectable = contentTypes.map(({ uid }) => {
    const literal = JSON.stringify(uid);
    return `${literal}: typia.reflect.literals<T.SelectableField<${literal}>>()`;
  });
  return String.raw`import typia from "typia";
import type { Modules, UID } from "@strapi/strapi";
import type * as T from "./rest-types.ts";
declare const process: { stdout: { write(text: string): void } };
type Owners = ${owners === "" ? "never" : owners};
type External = Exclude<T.ReachableModels<Owners>, Owners>;
type Related = Extract<External, UID.ContentType>;
const related = typia.reflect.literals<Related | "">().filter(Boolean);
const drafts = typia.reflect.literals<T.DraftModels<Related> | "">().filter(Boolean);
const components = typia.reflect.literals<Extract<External, UID.Component> | "">().filter(Boolean);
const selectable = { ${selectable.join(",\n")} };
const status = typia.reflect.literals<Modules.Documents.Params.PublicationStatus.Kind>();
const publicationFilter = typia.reflect.literals<Modules.Documents.Params.PublicationStatus.PublicationFilterMode>();
process.stdout.write("\n" + JSON.stringify({ related, drafts, components, selectable, status, publicationFilter }) + "\n");
`;
};

const stringList = (value: unknown, label: string): string[] => {
  if (
    !isUnknownArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(
      `Invalid schema discovery output: expected a string list for ${label}`,
    );
  }
  return value;
};

const readDiscovery = (
  { contentTypes, components }: SchemasInput,
  output: string,
): {
  models: Model[];
  contentTypes: DiscoveredContentType[];
  queryEnums: QueryEnums;
} => {
  const discovery = parseJsonObject(output);
  const enumValues = (name: keyof QueryEnums): string[] => {
    const values = stringList(discovery[name], name);
    if (values.length === 0) {
      throw new Error(
        `Invalid schema discovery output: empty enum for ${name}`,
      );
    }
    return values;
  };
  const queryEnums = {
    status: enumValues("status"),
    publicationFilter: enumValues("publicationFilter"),
  };
  const drafts = new Set(stringList(discovery["drafts"], "drafts"));
  const fields = toRecord(discovery["selectable"]);
  const discovered = contentTypes.map((content) => ({
    ...content,
    selectableFields: stringList(fields[content.uid], content.uid).filter(
      (key) => !content.privateAttributes.includes(key),
    ),
  }));
  const models: Model[] = [
    ...discovered.map((content) => ({
      uid: content.uid,
      content,
      drafts: content.draftAndPublish,
    })),
    ...components.map(({ uid }) => ({ uid, component: true, drafts: true })),
    ...stringList(discovery["related"], "related").map((uid) => ({
      uid,
      drafts: drafts.has(uid),
    })),
    ...stringList(discovery["components"], "components").map((uid) => ({
      uid,
      component: true,
      drafts: true,
    })),
  ];
  return { models, contentTypes: discovered, queryEnums };
};

/** Write literal schema probes for the source models and their discovered populated targets. */
const writeSchemaEntry = async (
  work: string,
  models: Model[],
): Promise<void> => {
  const probes = models.flatMap((model) => modelProbes(model));
  probes.push({ type: "T.RestError", identity: { name: ERROR_SCHEMA } });
  const entry = String.raw`import typia from "typia";
import type * as T from "./rest-types.ts";
declare const process: { stdout: { write(text: string): void } };
const generated = typia.json.schemas<[${probes.map(({ type }) => type).join(",\n")}], "3.1">();
const descriptors = ${JSON.stringify(probes.map(({ identity }) => identity))};
const roots = descriptors.map((root, index) => ({ ...root, schema: generated.schemas[index] }));
process.stdout.write("\n" + JSON.stringify({ schemas: generated.components.schemas ?? {}, roots }) + "\n");
`;
  await writeFile(path.join(work, "entry.ts"), entry);
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
  const { projectDirectory, cacheDirectory } = input;
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
    include: ["./entry.ts", "./discovery.ts", "./generated/*.d.ts"],
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
    writeFile(path.join(work, "discovery.ts"), discoverySource(input)),
    writeFile(path.join(work, "tsconfig.json"), JSON.stringify(tsconfig)),
    writeFile(path.join(work, "package.json"), JSON.stringify(manifest)),
  ]);

  return work;
};

export {
  createWorkDirectory,
  packageDirectory,
  readDiscovery,
  writeSchemaEntry,
};
export type { SchemasInput };
