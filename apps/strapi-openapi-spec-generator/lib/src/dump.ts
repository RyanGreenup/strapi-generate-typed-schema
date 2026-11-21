import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OpenApiDocument } from "./document.js";
import type { MediaFile } from "./dump-media.js";
import type { DumpTarget } from "./dump-query.js";

import manifest from "../package.json" with { type: "json" };
import { endpointUrl, fetchDocuments, instanceUrl } from "./dump-fetch.js";
import { mediaObjects, saveMedia } from "./dump-media.js";
import { planDump } from "./dump-query.js";
import { isUnknownArray, toRecord } from "./json.js";

type JsonRecord = Record<string, unknown>;

interface DumpOptions {
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
interface DumpManifest {
  formatVersion: 1;
  generatorVersion: string;
  specificationSha256: string;
  baseUrl: string;
  exportedAt: string;
  locales: [];
  entries: Entry[];
  media: MediaFile[];
}

interface TargetPath {
  target: DumpTarget;
  dir: string;
  endpoint: URL;
}
interface DumpState {
  options: DumpOptions;
  input: Pick<DumpOptions, "specification" | "out" | "token">;
  instance: URL;
  entries: Entry[];
  files: Map<string, MediaFile>;
}

const compare = (a: string, b: string): number => Number(a > b) - Number(a < b);
const ordered = (_key: string, value: unknown): unknown => {
  if (value === null || typeof value !== "object" || isUnknownArray(value)) {
    return value;
  }
  const entries = Object.entries(toRecord(value));
  entries.sort(([a], [b]) => compare(a, b));
  return Object.fromEntries(entries);
};
const writeJson = (file: string, value: unknown): Promise<void> =>
  writeFile(file, `${JSON.stringify(value, ordered, 2)}\n`, { flag: "wx" });

async function prepare(out: string): Promise<void> {
  try {
    await mkdir(out);
  } catch (error) {
    if (toRecord(error)["code"] !== "EEXIST") {
      throw error;
    }
    const stats = await lstat(out);
    const existing = stats.isDirectory() ? await readdir(out) : undefined;
    if (existing === undefined || existing.length > 0) {
      throw new Error("Dump output must be a new or empty directory", {
        cause: error,
      });
    }
  }
  const message = "Incomplete dump: no final manifest.\n";
  await writeFile(path.join(out, ".partial"), message, { flag: "wx" });
}

function directory(uid: string): string {
  if (!/^api::[\w-]+\.[\w-]+$/u.test(uid)) {
    throw new Error(`Invalid API model UID: ${uid}`);
  }
  return uid.replace("::", "__");
}

async function writeStatus(
  state: DumpState,
  { target, dir, endpoint }: TargetPath,
  status: Status,
): Promise<void> {
  const { options, input, entries } = state;
  const documents: { documentId: string; document: JsonRecord }[] = [];
  for await (const entry of fetchDocuments(
    input.specification,
    target,
    endpoint,
    input.token,
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
    // oxlint-disable-next-line eslint/no-await-in-loop -- Finish writing each document before processing the next.
    await writeJson(path.join(input.out, file), document);
    entries.push({
      uid: target.uid,
      kind: target.kind,
      documentId,
      // oxlint-disable-next-line unicorn/no-null -- The dump format uses explicit null for unlocalized entries.
      locale: null,
      status,
      file,
    });
    if (options.media ?? false) {
      for (const object of mediaObjects(target.models, target.uid, document)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Complete each media write before deduplicating against it.
        await saveMedia(object, state);
      }
    }
  }
}

async function writeTarget(state: DumpState, route: TargetPath): Promise<void> {
  await mkdir(path.join(state.input.out, route.dir));
  if (route.target.draftAndPublish) {
    await writeStatus(state, route, "draft");
  }
  await writeStatus(state, route, "published");
}

/** Export raw REST documents. Only a completed dump has a manifest. */
async function dump(options: DumpOptions): Promise<DumpManifest> {
  const { specification, out, token } = options;
  if (!/^[\u0021-\u007E]+$/u.test(token)) {
    throw new Error("Dump requires a valid API token");
  }
  const instance = instanceUrl(options.baseUrl);
  const targets = planDump(specification).map((target) => ({
    target,
    dir: directory(target.uid),
    endpoint: endpointUrl(instance, specification, target.path),
  }));
  await prepare(out);
  const entries: Entry[] = [];
  const files = new Map<string, MediaFile>();
  const input = { specification, out, token };
  const state = { options, input, instance, entries, files };
  for (const route of targets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Do not start another target after a failed export.
    await writeTarget(state, route);
  }
  entries.sort(
    (a, b) =>
      compare(a.uid, b.uid) ||
      compare(a.documentId, b.documentId) ||
      compare(a.status, b.status),
  );
  const media = [...files.values()];
  media.sort((a, b) => compare(a.hash, b.hash) || compare(a.file, b.file));
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
    media,
  };
  await writeJson(path.join(out, "manifest.json"), result);
  await unlink(path.join(out, ".partial"));
  return result;
}

export { dump };
export type { DumpManifest, DumpOptions };
