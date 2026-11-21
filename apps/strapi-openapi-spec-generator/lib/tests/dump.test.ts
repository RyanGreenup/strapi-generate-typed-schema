import type { Mock } from "vitest";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenApiDocument } from "../src/document.js";
import type { DumpManifest, DumpOptions } from "../src/index.js";

import { dump } from "../src/index.js";
import { isUnknownArray, parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

const baseUrl = "https://cms.example/install";
const token = "test-only-bearer-secret";
const article = "api::article.article";
const pageUid = "api::page.page";
const timestamp = "2025-05-01T12:34:56.000Z";
const articlesPath = "/install/api/articles";
const pagesPath = "/install/api/pages";
// Strapi sends null for unpublished timestamps; the dump writes null locales.
// oxlint-disable-next-line unicorn/no-null
const wireNull = null;

type Entry = DumpManifest["entries"][number];
type PublicationStatus = Entry["status"];

/** Complete the source models in the isolated fixture, as a real export requires. */
const customize = async (directory: string): Promise<void> => {
  const modelFile = (name: string): string =>
    path.join(directory, `src/api/${name}/content-types/${name}/schema.json`);
  const load = async (name: string): Promise<Record<string, unknown>> =>
    parseJsonObject(await readFile(modelFile(name), "utf8"));
  const model = await load("article");
  Object.assign(toRecord(model["attributes"]), {
    registeredCount: { type: "integer" },
    registeredPrice: { type: "decimal" },
    registeredFlag: { type: "boolean" },
    registeredData: { type: "json" },
    registeredKey: { type: "string" },
    registeredMedia: { type: "media", multiple: false },
    runtimeDefault: { type: "string" },
  });
  const fields = toRecord(model["attributes"]);
  Object.assign(toRecord(fields["page"]), {
    inversedBy: "articles",
    pluginOptions: { site: { populate: "title" } },
  });
  const page = await load("page");
  delete page["pluginOptions"];
  Object.assign(toRecord(page["attributes"]), {
    plugin$date: { type: "datetime" },
    pluginJson: { type: "json" },
    pluginComponent: {
      type: "component",
      component: "shared.seo",
      repeatable: false,
    },
    articles: {
      type: "relation",
      relation: "oneToMany",
      target: article,
      mappedBy: "page",
    },
  });
  const single = await load("site-setting");
  single["options"] = { draftAndPublish: true };
  const declarations = path.join(
    directory,
    "types/generated/contentTypes.d.ts",
  );
  const types = await readFile(declarations, "utf8");
  await Promise.all([
    writeFile(modelFile("article"), JSON.stringify(model)),
    writeFile(modelFile("page"), JSON.stringify(page)),
    writeFile(modelFile("site-setting"), JSON.stringify(single)),
    writeFile(
      declarations,
      types
        .replace(
          "    pluginComponent:",
          `    articles: Schema.Attribute.Relation<"oneToMany", "${article}">;\n    pluginComponent:`,
        )
        .replace(
          "draftAndPublish: false };\n  attributes: { siteName:",
          "draftAndPublish: true };\n  attributes: { siteName:",
        ),
    ),
  ]);
};

const sorted = (value: unknown): unknown => {
  if (isUnknownArray(value)) {
    return value.map((item) => sorted(item));
  }
  if (value === wireNull || typeof value !== "object") {
    return value;
  }
  const record = toRecord(value);
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, sorted(record[key])]),
  );
};

const jsonText = (value: unknown): string =>
  `${JSON.stringify(sorted(value), undefined, 2)}\n`;

const readJson = async (file: string | URL): Promise<Record<string, unknown>> =>
  parseJsonObject(await readFile(file, "utf8"));

const readTexts = (
  directory: string,
  files: readonly string[],
): Promise<string[]> =>
  Promise.all(
    files.map((file) => readFile(path.join(directory, file), "utf8")),
  );

const manifestFile = (directory: string): string =>
  path.join(directory, "manifest.json");

