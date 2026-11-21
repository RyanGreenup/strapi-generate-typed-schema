import { describe, expect, it, vi } from "vitest";

import type { JsonSchema } from "../src/document.js";

import { toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

describe("declaration-derived attribute metadata", () => {
  const fixture = generatedFixture();
  const properties = (model: string): JsonSchema =>
    toRecord(fixture.document?.components.schemas[model]?.["properties"]);
  const article = (role: string): JsonSchema =>
    properties(`ApiArticleArticle${role}`);

  it.each(["PublishedCreateInput", "DraftCreateInput"])(
    "derives configured facts and concrete defaults for %s",
    (role) => {
      const fields = article(role);
      expect(fields).toMatchObject({
        registeredCount: {
          default: 0,
          "x-strapi-coerces-numeric-string": true,
          "x-strapi-configured-bounds": { minimum: "2.9", maximum: "8.1" },
        },
        registeredFlag: { default: false },
        registeredData: { default: { labels: ["initial"], enabled: false } },
        // oxlint-disable-next-line unicorn/no-null -- explicit JSON null overrides a declared default.
        nullableDefault: { default: null },
        registeredKey: { "x-strapi-unique": true },
      });
      const categories = toRecord(fields["registeredMedia"])[
        "x-strapi-allowed-types"
      ];
      expect(categories).toHaveLength(2);
      expect(categories).toStrictEqual(
        expect.arrayContaining(["files", "videos"]),
      );
      expect(fields["runtimeDefault"]).not.toHaveProperty("default");
    },
  );

  it.each(["PublishedUpdateInput", "DraftUpdateInput", "PublishedDocument"])(
    "omits create-time defaults on %s, retaining configured facts",
    (role) => {
      const fields = article(role);
      expect(fields["registeredKey"]).toHaveProperty("x-strapi-unique", true);
      for (const field of [
        "registeredCount",
        "registeredFlag",
        "registeredData",
        "nullableDefault",
      ]) {
        expect(fields[field]).not.toHaveProperty("default");
      }
    },
  );

  it("distinguishes raw string bounds from draft and published integer validation", () => {
    const draft = fixture.validateDocument("ApiArticleArticleDraftUpdateInput");
    const published = fixture.validateDocument(
      "ApiArticleArticlePublishedUpdateInput",
    );
    expect(article("DraftUpdateInput")["registeredCount"]).toHaveProperty(
      "x-strapi-configured-bounds",
      { minimum: "2.9", maximum: "8.1" },
    );
    expect(draft({ registeredCount: 1 })).toBe(true);
    expect(published({ registeredCount: 1 })).toBe(false);
    expect(published({ registeredCount: 2 })).toBe(true);
    expect(draft({ registeredCount: 9 })).toBe(false);
  });

  it("does not truncate configured decimal bounds", () => {
    const published = fixture.validateDocument(
      "ApiArticleArticlePublishedUpdateInput",
    );
    expect(published({ registeredPrice: -0.5 })).toBe(true);
    expect(published({ registeredPrice: -0.6 })).toBe(false);
    expect(published({ registeredPrice: 8.1 })).toBe(true);
    expect(published({ registeredPrice: 8.2 })).toBe(false);
  });

  it("reads uniqueness from a reachable plugin declaration without local model JSON", () => {
    expect(
      properties("PluginUploadFilePublishedDocument")["hash"],
    ).toHaveProperty("x-strapi-unique", true);
  });
});
