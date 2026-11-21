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

import { dump } from "../src/index.js";
import { isUnknownArray, parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

const baseUrl = "https://cms.example/install";
const token = "test-only-bearer-secret";
const article = "api::article.article";
const pageUid = "api::page.page";
const timestamp = "2025-05-01T12:34:56.000Z";

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
  if (isUnknownArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  const record = toRecord(value);
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sorted(record[key])]),
  );
};

const stubFetch = (
  respond: (url: URL, request: Request) => Response | Promise<Response>,
) => {
  const mock = vi.fn<typeof fetch>((input, init) => {
    const request = new Request(input, init);
    return Promise.resolve(respond(new URL(request.url), request));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

const pageResponse = (
  data: unknown[],
  pagination: Record<string, number> = {
    page: 1,
    pageSize: 100,
    pageCount: data.length ? 1 : 0,
  },
) => Response.json({ data, meta: { pagination } });

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
const document = (documentId: string, published: boolean) => ({
  title: "Article",
  id: published ? 20 : 21,
  publishedAt: published ? timestamp : null,
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

const entry = (documentId: string, status: "draft" | "published") => ({
  uid: article,
  kind: "collectionType",
  documentId,
  status,
  locale: null,
  file: `api__article.article/${encodeURIComponent(documentId)}.~.${status}.json`,
});

const models = (spec: OpenApiDocument, uid: string) => {
  const result = Object.values(spec.components.schemas)
    .map((schema) => toRecord(schema["x-strapi-model"]))
    .filter((model) => model["uid"] === uid);
  assert(result.length, `Missing fixture metadata for ${uid}`);
  return result;
};

describe("dump", () => {
  const fixture = generatedFixture(customize);
  let directory: string;
  let out: string;

  // Each test gets a private spec; keep the genuine response envelopes and all local refs.
  const options = (...routes: string[]) => {
    assert(fixture.document);
    const specification = structuredClone(fixture.document);
    specification.paths = Object.fromEntries(
      routes.map((route) => {
        const operations = specification.paths[route];
        assert(operations, `Missing fixture route ${route}`);
        return [route, operations];
      }),
    );
    return { specification, baseUrl, token, out };
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "strapi-dump-"));
    out = path.join(directory, "dump");
    stubFetch(() => {
      throw new Error("Unexpected fetch");
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { force: true, recursive: true });
  });

  it("exports both publication states and all pages, preserving nested rows and original media references", async () => {
    // Route order, page order and upload encounter order deliberately differ from manifest order.
    const input = options(
      "/pages",
      "/articles",
      "/health",
      "/pages/{id}/preview",
    );
    const requests: string[] = [];
    const downloads: string[] = [];
    stubFetch((url, request) => {
      expect(request.method).toBe("GET");
      if (
        url.pathname === "/uploads/banner.png" ||
        url.hostname === "assets.example"
      ) {
        const local = url.pathname === "/uploads/banner.png";
        expect(url.href).toBe(
          local ? "https://cms.example/uploads/banner.png" : cdnMedia.url,
        );
        expect(request.headers.get("authorization")).toBe(
          local ? `Bearer ${token}` : null,
        );
        downloads.push(url.href);
        return new Response(local ? "local file" : "remote file");
      }
      expect(url.origin).toBe("https://cms.example");
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      const q = url.searchParams;
      expect(q.get("pagination[pageSize]")).toBe("100");
      expect(q.get("pagination[withCount]")).toBe("true");
      const page = Number(q.get("pagination[page]"));
      if (url.pathname === "/install/api/pages") {
        expect(q.has("status")).toBe(false);
        expect(
          [...q.keys()].some((key) => key.startsWith("populate[articles]")),
        ).toBe(false);
        requests.push("pages");
        return pageResponse([{ id: 24, documentId: "home" }]);
      }
      expect(url.pathname).toBe("/install/api/articles");
      expect(q.get("populate[page][fields][0]")).toBe("documentId");
      expect(q.get("populate[cover]")).toBe("true");
      expect(q.get("populate[seo]")).toBe("true");
      expect(q.get("populate[link][populate][attachment]")).toBe("true");
      expect(q.get("populate[blocks][on][shared.seo][populate]")).toBe("*");
      expect(
        q.get(
          "populate[blocks][on][shared.conditional-link][populate][attachment]",
        ),
      ).toBe("true");
      expect([...q.values()]).not.toContain("title");
      const status = q.get("status");
      expect(["draft", "published"]).toContain(status);
      expect([1, 2]).toContain(page);
      requests.push(`${status}:${page}`);
      // The server caps its page size. Draft supplies pageCount; published supplies only total.
      return pageResponse(
        [document(page === 1 ? "z page" : "alpha", status === "published")],
        {
          page,
          pageSize: 1,
          ...(status === "draft" ? { pageCount: 2 } : { total: 2 }),
        },
      );
    });
    const manifest = await dump({ ...input, media: true });
    expect(requests.sort()).toEqual([
      "draft:1",
      "draft:2",
      "pages",
      "published:1",
      "published:2",
    ]);
    expect(downloads.sort()).toEqual([
      cdnMedia.url,
      "https://cms.example/uploads/banner.png",
    ]);
    const entries = [
      entry("alpha", "draft"),
      entry("alpha", "published"),
      entry("z page", "draft"),
      entry("z page", "published"),
      {
        uid: pageUid,
        kind: "collectionType",
        documentId: "home",
        locale: null,
        status: "published",
        file: "api__page.page/home.~.published.json",
      },
    ];
    const pkg = parseJsonObject(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest).toStrictEqual({
      formatVersion: 1,
      generatorVersion: pkg["version"],
      specificationSha256: createHash("sha256")
        .update(JSON.stringify(sorted(input.specification)))
        .digest("hex"),
      baseUrl,
      exportedAt: expect.any(String),
      locales: [],
      entries,
      media: [
        { hash: cdnMedia.hash, file: "media/aaa_remote.jpg" },
        { hash: localMedia.hash, file: "media/zzz_local.png" },
      ],
    });
    expect(new Date(manifest.exportedAt).toISOString()).toBe(
      manifest.exportedAt,
    );
    expect(await readFile(path.join(out, "manifest.json"), "utf8")).toBe(
      `${JSON.stringify(sorted(manifest), null, 2)}\n`,
    );
    for (const item of entries.filter((item) => item.uid === article)) {
      expect(await readFile(path.join(out, item.file), "utf8")).toBe(
        `${JSON.stringify(sorted(document(item.documentId, item.status === "published")), null, 2)}\n`,
      );
    }
    expect(await readFile(path.join(out, "media/zzz_local.png"), "utf8")).toBe(
      "local file",
    );
    expect(await readFile(path.join(out, "media/aaa_remote.jpg"), "utf8")).toBe(
      "remote file",
    );
  });

  it("keeps media metadata without downloading by default, and accepts an existing empty directory", async () => {
    await mkdir(out);
    const raw = document("news", true);
    const mock = stubFetch((url) => {
      expect(url.pathname).toBe("/install/api/articles");
      return pageResponse(
        url.searchParams.get("status") === "draft" ? [] : [raw],
      );
    });
    const manifest = await dump(options("/articles"));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(manifest.media).toEqual([]);
    expect(await readdir(out)).not.toContain("media");
    expect(
      parseJsonObject(
        await readFile(path.join(out, entry("news", "published").file), "utf8"),
      ),
    ).toStrictEqual(raw);
  });

  it("omits a missing singleton draft while preserving the published singleton's real identity", async () => {
    const raw = { id: 5, documentId: "configuration", siteName: "Example" };
    const statuses: (string | null)[] = [];
    stubFetch((url) => {
      expect(url.pathname).toBe("/install/api/site-setting");
      expect(
        [...url.searchParams.keys()].some((key) =>
          key.startsWith("pagination"),
        ),
      ).toBe(false);
      const status = url.searchParams.get("status");
      statuses.push(status);
      return status === "draft"
        ? new Response(null, { status: 404 })
        : Response.json({ data: raw, meta: {} });
    });
    const manifest = await dump(options("/site-setting"));
    expect(statuses.sort()).toEqual(["draft", "published"]);
    const file = "api__site-setting.site-setting/single.~.published.json";
    expect(manifest.entries).toEqual([
      {
        uid: "api::site-setting.site-setting",
        kind: "singleType",
        locale: null,
        documentId: "configuration",
        status: "published",
        file,
      },
    ]);
    expect(
      parseJsonObject(await readFile(path.join(out, file), "utf8")),
    ).toEqual(raw);
    expect(await readdir(path.dirname(path.join(out, file)))).toEqual([
      "single.~.published.json",
    ]);
  });

  it("validates full envelopes by default and can retain a structurally safe but invalid raw document", async () => {
    const raw = { id: 1, documentId: "bad", publishedAt: timestamp, title: 42 };
    stubFetch((url) =>
      pageResponse(url.searchParams.get("status") === "published" ? [raw] : []),
    );
    const input = options("/articles");
    const failed = dump(input);
    await expect(failed).rejects.toThrow(/articles/);
    await expect(failed).rejects.toThrow(/published/);
    await expect(failed).rejects.toThrow(/\/data\/0/);
    await expect(
      readFile(path.join(out, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const other = path.join(directory, "unchecked");
    const manifest = await dump({ ...input, validate: false, out: other });
    expect(manifest.entries).toEqual([entry("bad", "published")]);
    expect(
      parseJsonObject(
        await readFile(
          path.join(other, entry("bad", "published").file),
          "utf8",
        ),
      ),
    ).toEqual(raw);
  });

  it.each([
    [
      "missing documentId",
      { data: [{ id: 33 }], meta: { pagination: { page: 1, pageSize: 100 } } },
    ],
    [
      "empty documentId",
      {
        data: [{ id: 33, documentId: "" }],
        meta: { pagination: { page: 1, pageSize: 100 } },
      },
    ],
    ["wrong envelope", { data: {} }],
  ])("rejects %s even when AJV is disabled", async (_description, envelope) => {
    stubFetch(() => Response.json(envelope));
    await expect(
      dump({ ...options("/articles"), validate: false }),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(out, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses a short page to stop only when the server omits counts", async () => {
    const mock = stubFetch((url) => {
      const page = Number(url.searchParams.get("pagination[page]"));
      expect([1, 2]).toContain(page);
      return pageResponse(page === 1 ? [{ id: 24, documentId: "home" }] : [], {
        page,
        pageSize: 1,
      });
    });
    const manifest = await dump(options("/pages"));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(manifest.entries.map((item) => item.documentId)).toEqual(["home"]);
  });

  it("uses the marked operation and escaped JSON pointers rather than route or schema names", async () => {
    const input = options("/pages");
    const { specification } = input;
    const route = specification.paths["/pages"];
    assert(route);
    specification.paths = { "/archive": route };
    const response = toRecord(toRecord(route["get"]?.["responses"])["200"]);
    const json = toRecord(toRecord(response["content"])["application/json"]);
    specification.components.schemas["payload/v1~fixture"] = {
      allOf: [json["schema"]],
    };
    json["schema"] = { $ref: "#/components/schemas/payload~1v1~0fixture" };
    stubFetch((url) => {
      expect(url.pathname).toBe("/install/api/archive");
      return pageResponse([{ id: 24, documentId: "home" }]);
    });
    const manifest = await dump(input);
    expect(manifest.entries.map((item) => item.uid)).toEqual([pageUid]);
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
    const mock = stubFetch((url) => {
      const keys = [...url.searchParams.entries()].filter(([key]) =>
        key.startsWith("populate[blocks][on][shared.seo]"),
      );
      expect(keys).toEqual([["populate[blocks][on][shared.seo][fields]", "*"]]);
      return pageResponse([]);
    });
    await dump({ ...input, validate: false });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "duplicate ID within a page",
    "repeated page",
    "inconsistent page number",
  ])("rejects %s instead of publishing a manifest", async (problem) => {
    const row = { id: 1, documentId: "duplicate" };
    const mock = stubFetch((url) => {
      const page = Number(url.searchParams.get("pagination[page]"));
      if (page > 2) throw new Error("Unbounded loop");
      if (problem === "duplicate ID within a page")
        return pageResponse([row, row]);
      return pageResponse([row], {
        page: problem === "repeated page" ? page : 9,
        pageCount: 2,
        pageSize: 1,
      });
    });
    await expect(
      dump({ ...options("/pages"), validate: false }),
    ).rejects.toThrow(/duplicate|repeat|pagination|page number|collision/i);
    expect(mock.mock.calls.length).toBeLessThanOrEqual(2);
    await expect(
      readFile(path.join(out, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a nonempty destination before fetching or replacing user data", async () => {
    await mkdir(out);
    const manifest = path.join(out, "manifest.json");
    await writeFile(manifest, "existing backup\n");
    await expect(dump(options("/articles"))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(manifest, "utf8")).toBe("existing backup\n");
    expect(await readdir(out)).toEqual(["manifest.json"]);
  });

  it("never overwrites a document file created after the dump began", async () => {
    const file = path.join(out, "api__page.page", "home.~.published.json");
    stubFetch(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "user data", { flag: "wx" });
      return pageResponse([{ id: 1, documentId: "home" }]);
    });
    await expect(
      dump({ ...options("/pages"), validate: false }),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("user data");
    await expect(
      readFile(path.join(out, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
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
    const manifest = await dump({ ...options("/pages"), validate: false });
    expect(manifest.entries.map((item) => item.documentId).sort()).toEqual(
      ids.toSorted(),
    );
    expect(new Set(manifest.entries.map((item) => item.file)).size).toBe(
      ids.length,
    );
    for (const item of manifest.entries) {
      expect(path.dirname(item.file)).toBe("api__page.page");
      expect(
        parseJsonObject(await readFile(path.join(out, item.file), "utf8"))[
          "documentId"
        ],
      ).toBe(item.documentId);
    }
  });

  it.each([
    "localized model",
    "unknown field",
    "component cycle",
    "missing model metadata",
    "duplicate marker",
    "response UID mismatch",
  ])("rejects %s before any model is fetched", async (problem) => {
    const input = options("/articles", "/pages");
    const paths = input.specification.paths;
    const operation = paths["/pages"]?.["get"];
    assert(operation);
    const marker = toRecord(operation["x-strapi-dump"]);
    let diagnostic: RegExp;
    switch (problem) {
      case "localized model":
        marker["localized"] = true;
        for (const model of models(input.specification, pageUid))
          model["localized"] = true;
        diagnostic = /localiz|locale/i;
        break;
      case "unknown field":
        for (const model of models(input.specification, pageUid))
          toRecord(model["fields"])["pluginComponent"] = { kind: "unknown" };
        diagnostic = /pluginComponent/;
        break;
      case "component cycle":
        for (const model of models(input.specification, "shared.seo"))
          toRecord(model["fields"])["heading"] = {
            kind: "component",
            component: "shared.seo",
            repeatable: false,
          };
        diagnostic = /cycl|recurs/i;
        break;
      case "missing model metadata":
        for (const schema of Object.values(
          input.specification.components.schemas,
        )) {
          if (toRecord(schema["x-strapi-model"])["uid"] === pageUid)
            delete schema["x-strapi-model"];
        }
        diagnostic = /model|metadata/i;
        break;
      case "duplicate marker":
        paths["/extra-pages"] = { get: operation };
        diagnostic = /duplicate|multiple/i;
        break;
      default:
        operation["responses"] = paths["/articles"]?.["get"]?.["responses"];
        diagnostic = /model|uid|metadata|match/i;
    }
    await expect(dump({ ...input, validate: false })).rejects.toThrow(
      diagnostic,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://other.example/api",
    "//other.example/api",
    "/safe/../escape",
  ])("does not send credentials to unsafe spec server %s", async (url) => {
    const input = options("/pages");
    input.specification.servers = [{ url }];
    await expect(dump(input)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/articles", 404],
    ["/site-setting", 401],
  ] as const)(
    "reports a failed GET %s (%d) without leaking the bearer token",
    async (route, status) => {
      stubFetch(() => new Response(`rejected: ${token}`, { status }));
      const failed = dump(options(route));
      await expect(failed).rejects.toThrow(/GET/);
      await expect(failed).rejects.toThrow(route);
      await expect(failed).rejects.toThrow(String(status));
      await expect(failed).rejects.not.toThrow(token);
    },
  );

  it("does not publish a manifest when a media download fails", async () => {
    stubFetch((url) =>
      url.pathname === "/uploads/banner.png"
        ? new Response(null, { status: 403 })
        : pageResponse([{ documentId: "news", cover: localMedia }]),
    );
    await expect(
      dump({ ...options("/articles"), validate: false, media: true }),
    ).rejects.toThrow(/403/);
    await expect(
      readFile(path.join(out, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { ...localMedia, hash: "../outside" },
    { ...localMedia, ext: ".png/../../outside" },
    { ...localMedia, ext: "" },
    { ...localMedia, hash: "" },
    { ...localMedia, url: "" },
    { ...localMedia, url: "file:///etc/passwd" },
  ])(
    "rejects unsafe or incomplete media without fetching its URL",
    async (cover) => {
      const mock = stubFetch(() =>
        pageResponse([{ documentId: "news", cover }]),
      );
      await expect(
        dump({ ...options("/articles"), validate: false, media: true }),
      ).rejects.toThrow();
      expect(
        mock.mock.calls.every(
          ([input, init]) =>
            new URL(new Request(input, init).url).pathname ===
            "/install/api/articles",
        ),
      ).toBe(true);
      await expect(
        readFile(path.join(out, "manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