const stubFetch = (
  respond: (url: URL, request: Request) => Response | Promise<Response>,
): Mock<typeof fetch> => {
  const mock = vi.fn<typeof fetch>((input, init) => {
    const request = new Request(input, init);
    return Promise.resolve(respond(new URL(request.url), request));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

const stubResponses = (
  key: (url: URL) => string,
  replies: Readonly<Partial<Record<string, () => Response>>>,
): Mock<typeof fetch> =>
  stubFetch((url) => {
    const reply = replies[key(url)];
    assert.ok(reply !== undefined, `Unexpected GET ${url.href}`);
    return reply();
  });

const sentRequests = (mock: Mock<typeof fetch>): Request[] =>
  mock.mock.calls.map(([input, init]) => new Request(input, init));

const pageResponse = (
  data: readonly object[],
  pagination?: Readonly<Record<string, number>>,
): Response =>
  Response.json({
    data,
    meta: {
      pagination: pagination ?? {
        page: 1,
        pageSize: 100,
        pageCount: Number(data.length > 0),
      },
    },
  });

const statusKey = (url: URL): string => url.searchParams.get("status") ?? "";
const pageKey = (url: URL): string =>
  url.searchParams.get("pagination[page]") ?? "";
const pathKey = (url: URL): string => url.pathname;

const stubArticle = (published: readonly object[]): Mock<typeof fetch> =>
  stubResponses((url) => `${url.pathname} ${statusKey(url)}`, {
    [`${articlesPath} draft`]: () => pageResponse([]),
    [`${articlesPath} published`]: () => pageResponse(published),
  });

const localMedia = {
  id: 90,
  documentId: "upload-local",
  hash: "zzz_local",
  ext: ".png",
  url: "/uploads/banner.png",
};
const cdnMedia = {
  id: 91,
  documentId: "upload-remote",
  hash: "aaa_remote",
  ext: ".jpg",
  url: "https://assets.example/card.jpg",
};

interface ArticleDocument {
  title: string;
  id: number;
  publishedAt: string | null;
  updatedAt: string;
  documentId: string;
  page: { documentId: string; id: number };
  seo: { id: number; heading: string }[];
  cover: typeof localMedia;
  blocks: (
    | { id: number; __component: "shared.seo"; heading: string }
    | {
        id: number;
        __component: "shared.conditional-link";
        kind: "internal";
        attachment: typeof cdnMedia;
      }
  )[];
}

const document = (documentId: string, published: boolean): ArticleDocument => ({
  title: "Article",
  id: published ? 20 : 21,
  publishedAt: published ? timestamp : wireNull,
  updatedAt: timestamp,
  documentId,
  page: { documentId: "home", id: 24 },
  seo: [{ id: 30, heading: "News" }],
  cover: localMedia,
  blocks: [
    { id: 31, __component: "shared.seo", heading: "World" },
    {
      id: 32,
      __component: "shared.conditional-link",
      kind: "internal",
      attachment: cdnMedia,
    },
  ],
});

const entry = (documentId: string, status: PublicationStatus): Entry => ({
  uid: article,
  kind: "collectionType",
  documentId,
  status,
  locale: wireNull,
  file: `api__article.article/${encodeURIComponent(documentId)}.~.${status}.json`,
});

const models = (
  spec: OpenApiDocument,
  uid: string,
): Record<string, unknown>[] => {
  const result = Object.values(spec.components.schemas)
    .map((schema) => toRecord(schema["x-strapi-model"]))
    .filter((model) => model["uid"] === uid);
  assert.ok(result.length > 0, `Missing fixture metadata for ${uid}`);
  return result;
};

const exportRequestKey = (url: URL): string =>
  url.pathname === articlesPath
    ? `${articlesPath} ${statusKey(url)} ${pageKey(url)}`
    : url.pathname;

const articlePage = (
  documentId: string,
  published: boolean,
  pagination: Readonly<Record<string, number>>,
): Response => pageResponse([document(documentId, published)], pagination);

const stubFullExport = (): Mock<typeof fetch> =>
  stubResponses(exportRequestKey, {
    [pagesPath]: () => pageResponse([{ id: 24, documentId: "home" }]),
    // The server caps its page size. Draft supplies pageCount; published supplies only total.
    [`${articlesPath} draft 1`]: () =>
      articlePage("z page", false, { page: 1, pageSize: 1, pageCount: 2 }),
    [`${articlesPath} draft 2`]: () =>
      articlePage("alpha", false, { page: 2, pageSize: 1, pageCount: 2 }),
    [`${articlesPath} published 1`]: () =>
      articlePage("z page", true, { page: 1, pageSize: 1, total: 2 }),
    [`${articlesPath} published 2`]: () =>
      articlePage("alpha", true, { page: 2, pageSize: 1, total: 2 }),
    [localMedia.url]: () => new Response("local file"),
    [new URL(cdnMedia.url).pathname]: () => new Response("remote file"),
  });

const articlePopulation = {
  "populate[page][fields][0]": "documentId",
  "populate[cover]": "true",
  "populate[seo]": "true",
  "populate[link][populate][attachment]": "true",
  "populate[blocks][on][shared.seo][populate]": "*",
  "populate[blocks][on][shared.conditional-link][populate][attachment]": "true",
};

const describeRequest = (request: Request, url: URL): object => {
  const authorization = request.headers.get("authorization");
  const { searchParams } = url;
  const { method } = request;
  if (url.pathname === articlesPath || url.pathname === pagesPath) {
    const collection = {
      method,
      origin: url.origin,
      authorization,
      pageSize: searchParams.get("pagination[pageSize]"),
      withCount: searchParams.get("pagination[withCount]"),
    };
    if (url.pathname === pagesPath) {
      return {
        ...collection,
        hasStatus: searchParams.has("status"),
        populatesInverseArticles: [...searchParams.keys()].some((key) =>
          key.startsWith("populate[articles]"),
        ),
      };
    }
    return {
      ...collection,
      selectsTitle: [...searchParams.values()].includes("title"),
      populate: Object.fromEntries(
        Object.keys(articlePopulation).map((key) => [
          key,
          searchParams.get(key),
        ]),
      ),
    };
  }
  return { method, url: url.href, authorization };
};

const exportRequests = (mock: Mock<typeof fetch>): [string, object][] =>
  sentRequests(mock)
    .map((request) => {
      const url = new URL(request.url);
      return [exportRequestKey(url), describeRequest(request, url)] satisfies [
        string,
        object,
      ];
    })
    .toSorted(([left], [right]) => left.localeCompare(right));

const authenticatedGet = {
  method: "GET",
  authorization: `Bearer ${token}`,
};
const collectionGet = {
  ...authenticatedGet,
  origin: "https://cms.example",
  pageSize: "100",
  withCount: "true",
};
const articleGet = {
  ...collectionGet,
  selectsTitle: false,
  populate: articlePopulation,
};
const expectedExportRequests = [
  [
    new URL(cdnMedia.url).pathname,
    { method: "GET", url: cdnMedia.url, authorization: wireNull },
  ],
  [`${articlesPath} draft 1`, articleGet],
  [`${articlesPath} draft 2`, articleGet],
  [`${articlesPath} published 1`, articleGet],
  [`${articlesPath} published 2`, articleGet],
  [
    pagesPath,
    { ...collectionGet, hasStatus: false, populatesInverseArticles: false },
  ],
  [
    localMedia.url,
    { ...authenticatedGet, url: "https://cms.example/uploads/banner.png" },
  ],
] satisfies [string, object][];

const invalidArticle = {
  id: 1,
  documentId: "bad",
  publishedAt: timestamp,
  title: 42,
};

const duplicateRow = { id: 1, documentId: "duplicate" };
const unsafeMediaDiagnostic =
  "Populated media requires a safe hash, ext and URL";

interface InvalidSpecification {
  problem: string;
  change: (specification: OpenApiDocument) => void;
  diagnostic: string;
}

const pageGet = (specification: OpenApiDocument): Record<string, unknown> => {
  const operation = specification.paths["/pages"]?.["get"];
  assert.ok(operation !== undefined, "Missing fixture GET /pages");
  return operation;
};

const invalidSpecifications: readonly InvalidSpecification[] = [
  {
    problem: "localized model",
    change(specification) {
      toRecord(pageGet(specification)["x-strapi-dump"])["localized"] = true;
      for (const model of models(specification, pageUid)) {
        model["localized"] = true;
      }
    },
    diagnostic: `Cannot dump localized model ${pageUid}`,
  },
  {
    problem: "unknown field",
    change(specification) {
      for (const model of models(specification, pageUid)) {
        toRecord(model["fields"])["pluginComponent"] = { kind: "unknown" };
      }
    },
    diagnostic: `Unknown model field ${pageUid}.pluginComponent`,
  },
  {
    problem: "component cycle",
    change(specification) {
      for (const model of models(specification, "shared.seo")) {
        toRecord(model["fields"])["heading"] = {
          kind: "component",
          component: "shared.seo",
          repeatable: false,
        };
      }
    },
    diagnostic: "Component cycle in dump populate",
  },
  {
    problem: "missing model metadata",
    change(specification) {
      for (const schema of Object.values(specification.components.schemas)) {
        if (toRecord(schema["x-strapi-model"])["uid"] === pageUid) {
          delete schema["x-strapi-model"];
        }
      }
    },
    diagnostic: `Missing x-strapi-model metadata for ${pageUid}`,
  },
  {
    problem: "duplicate marker",
    change(specification) {
      specification.paths["/extra-pages"] = { get: pageGet(specification) };
    },
    diagnostic: `Duplicate x-strapi-dump marker for ${pageUid}`,
  },
  {
    problem: "response UID mismatch",
    change(specification) {
      const operation = pageGet(specification);
      operation["responses"] =
        specification.paths["/articles"]?.["get"]?.["responses"];
    },
    diagnostic: `Inconsistent x-strapi-model identity or flags: expected ${pageUid}`,
  },
];

describe("dump", () => {
  const fixture = generatedFixture(customize);
  const temporary = { directory: "" };

  // Keep the real response envelopes and refs, but give each test a private spec.
  const options = (...routes: string[]): DumpOptions => {
    assert.ok(
      fixture.document !== undefined,
      "Missing generated specification",
    );
    assert.ok(temporary.directory !== "", "Missing test output directory");
    const specification = structuredClone(fixture.document);
    specification.paths = Object.fromEntries(
      routes.map((route) => {
        const operations = specification.paths[route];
        assert.ok(operations !== undefined, `Missing fixture route ${route}`);
        return [route, operations];
      }),
    );
    return {
      specification,
      baseUrl,
      token,
      out: path.join(temporary.directory, "dump"),
    };
  };

  beforeEach(async () => {
    temporary.directory = await mkdtemp(path.join(os.tmpdir(), "strapi-dump-"));
    stubFetch(() => {
      throw new Error("Unexpected fetch");
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (temporary.directory !== "") {
      await rm(temporary.directory, { force: true, recursive: true });
      temporary.directory = "";
    }
  });

  it("exports both publication states and all pages, preserving nested rows and original media references", async () => {
    // Route order, page order and upload encounter order deliberately differ from manifest order.
    const input = options(
      "/pages",
      "/articles",
      "/health",
      "/pages/{id}/preview",
    );
    const mock = stubFullExport();
    const manifest = await dump({ ...input, media: true });
    expect(exportRequests(mock)).toStrictEqual(expectedExportRequests);
    const articleEntries = [
      entry("alpha", "draft"),
      entry("alpha", "published"),
      entry("z page", "draft"),
      entry("z page", "published"),
    ];
    const entries = [
      ...articleEntries,
      {
        uid: pageUid,
        kind: "collectionType",
        documentId: "home",
        locale: wireNull,
        status: "published",
        file: "api__page.page/home.~.published.json",
      },
    ];
    const pkg = await readJson(new URL("../package.json", import.meta.url));
    const specification = JSON.stringify(sorted(input.specification));
    const { exportedAt, ...metadata } = manifest;
    expect(metadata).toStrictEqual({
      formatVersion: 1,
      generatorVersion: pkg["version"],
      specificationSha256: createHash("sha256")
        .update(specification)
        .digest("hex"),
      baseUrl,
      locales: [],
      entries,
      media: [
        { hash: cdnMedia.hash, file: "media/aaa_remote.jpg" },
        { hash: localMedia.hash, file: "media/zzz_local.png" },
      ],
    });
    expect(new Date(exportedAt).toISOString()).toBe(exportedAt);
    const files: [string, string][] = [
      ["manifest.json", jsonText(manifest)],
      ...articleEntries.map(
        ({ documentId, status, file }): [string, string] => {
          const raw = document(documentId, status === "published");
          return [file, jsonText(raw)];
        },
      ),
      ["media/zzz_local.png", "local file"],
      ["media/aaa_remote.jpg", "remote file"],
    ];
    const names = files.map(([file]) => file);
    await expect(readTexts(input.out, names)).resolves.toStrictEqual(
      files.map(([, contents]) => contents),
    );
  });

  it("keeps media metadata without downloading by default, and accepts an existing empty directory", async () => {
    const input = options("/articles");
    const { out } = input;
    await mkdir(out);
    const raw = document("news", true);
    const mock = stubArticle([raw]);
    const manifest = await dump(input);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(manifest.media).toStrictEqual([]);
    await expect(readdir(out)).resolves.not.toContain("media");
    const { file } = entry("news", "published");
    await expect(readJson(path.join(out, file))).resolves.toStrictEqual(raw);
  });

  it("omits a missing singleton draft while preserving the published singleton's real identity", async () => {
    const raw = { id: 5, documentId: "configuration", siteName: "Example" };
    const input = options("/site-setting");
    const mock = stubResponses((url) => `${url.pathname} ${statusKey(url)}`, {
      "/install/api/site-setting draft": () =>
        new Response("", { status: 404 }),
      "/install/api/site-setting published": () =>
        Response.json({ data: raw, meta: {} }),
    });
    const manifest = await dump(input);
    const queries = sentRequests(mock).map((request) => {
      const { searchParams } = new URL(request.url);
      return {
        status: String(searchParams.get("status")),
        hasPagination: [...searchParams.keys()].some((key) =>
          key.startsWith("pagination"),
        ),
      };
    });
    expect(
      queries.toSorted((left, right) =>
        left.status.localeCompare(right.status),
      ),
    ).toStrictEqual([
      { status: "draft", hasPagination: false },
      { status: "published", hasPagination: false },
    ]);
    const file = "api__site-setting.site-setting/single.~.published.json";
    expect(manifest.entries).toStrictEqual([
      {
        uid: "api::site-setting.site-setting",
        kind: "singleType",
        locale: wireNull,
        documentId: "configuration",
        status: "published",
        file,
      },
    ]);
    const exported = path.join(input.out, file);
    await expect(readJson(exported)).resolves.toStrictEqual(raw);
    await expect(readdir(path.dirname(exported))).resolves.toStrictEqual([
      "single.~.published.json",
    ]);
  });

  it("validates full envelopes by default", async () => {
    stubArticle([invalidArticle]);
    const input = options("/articles");
    await expect(dump(input)).rejects.toThrow(
      "GET /install/api/articles (published): validation failed at /data/0",
    );
    await expect(readFile(manifestFile(input.out))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains a structurally safe but schema-invalid document when validation is disabled", async () => {
    stubArticle([invalidArticle]);
    const input = options("/articles");
    const expected = entry("bad", "published");
    const manifest = await dump({ ...input, validate: false });
    expect(manifest.entries).toStrictEqual([expected]);
    const file = path.join(input.out, expected.file);
    await expect(readJson(file)).resolves.toStrictEqual(invalidArticle);
  });

  it.each([
    [
      "missing documentId",
      { data: [{ id: 33 }], meta: { pagination: { page: 1, pageSize: 100 } } },
      "expected a document with a nonempty string documentId",
    ],
    [
      "empty documentId",
      {
        data: [{ id: 33, documentId: "" }],
        meta: { pagination: { page: 1, pageSize: 100 } },
      },
      "expected a document with a nonempty string documentId",
    ],
    [
      "wrong envelope",
      { data: {} },
      "expected response envelope with meta object",
    ],
  ] as const)(
    "rejects %s even when AJV is disabled",
    async (_description, envelope, diagnostic) => {
      stubFetch(() => Response.json(envelope));
      const input = options("/articles");
      await expect(dump({ ...input, validate: false })).rejects.toThrow(
        diagnostic,
      );
      await expect(readFile(manifestFile(input.out))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("uses a short page to stop only when the server omits counts", async () => {
    const mock = stubResponses(pageKey, {
      "1": () =>
        pageResponse([{ id: 24, documentId: "home" }], {
          page: 1,
          pageSize: 1,
        }),
      "2": () => pageResponse([], { page: 2, pageSize: 1 }),
    });
    const manifest = await dump(options("/pages"));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(manifest.entries.map((item) => item.documentId)).toStrictEqual([
      "home",
    ]);
  });

  it("uses the marked operation and escaped JSON pointers rather than route or schema names", async () => {
    const input = options("/pages");
    const { specification } = input;
    const route = specification.paths["/pages"];
    assert.ok(route !== undefined, "Missing fixture route /pages");
    specification.paths = { "/archive": route };
    const response = toRecord(toRecord(route["get"]?.["responses"])["200"]);
    const json = toRecord(toRecord(response["content"])["application/json"]);
    specification.components.schemas["payload/v1~fixture"] = {
      allOf: [json["schema"]],
    };
    json["schema"] = { $ref: "#/components/schemas/payload~1v1~0fixture" };
    stubResponses(pathKey, {
      "/install/api/archive": () =>
        pageResponse([{ id: 24, documentId: "home" }]),
    });
    const manifest = await dump(input);
    expect(manifest.entries.map((item) => item.uid)).toStrictEqual([pageUid]);
  });

  it("does not wildcard-populate a zone variant whose only nested relation is inverse", async () => {
    const input = options("/articles");
    for (const model of models(input.specification, "shared.seo")) {
      toRecord(model["fields"])["heading"] = {
        kind: "relation",
        relation: "oneToMany",
        target: pageUid,
        mappedBy: "seo",
      };
    }
    const mock = stubArticle([]);
    await dump({ ...input, validate: false });
    const zoneQueries = sentRequests(mock).map((request) => {
      const { searchParams } = new URL(request.url);
      return [...searchParams.entries()].filter(([key]) =>
        key.startsWith("populate[blocks][on][shared.seo]"),
      );
    });
    expect(zoneQueries).toStrictEqual([
      [["populate[blocks][on][shared.seo][fields]", "*"]],
      [["populate[blocks][on][shared.seo][fields]", "*"]],
    ]);
  });

  it.each([
    {
      problem: "duplicate ID within a page",
      replies: { "1": () => pageResponse([duplicateRow, duplicateRow]) },
      calls: 1,
      diagnostic: "duplicate documentId on page 1",
    },
    {
      problem: "repeated page",
      replies: {
        "1": () =>
          pageResponse([duplicateRow], { page: 1, pageCount: 2, pageSize: 1 }),
        "2": () =>
          pageResponse([duplicateRow], { page: 2, pageCount: 2, pageSize: 1 }),
      },
      calls: 2,
      diagnostic: "duplicate documentId on page 2",
    },
    {
      problem: "inconsistent page number",
      replies: {
        "1": () =>
          pageResponse([duplicateRow], { page: 9, pageCount: 2, pageSize: 1 }),
      },
      calls: 1,
      diagnostic: "inconsistent pagination size or position on page 1",
    },
  ])(
    "rejects $problem instead of publishing a manifest",
    async ({ replies, calls, diagnostic }) => {
      const mock = stubResponses(pageKey, replies);
      const input = options("/pages");
      await expect(dump({ ...input, validate: false })).rejects.toThrow(
        diagnostic,
      );
      expect(mock).toHaveBeenCalledTimes(calls);
      await expect(readFile(manifestFile(input.out))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("refuses a nonempty destination before fetching or replacing user data", async () => {
    const input = options("/articles");
    const { out } = input;
    await mkdir(out);
    const file = manifestFile(out);
    await writeFile(file, "existing backup\n");
    await expect(dump(input)).rejects.toThrow(
      "Dump output must be a new or empty directory",
    );
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(file, "utf8")).resolves.toBe("existing backup\n");
    await expect(readdir(out)).resolves.toStrictEqual(["manifest.json"]);
  });

  it("never overwrites a document file created after the dump began", async () => {
    const input = options("/pages");
    const { out } = input;
    const file = path.join(out, "api__page.page", "home.~.published.json");
    stubFetch(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "user data", { flag: "wx" });
      return pageResponse([{ id: 1, documentId: "home" }]);
    });
    await expect(dump({ ...input, validate: false })).rejects.toMatchObject({
      code: "EEXIST",
      path: file,
    });
    await expect(readFile(file, "utf8")).resolves.toBe("user data");
    await expect(readFile(manifestFile(out))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps traversal-like IDs and their percent-encoded lookalikes in distinct model-local files", async () => {
    const ids = [
      "../../escape.~.draft",
      "%2E%2E%2F%2E%2E%2Fescape%2E%7E%2Edraft",
    ];
    stubFetch(() =>
      pageResponse(
        ids.map((documentId, index) => ({ documentId, id: index + 1 })),
      ),
    );
    const input = options("/pages");
    const manifest = await dump({ ...input, validate: false });
    const { entries } = manifest;
    expect(entries.map((item) => item.documentId).toSorted()).toStrictEqual(
      ids.toSorted(),
    );
    expect(new Set(entries.map((item) => item.file)).size).toBe(ids.length);
    expect(entries.map((item) => path.dirname(item.file))).toStrictEqual([
      "api__page.page",
      "api__page.page",
    ]);
    const rows = await Promise.all(
      entries.map(({ file }) => readJson(path.join(input.out, file))),
    );
    expect(rows.map((row) => row["documentId"])).toStrictEqual(
      entries.map((item) => item.documentId),
    );
  });

  describe("preflight and fetch failures", () => {
    it.each(invalidSpecifications)(
      "rejects $problem before any model is fetched",
      async ({ change, diagnostic }) => {
        const input = options("/articles", "/pages");
        change(input.specification);
        await expect(dump({ ...input, validate: false })).rejects.toThrow(
          diagnostic,
        );
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        "https://other.example/api",
        "External specification server origin is not allowed",
      ],
      ["//other.example/api", "Invalid dump URL path"],
      ["/safe/../escape", "Invalid dump URL path segment or traversal"],
    ])(
      "does not send credentials to unsafe spec server %s",
      async (url, diagnostic) => {
        const input = options("/pages");
        input.specification.servers = [{ url }];
        await expect(dump(input)).rejects.toThrow(diagnostic);
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["/articles", 404],
      ["/site-setting", 401],
    ] as const)(
      "reports a failed GET %s (%d) without leaking the bearer token",
      async (route, status) => {
        stubFetch(() => new Response(`rejected: ${token}`, { status }));
        const failed = dump(options(route));
        await expect(failed).rejects.toThrow(
          `GET /install/api${route} (draft): HTTP ${status}`,
        );
        await expect(failed).rejects.not.toThrow(token);
      },
    );

    it("does not publish a manifest when a media download fails", async () => {
      stubResponses(pathKey, {
        [localMedia.url]: () => new Response(undefined, { status: 403 }),
        [articlesPath]: () =>
          pageResponse([{ documentId: "news", cover: localMedia }]),
      });
      const input = options("/articles");
      await expect(
        dump({ ...input, validate: false, media: true }),
      ).rejects.toThrow("GET media/zzz_local.png: HTTP 403");
      await expect(readFile(manifestFile(input.out))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it.each([
      [
        "unsafe hash",
        { ...localMedia, hash: "../outside" },
        unsafeMediaDiagnostic,
      ],
      [
        "unsafe extension",
        { ...localMedia, ext: ".png/../../outside" },
        unsafeMediaDiagnostic,
      ],
      ["missing extension", { ...localMedia, ext: "" }, unsafeMediaDiagnostic],
      ["missing hash", { ...localMedia, hash: "" }, unsafeMediaDiagnostic],
      ["missing URL", { ...localMedia, url: "" }, unsafeMediaDiagnostic],
      [
        "file URL",
        { ...localMedia, url: "file:///etc/passwd" },
        "Invalid media URL",
      ],
    ] as const)(
      "rejects a media record with %s without fetching its URL",
      async (_description, cover, diagnostic) => {
        const mock = stubResponses(pathKey, {
          [articlesPath]: () => pageResponse([{ documentId: "news", cover }]),
        });
        const input = options("/articles");
        await expect(
          dump({ ...input, validate: false, media: true }),
        ).rejects.toThrow(diagnostic);
        const paths = sentRequests(mock).map(
          (request) => new URL(request.url).pathname,
        );
        expect(paths).toStrictEqual([articlesPath]);
        await expect(readFile(manifestFile(input.out))).rejects.toMatchObject({
          code: "ENOENT",
        });
      },
    );
  });
});
