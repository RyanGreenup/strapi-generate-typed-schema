import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ValidateFunction } from "ajv";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JsonSchema, OpenApiDocument, Operation } from "../src/index.js";

import {
  buildDocument,
  generateSpecification,
  readContentTypes,
  readRoutes,
  readRouteSource,
} from "../src/index.js";
import { toRecord } from "../src/json.js";
import { readableSchemaName, renameSchemas } from "../src/schema-names.js";

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
  it("reads kind, names and options from each schema.json", async () => {
    const contentTypes = await readContentTypes(project);

    expect(contentTypes).toStrictEqual([
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
    ]);
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

  it("warns about a core router for an unknown content type", () => {
    const result = readRouteSource(
      'export default createCoreRouter("api::missing.missing");',
      { apiName: "missing", contentTypes: [], file: "routes/missing.ts" },
    );

    expect(result.routes).toStrictEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("warns about a file without routes", () => {
    const result = readRouteSource("export default {};", {
      apiName: "empty",
      contentTypes: [],
      file: "routes/empty.ts",
    });

    expect(result.warnings).toStrictEqual([
      "routes/empty.ts: no routes were found in this file",
    ]);
  });
});

describe("buildDocument", () => {
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
  it("names a generic schema after its UID", () => {
    expect(
      readableSchemaName(
        "RestAnyDocumentapi_x3A__x3A_page_x2E_page-x7AB9B112138960C0",
      ),
    ).toBe("ApiPagePageDocument");
    expect(readableSchemaName("RestError")).toBe("RestError");
  });

  it("renames keys and references together", () => {
    const generated = "ComponentInputshared_x2E_seo-xF8A29A5A1753DD2C";
    const renamed = renameSchemas({
      [generated]: { type: "object" },
      Page: { $ref: `#/components/schemas/${generated}` },
    });

    expect(renamed).toStrictEqual({
      Page: { $ref: "#/components/schemas/SharedSeoEntryInput" },
      SharedSeoEntryInput: { type: "object" },
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

describe("generated response validation", () => {
  let directory: string | undefined;
  let document: OpenApiDocument;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);

  const published = {
    id: 1,
    documentId: "fixture",
    publishedAt: "2026-11-17T00:00:00.000Z",
  };
  const draft = { ...published, publishedAt: null };
  const compileSchema = (schema: JsonSchema): ValidateFunction =>
    ajv.compile({ components: document.components, ...schema });
  const validateDocument = (name: string): ValidateFunction =>
    compileSchema({ $ref: `#/components/schemas/${name}` });

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "strapi-openapi-test-"));
    await cp(project, directory, { recursive: true });
    const generated = path.join(directory, "types", "generated");
    const modules = path.join(directory, "node_modules", "@strapi");
    await Promise.all([
      mkdir(generated, { recursive: true }),
      mkdir(modules, { recursive: true }),
    ]);
    await Promise.all([
      cp(
        fileURLToPath(new URL("fixtures/generated-types", import.meta.url)),
        generated,
        { recursive: true },
      ),
      symlink(
        path.dirname(
          createRequire(import.meta.url).resolve("@strapi/strapi/package.json"),
        ),
        path.join(modules, "strapi"),
      ),
    ]);
    ({ document } = await generateSpecification({
      projectDirectory: directory,
    }));
  }, 600_000);

  afterAll(async () => {
    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
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
      expect(validate({ ...published, ...invalid }), JSON.stringify(invalid)).toBe(
        false,
      );
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
      expect(validate({ ...draft, ...valid }), JSON.stringify(valid)).toBe(true);
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
      expect(validate({ ...draft, ...invalid }), JSON.stringify(invalid)).toBe(
        false,
      );
    }
  });

  it("keeps selected fields and populated attributes optional in both states", () => {
    for (const [name, entry] of [
      ["ApiArticleArticlePublishedDocument", published],
      ["ApiArticleArticleDraftDocument", draft],
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
      expect(validatePublished({ ...published, seo }), JSON.stringify(seo)).toBe(
        false,
      );
    }
    for (const seo of [
      null,
      [],
      [{ id: 1, heading: "" }],
      [{ id: 1, heading: null }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    ]) {
      expect(validateDraft({ ...draft, seo }), JSON.stringify(seo)).toBe(true);
    }
    expect(
      validateDraft({ ...draft, seo: [{ id: 1, heading: "123456789" }] }),
    ).toBe(false);
    expect(
      validateDraft({
        ...draft,
        page: { id: 2, documentId: "page", title: "1234" },
      }),
    ).toBe(false);
  });

  it("uses the draft/published union in real list and single operation responses", () => {
    for (const [route, entries] of [
      ["/articles", true],
      ["/articles/{id}", false],
    ] as const) {
      const operation = document.paths[route]?.["get"];
      const responses = toRecord(operation?.["responses"]);
      const content = toRecord(toRecord(responses["200"])["content"]);
      const schema = toRecord(toRecord(content["application/json"])["schema"]);
      const validate = compileSchema(schema);
      const response = (entry: unknown): JsonSchema => ({
        data: entries ? [entry] : entry,
        meta: entries ? { pagination: { page: 1, pageSize: 10 } } : {},
      });
      expect(validate(response({ ...published, title: "12345" }))).toBe(true);
      expect(validate(response({ ...draft, title: "", email: "invalid" }))).toBe(
        true,
      );
      expect(validate(response({ ...published, title: "1234" }))).toBe(false);
      expect(validate(response({ ...draft, title: "12345678901" }))).toBe(false);
    }
  });

  it("keeps non-draft content types strict and omits unsupported single-type aliases", () => {
    const validate = validateDocument("ApiPagePageDocument");
    const page = { id: 1, documentId: "page" };
    expect(validate(page)).toBe(true);
    expect(validate({ ...page, title: "12345" })).toBe(true);
    expect(validate({ ...page, title: "1234" })).toBe(false);
    expect(validate({ ...page, title: null })).toBe(false);
    expect(document.components.schemas).not.toHaveProperty(
      "ApiSiteSettingSiteSettingListResponse",
    );
    expect(document.components.schemas).not.toHaveProperty(
      "ApiSiteSettingSiteSettingCreateRequest",
    );
  });
});
