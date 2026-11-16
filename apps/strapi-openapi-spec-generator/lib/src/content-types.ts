import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseJsonObject, toOptionalString, toRecord } from "./json.js";

/** One content type of a Strapi project, as declared in its schema.json. */
interface ContentType {
  /** Directory name below src/api that owns the content type. */
  apiName: string;
  /** True when `options.draftAndPublish` is set. */
  draftAndPublish: boolean;
  kind: "collectionType" | "singleType";
  /** True when `pluginOptions.i18n.localized` is set. */
  localized: boolean;
  pluralName: string;
  singularName: string;
  /** For example "api::article.article". */
  uid: string;
}

/**
 * List the directories directly inside a directory.
 *
 * @param directory - The directory to read.
 * @returns The sorted directory names, or an empty list when `directory` does not exist.
 */
const listDirectories = async (directory: string): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

/**
 * Read one content type from its schema.json.
 *
 * @param apiDirectory - The src/api/<apiName> directory.
 * @param name - The directory name of the content type inside content-types/.
 * @returns The content type.
 */
const readContentType = async (
  apiDirectory: string,
  name: string,
): Promise<ContentType> => {
  const file = path.join(apiDirectory, "content-types", name, "schema.json");
  const schema = parseJsonObject(await readFile(file, "utf8"));
  const info = toRecord(schema["info"]);
  const i18n = toRecord(toRecord(schema["pluginOptions"])["i18n"]);
  const apiName = path.basename(apiDirectory);

  return {
    apiName,
    draftAndPublish: toRecord(schema["options"])["draftAndPublish"] === true,
    kind: schema["kind"] === "singleType" ? "singleType" : "collectionType",
    localized: i18n["localized"] === true,
    pluralName: toOptionalString(info["pluralName"]) ?? `${name}s`,
    singularName: toOptionalString(info["singularName"]) ?? name,
    uid: `api::${apiName}.${name}`,
  };
};

/**
 * Read every content type declared below src/api of a Strapi project.
 *
 * @param projectDirectory - The root directory of the Strapi project.
 * @returns The content types, sorted by UID.
 */
const readContentTypes = async (
  projectDirectory: string,
): Promise<ContentType[]> => {
  const apiRoot = path.join(projectDirectory, "src", "api");
  const apiNames = await listDirectories(apiRoot);
  const perApi = await Promise.all(
    apiNames.map(async (apiName) => {
      const apiDirectory = path.join(apiRoot, apiName);
      const names = await listDirectories(
        path.join(apiDirectory, "content-types"),
      );

      return Promise.all(
        names.map((name) => readContentType(apiDirectory, name)),
      );
    }),
  );

  return perApi.flat();
};

export { listDirectories, readContentTypes };
export type { ContentType };
