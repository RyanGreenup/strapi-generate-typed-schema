import assert from "node:assert/strict";
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
import { isUnknownArray, toRecord } from "../src/json.js";
import { readRoutes } from "../src/routes.js";
import { renameSchemas, validateSchemaRefs } from "../src/schema-names.js";
import { readDiscovery } from "../src/work-directory.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

const project = fileURLToPath(new URL("fixtures/project", import.meta.url));
const queryEnums = {
  status: ["draft", "published"],
  publicationFilter: [
    "never-published",
    "has-published-version",
    "modified",
    "unmodified",
    "never-published-document",
    "has-published-version-document",
    "published-without-draft",
    "published-with-draft",
  ],
};

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
    queryEnums,
    contentTypes: contentTypes.map((model) =>
      Object.assign(model, { selectableFields: ["id", "documentId"] }),
    ),
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
        privateAttributes: [],
        pluralName: "articles",
        singularName: "article",
        uid: "api::article.article",
      },
      {
        apiName: "page",
        draftAndPublish: false,
        kind: "collectionType",
        localized: true,
        privateAttributes: ["editorNote"],
        pluralName: "pages",
        singularName: "page",
        uid: "api::page.page",
      },
      {
        apiName: "site-setting",
        draftAndPublish: false,
        kind: "singleType",
        localized: false,
        privateAttributes: ["id", "documentId", "siteName"],
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
      const contentTypes = await readContentTypes(project);
      const { paths } = buildDocument({
        queryEnums,
        contentTypes: contentTypes.map((model) =>
          Object.assign(model, { selectableFields: ["id", "documentId"] }),
        ),
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
              $ref: "#/components/schemas/ApiArticleArticlePublishedCreateRequest",
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

const ref = (name: string): { $ref: string } => ({
  $ref: `#/components/schemas/${name}`,
});

describe("renameSchemas", () => {
  it("retains boolean components, inline roots and flattened public aliases", () => {
    expect(
      renameSchemas({ t0: false, t1: true, Extra: ref("t0") }, [
        { name: "Never", schema: ref("t0") },
        { name: "AlsoNever", schema: ref("t0") },
        { name: "Anything", schema: ref("t1") },
        { name: "Inline", schema: { items: ref("t0") } },
        { name: "InlineFalse", schema: false },
      ]),
    ).toStrictEqual({
      Never: { not: {} },
      AlsoNever: ref("Never"),
      Anything: {},
      Inline: { items: ref("Never") },
      InlineFalse: { not: {} },
      Extra: ref("Never"),
    });
  });

  it("rewrites only local schema references, never property names or payloads", () => {
    const generated = "unrelated~component/name";
    const old = ref("unrelated~0component~1name");
    const data = { ...old, nested: [ref("NotASchema")] };
    const payload = {
      title: generated,
      description: old.$ref,
      enum: [generated, old.$ref, data],
      const: data,
      default: data,
      examples: [data],
      "x-strapi-conditions": data,
      required: [generated],
    };
    const remote = { $ref: `https://example.test/schema.json${old.$ref}` };
    const renamed = renameSchemas(
      {
        [generated]: { type: "object" },
        Consumer: { ...payload, properties: { [generated]: old, remote } },
      },
      [{ name: "Model", schema: old }],
    );
    expect(renamed).toStrictEqual({
      Model: { type: "object" },
      Consumer: {
        ...payload,
        properties: { [generated]: ref("Model"), remote },
      },
    });
  });

  it("renames discriminator mapping targets without changing tag keys, examples or input schemas", () => {
    const target = ref("t0").$ref;
    const mapping = {
      "media.image": target,
      t0: "t0",
      remote: `https://example.test/schema.json${target}`,
      relative: `./schema.json${target}`,
    };
    const discriminator = { propertyName: "t0", mapping };
    const raw = {
      t0: {},
      Blocks: {
        items: { oneOf: [ref("t0")], discriminator },
        examples: [{ discriminator }],
      },
    };
    const renamed = renameSchemas(raw, [{ name: "Image", schema: ref("t0") }]);
    const image = ref("Image");
    expect(renamed["Blocks"]).toStrictEqual({
      items: {
        oneOf: [image],
        discriminator: {
          propertyName: "t0",
          mapping: { ...mapping, "media.image": image.$ref, t0: image.$ref },
        },
      },
      examples: [{ discriminator }],
    });
    expect(raw.Blocks.items.discriminator.mapping["media.image"]).toBe(target);
    expect(raw.Blocks.items.discriminator.mapping.t0).toBe("t0");
  });

  it.each(["missing", "#/components/schemas/missing"])(
    "rejects a missing discriminator mapping target %s during renaming and final validation",
    (target) => {
      const raw = {
        Blocks: {
          items: {
            discriminator: {
              propertyName: "__component",
              mapping: { "media.image": target },
            },
          },
        },
      };
      expect(() => renameSchemas(raw, [])).toThrow(/Unresolved.*missing/u);
      expect(() => {
        validateSchemaRefs(raw);
      }).toThrow(/Unresolved.*missing/u);
    },
  );

  it("groups only bare state references from the same model, retaining constraints and null", () => {
    const pair = [ref("a"), ref("b")];
    const restricted = [{ ...ref("a"), required: ["publishedAt"] }, ref("b")];
    const renamed = renameSchemas(
      {
        a: { type: "object" },
        b: { type: "object" },
        Outer: {
          properties: {
            relation: { oneOf: pair, minProperties: 2 },
            nullable: { oneOf: [...pair, { type: "null" }] },
            restricted: { oneOf: restricted },
          },
        },
        LookalikeDraftDocument: {},
        LookalikePublishedDocument: {},
        Unrelated: {
          oneOf: [
            ref("LookalikeDraftDocument"),
            ref("LookalikePublishedDocument"),
          ],
        },
      },
      [
        {
          uid: "project.model",
          name: "Public",
          state: "published",
          schema: ref("a"),
        },
        {
          uid: "project.model",
          name: "Preview",
          state: "draft",
          schema: ref("b"),
        },
        {
          uid: "project.model",
          name: "Entry",
          state: "document",
          schema: { oneOf: pair },
        },
      ],
    );
    expect(renamed["Entry"]).toStrictEqual({
      anyOf: [ref("Public"), ref("Preview")],
    });
    expect(renamed["Outer"]).toStrictEqual({
      properties: {
        relation: { ...ref("Entry"), minProperties: 2 },
        nullable: { oneOf: [ref("Entry"), { type: "null" }] },
        restricted: {
          oneOf: [
            { ...ref("Public"), required: ["publishedAt"] },
            ref("Preview"),
          ],
        },
      },
    });
    expect(renamed["Unrelated"]).toStrictEqual({
      oneOf: [ref("LookalikeDraftDocument"), ref("LookalikePublishedDocument")],
    });
  });

  it("does not impose a constrained document root on other unions of its states", () => {
    const pair = [ref("P"), ref("D")];
    const renamed = renameSchemas(
      {
        P: {},
        D: {},
        Other: { oneOf: pair, minProperties: 1 },
      },
      [
        { uid: "u", name: "P", state: "published", schema: ref("P") },
        { uid: "u", name: "D", state: "draft", schema: ref("D") },
        {
          uid: "u",
          name: "Entry",
          state: "document",
          schema: {
            oneOf: pair,
            required: ["special"],
          },
        },
      ],
    );
    expect(renamed["Entry"]).toStrictEqual({
      anyOf: pair,
      required: ["special"],
    });
    expect(renamed["Other"]).toStrictEqual({ anyOf: pair, minProperties: 1 });
  });

  it("refuses ambiguous public names even when typia shares the target", () => {
    expect(() =>
      renameSchemas({ helper: {} }, [
        { name: "Same", uid: "shared.seo", schema: ref("helper") },
        { name: "Same", uid: "shared-seo", schema: ref("helper") },
      ]),
    ).toThrow(/Same.*shared\.seo.*shared-seo/u);
    expect(() =>
      renameSchemas({ Same: {}, helper: {} }, [
        { name: "Same", schema: ref("helper") },
      ]),
    ).toThrow(/Ambiguous.*Same/u);
  });

  it("rejects missing local targets in roots and nested schemas before renaming", () => {
    expect(() =>
      renameSchemas({}, [{ name: "Missing", schema: ref("Missing") }]),
    ).toThrow(/Unresolved.*Missing/u);
    expect(() =>
      renameSchemas(
        {
          Actual: false,
          Consumer: { anyOf: [{ items: ref("Public") }] },
        },
        [{ name: "Public", schema: ref("Actual") }],
      ),
    ).toThrow(/Unresolved.*Public/u);
  });

  it.each([
    "#/wrong/path",
    "#missing",
    "#/components/schemas/Model/properties/id",
  ])("rejects unsupported local component pointer %s", ($ref) => {
    expect(() => renameSchemas({ Model: { $ref } }, [])).toThrow(
      "Expected a local schema component reference",
    );
  });
});

describe("readDiscovery", () => {
  it.each(["status", "publicationFilter"])(
    "rejects an empty %s enum",
    (name) => {
      const input = {
        components: [],
        contentTypes: [],
        cacheDirectory: project,
        projectDirectory: project,
      };
      const output = {
        related: [],
        components: [],
        drafts: [],
        selectable: {},
        ...queryEnums,
        [name]: [],
      };
      expect(() => readDiscovery(input, JSON.stringify(output))).toThrow(
        `empty enum for ${name}`,
      );
    },
  );
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

const publicationEnum = (
  document: OpenApiDocument,
  name: string,
): unknown[] => {
  const { parameters } = toRecord(document.paths["/articles"]?.["get"]);
  assert.ok(isUnknownArray(parameters));
  const parameter = parameters.find(
    (value) => toRecord(value)["name"] === name,
  );
  const { enum: values } = toRecord(toRecord(parameter)["schema"]);
  assert.ok(isUnknownArray(values));
  return values;
};

const requestBodySchema = (operation: Operation | undefined): JsonSchema => {
  const content = toRecord(toRecord(operation?.["requestBody"])["content"]);
  return toRecord(toRecord(content["application/json"])["schema"]);
};

// oxlint-disable-next-line unicorn/no-null -- JSON payloads distinguish null from omitted fields.
const jsonNull = null;

describe("generated specification validation", () => {
  const fixture = generatedFixture();
  const { compileSchema, validateDocument, validateQuery } = fixture;
  const generatedDocument = (): OpenApiDocument => {
    const { document } = fixture;
    assert.ok(document !== undefined);
    return document;
  };

  describe("query parameters", () => {
    it("reflects the installed publication enums on every generation", async () => {
      const { directory } = fixture;
      assert.ok(directory !== undefined);
      const { document: second } = await generateSpecification({
        projectDirectory: directory,
      });
      for (const [name, expected] of Object.entries(queryEnums)) {
        const values = publicationEnum(generatedDocument(), name);
        expect(values).toHaveLength(expected.length);
        expect(values).toStrictEqual(expect.arrayContaining(expected));
        expect(publicationEnum(second, name)).toStrictEqual(values);
        expect(parameterNames(second.paths["/pages"]?.["get"])).not.toContain(
          name,
        );
      }
    }, 600_000);

    it.each([
      {},
      { withCount: true },
      { page: 1 },
      { pageSize: 3 },
      { start: 0 },
      { page: 2, pageSize: 3 },
      { start: 0, limit: 3 },
      { limit: -1 },
      { limit: 0 },
    ])("accepts article pagination %j", (value) => {
      expect(validateQuery("/articles", "pagination")(value)).toBe(true);
    });

    it.each([
      { page: 1, start: 0 },
      { page: 1, limit: 3 },
      { pageSize: 3, start: 0 },
      { pageSize: 3, limit: 3 },
      { page: 0 },
      { pageSize: 0 },
      { start: -1 },
      { limit: -2 },
      { limit: 1.5 },
    ])("rejects article pagination %j", (value) => {
      expect(validateQuery("/articles", "pagination")(value)).toBe(false);
    });

    it.each([
      { fields: "*" },
      { fields: "  title, slug , publishedAt  " },
      { fields: "*,title" },
      { fields: ["title,*", "slug"] },
      { fields: ["*", "email"] },
      { fields: ["id, documentId", "createdAt", "updatedAt"] },
    ])("accepts selectable article fields $fields", ({ fields }) => {
      expect(validateQuery("/articles", "fields")(fields)).toBe(true);
    });

    it.each([
      { fields: "" },
      { fields: "title," },
      { fields: "*,notAField" },
      { fields: "notAField" },
      { fields: "locale" },
      { fields: "page" },
      { fields: "seo" },
      { fields: "cover" },
      { fields: "blocks" },
      { fields: ["title", "plugin$date"] },
      { fields: "pluginJson" },
      { fields: ["id", "unknown"] },
      { fields: { title: true } },
    ])("rejects invalid selections of article fields $fields", ({ fields }) => {
      expect(validateQuery("/articles", "fields")(fields)).toBe(false);
    });

    it.each(["plugin$date", "pluginJson", "locale,title", "publishedAt"])(
      "accepts selectable page fields %s",
      (fields) => {
        expect(validateQuery("/pages", "fields")(fields)).toBe(true);
      },
    );

    it.each([
      "slug",
      "editorNote",
      "passcode",
      "secret",
      "pluginComponent",
      "pluginPassword",
      "pluginPrivate",
      "createdBy",
    ])("rejects nonselectable page fields %s", (fields) => {
      expect(validateQuery("/pages", "fields")(fields)).toBe(false);
    });

    it("allows a wildcard when every field is private", () => {
      expect(validateQuery("/site-setting", "fields")("*")).toBe(true);
    });

    it.each([
      { fields: "" },
      { fields: "*," },
      { fields: ["*,"] },
      { fields: "siteName" },
      { fields: "id" },
      { fields: "documentId" },
    ])("rejects private or empty site-setting fields $fields", ({ fields }) => {
      expect(validateQuery("/site-setting", "fields")(fields)).toBe(false);
    });
  });

  describe("schema metadata", () => {
    it("retains referenced published schemas for populated targets", () => {
      const {
        components: { schemas },
      } = generatedDocument();
      for (const name of [
        "PluginUploadFilePublishedDocument",
        "ApiPagePagePublishedDocument",
        "SharedSeoPublishedDocument",
        "SharedConditionalLinkPublishedDocument",
      ]) {
        expect(schemas).toHaveProperty(name);
      }
      validateSchemaRefs(schemas);
    });

    it.each(["PublishedDocument", "PublishedCreateInput", "DraftUpdateInput"])(
      "preserves article uniqueness and media metadata for %s",
      (suffix) => {
        const { schemas } = generatedDocument().components;
        expect(schemas[`ApiArticleArticle${suffix}`]).toMatchObject({
          properties: {
            title: { "x-strapi-unique": true },
            cover: { "x-strapi-allowed-types": ["images"] },
          },
        });
      },
    );

    it.each(["PublishedCreateInput", "DraftUpdateInput"])(
      "describes numeric coercion and configured bounds for article %s",
      (suffix) => {
        const { schemas } = generatedDocument().components;
        expect(schemas[`ApiArticleArticle${suffix}`]).toMatchObject({
          properties: {
            rating: {
              "x-strapi-coerces-numeric-string": true,
              "x-strapi-configured-bounds": { minimum: 2, maximum: 8 },
            },
          },
        });
      },
    );

    it("does not annotate response numeric coercion or infer uniqueness from another model", () => {
      const { schemas } = generatedDocument().components;
      const article = toRecord(
        schemas["ApiArticleArticlePublishedDocument"]?.["properties"],
      );
      const page = toRecord(
        schemas["ApiPagePagePublishedDocument"]?.["properties"],
      );
      expect(article["rating"]).not.toHaveProperty(
        "x-strapi-coerces-numeric-string",
      );
      expect(page["title"]).not.toHaveProperty("x-strapi-unique");
    });

    it.each([
      ["PublishedCreateEntryInput", { required: ["url"] }],
      ["DraftCreateBlockInput", {}],
    ] as const)(
      "preserves conditional component metadata for %s",
      (suffix, constraints) => {
        const { schemas } = generatedDocument().components;
        const schema = schemas[`SharedConditionalLink${suffix}`];
        expect(schema).toMatchObject({
          properties: {
            active: { default: false },
            weight: { default: 0, "x-strapi-coerces-numeric-string": true },
            attachment: { "x-strapi-allowed-types": ["images", "files"] },
            url: { "x-strapi-unique": true },
          },
        });
        const { allOf, properties } = toRecord(schema);
        assert.ok(isUnknownArray(allOf));
        const conditionalBranches = allOf.map(
          (branch) => toRecord(branch)["then"],
        );
        const uniqueUrl: unknown = expect.objectContaining({
          "x-strapi-unique": true,
        });
        expect(conditionalBranches).toContainEqual({
          properties: { url: uniqueUrl },
          ...constraints,
        });
        expect(toRecord(properties)["weight"]).not.toHaveProperty(
          "x-strapi-configured-bounds",
        );
      },
    );

    it("omits unsupported single-type aliases", () => {
      expect(fixture.document?.components.schemas).not.toHaveProperty(
        "ApiSiteSettingSiteSettingListResponse",
      );
      expect(fixture.document?.components.schemas).not.toHaveProperty(
        "ApiSiteSettingSiteSettingCreateRequest",
      );
    });
  });

  describe("request validation", () => {
    it.each([
      ["/articles", "post"],
      ["/articles/{id}", "put"],
    ] as const)(
      "validates published writes by default and incomplete drafts for %s %s",
      (route, method) => {
        const operation = generatedDocument().paths[route]?.[method];
        const validatePublished = compileSchema(requestBodySchema(operation));
        expect(validatePublished({ data: { title: jsonNull } })).toBe(false);
        const status = toRecord(operation?.["x-strapi-request-status"]);
        const validate = compileSchema(
          toRecord(toRecord(status["schemas"])["draft"]),
        );
        expect(
          validate({
            data: { seo: [], title: jsonNull, email: "invalid", rating: -1 },
          }),
        ).toBe(true);
        expect(validate({ data: { seo: [], title: "12345678901" } })).toBe(
          false,
        );
      },
    );

    it("requires data fields for a create that defaults to published", () => {
      const operation = generatedDocument().paths["/articles"]?.["post"];
      const validate = compileSchema(requestBodySchema(operation));
      expect(validate({ data: {} })).toBe(false);
    });

    it("accepts numeric strings on create in both states", () => {
      const data = {
        title: "12345",
        email: "a@b.co",
        seo: [{ heading: "SEO" }],
      };
      for (const state of ["Published", "Draft"]) {
        const validate = validateDocument(
          `ApiArticleArticle${state}CreateRequest`,
        );
        expect(
          validate({ data: { ...data, price: "12.34", rating: "3" } }),
        ).toBe(true);
        expect(validate({ data: { ...data, rating: "abc" } })).toBe(false);
      }
    });

    it("exposes publication-specific create constraints without requiring defaulted or relational attributes", () => {
      const validate = validateDocument(
        "ApiArticleArticlePublishedCreateRequest",
      );
      const data = {
        title: "12345",
        email: "a@b.co",
        seo: [{ heading: "SEO" }],
      };
      expect(validate({ data })).toBe(true);
      expect(
        validate({
          data: { ...data, page: jsonNull, cover: jsonNull, blocks: [] },
        }),
      ).toBe(true);
      for (const invalid of [
        { title: jsonNull },
        { title: "1234" },
        { email: "invalid" },
        { email: jsonNull },
        { rating: 1 },
        { rating: 9 },
        { rating: 2.5 },
        { price: 0.4 },
        { price: 10.6 },
        { label: jsonNull },
        { slug: "a b" },
        { slug: "ab" },
        { seo: [] },
        { seo: jsonNull },
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
        {
          seo: [{}],
          title: jsonNull,
          email: jsonNull,
          rating: -1,
          price: -0.5,
        },
        {
          seo: [{ heading: jsonNull }],
          summary: jsonNull,
          slug: "space ok",
          label: jsonNull,
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
        { seo: jsonNull },
        { blocks: jsonNull },
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
        { page: jsonNull, cover: jsonNull },
      ]) {
        expect(validate({ data })).toBe(true);
      }
      for (const data of [
        { title: jsonNull },
        { label: jsonNull },
        { seo: [{}] },
        { summary: {} },
        { seo: [{ id: 1, heading: jsonNull }] },
        { seo: [{ id: 1 }, {}] },
        { blocks: [{ __component: "shared.seo" }] },
        { blocks: [{ id: 1 }] },
        { blocks: [{ __component: "shared.seo", heading: "ab" }] },
      ]) {
        expect(validate({ data })).toBe(false);
      }
    });

    it("allows incomplete components and null titles in draft updates", () => {
      const validateDraftUpdate = validateDocument(
        "ApiArticleArticleDraftUpdateRequest",
      );
      expect(validateDraftUpdate({ data: {} })).toBe(true);
      expect(
        validateDraftUpdate({
          data: { seo: [{}], summary: {}, title: jsonNull },
        }),
      ).toBe(true);
    });

    it("keeps non-draft writes strict", () => {
      const validatePage = validateDocument("ApiPagePageCreateRequest");
      expect(validatePage({ data: { title: "12345" } })).toBe(true);
      expect(validatePage({ data: {} })).toBe(false);
      expect(validatePage({ data: { title: jsonNull } })).toBe(false);
      expect(validatePage({ data: { title: "1234" } })).toBe(false);
    });

    it("keeps the default short-text maximum in draft and published updates", () => {
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
      const data = {
        title: "12345",
        email: "a@b.co",
        seo: [{ heading: "SEO" }],
      };
      for (const wrap of [
        (link: JsonSchema): JsonSchema => ({ link }),
        (link: JsonSchema): JsonSchema => ({
          blocks: [{ __component: "shared.conditional-link", ...link }],
        }),
      ]) {
        for (const link of [
          { label: "x" },
          { kind: "internal", label: "x" },
          { kind: "internal", label: "x", url: jsonNull },
          { kind: "external", label: "x", url: "/target" },
        ]) {
          expect(validate({ data: { ...data, ...wrap(link) } })).toBe(true);
        }
        for (const link of [
          { kind: "external", label: "x" },
          { kind: "external", label: "x", url: "" },
          { kind: "external", label: "x", url: jsonNull },
          { kind: "internal", label: "" },
        ]) {
          expect(validate({ data: { ...data, ...wrap(link) } })).toBe(false);
        }
      }
    });

    it("relaxes conditional validation for retained components in published updates", () => {
      const update = validateDocument(
        "ApiArticleArticlePublishedUpdateRequest",
      );
      expect(update({ data: { link: { id: 1 } } })).toBe(true);
      expect(update({ data: { link: { kind: "external", label: "x" } } })).toBe(
        false,
      );
      expect(update({ data: { link: { id: 1, url: jsonNull } } })).toBe(true);
    });
  });

  describe("response validation", () => {
    const published = {
      id: 1,
      documentId: "fixture",
      publishedAt: "2026-11-17T00:00:00.000Z",
    };
    const draftEntry = { ...published, publishedAt: jsonNull };

    it("requires JSON numbers in responses", () => {
      const response = validateDocument("ApiArticleArticlePublishedDocument");
      expect(response({ ...published, rating: 3 })).toBe(true);
      expect(response({ ...published, rating: "3" })).toBe(false);
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
          validate({
            ...published,
            ...wrap({ kind: "internal", url: jsonNull }),
          }),
        ).toBe(true);
        expect(
          validate({
            ...published,
            ...wrap({ kind: "external", url: "/target" }),
          }),
        ).toBe(true);
        expect(validate({ ...published, ...wrap({ url: jsonNull }) })).toBe(
          true,
        );
        expect(
          validate({ ...published, ...wrap({ kind: "external", url: "" }) }),
        ).toBe(false);
        expect(
          validate({
            ...published,
            ...wrap({ kind: "external", url: jsonNull }),
          }),
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
        { title: jsonNull },
        { email: "not-an-email" },
        { email: "a@b.c" },
        { email: `${"a".repeat(35)}@x.com` },
        { email: jsonNull },
        { rating: 1 },
        { rating: 9 },
        { rating: 2.5 },
        { price: 0.4 },
        { price: 10.6 },
        { publishedAt: jsonNull },
      ]) {
        expect(validate({ ...published, ...invalid })).toBe(false);
      }
    });

    it("relaxes draft required, minimum length, email and numeric minimum rules only", () => {
      const validate = validateDocument("ApiArticleArticleDraftDocument");
      for (const valid of [
        { title: "" },
        { title: "1234" },
        { title: jsonNull, email: jsonNull },
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
        expect(validate({ ...entry, seo: [{ id: 1 }], page: jsonNull })).toBe(
          true,
        );
        expect(validate({ ...entry, rating: jsonNull, price: jsonNull })).toBe(
          true,
        );
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
        jsonNull,
        [],
        [{ id: 1, heading: "ab" }],
        [{ id: 1, heading: jsonNull }],
        [{ id: 1 }, { id: 2 }, { id: 3 }],
      ]) {
        expect(validatePublished({ ...published, seo })).toBe(false);
      }
      for (const seo of [
        jsonNull,
        [],
        [{ id: 1, heading: "" }],
        [{ id: 1, heading: jsonNull }],
        [{ id: 1 }, { id: 2 }, { id: 3 }],
      ]) {
        expect(validateDraft({ ...draftEntry, seo })).toBe(true);
      }
      expect(
        validateDraft({
          ...draftEntry,
          seo: [{ id: 1, heading: "123456789" }],
        }),
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
        const schema = toRecord(
          toRecord(content["application/json"])["schema"],
        );
        const validate = compileSchema(schema);
        expect(validate(response({ ...published, title: "12345" }))).toBe(true);
        expect(
          validate(response({ ...draftEntry, title: "", email: "invalid" })),
        ).toBe(true);
        expect(validate(response({ ...published, title: "1234" }))).toBe(false);
        expect(
          validate(response({ ...draftEntry, title: "12345678901" })),
        ).toBe(false);
      },
    );

    it("keeps non-draft content types strict", () => {
      const validate = validateDocument("ApiPagePageDocument");
      const page = { id: 1, documentId: "page" };
      expect(validate(page)).toBe(true);
      expect(validate({ ...page, title: "12345" })).toBe(true);
      expect(validate({ ...page, title: "1234" })).toBe(false);
      expect(validate({ ...page, title: jsonNull })).toBe(false);
    });
  });
});
