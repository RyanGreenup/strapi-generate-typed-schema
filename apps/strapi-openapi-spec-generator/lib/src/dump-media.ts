import { mkdir, open } from "node:fs/promises";
import path from "node:path";

import type { ModelMetadata } from "./dump-query.js";
import type { ModelField } from "./model-metadata.js";

import { isUnknownArray, toRecord } from "./json.js";

type JsonRecord = Record<string, unknown>;

interface MediaFile {
  hash: string;
  file: string;
}

interface MediaState {
  instance: URL;
  options: { out: string; token: string };
  files: Map<string, MediaFile>;
}

type PopulatedKind = "component" | "dynamiczone" | "media";
type PopulatedField = Extract<ModelField, { kind: PopulatedKind }>;

function populatedItems(
  value: unknown,
  field: PopulatedField,
  location: string,
): unknown[] {
  const many =
    field.kind === "dynamiczone" ||
    (field.kind === "media" ? field.multiple : field.repeatable);
  const array = isUnknownArray(value);
  if (many !== array) {
    throw new Error(`Invalid populated field ${location}`);
  }
  return array ? value : [value];
}

function* fieldMedia(
  models: ReadonlyMap<string, ModelMetadata>,
  field: PopulatedField,
  { value, location }: { value: unknown; location: string },
): Generator<JsonRecord> {
  for (const item of populatedItems(value, field, location)) {
    const object = toRecord(item);
    // Reject values for which toRecord returned its fallback object.
    if (object !== item) {
      throw new Error(`Invalid populated field ${location}`);
    }
    switch (field.kind) {
      case "media": {
        yield object;
        break;
      }
      case "component": {
        yield* mediaObjects(models, field.component, object);
        break;
      }
      case "dynamiczone": {
        const tag = object["__component"];
        if (typeof tag !== "string" || !field.components.includes(tag)) {
          throw new Error(`Invalid dynamic zone variant at ${location}`);
        }
        yield* mediaObjects(models, tag, object);
        break;
      }
      default: {
        throw new Error(`Unsupported populated field at ${location}`);
      }
    }
  }
}

/**
 * Walk a document using model metadata and collect populated media objects.
 *
 * @param models - Model metadata keyed by UID, used to find media fields.
 * @param uid - UID of the model that `document` belongs to.
 * @param document - The populated document or component to search.
 * @yields Each populated media object, including those in components and dynamic zones.
 */
function* mediaObjects(
  models: ReadonlyMap<string, ModelMetadata>,
  uid: string,
  document: JsonRecord,
): Generator<JsonRecord> {
  const model = models.get(uid);
  if (model === undefined) {
    throw new Error(`Missing media traversal metadata: ${uid}`);
  }
  for (const [name, field] of Object.entries(model.fields)) {
    const value = Object.hasOwn(document, name) ? document[name] : undefined;
    if (
      value !== undefined &&
      value !== null &&
      (field.kind === "component" ||
        field.kind === "dynamiczone" ||
        field.kind === "media")
    ) {
      yield* fieldMedia(models, field, { value, location: `${uid}.${name}` });
    }
  }
}

const mediaSource = (
  object: JsonRecord,
  instance: URL,
): { hash: string; file: string; address: URL } => {
  const { hash, ext, url } = object;
  if (
    typeof hash !== "string" ||
    !/^[\w-]+$/u.test(hash) ||
    typeof ext !== "string" ||
    !/^\.[a-z\d]+$/iu.test(ext) ||
    typeof url !== "string" ||
    !url.trim()
  ) {
    throw new Error("Populated media requires a safe hash, ext and URL");
  }
  const address = URL.parse(url, instance.origin);
  if (
    !address ||
    !["http:", "https:"].includes(address.protocol) ||
    address.username ||
    address.password
  ) {
    throw new Error("Invalid media URL");
  }
  return { hash, file: `media/${hash}${ext}`, address };
};

/**
 * Download one media file into `media/` under the output directory, once per file name.
 *
 * @param object - The populated media object with `hash`, `ext` and `url`.
 * @param state - Instance URL, output options and the files written so far.
 * @returns A promise that settles when the file is written or was already present.
 */
async function saveMedia(object: JsonRecord, state: MediaState): Promise<void> {
  const { instance, options, files } = state;
  const { hash, file, address } = mediaSource(object, instance);
  if (files.has(file)) {
    return;
  }
  if (files.size === 0) {
    await mkdir(path.join(options.out, "media"));
  }
  const response = await fetch(address, {
    headers:
      address.origin === instance.origin
        ? { Authorization: `Bearer ${options.token}` }
        : {},
    redirect: "manual",
  }).catch(() => {
    throw new Error(`GET ${file}: request failed`);
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`GET ${file}: HTTP ${response.status}`);
  }
  const handle = await open(path.join(options.out, file), "wx");
  try {
    await handle.writeFile(response.body);
  } finally {
    await handle.close();
  }
  files.set(file, { hash, file });
}

export { mediaObjects, saveMedia };
export type { MediaFile, MediaState };
