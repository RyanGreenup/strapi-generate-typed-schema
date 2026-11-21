import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

const RELATIONS = "x-strapi-relations";

/** Merge attributes into a source model JSON file. */
const addAttributes = async (
  file: string,
  attributes: Record<string, unknown>,
): Promise<void> => {
  const model = parseJsonObject(await readFile(file, "utf8"));
  model["attributes"] = { ...toRecord(model["attributes"]), ...attributes };
  await writeFile(file, JSON.stringify(model));
};

/** Insert attribute declarations at the top of one generated interface. */
const declare = async (
  directory: string,
  schema: string,
  lines: string[],
): Promise<void> => {
  const file = path.join(directory, "types/generated/contentTypes.d.ts");
  const types = await readFile(file, "utf8");
  const start = types.indexOf(`export interface ${schema} extends`);
  const anchor = "attributes: {\n";
  const at = types.indexOf(anchor, start);
  if (start === -1 || at === -1) {
    throw new Error(`Fixture types changed: no ${schema} attributes`);
  }
  const end = at + anchor.length;
  await writeFile(
    file,
    `${types.slice(0, end)}${lines.join("\n")}\n${types.slice(end)}`,
  );
};

const pageRelation = {
  relation: "manyToOne",
  target: "api::page.page",
  inversedBy: "articles",
  pluginOptions: { site: { populate: "title" } },
};

describe("relation metadata on response schemas", () => {
  const fixture = generatedFixture(async (directory) => {
    const source = (file: string): string => path.join(directory, "src", file);
    await addAttributes(
      source("api/article/content-types/article/schema.json"),
      {
        page: { type: "relation", required: true, ...pageRelation },
      },
    );
    await addAttributes(source("api/page/content-types/page/schema.json"), {
      articles: {
        type: "relation",
        relation: "oneToMany",
        target: "api::article.article",
        mappedBy: "page",
      },
    });
    await addAttributes(source("components/shared/conditional-link.json"), {
      page: {
        type: "relation",
        relation: "manyToOne",
        target: "api::page.page",
      },
    });
    await declare(directory, "ApiPagePage", [
      '    articles: Schema.Attribute.Relation<"oneToMany", "api::article.article">;',
    ]);
    await declare(directory, "SharedConditionalLink", [
      '    page: Schema.Attribute.Relation<"manyToOne", "api::page.page">;',
    ]);
  });
  const schema = (name: string): Record<string, unknown> =>
    toRecord(fixture.document?.components.schemas[name]);

  it("describes both sides of a bidirectional relation with its plugin options", () => {
    for (const name of [
      "ApiArticleArticlePublishedDocument",
      "ApiArticleArticleDraftDocument",
    ]) {
      expect(toRecord(schema(name)[RELATIONS])["page"]).toStrictEqual(
        pageRelation,
      );
    }
    expect(schema("ApiPagePagePublishedDocument")[RELATIONS]).toStrictEqual({
      articles: {
        relation: "oneToMany",
        target: "api::article.article",
        mappedBy: "page",
      },
    });
  });

  it("describes relations inside components and dynamic zone entries", () => {
    const link = { page: { relation: "manyToOne", target: "api::page.page" } };
    for (const name of [
      "SharedConditionalLinkPublishedDocument",
      "SharedConditionalLinkPublishedBlock",
    ]) {
      expect(schema(name)[RELATIONS]).toStrictEqual(link);
    }
  });

  it("leaves request schemas and models without relations unannotated", () => {
    expect(schema("ApiArticleArticlePublishedCreateInput")).not.toHaveProperty(
      RELATIONS,
    );
    expect(
      schema("ApiSiteSettingSiteSettingPublishedDocument"),
    ).not.toHaveProperty(RELATIONS);
    // Unions only point at the state schemas, which carry the metadata.
    expect(schema("ApiArticleArticleDocument")).not.toHaveProperty(RELATIONS);
  });
});
