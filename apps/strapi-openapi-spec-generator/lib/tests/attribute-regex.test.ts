import type { ValidateFunction } from "ajv";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseJsonObject, toRecord } from "../src/json.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

describe("source regex on entity writes", () => {
  const fixture = generatedFixture(async (directory) => {
    const patch = async (
      file: string,
      changes: Record<string, object>,
    ): Promise<void> => {
      const target = path.join(directory, file);
      const schema = parseJsonObject(await readFile(target, "utf8"));
      const attributes = toRecord(schema["attributes"]);
      for (const [key, change] of Object.entries(changes)) {
        attributes[key] = { ...toRecord(attributes[key]), ...change };
      }
      await writeFile(target, JSON.stringify(schema));
    };
    const declaration = path.join(
      directory,
      "types/generated/contentTypes.d.ts",
    );
    const types = await readFile(declaration, "utf8");
    await writeFile(
      declaration,
      types.replace(
        "shortText: Schema.Attribute.String;",
        `$&
    bodyText: Schema.Attribute.Text;
    bodyRich: Schema.Attribute.RichText;
    optionalUid: Schema.Attribute.UID;
    legacyUid: Schema.Attribute.UID;
    broken: Schema.Attribute.String;`,
      ),
    );
    await patch("src/api/article/content-types/article/schema.json", {
      label: { regex: "[A-Z]" },
      shortText: { regex: String.raw`^ref-\d+$` },
      slug: { regex: "^/[a-z]+$" },
      bodyText: { type: "text", regex: "^T" },
      bodyRich: { type: "richtext", regex: "^R" },
      optionalUid: { type: "uid", regex: "^/ok$" },
      legacyUid: { type: "uid", regex: String.raw`^\q$` },
      broken: { type: "string", regex: "[" },
      email: { regex: String.raw`@example\.org$` },
      title: {
        regex: "^NEWS-",
        conditions: { visible: { "==": [{ var: "rating" }, 2] } },
      },
      // The numeric validator does not call addStringRegexValidator.
      rating: { regex: "^never$" },
    });
    await patch("src/components/shared/seo.json", {
      heading: { regex: "^[A-Z]" },
    });
    await patch("src/api/page/content-types/page/schema.json", {
      passcode: { regex: "[0-9]" },
      // Flagless JS counts UTF-16 code units; JSON Schema patterns use Unicode.
      title: { regex: "^.{5}$" },
    });
  });
  const validate = (role: string): ValidateFunction =>
    fixture.validateDocument(`ApiArticleArticle${role}`);

  it("checks published creates and updates but neither drafts nor reads", () => {
    const data = {
      email: "a@example.org",
      seo: [{ heading: "News" }],
      label: "aBc",
    };
    for (const mode of ["Create", "Update"]) {
      const published = validate(`Published${mode}Input`);
      expect(published(data)).toBe(true);
      expect(published({ ...data, label: "" })).toBe(false);
      expect(published({ ...data, label: "lower" })).toBe(false);
      expect(validate(`Draft${mode}Input`)({ ...data, label: "lower" })).toBe(
        true,
      );
    }
    expect(
      validate("PublishedDocument")({
        id: 1,
        documentId: "news",
        publishedAt: "2026-11-17T00:00:00Z",
        label: "lower",
      }),
    ).toBe(true);
  });

  it("skips an optional empty string without removing nullability", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ shortText: "" })).toBe(true);
    // oxlint-disable-next-line unicorn/no-null -- Explicit JSON null must remain valid.
    expect(update({ shortText: null })).toBe(true);
    expect(update({ shortText: "ref-23" })).toBe(true);
    expect(update({ shortText: "other" })).toBe(false);
  });

  it("validates text and rich text with their source regexes", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ bodyText: "Text", bodyRich: "Rich" })).toBe(true);
    expect(update({ bodyText: "wrong" })).toBe(false);
    expect(update({ bodyRich: "wrong" })).toBe(false);
  });

  it("validates both the email format and the source regex", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ email: "bad@example.net" })).toBe(false);
    expect(update({ email: "@example.org" })).toBe(false);
    expect(update({ email: "a@example.org" })).toBe(true);
  });

  it("does not apply source regexes to numeric attributes", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ rating: "3" })).toBe(true);
  });

  it("replaces the UID fallback rather than combining it with the custom expression", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ slug: "/news" })).toBe(true);
    expect(update({ slug: "news" })).toBe(false);
    expect(update({ slug: "/x" })).toBe(false); // Existing minLength remains.
    expect(validate("DraftUpdateInput")({ slug: "news" })).toBe(true);
  });

  it("enforces the source regex on an optional UID even when empty", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ optionalUid: "" })).toBe(false);
    expect(update({ optionalUid: "/ok" })).toBe(true);
  });

  it("enforces visible and nested fields without validating hidden values", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ rating: 2, title: "other" })).toBe(false);
    expect(update({ rating: 2, title: "NEWS-item" })).toBe(true);
    expect(update({ rating: 3, title: "other" })).toBe(true);
    for (const nested of [
      { seo: [{ id: 1, heading: "lower" }] },
      { blocks: [{ __component: "shared.seo", heading: "lower" }] },
    ]) {
      expect(update(nested)).toBe(false);
      expect(validate("DraftUpdateInput")(nested)).toBe(true);
    }
  });

  it("checks non-D&P password writes and reports patterns with incompatible Unicode semantics", () => {
    const update = fixture.validateDocument("ApiPagePageUpdateInput");
    expect(update({ passcode: "abc" })).toBe(false);
    expect(update({ passcode: "a3c" })).toBe(true);
    expect(update({ passcode: "" })).toBe(true);
    expect(update({ title: "abcdef" })).toBe(true);
    expect(
      fixture.warnings.filter((message) =>
        /api::page\.page\.title.*regex/u.test(message),
      ),
    ).toHaveLength(1);
  });

  it("preserves unsupported source expressions as metadata without a bogus UID fallback", () => {
    const update = validate("PublishedUpdateInput");
    expect(update({ legacyUid: "/ok", broken: "ok" })).toBe(true);
    const schema =
      fixture.document?.components.schemas[
        "ApiArticleArticlePublishedUpdateInput"
      ];
    expect(schema?.["properties"]).toMatchObject({
      legacyUid: { "x-strapi-regex": String.raw`^\q$` },
      broken: { "x-strapi-regex": "[" },
    });
    expect(
      fixture.warnings.some((message) =>
        message.includes("api::article.article.broken"),
      ),
    ).toBe(true);
  });
});
