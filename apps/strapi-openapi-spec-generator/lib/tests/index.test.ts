import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { OpenApiDocument, Operation } from "../src/index.js";

import {
  buildDocument,
  entrySource,
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

describe("entrySource", () => {
  it("declares one alias per schema and no list or create alias for a single type", async () => {
    const source = entrySource(await readContentTypes(project));

    expect(source).toContain(
      'type ApiArticleArticleListResponse = RestAnyFind<"api::article.article">;',
    );
    expect(source).toContain(
      'type ApiSiteSettingSiteSettingUpdateRequest = RestUpdateBody<"api::site-setting.site-setting">;',
    );
    expect(source).not.toContain("ApiSiteSettingSiteSettingListResponse");
    expect(source).not.toContain("ApiSiteSettingSiteSettingCreateRequest");
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
