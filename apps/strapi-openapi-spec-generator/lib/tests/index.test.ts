import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type {
  JsonSchema,
  OpenApiDocument,
  Operation,
} from "../src/document.js";

import { readContentTypes } from "../src/content-types.js";
import { buildDocument } from "../src/document.js";
import { generateSpecification } from "../src/index.js";
import { toRecord } from "../src/json.js";
import { readRoutes } from "../src/routes.js";
import { renameSchemas } from "../src/schema-names.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

const project = fileURLToPath(new URL("fixtures/project", import.meta.url));

/**
 * Build the document of the fixture project with empty schemas.
 *
 * @returns The document and the warnings from reading the routes.
 */
const fixtureDocument = async (): Promise<{
  document: OpenApiDocument;
  warnings: string[];
}> => {
  const contentTypes = await readContentTypes(project);
  const { routes, warnings } = await readRoutes(project, contentTypes);
  const document = buildDocument({
    contentTypes,
    info: { title: "fixture", version: "1.0.0" },
    routes,
    schemas: {},
    serverUrl: "/api",
  });

  return { document, warnings };
};

/**
 * List the parameter names of an operation.
 *
 * @param operation - The operation, or `undefined` when the document has none.
 * @returns The `name` of each parameter.
 */
const parameterNames = (operation: Operation | undefined): unknown[] => {
  const parameters: unknown = operation?.["parameters"];

  return Array.isArray(parameters)
    ? parameters.map((parameter: unknown) => toRecord(parameter)["name"])
    : [];
};

describe("readContentTypes", () => {
  it("reads exact metadata and preserves every attribute from each schema.json", async () => {
    const contentTypes = await readContentTypes(project);

    const metadata = [
      {
        apiName: "article",
        draftAndPublish: true,
        kind: "collectionType",
        localized: false,
        pluralName: "articles",
        singularName: "article",
        uid: "api::article.article",
      },
      {
        apiName: "page",
        draftAndPublish: false,
        kind: "collectionType",
        localized: true,
        pluralName: "pages",
        singularName: "page",
        uid: "api::page.page",
      },
      {
        apiName: "site-setting",
        draftAndPublish: false,
        kind: "singleType",
        localized: false,
        pluralName: "site-settings",
        singularName: "site-setting",
        uid: "api::site-setting.site-setting",
      },
    ];
    const expected = await Promise.all(
      metadata.map(async (model) => {
        const schemaPath = path.join(
          project,
          "src/api",
          model.apiName,
          "content-types",
          model.singularName,
          "schema.json",
        );
        const schema: unknown = JSON.parse(await readFile(schemaPath, "utf8"));
        return Object.assign(model, {
          attributes: toRecord(schema)["attributes"],
        });
      }),
    );

    expect(contentTypes).toStrictEqual(expected);
  });

  it("returns nothing for a directory without src/api", async () => {
    await expect(
      readContentTypes(path.join(project, "src")),
    ).resolves.toStrictEqual([]);
  });
});

