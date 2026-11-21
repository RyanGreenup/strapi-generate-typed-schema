import type { ValidateFunction } from "ajv";

import addFormats from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { OpenApiDocument } from "./document.js";
import type { DumpTarget } from "./dump-query.js";

import { isUnknownArray, toRecord } from "./json.js";

const pageSize = 100;
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
  return path.replace(/^\/+|\/+$/gu, "");
};

const instanceUrl = (baseUrl: string): URL => {
  const authority = httpUrl.exec(baseUrl)?.[0];
  if (
    !authority ||
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

const endpointUrl = (
  instance: URL,
  spec: OpenApiDocument,
  path: string,
): URL => {
  const server = spec.servers?.[0]?.url;
  if (typeof server !== "string" || !server || !path.startsWith("/")) {
    throw new Error("Invalid specification server URL or operation path");
  }
  let prefix: string;
  if (httpUrl.test(server)) {
    const absolute = instanceUrl(server);
    if (absolute.origin !== instance.origin) {
      throw new Error("External specification server origin is not allowed");
    }
    prefix = checkedPath(absolute.pathname);
  } else {
    if (/^[a-z][\w+.-]*:/iu.test(server)) {
      throw new Error("Invalid specification server URL");
    }
    prefix = checkedPath(server);
  }
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
  if (existing) return existing;
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
  const documentId = document["documentId"];
  if (typeof documentId !== "string" || documentId === "") {
    throw new Error(
      `${route}: expected a document with a nonempty string documentId`,
    );
  }
  return { document, documentId };
};

const numeric = (
  pagination: Record<string, unknown>,
  key: string,
  route: string,
): number | undefined => {
  const value = pagination[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${route}: invalid pagination.${key}`);
  }
  return value;
};

interface PageState {
  size?: number;
  count?: number;
  total?: number;
}

const lastPage = (
  pagination: Record<string, unknown>,
  page: number,
  length: number,
  received: number,
  state: PageState,
  route: string,
): boolean => {
  const reportedPage = numeric(pagination, "page", route);
  const start = numeric(pagination, "start", route);
  const limit = numeric(pagination, "limit", route);
  const size = numeric(pagination, "pageSize", route) ?? limit ?? pageSize;
  const total = numeric(pagination, "total", route) ?? state.total;
  const fromTotal = total === undefined ? undefined : Math.ceil(total / size);
  const count =
    numeric(pagination, "pageCount", route) ?? state.count ?? fromTotal;
  if (
    size === 0 ||
    length > size ||
    (limit !== undefined && limit !== size) ||
    (state.size !== undefined && size !== state.size) ||
    (reportedPage !== undefined && reportedPage !== page) ||
    (start !== undefined && start !== (page - 1) * size)
  ) {
    throw new Error(
      `${route}: inconsistent pagination size or position on page ${page}`,
    );
  }
  if (
    (state.total !== undefined && total !== state.total) ||
    (state.count !== undefined && count !== state.count) ||
    (fromTotal !== undefined &&
      count !== fromTotal &&
      !(total === 0 && count === 1))
  ) {
    throw new Error(`${route}: inconsistent pagination counts on page ${page}`);
  }
  if (
    count !== undefined &&
    (page > Math.max(1, count) ||
      (count === 0 && length > 0) ||
      (length === 0 && !(page === 1 && count <= 1)))
  ) {
    throw new Error(
      `${route}: unexpected data length on pagination page ${page}`,
    );
  }
  const last = count === undefined ? length < size : page >= count;
  if (total !== undefined && (last ? received !== total : received >= total)) {
    throw new Error(`${route}: inconsistent pagination total on page ${page}`);
  }
  state.size = size;
  if (count !== undefined) state.count = count;
  if (total !== undefined) state.total = total;
  return last;
};

const requireRecord = (
  value: unknown,
  description: string,
): Record<string, unknown> => {
  const record = toRecord(value);
  if (value !== record) throw new Error(description);
  return record;
};

async function* fetchDocuments(
  spec: OpenApiDocument,
  target: DumpTarget,
  endpoint: URL,
  token: string,
  status: "draft" | "published",
  validate: boolean,
): AsyncGenerator<DumpDocument> {
  const url = new URL(endpoint);
  url.search = target.query.toString();
  if (target.draftAndPublish) url.searchParams.set("status", status);
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
  const seen = new Set<string>();
  const pagination: PageState = {};
  for (let page = 1; ; page++) {
    if (collection) url.searchParams.set("pagination[page]", String(page));
    const response = await fetch(url.href, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    }).catch(() => {
      throw new Error(`${route}: request failed`);
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (!collection && response.status === 404) return;
      throw new Error(`${route}: HTTP ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => {
      throw new Error(`${route}: response is not valid JSON`);
    });
    if (validator && !validator(body)) {
      const issue = validator.errors?.[0];
      const detail = `${issue?.instancePath || "/"}: ${issue?.message ?? "invalid response"}`;
      throw new Error(
        `${route}: validation failed at ${detail.replaceAll(token, "[redacted]")}`,
      );
    }
    const { data, meta } = toRecord(body);
    const metadata = requireRecord(
      meta,
      `${route}: expected response envelope with meta object`,
    );
    if (!collection) {
      yield documentEntry(data, route);
      return;
    }
    if (!isUnknownArray(data)) throw new Error(`${route}: expected data array`);
    const info = requireRecord(
      metadata["pagination"],
      `${route}: expected meta.pagination object`,
    );
    const last = lastPage(
      info,
      page,
      data.length,
      seen.size + data.length,
      pagination,
      route,
    );
    for (const value of data) {
      const entry = documentEntry(value, route);
      if (seen.has(entry.documentId)) {
        throw new Error(`${route}: duplicate documentId on page ${page}`);
      }
      seen.add(entry.documentId);
      yield entry;
    }
    if (last) return;
  }
}

export { endpointUrl, fetchDocuments, instanceUrl };
