/* oxlint-disable unicorn/no-null -- Strapi responses carry null. */
/**
 * Responses that the generated schemas misdescribe, checked against Strapi 5.62
 * behaviour.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

/** Give the article relations to another draft-and-publish type: itself. */
const addArticleRelations = async (directory: string): Promise<void> => {
  const schemaPath = path.join(
    directory,
    "src/api/article/content-types/article/schema.json",
  );
  const schema = parseJsonObject(await readFile(schemaPath, "utf8"));
  const attributes = toRecord(schema["attributes"]);
  attributes["related"] = {
    type: "relation",
    relation: "manyToOne",
    target: "api::article.article",
  };
  attributes["relatedList"] = {
    type: "relation",
    relation: "manyToMany",
    target: "api::article.article",
  };
  await writeFile(
    schemaPath,
    JSON.stringify({ ...schema, attributes }, null, 2),
  );

  const typesPath = path.join(directory, "types/generated/contentTypes.d.ts");
  const types = await readFile(typesPath, "utf8");
  const anchor = "    cover: Schema.Attribute.Media";
  if (!types.includes(anchor)) {
    throw new Error("Fixture article types changed: no cover attribute");
  }
  await writeFile(
    typesPath,
    types.replace(
      anchor,
      [
        '    related: Schema.Attribute.Relation<"manyToOne", "api::article.article">;',
        '    relatedList: Schema.Attribute.Relation<"manyToMany", "api::article.article">;',
        anchor,
      ].join("\n"),
    ),
  );
};

const fixture = generatedFixture(addArticleRelations);

const published = {
  id: 1,
  documentId: "fixture",
  publishedAt: "2026-11-17T00:00:00.000Z",
};
const draft = { ...published, id: 2, publishedAt: null };
const relatedPublished = { ...published, id: 3, documentId: "other" };
const relatedDraft = { ...relatedPublished, id: 4, publishedAt: null };

describe("relations between draft-and-publish types", () => {
  // Publishing runs transformData with status "published", which links the published
  // entry to the published versions of its targets only, and drafts link to drafts.
  // Unpublishing or deleting a target cascades its link rows away, so null stays valid.
  it("populates a published entry with published versions only", () => {
    const validate = fixture.validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    expect(validate({ ...published, related: relatedPublished })).toBe(true);
    expect(validate({ ...published, related: null })).toBe(true);
    expect.soft(validate({ ...published, related: relatedDraft })).toBe(false);
    expect
      .soft(validate({ ...published, relatedList: [relatedDraft] }))
      .toBe(false);
  });

  it("populates a draft entry with draft versions only", () => {
    const validate = fixture.validateDocument("ApiArticleArticleDraftDocument");
    expect(validate({ ...draft, related: relatedDraft })).toBe(true);
    expect(validate({ ...draft, related: null })).toBe(true);
    expect.soft(validate({ ...draft, related: relatedPublished })).toBe(false);
    expect
      .soft(validate({ ...draft, relatedList: [relatedPublished] }))
      .toBe(false);
  });
});
/* oxlint-enable unicorn/no-null */