describe("readRoutes", () => {
  it("expands core routers and reads custom routes", async () => {
    const { document, warnings } = await fixtureDocument();
    const operations = Object.entries(document.paths).flatMap(
      ([routePath, methods]) =>
        Object.keys(methods).map((method) => `${method} ${routePath}`),
    );

    expect([...operations].toSorted()).toStrictEqual(
      [
        "get /articles",
        "get /articles/{id}",
        "get /health",
        "get /pages",
        "get /pages/by-slug/{slug}",
        "get /pages/{id}",
        "get /pages/{id}/preview",
        "get /site-setting",
        "delete /pages/{id}",
        "post /articles",
        "post /pages",
        "put /articles/{id}",
        "put /pages/{id}",
        "put /site-setting",
      ].toSorted(),
    );
    expect(warnings).toStrictEqual([
      "src/api/page/routes/01-custom-page.ts: a route was skipped because its method or path is not a string literal",
    ]);
  });

  it("warns for unknown core routers and files without routes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "strapi-routes-"));
    try {
      const routes = path.join(root, "src/api/missing/routes");
      await mkdir(routes, { recursive: true });
      await writeFile(
        path.join(routes, "core.ts"),
        'export default createCoreRouter("api::missing.missing");',
      );
      await writeFile(path.join(routes, "empty.ts"), "export default {};");
      await expect(readRoutes(root, [])).resolves.toStrictEqual({
        routes: [],
        warnings: [
          "src/api/missing/routes/core.ts: createCoreRouter is called for a content type that is not in src/api",
          "src/api/missing/routes/empty.ts: no routes were found in this file",
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("buildDocument", () => {
  it.each(["constructor", "toString"])(
    "describes %s as a custom handler",
    async (action) => {
      const handler = `api::article.article.${action}`;
      const { paths } = buildDocument({
        contentTypes: await readContentTypes(project),
        info: { title: "fixture", version: "1" },
        routes: [{ auth: false, handler, method: "get", path: "/custom" }],
        schemas: {},
        serverUrl: "/api",
      });
      expect(paths["/custom"]?.["get"]).toMatchObject({
        summary: handler,
        parameters: [],
        responses: { default: {} },
      });
    },
  );

  it("describes a core action with its schemas, parameters and statuses", async () => {
    const { document } = await fixtureDocument();
    const operation = document.paths["/articles"]?.["post"];

    expect(operation).toMatchObject({
      operationId: "post /articles",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApiArticleArticleCreateRequest",
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: ["article"],
    });
    expect(Object.keys(toRecord(operation?.["responses"]))).toStrictEqual([
      "201",
      "400",
      "401",
      "403",
    ]);
  });

  it("leaves out authentication for a route with auth: false", async () => {
    const { document } = await fixtureDocument();
    const operation = document.paths["/articles"]?.["get"];

    expect(operation?.["security"]).toStrictEqual([]);
    expect(Object.keys(toRecord(operation?.["responses"]))).toStrictEqual([
      "200",
      "400",
    ]);
  });

  it("adds locale and status only where the content type supports them", async () => {
    const { document } = await fixtureDocument();
    const articles = parameterNames(document.paths["/articles"]?.["get"]);
    const pages = parameterNames(document.paths["/pages"]?.["get"]);

    expect(articles).toContain("status");
    expect(articles).not.toContain("locale");
    expect(pages).toContain("locale");
    expect(pages).not.toContain("status");
  });

  it("uses the core schemas for a custom route with a core handler", async () => {
    const { document } = await fixtureDocument();
    const operation = document.paths["/pages/{id}/preview"]?.["get"];

    expect(operation).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiPagePageResponse" },
            },
          },
        },
      },
      security: [],
    });
  });

  it("describes a custom handler without body schemas", async () => {
    const { document } = await fixtureDocument();
    const operation = document.paths["/pages/by-slug/{slug}"]?.["get"];

    expect(operation).toMatchObject({
      parameters: [{ in: "path", name: "slug", required: true }],
      summary: "api::page.page.findBySlug",
    });
    expect(operation?.["responses"]).toHaveProperty("default");
  });
});

describe("renameSchemas", () => {
  it("preserves boolean component schemas and references to them", () => {
    const ref = { $ref: "#/components/schemas/Never" };
    expect(
      renameSchemas({ Never: false, Anything: true, Alias: ref }),
    ).toStrictEqual({
      Never: { not: {} },
      Anything: {},
      Alias: ref,
    });
  });

  it("names a generic schema after its UID", () => {
    expect(
      renameSchemas({
        "RestAnyDocumentapi_x3A__x3A_page_x2E_page-x7AB9B112138960C0": {},
        RestError: {},
      }),
    ).toStrictEqual({ ApiPagePageDocument: {}, RestError: {} });
  });

  it("renames keys and references together", () => {
    const generated = "PublishedComponentInputshared_x2E_seo-xF8A29A5A1753DD2C";
    const renamed = renameSchemas({
      [generated]: { type: "object" },
      Page: { $ref: `#/components/schemas/${generated}` },
    });

    expect(renamed).toStrictEqual({
      Page: { $ref: "#/components/schemas/SharedSeoPublishedEntryInput" },
      SharedSeoPublishedEntryInput: { type: "object" },
    });
  });

  it("refuses two schemas with the same readable name", () => {
    expect(() =>
      renameSchemas({
        "RestAnyDocumentshared_x2E_seo-x0000000000000001": {},
        "RestAnyDocumentshared_x2E_seo-x0000000000000002": {},
      }),
    ).toThrow("renamed to the same name");
  });
});

describe("generateSpecification", () => {
  it("rejects a directory that is not a project", async () => {
    await expect(
      generateSpecification({
        projectDirectory: path.join(project, "missing"),
      }),
    ).rejects.toThrow("is not a Strapi project");
  });

  it("rejects a project without generated types", async () => {
    await expect(
      generateSpecification({ projectDirectory: project }),
    ).rejects.toThrow("strapi ts:generate-types");
  });
});

/* oxlint-disable unicorn/no-null -- JSON responses distinguish null from omitted fields. */
describe("generated response validation", () => {
  const fixture = generatedFixture();
  const { compileSchema, validateDocument } = fixture;

  const published = {
    id: 1,
    documentId: "fixture",
    publishedAt: "2026-11-17T00:00:00.000Z",
  };
  const draftEntry = { ...published, publishedAt: null };

  it("accepts incomplete draft writes through generated operation bodies", () => {
    for (const [route, method] of [
      ["/articles", "post"],
      ["/articles/{id}", "put"],
    ] as const) {
      const operation = fixture.document?.paths[route]?.[method];
      const content = toRecord(toRecord(operation?.["requestBody"])["content"]);
      const schema = toRecord(toRecord(content["application/json"])["schema"]);
      const validate = compileSchema(schema);
      expect(
        validate({
          data: { seo: [], title: null, email: "invalid", rating: -1 },
        }),
      ).toBe(true);
      expect(validate({ data: { seo: [], title: "12345678901" } })).toBe(false);
    }
  });

  it("exposes publication-specific create constraints without requiring defaulted or relational attributes", () => {
    const validate = validateDocument(
      "ApiArticleArticlePublishedCreateRequest",
    );
    const data = { title: "12345", email: "a@b.co", seo: [{ heading: "SEO" }] };
    expect(validate({ data })).toBe(true);
    expect(
      validate({ data: { ...data, page: null, cover: null, blocks: [] } }),
    ).toBe(true);
    for (const invalid of [
      { title: null },
      { title: "1234" },
      { email: "invalid" },
      { email: null },
      { rating: 1 },
      { rating: 9 },
      { rating: 2.5 },
      { price: 0.4 },
      { price: 10.6 },
      { label: null },
      { slug: "a b" },
      { slug: "ab" },
      { seo: [] },
      { seo: null },
      { seo: [{ heading: "ab" }] },
    ]) {
      expect(validate({ data: { ...data, ...invalid } })).toBe(false);
    }
    for (const missingData of [
      {},
      { title: "12345" },
      { email: "a@b.co", seo: [{ heading: "SEO" }] },
    ]) {
      expect(validate({ data: missingData })).toBe(false);
    }
  });

  it("relaxes draft create rules throughout nested components but retains scalar upper bounds", () => {
    const validate = validateDocument("ApiArticleArticleDraftCreateRequest");
    for (const data of [
      { seo: [] },
      { seo: [{}], title: null, email: null, rating: -1, price: -0.5 },
      {
        seo: [{ heading: null }],
        summary: null,
        slug: "space ok",
        label: null,
      },
      {
        seo: [{}, {}, {}],
        blocks: [
          { __component: "shared.seo" },
          { __component: "shared.seo" },
          { __component: "shared.seo" },
        ],
      },
    ]) {
      expect(validate({ data })).toBe(true);
    }
    for (const invalid of [
      { title: "12345678901" },
      { email: `${"a".repeat(35)}@x.com` },
      { rating: 9 },
      { rating: 1.5 },
      { price: 10.6 },
      { seo: [{ heading: "123456789" }] },
      { summary: { heading: "123456789" } },
      { shortText: "x".repeat(256) },
      { slug: "x".repeat(13) },
      { seo: null },
      { blocks: null },
    ]) {
      expect(validate({ data: { seo: [], ...invalid } })).toBe(false);
    }
  });

  it("distinguishes retained components from new components in published updates", () => {
    const validate = validateDocument(
      "ApiArticleArticlePublishedUpdateRequest",
    );
    for (const data of [
      {},
      { seo: [{ id: 1 }] },
      { summary: { id: 1 }, seo: [{ id: 2, heading: "SEO" }] },
      { seo: [{ heading: "SEO" }] },
      { blocks: [{ id: 1, __component: "shared.seo" }] },
      { blocks: [{ __component: "shared.seo", heading: "SEO" }] },
      { page: null, cover: null },
    ]) {
      expect(validate({ data })).toBe(true);
    }
    for (const data of [
      { title: null },
      { label: null },
      { seo: [{}] },
      { summary: {} },
      { seo: [{ id: 1, heading: null }] },
      { seo: [{ id: 1 }, {}] },
      { blocks: [{ __component: "shared.seo" }] },
      { blocks: [{ id: 1 }] },
      { blocks: [{ __component: "shared.seo", heading: "ab" }] },
    ]) {
      expect(validate({ data })).toBe(false);
    }
    const validateDraftUpdate = validateDocument(
      "ApiArticleArticleDraftUpdateRequest",
    );
    expect(validateDraftUpdate({ data: {} })).toBe(true);
    expect(
      validateDraftUpdate({ data: { seo: [{}], summary: {}, title: null } }),
    ).toBe(true);
  });

  it("keeps non-draft writes strict and enforces the default short-text maximum", () => {
    const validatePage = validateDocument("ApiPagePageCreateRequest");
    expect(validatePage({ data: { title: "12345" } })).toBe(true);
    expect(validatePage({ data: {} })).toBe(false);
    expect(validatePage({ data: { title: null } })).toBe(false);
    expect(validatePage({ data: { title: "1234" } })).toBe(false);
    for (const name of ["Draft", "Published"]) {
      const validate = validateDocument(
        `ApiArticleArticle${name}UpdateRequest`,
      );
      expect(validate({ data: { shortText: "x".repeat(255) } })).toBe(true);
      expect(validate({ data: { shortText: "x".repeat(256) } })).toBe(false);
    }
  });

  it("relates status query values to precise body schemas through operation metadata", () => {
    for (const [route, method, action] of [
      ["/articles", "post", "Create"],
      ["/articles/{id}", "put", "Update"],
    ] as const) {
      const operation = fixture.document?.paths[route]?.[method];
      expect(operation?.["x-strapi-request-status"]).toStrictEqual({
        parameter: "status",
        default: "published",
        schemas: {
          draft: {
            $ref: `#/components/schemas/ApiArticleArticleDraft${action}Request`,
          },
          published: {
            $ref: `#/components/schemas/ApiArticleArticlePublished${action}Request`,
          },
        },
      });
    }
    expect(fixture.document?.paths["/pages"]?.["post"]).not.toHaveProperty(
      "x-strapi-request-status",
    );
  });

  it("excludes system and explicitly nonwritable attributes from generated inputs", () => {
    for (const state of ["Draft", "Published"]) {
      for (const action of ["Create", "Update"]) {
        const schema =
          fixture.document?.components.schemas[
            `ApiArticleArticle${state}${action}Input`
          ];
        const properties = toRecord(schema?.["properties"]);
        expect(properties).toHaveProperty("title");
        for (const key of [
          "id",
          "documentId",
          "createdAt",
          "updatedAt",
          "publishedAt",
          "internalCode",
        ]) {
          expect(properties).not.toHaveProperty(key);
        }
      }
    }
  });

  it("applies conditional component create validation to single components and dynamic-zone blocks", () => {
    const validate = validateDocument(
      "ApiArticleArticlePublishedCreateRequest",
    );
    const data = { title: "12345", email: "a@b.co", seo: [{ heading: "SEO" }] };
    for (const wrap of [
      (link: JsonSchema): JsonSchema => ({ link }),
      (link: JsonSchema): JsonSchema => ({
        blocks: [{ __component: "shared.conditional-link", ...link }],
      }),
    ]) {
      for (const link of [
        { label: "x" },
        { kind: "internal", label: "x" },
        { kind: "internal", label: "x", url: null },
        { kind: "external", label: "x", url: "/target" },
      ]) {
        expect(validate({ data: { ...data, ...wrap(link) } })).toBe(true);
      }
      for (const link of [
        { kind: "external", label: "x" },
        { kind: "external", label: "x", url: "" },
        { kind: "external", label: "x", url: null },
        { kind: "internal", label: "" },
      ]) {
        expect(validate({ data: { ...data, ...wrap(link) } })).toBe(false);
      }
    }
    const update = validateDocument("ApiArticleArticlePublishedUpdateRequest");
    expect(update({ data: { link: { id: 1 } } })).toBe(true);
    expect(update({ data: { link: { kind: "external", label: "x" } } })).toBe(
      false,
    );
    expect(update({ data: { link: { id: 1, url: null } } })).toBe(true);
  });

  it("preserves conditional projection behavior in component and dynamic-zone responses", () => {
    const validate = validateDocument("ApiArticleArticlePublishedDocument");
    for (const wrap of [
      (link: JsonSchema): JsonSchema => ({ link: { id: 1, ...link } }),
      (link: JsonSchema): JsonSchema => ({
        blocks: [{ id: 1, __component: "shared.conditional-link", ...link }],
      }),
    ]) {
      expect(
        validate({ ...published, ...wrap({ kind: "internal", url: null }) }),
      ).toBe(true);
      expect(
        validate({
          ...published,
          ...wrap({ kind: "external", url: "/target" }),
        }),
      ).toBe(true);
      expect(validate({ ...published, ...wrap({ url: null }) })).toBe(true);
      expect(
        validate({ ...published, ...wrap({ kind: "external", url: "" }) }),
      ).toBe(false);
      expect(
        validate({ ...published, ...wrap({ kind: "external", url: null }) }),
      ).toBe(false);
    }
  });

  it("validates published string lengths, email format and numeric ranges", () => {
    const validate = validateDocument("ApiArticleArticlePublishedDocument");
    expect(
      validate({
        ...published,
        title: "12345",
        email: "a@b.co",
        rating: 2,
        price: 0.5,
      }),
    ).toBe(true);
    expect(
      validate({
        ...published,
        title: "1234567890",
        rating: 8,
        email: `${"a".repeat(34)}@x.com`,
        price: 10.5,
      }),
    ).toBe(true);
    for (const invalid of [
      { title: "1234" },
      { title: "12345678901" },
      { title: null },
      { email: "not-an-email" },
      { email: "a@b.c" },
      { email: `${"a".repeat(35)}@x.com` },
      { email: null },
      { rating: 1 },
      { rating: 9 },
      { rating: 2.5 },
      { price: 0.4 },
      { price: 10.6 },
      { publishedAt: null },
    ]) {
      expect(validate({ ...published, ...invalid })).toBe(false);
    }
  });

  it("relaxes draft required, minimum length, email and numeric minimum rules only", () => {
    const validate = validateDocument("ApiArticleArticleDraftDocument");
    for (const valid of [
      { title: "" },
      { title: "1234" },
      { title: null, email: null },
      { email: "invalid" },
      { email: "" },
      { rating: -1, price: -0.5 },
    ]) {
      expect(validate({ ...draftEntry, ...valid })).toBe(true);
    }
    for (const invalid of [
      { title: "12345678901" },
      { email: `${"a".repeat(35)}@x.com` },
      { rating: 9 },
      { rating: 2.5 },
      { price: 10.6 },
      { title: 123 },
      { publishedAt: published.publishedAt },
    ]) {
      expect(validate({ ...draftEntry, ...invalid })).toBe(false);
    }
  });

  it("keeps selected fields and populated attributes optional in both states", () => {
    for (const [name, entry] of [
      ["ApiArticleArticlePublishedDocument", published],
      ["ApiArticleArticleDraftDocument", draftEntry],
    ] as const) {
      const validate = validateDocument(name);
      expect(validate(entry)).toBe(true);
      expect(validate({ id: 1, documentId: "fixture" })).toBe(true);
      expect(validate({ ...entry, seo: [{ id: 1 }], page: null })).toBe(true);
      expect(validate({ ...entry, rating: null, price: null })).toBe(true);
    }
  });

  it("applies component restrictions in the parent state and keeps related non-draft documents strict", () => {
    const validatePublished = validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    const validateDraft = validateDocument("ApiArticleArticleDraftDocument");
    expect(
      validatePublished({ ...published, seo: [{ id: 1, heading: "SEO" }] }),
    ).toBe(true);
    for (const seo of [
      null,
      [],
      [{ id: 1, heading: "ab" }],
      [{ id: 1, heading: null }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    ]) {
      expect(validatePublished({ ...published, seo })).toBe(false);
    }
    for (const seo of [
      null,
      [],
      [{ id: 1, heading: "" }],
      [{ id: 1, heading: null }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    ]) {
      expect(validateDraft({ ...draftEntry, seo })).toBe(true);
    }
    expect(
      validateDraft({ ...draftEntry, seo: [{ id: 1, heading: "123456789" }] }),
    ).toBe(false);
    expect(
      validateDraft({
        ...draftEntry,
        page: { id: 2, documentId: "page", title: "1234" },
      }),
    ).toBe(false);
  });

  it.each([
    [
      "/articles",
      (entry: unknown): JsonSchema => ({
        data: [entry],
        meta: { pagination: { page: 1, pageSize: 10 } },
      }),
    ],
    [
      "/articles/{id}",
      (entry: unknown): JsonSchema => ({ data: entry, meta: {} }),
    ],
  ] as const)(
    "uses the draft/published union in the %s operation response",
    (route, response) => {
      const operation = fixture.document?.paths[route]?.["get"];
      const responses = toRecord(operation?.["responses"]);
      const content = toRecord(toRecord(responses["200"])["content"]);
      const schema = toRecord(toRecord(content["application/json"])["schema"]);
      const validate = compileSchema(schema);
      expect(validate(response({ ...published, title: "12345" }))).toBe(true);
      expect(
        validate(response({ ...draftEntry, title: "", email: "invalid" })),
      ).toBe(true);
      expect(validate(response({ ...published, title: "1234" }))).toBe(false);
      expect(validate(response({ ...draftEntry, title: "12345678901" }))).toBe(
        false,
      );
    },
  );

  it("keeps non-draft content types strict", () => {
    const validate = validateDocument("ApiPagePageDocument");
    const page = { id: 1, documentId: "page" };
    expect(validate(page)).toBe(true);
    expect(validate({ ...page, title: "12345" })).toBe(true);
    expect(validate({ ...page, title: "1234" })).toBe(false);
    expect(validate({ ...page, title: null })).toBe(false);
  });

  it("omits unsupported single-type aliases", () => {
    expect(fixture.document?.components.schemas).not.toHaveProperty(
      "ApiSiteSettingSiteSettingListResponse",
    );
    expect(fixture.document?.components.schemas).not.toHaveProperty(
      "ApiSiteSettingSiteSettingCreateRequest",
    );
  });
});
/* oxlint-enable unicorn/no-null */
