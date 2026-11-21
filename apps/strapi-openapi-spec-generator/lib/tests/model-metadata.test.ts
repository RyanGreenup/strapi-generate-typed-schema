import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

const MODEL = "x-strapi-model";

describe("population metadata on generated responses", () => {
  const fixture = generatedFixture(async (directory) => {
    const modelFile = (name: string): string =>
      path.join(directory, `src/api/${name}/content-types/${name}/schema.json`);
    const article = parseJsonObject(
      await readFile(modelFile("article"), "utf8"),
    );
    const page = parseJsonObject(await readFile(modelFile("page"), "utf8"));
    const articlePage = toRecord(toRecord(article["attributes"])["page"]);
    articlePage["inversedBy"] = "articles";
    toRecord(page["attributes"])["articles"] = {
      type: "relation",
      relation: "oneToMany",
      target: "api::article.article",
      mappedBy: "page",
    };
    await writeFile(modelFile("article"), JSON.stringify(article));
    await writeFile(modelFile("page"), JSON.stringify(page));
    const file = path.join(directory, "types/generated/contentTypes.d.ts");
    const types = await readFile(file, "utf8");
    await writeFile(
      file,
      types.replace(
        "    passcode:",
        '    articles: Schema.Attribute.Relation<"oneToMany", "api::article.article">;\n    passcode:',
      ),
    );
  });
  const schema = (name: string): Record<string, unknown> =>
    toRecord(fixture.document?.components.schemas[name]);

  it("marks every emitted document field and both sides of a relation", () => {
    for (const name of [
      "ApiArticleArticlePublishedDocument",
      "ApiArticleArticleDraftDocument",
    ]) {
      const response = schema(name);
      expect(response[MODEL]).toMatchObject({
        uid: "api::article.article",
        kind: "collectionType",
        draftAndPublish: true,
        localized: false,
        fields: {
          id: { kind: "scalar" },
          documentId: { kind: "scalar" },
          createdAt: { kind: "scalar" },
          updatedAt: { kind: "scalar" },
          publishedAt: { kind: "scalar" },
          title: { kind: "scalar" },
          seo: { kind: "component", component: "shared.seo", repeatable: true },
          summary: {
            kind: "component",
            component: "shared.seo",
            repeatable: false,
          },
          blocks: {
            kind: "dynamiczone",
            components: ["shared.seo", "shared.conditional-link"],
          },
          cover: { kind: "media", multiple: false },
          page: {
            kind: "relation",
            target: "api::page.page",
            relation: "manyToOne",
            inversedBy: "articles",
          },
        },
      });
      const fields = toRecord(toRecord(response[MODEL])["fields"]);
      expect(Object.keys(fields).toSorted()).toEqual(
        Object.keys(toRecord(response["properties"])).toSorted(),
      );
    }
    expect(schema("ApiPagePagePublishedDocument")[MODEL]).toMatchObject({
      uid: "api::page.page",
      localized: true,
      draftAndPublish: false,
      fields: {
        locale: { kind: "scalar" },
        articles: {
          kind: "relation",
          target: "api::article.article",
          relation: "oneToMany",
          mappedBy: "page",
        },
      },
    });
  });

  it("describes the component in both component and dynamic zone responses", () => {
    for (const name of [
      "SharedConditionalLinkPublishedDocument",
      "SharedConditionalLinkPublishedBlock",
    ]) {
      const model = toRecord(schema(name)[MODEL]);
      expect(model).toMatchObject({
        uid: "shared.conditional-link",
        fields: {
          attachment: { kind: "media", multiple: false },
          id: { kind: "scalar" },
        },
      });
      expect(model).not.toHaveProperty("kind");
    }
    expect(schema("SharedConditionalLinkPublishedBlock")[MODEL]).toMatchObject({
      fields: { __component: { kind: "scalar" } },
    });
  });

  it("warns once per emitted field with no source, without guessing its kind", () => {
    const fields = toRecord(
      toRecord(schema("ApiPagePagePublishedDocument")[MODEL])["fields"],
    );
    expect(fields["pluginComponent"]).toEqual({ kind: "unknown" });
    expect(fields["pluginJson"]).toEqual({ kind: "unknown" });
    expect(fields).not.toHaveProperty("secret");
    expect(
      fixture.warnings.filter((warning) =>
        warning.includes("api::page.page.pluginComponent"),
      ),
    ).toHaveLength(1);
  });

  it("leaves input schemas, dispatch unions, properties and unsourced plugin models alone", () => {
    for (const name of [
      "ApiArticleArticlePublishedCreateInput",
      "ApiArticleArticleDraftUpdateInput",
      "ApiArticleArticleDocument",
      "PluginUploadFilePublishedDocument",
    ]) {
      expect(schema(name)).not.toHaveProperty(MODEL);
    }
    const article = schema("ApiArticleArticlePublishedDocument");
    expect(toRecord(article["properties"])["title"]).not.toHaveProperty(MODEL);
  });
});
