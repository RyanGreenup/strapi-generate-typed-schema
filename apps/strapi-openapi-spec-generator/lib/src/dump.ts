import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { OpenApiDocument } from "./document.js";

import manifest from "../package.json" with { type: "json" };
import { endpointUrl, fetchDocuments, instanceUrl } from "./dump-fetch.js";
import { planDump, type ModelMetadata } from "./dump-query.js";
import { toRecord } from "./json.js";

export interface DumpOptions {
  specification: OpenApiDocument;
  baseUrl: string;
  token: string;
  out: string;
  media?: boolean;
  validate?: boolean;
}

type Status = "draft" | "published";
interface Entry {
  uid: string;
  kind: "collectionType" | "singleType";
  documentId: string;
  locale: null;
  status: Status;
  file: string;
}
interface MediaFile {
  hash: string;
  file: string;
}
export interface DumpManifest {
  formatVersion: 1;
  generatorVersion: string;
  specificationSha256: string;
  baseUrl: string;
  exportedAt: string;
  locales: [];
  entries: Entry[];
  media: MediaFile[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ordered = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(toRecord(value)).sort(([a], [b]) => compare(a, b)),
  );
};
const writeJson = (file: string, value: unknown) =>
  writeFile(file, `${JSON.stringify(value, ordered, 2)}\n`, { flag: "wx" });

async function prepare(out: string): Promise<void> {
  try {
    await mkdir(out);
  } catch (error) {
    if (toRecord(error)["code"] !== "EEXIST") throw error;
    if (!(await lstat(out)).isDirectory() || (await readdir(out)).length) {
      throw new Error("Dump output must be a new or empty directory");
    }
  }
  await writeFile(
    path.join(out, ".partial"),
    "Incomplete dump: no final manifest.\n",
    { flag: "wx" },
  );
}

function directory(uid: string): string {
  if (!/^api::[\w-]+\.[\w-]+$/u.test(uid))
    throw new Error(`Invalid API model UID: ${uid}`);
  return uid.replace("::", "__");
}

function* mediaObjects(
  models: ReadonlyMap<string, ModelMetadata>,
  uid: string,
  document: Record<string, unknown>,
): Generator<Record<string, unknown>> {
  const model = models.get(uid);
  if (!model) throw new Error(`Missing media traversal metadata: ${uid}`);
  for (const [name, field] of Object.entries(model.fields)) {
    if (!Object.hasOwn(document, name)) continue;
    const value = document[name];
    if (
      value == null ||
      !["component", "dynamiczone", "media"].includes(field.kind)
    )
      continue;
    const many =
      field.kind === "dynamiczone" ||
      (field.kind === "media" && field.multiple) ||
      (field.kind === "component" && field.repeatable);
    if (many !== Array.isArray(value))
      throw new Error(`Invalid populated field ${uid}.${name}`);
    for (const item of many ? (value as unknown[]) : [value]) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error(`Invalid populated field ${uid}.${name}`);
      const object = toRecord(item);
      if (field.kind === "media") yield object;
      if (field.kind === "component")
        yield* mediaObjects(models, field.component, object);
      if (field.kind === "dynamiczone") {
        const component = object["__component"];
        if (
          typeof component !== "string" ||
          !field.components.includes(component)
        )
          throw new Error(`Invalid dynamic zone variant at ${uid}.${name}`);
        yield* mediaObjects(models, component, object);
      }
    }
  }
}

async function saveMedia(
  object: Record<string, unknown>,
  instance: URL,
  options: DumpOptions,
  files: Map<string, MediaFile>,
): Promise<void> {
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
  )
    throw new Error("Invalid media URL");
  const file = `media/${hash}${ext}`;
  if (files.has(file)) return;
  if (!files.size) await mkdir(path.join(options.out, "media"));
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

/** Export raw REST documents. Only a completed dump has a manifest. */
export async function dump(options: DumpOptions): Promise<DumpManifest> {
  const { specification, out, token } = options;
  if (!/^[\x21-\x7e]+$/u.test(token))
    throw new Error("Dump requires a valid API token");
  const instance = instanceUrl(options.baseUrl);
  const targets = planDump(specification).map((target) => ({
    target,
    dir: directory(target.uid),
    endpoint: endpointUrl(instance, specification, target.path),
  }));
  await prepare(out);
  const entries: Entry[] = [];
  const files = new Map<string, MediaFile>();
  for (const { target, dir, endpoint } of targets) {
    await mkdir(path.join(out, dir));
    const statuses: Status[] = target.draftAndPublish
      ? ["draft", "published"]
      : ["published"];
    for (const status of statuses) {
      const documents: {
        documentId: string;
        document: Record<string, unknown>;
      }[] = [];
      for await (const entry of fetchDocuments(
        specification,
        target,
        endpoint,
        token,
        status,
        options.validate ?? true,
      )) {
        documents.push(entry);
      }
      documents.sort((a, b) => compare(a.documentId, b.documentId));
      for (const { documentId, document } of documents) {
        const stem =
          target.kind === "singleType"
            ? "single"
            : encodeURIComponent(documentId)
                .replaceAll(".", "%2E")
                .replaceAll("~", "%7E");
        const file = `${dir}/${stem}.~.${status}.json`;
        await writeJson(path.join(out, file), document);
        entries.push({
          uid: target.uid,
          kind: target.kind,
          documentId,
          locale: null,
          status,
          file,
        });
        if (options.media) {
          for (const object of mediaObjects(
            target.models,
            target.uid,
            document,
          ))
            await saveMedia(object, instance, options, files);
        }
      }
    }
  }
  entries.sort(
    (a, b) =>
      compare(a.uid, b.uid) ||
      compare(a.documentId, b.documentId) ||
      compare(a.status, b.status),
  );
  const result: DumpManifest = {
    formatVersion: 1,
    generatorVersion: manifest.version,
    specificationSha256: createHash("sha256")
      .update(JSON.stringify(specification, ordered))
      .digest("hex"),
    baseUrl: instance.href.replace(/\/$/u, ""),
    exportedAt: new Date().toISOString(),
    locales: [],
    entries,
    media: [...files.values()].sort(
      (a, b) => compare(a.hash, b.hash) || compare(a.file, b.file),
    ),
  };
  await writeJson(path.join(out, "manifest.json"), result);
  await unlink(path.join(out, ".partial"));
  return result;
}
