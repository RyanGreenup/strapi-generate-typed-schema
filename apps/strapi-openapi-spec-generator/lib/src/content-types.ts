import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  isUnknownArray,
  parseJsonObject,
  toOptionalString,
  toRecord,
} from "./json.js";

/** One content type of a Strapi project, as declared in its schema.json. */
interface ContentType {
  apiName: string;
  attributes: Record<string, unknown>;
  draftAndPublish: boolean;
  kind: "collectionType" | "singleType";
  localized: boolean;
  pluralName: string;
  privateAttributes: string[];
  singularName: string;
  uid: string;
}

interface DiscoveredContentType extends ContentType {
  selectableFields: string[];
}

/** Return sorted child directory names, or none if the directory cannot be read. */
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

/** Read all APIs in directory order, including APIs without content types. */
const readApis = async <T>(
  projectDirectory: string,
  readApi: (directory: string, apiName: string) => Promise<T[]>,
): Promise<T[]> => {
  const root = path.join(projectDirectory, "src", "api");
  const names = await listDirectories(root);
  const groups = await Promise.all(
    names.map((name) => readApi(path.join(root, name), name)),
  );
  return groups.flat();
};

const readContentType = async (
  directory: string,
  apiName: string,
  name: string,
): Promise<ContentType> => {
  const file = path.join(directory, name, "schema.json");
  const schema = parseJsonObject(await readFile(file, "utf8"));
  const info = toRecord(schema["info"]);
  const i18n = toRecord(toRecord(schema["pluginOptions"])["i18n"]);
  const options = toRecord(schema["options"]);
  const { privateAttributes } = options;

  return {
    apiName,
    attributes: toRecord(schema["attributes"]),
    draftAndPublish: options["draftAndPublish"] === true,
    kind: schema["kind"] === "singleType" ? "singleType" : "collectionType",
    localized: i18n["localized"] === true,
    pluralName: toOptionalString(info["pluralName"]) ?? `${name}s`,
    privateAttributes: isUnknownArray(privateAttributes)
      ? privateAttributes.filter((attribute) => typeof attribute === "string")
      : [],
    singularName: toOptionalString(info["singularName"]) ?? name,
    uid: `api::${apiName}.${name}`,
  };
};

/** Read content-type schema.json files without loading the project. */
const readContentTypes = (projectDirectory: string): Promise<ContentType[]> =>
  readApis(projectDirectory, async (directory, apiName) => {
    const models = path.join(directory, "content-types");
    const names = await listDirectories(models);
    return Promise.all(
      names.map((name) => readContentType(models, apiName, name)),
    );
  });

export { listDirectories, readApis, readContentTypes };
export type { ContentType, DiscoveredContentType };
