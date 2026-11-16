import addFormats from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OpenApiDocument } from "../src/index.js";

import { generateSpecification } from "../src/index.js";
import { parseJsonObject, toRecord } from "../src/json.js";

/** A relation, a component, a media field and a dynamic zone. */
const STRUCTURED = ["page", "summary", "cover", "blocks"] as const;
/** Make every structured field visible only when `rating` is 2. */
const hideStructured = (
  model: Record<string, unknown>,
): Record<string, unknown> => {
  const attributes = toRecord(model["attributes"]);
  for (const key of STRUCTURED) {
    toRecord(attributes[key])["conditions"] = {
      visible: { "==": [{ var: "rating" }, 2] },
    };
  }
  return model;
};

/* oxlint-disable unicorn/no-null -- Hidden fields can retain null values. */
describe("generated conditional attribute validation", () => {
  let directory: string;
  let document: OpenApiDocument;
  let warnings: string[];
  const ajv = new Ajv2020({ strict: false });
  const published = {
    id: 1,
    documentId: "conditional",
    publishedAt: "2026-11-17T00:00:00.000Z",
  };
  const request = { email: "a@b.co", seo: [{ heading: "active" }] };
  const validate = (name: string) =>
    ajv.compile({
      components: document.components,
      $ref: `#/components/schemas/${name}`,
    });

  beforeAll(async () => {
    addFormats(ajv);
    directory = await mkdtemp(
      path.join(os.tmpdir(), "strapi-conditions-test-"),
    );
    await cp(
      fileURLToPath(new URL("fixtures/project", import.meta.url)),
      directory,
      { recursive: true },
    );
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
    // Conditions are deliberately present only in source JSON, like Strapi's
    // generated declarations, which discard conditions.visible.
    const articleFile = path.join(
      directory,
      "src/api/article/content-types/article/schema.json",
    );
    const article = parseJsonObject(await readFile(articleFile, "utf8"));
    const attributes = toRecord(article["attributes"]);
    toRecord(attributes["rating"])["default"] = 2;
    toRecord(attributes["title"])["conditions"] = {
      visible: { "==": [{ var: "rating" }, 2] },
    };
    toRecord(attributes["email"])["conditions"] = {
      visible: { unsupported: [{ var: "rating" }, 2] },
    };
    toRecord(attributes["price"])["conditions"] = {
      visible: {
        and: [
          {
            or: [
              { "===": [{ var: "rating" }, 2] },
              { in: [{ var: "rating" }, [3, 4]] },
            ],
          },
          { "!": [{ "!=": [{ var: "title" }, "12345"] }] },
        ],
      },
    };
    await writeFile(articleFile, JSON.stringify(hideStructured(article)));
    const componentFile = path.join(
      directory,
      "src/components/shared/seo.json",
    );
    const component = parseJsonObject(await readFile(componentFile, "utf8"));
    toRecord(toRecord(component["attributes"])["heading"])["conditions"] = {
      visible: { in: [{ var: "heading" }, ["active", "on"]] },
    };
    await writeFile(componentFile, JSON.stringify(component));
    ({ document, warnings } = await generateSpecification({
      projectDirectory: directory,
    }));
  }, 600_000);

  afterAll(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains visible response bounds but permits retained hidden values and field selection", () => {
    const accepts = validate("ApiArticleArticlePublishedDocument");
    expect(accepts({ ...published, rating: 2, title: "12345" })).toBe(true);
    for (const title of [null, "x", "12345678901"]) {
      expect(accepts({ ...published, rating: 2, title })).toBe(false);
      expect(accepts({ ...published, rating: 3, title })).toBe(true);
      expect(accepts({ ...published, title })).toBe(true);
    }
    expect(accepts({ ...published, rating: 2 })).toBe(true);
    // Serialization still makes a string field a string, even when invisible.
    expect(accepts({ ...published, rating: 3, title: 123 })).toBe(false);
  });

  it("uses create defaults for conditional required fields and only written update values", () => {
    const create = validate("ApiArticleArticlePublishedCreateInput");
    expect(create({ ...request })).toBe(false);
    expect(create({ ...request, title: "12345" })).toBe(true);
    expect(create({ ...request, rating: 3 })).toBe(true);
    expect(create({ ...request, rating: 3, title: null })).toBe(true);
    expect(create({ ...request, rating: 2, title: "x" })).toBe(false);
    const update = validate("ApiArticleArticlePublishedUpdateInput");
    expect(update({ title: null })).toBe(true);
    expect(update({ rating: 2, title: null })).toBe(false);
    expect(update({ rating: 2 })).toBe(true);
    expect(update({ rating: 3, title: "far beyond the normal maximum" })).toBe(
      true,
    );
  });

  it("compiles conjunction, disjunction, negation, inequality and enum membership", () => {
    const accepts = validate("ApiArticleArticlePublishedDocument");
    for (const rating of [2, 3, 4]) {
      expect(
        accepts({ ...published, rating, title: "12345", price: 0.4 }),
      ).toBe(false);
      expect(
        accepts({ ...published, rating, title: "12345", price: 0.5 }),
      ).toBe(true);
    }
    expect(
      accepts({ ...published, rating: 5, title: "12345", price: -1 }),
    ).toBe(true);
    expect(
      accepts({ ...published, rating: 3, title: "other", price: null }),
    ).toBe(true);
    expect(accepts({ ...published, rating: 3, price: -1 })).toBe(true);
  });

  it("applies source component conditions through named response and request references", () => {
    const response = validate("ApiArticleArticlePublishedDocument");
    expect(response({ ...published, seo: [{ id: 1, heading: null }] })).toBe(
      true,
    );
    expect(response({ ...published, seo: [{ id: 1, heading: "on" }] })).toBe(
      false,
    );
    expect(
      response({ ...published, seo: [{ id: 1, heading: "active" }] }),
    ).toBe(true);
    const create = validate("ApiArticleArticlePublishedCreateInput");
    expect(
      create({ ...request, title: "12345", seo: [{ heading: null }] }),
    ).toBe(true);
    expect(
      create({ ...request, title: "12345", seo: [{ heading: "on" }] }),
    ).toBe(false);
  });

  it("retains draft visible maxima without reintroducing draft required or minimum rules", () => {
    const draft = validate("ApiArticleArticleDraftDocument");
    expect(
      draft({ ...published, publishedAt: null, rating: 2, title: null }),
    ).toBe(true);
    expect(
      draft({ ...published, publishedAt: null, rating: 2, title: "x" }),
    ).toBe(true);
    expect(
      draft({
        ...published,
        publishedAt: null,
        rating: 2,
        title: "12345678901",
      }),
    ).toBe(false);
    expect(
      draft({
        ...published,
        publishedAt: null,
        rating: 3,
        title: "12345678901",
      }),
    ).toBe(true);
    const create = validate("ApiArticleArticleDraftCreateInput");
    expect(create({ seo: [] })).toBe(true);
  });

  it("keeps the type of conditional structured fields for generated clients", () => {
    const properties = toRecord(
      document.components.schemas["ApiArticleArticlePublishedDocument"]?.[
        "properties"
      ],
    );
    // An empty schema becomes `unknown` in openapi-typescript output.
    const references = Object.fromEntries(
      STRUCTURED.map((key) => [
        key,
        /#\/components\/schemas\/\w+/u.exec(
          JSON.stringify(properties[key]),
        )?.[0],
      ]),
    );
    expect(references).toStrictEqual({
      page: "#/components/schemas/ApiPagePagePublishedDocument",
      summary: "#/components/schemas/SharedSeoPublishedDocument",
      cover: "#/components/schemas/PluginUploadFilePublishedDocument",
      blocks: "#/components/schemas/SharedConditionalLinkPublishedBlock",
    });
  });

  it("rejects wrongly typed hidden structured values without restoring their required rules", () => {
    const accepts = validate("ApiArticleArticlePublishedDocument");
    const hidden = (value: unknown): Record<string, boolean> =>
      Object.fromEntries(
        STRUCTURED.map((key) => [
          key,
          accepts({ ...published, rating: 3, [key]: value }),
        ]),
      );
    expect(hidden(null)).toStrictEqual({
      page: true,
      summary: true,
      cover: true,
      blocks: true,
    });
    expect(hidden(42)).toStrictEqual({
      page: false,
      summary: false,
      cover: false,
      blocks: false,
    });
    // A retained hidden component may break its own required/minimum rules.
    expect(
      accepts({ ...published, rating: 3, summary: { id: 1, heading: null } }),
    ).toBe(true);
    expect(
      accepts({ ...published, rating: 3, summary: { id: 1, heading: 42 } }),
    ).toBe(false);
  });

  it("warns and retains unsupported source rules rather than pretending to compile them", () => {
    expect(warnings).toContain(
      "api::article.article.email: unsupported conditions.visible; validation is conservatively relaxed and the rule is retained in x-strapi-conditions",
    );
    expect(
      document.components.schemas["ApiArticleArticlePublishedDocument"],
    ).toHaveProperty("x-strapi-conditions.email", {
      unsupported: [{ var: "rating" }, 2],
    });
    const accepts = validate("ApiArticleArticlePublishedDocument");
    expect(accepts({ ...published, email: null })).toBe(true);
    expect(accepts({ ...published, email: "not-an-email" })).toBe(true);
  });
});
/* oxlint-enable unicorn/no-null */
