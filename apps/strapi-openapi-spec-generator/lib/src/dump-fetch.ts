import type { ValidateFunction } from "ajv";

import addFormats from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { OpenApiDocument } from "./document.js";
import type { PagePosition, PageState } from "./dump-pagination.js";
import type { DumpTarget } from "./dump-query.js";

import { lastPage, pageSize } from "./dump-pagination.js";
import { isUnknownArray, toRecord } from "./json.js";

const httpUrl = /^https?:\/\/[^/]+/iu;

// Check raw segments before WHATWG URL parsing can normalize a traversal away.
const checkedPath = (path: string): string => {
  if (path.includes("//") || /[\\?#{}\s]/u.test(path)) {
    throw new Error("Invalid dump URL path");
  }
  for (const segment of path.split("/")) {
    const decoded = decodeURIComponent(segment);
    if (
      decoded === "." ||
      decoded === ".." ||
      /[/\\?#{}\p{Cc}]|%[\da-f]{2}/iu.test(decoded)
    ) {
      throw new Error("Invalid dump URL path segment or traversal");
    }
  }
  return path.replace(/^\//u, "").replace(/\/$/u, "");
};

const instanceUrl = (baseUrl: string): URL => {
  const authority = httpUrl.exec(baseUrl)?.[0];
  if (
    authority === undefined ||
    /[\\?#\s]/u.test(baseUrl) ||
    authority.includes("@") ||
    !URL.canParse(baseUrl)
  ) {
    throw new Error(
      "Invalid instance URL: expected an HTTP(S) URL without credentials, query, or fragment",
    );
  }
  const installation = checkedPath(baseUrl.slice(authority.length));
  const url = new URL(baseUrl);
  url.pathname = `/${installation}`;
  return url;
};

const serverPrefix = (instance: URL, server: string): string => {
  if (httpUrl.test(server)) {
    const absolute = instanceUrl(server);
    if (absolute.origin !== instance.origin) {
      throw new Error("External specification server origin is not allowed");
    }
    return checkedPath(absolute.pathname);
  }
  if (/^[a-z][\w+.-]*:/iu.test(server)) {
    throw new Error("Invalid specification server URL");
  }
  return checkedPath(server);
};

const endpointUrl = (
  instance: URL,
  spec: OpenApiDocument,
  path: string,
): URL => {
  const server = spec.servers?.[0]?.url;
  if (typeof server !== "string" || !server || !path.startsWith("/")) {
    throw new Error("Invalid specification server URL or operation path");
  }
  const prefix = serverPrefix(instance, server);
  const installation = checkedPath(instance.pathname);
  let root = installation;
  if (!root || prefix.startsWith(`${installation}/`)) {
    root = prefix;
  } else if (prefix && prefix !== root && !root.endsWith(`/${prefix}`)) {
    root += `/${prefix}`;
  }
  const endpoint = new URL(instance);
  endpoint.pathname = `/${[root, checkedPath(path)].filter(Boolean).join("/")}`;
  return endpoint;
};

// A target belongs to one dump plan. Draft and published share its validator;
// a later dump (including one with an edited specification) gets a fresh plan.
const validators = new WeakMap<DumpTarget, ValidateFunction>();
const validatorFor = (
  spec: OpenApiDocument,
  target: DumpTarget,
): ValidateFunction => {
  const existing = validators.get(target);
  if (existing) {
    return existing;
  }
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validator = ajv.compile({
    components: spec.components,
    paths: spec.paths,
    allOf: [target.schema],
  });
  validators.set(target, validator);
  return validator;
};

interface DumpDocument {
  documentId: string;
  document: Record<string, unknown>;
}

const documentEntry = (value: unknown, route: string): DumpDocument => {
  const document = toRecord(value);
  const { documentId } = document;
  if (typeof documentId !== "string" || documentId === "") {
    throw new Error(
      `${route}: expected a document with a nonempty string documentId`,
    );
  }
  return { document, documentId };
};

const requireRecord = (
  value: unknown,
  description: string,
): Record<string, unknown> => {
  const record = toRecord(value);
  if (value !== record) {
    throw new Error(description);
  }
  return record;
};

type FetchArguments = [
  spec: OpenApiDocument,
  target: DumpTarget,
  endpoint: URL,
  token: string,
  status: "draft" | "published",
  validate: boolean,
];

interface PageRequest {
  url: URL;
  collection: boolean;
  token: string;
  route: string;
  validator: ValidateFunction | undefined;
}

interface ResponsePage {
  page: number;
  data: unknown;
  metadata: Record<string, unknown>;
}

const prepareRequest = ([
  spec,
  target,
  endpoint,
  token,
  status,
  validate,
]: FetchArguments): PageRequest => {
  const url = new URL(endpoint);
  url.search = target.query.toString();
  if (target.draftAndPublish) {
    url.searchParams.set("status", status);
  }
  const collection = target.kind === "collectionType";
  if (collection) {
    url.searchParams.set("pagination[pageSize]", String(pageSize));
    url.searchParams.set("pagination[withCount]", "true");
  }
  const validator = validate ? validatorFor(spec, target) : undefined;
  const route = `GET ${url.pathname} (${status})`.replaceAll(
    token,
    "[redacted]",
  );
  return { url, collection, token, route, validator };
};

const validateBody = (
  body: unknown,
  { validator, route, token }: PageRequest,
): void => {
  if (validator !== undefined && !validator(body)) {
    const issue = validator.errors?.[0];
    const path = issue?.instancePath ?? "";
    const detail = `${path === "" ? "/" : path}: ${issue?.message ?? "invalid response"}`;
    throw new Error(
      `${route}: validation failed at ${detail.replaceAll(token, "[redacted]")}`,
    );
  }
};

const notFound = 404;

// Cancelling an error response body is best effort.
const ignoreError = (): void => {
  // Ignore the failure; the status error below is the useful one.
};

const requestPage = async (
  request: PageRequest,
  page: number,
): Promise<ResponsePage | undefined> => {
  const { url, collection, token, route } = request;
  if (collection) {
    url.searchParams.set("pagination[page]", String(page));
  }
  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  }).catch(() => {
    throw new Error(`${route}: request failed`);
  });
  if (!response.ok) {
    await response.body?.cancel().catch(ignoreError);
    if (!collection && response.status === notFound) {
      return undefined;
    }
    throw new Error(`${route}: HTTP ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => {
    throw new Error(`${route}: response is not valid JSON`);
  });
  validateBody(body, request);
  const { data, meta } = toRecord(body);
  const metadata = requireRecord(
    meta,
    `${route}: expected response envelope with meta object`,
  );
  return { page, data, metadata };
};

// The consumer pulls one request at a time so the next page starts only after
// the current page passes validation and all its entries have been consumed.
async function* requestPages(
  request: PageRequest,
): AsyncGenerator<ResponsePage | undefined> {
  for (let page = 1; ; page += 1) {
    yield requestPage(request, page);
  }
}

function* pageDocuments(
  data: unknown[],
  seen: Set<string>,
  { page, route }: PagePosition,
): Generator<DumpDocument> {
  for (const value of data) {
    const entry = documentEntry(value, route);
    if (seen.has(entry.documentId)) {
      throw new Error(`${route}: duplicate documentId on page ${page}`);
    }
    seen.add(entry.documentId);
    yield entry;
  }
}

/**
 * A singleton that returns 404 yields no documents.
 *
 * @yields Each validated document, in response order.
 */
async function* fetchDocuments(
  ...args: FetchArguments
): AsyncGenerator<DumpDocument> {
  const request = prepareRequest(args);
  const { collection, route } = request;
  const seen = new Set<string>();
  const pagination: PageState = {};
  for await (const response of requestPages(request)) {
    if (response === undefined) {
      return;
    }
    const { page, data, metadata } = response;
    if (!collection) {
      yield documentEntry(data, route);
      return;
    }
    if (!isUnknownArray(data)) {
      throw new Error(`${route}: expected data array`);
    }
    const info = requireRecord(
      metadata["pagination"],
      `${route}: expected meta.pagination object`,
    );
    const position = {
      page,
      length: data.length,
      received: seen.size + data.length,
      route,
    };
    const last = lastPage(info, pagination, position);
    yield* pageDocuments(data, seen, position);
    if (last) {
      return;
    }
  }
}

export { endpointUrl, fetchDocuments, instanceUrl };
