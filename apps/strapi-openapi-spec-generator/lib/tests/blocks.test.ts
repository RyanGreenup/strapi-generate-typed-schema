/**
 * Rich text (blocks) responses as Strapi 5.62 stores them, which its own
 * declarations misdescribe.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

/** Register a rich text field in the article declarations only. */
const addArticleBody = async (directory: string): Promise<void> => {
  const typesPath = path.join(directory, "types/generated/contentTypes.d.ts");
  const types = await readFile(typesPath, "utf8");
  const anchor = "    cover: Schema.Attribute.Media";
  if (!types.includes(anchor)) {
    throw new Error("Fixture article types changed: no cover attribute");
  }
  await writeFile(
    typesPath,
    types.replace(anchor, `    body: Schema.Attribute.Blocks;\n${anchor}`),
  );
};

const fixture = generatedFixture(addArticleBody);

describe("rich text field selection", () => {
  it("selects a declaration-only blocks field on its own model", () => {
    expect(fixture.validateQuery("/articles", "fields")("body")).toBe(true);
    expect(fixture.validateQuery("/pages", "fields")("body")).toBe(false);
  });
});

const published = {
  id: 1,
  documentId: "fixture",
  publishedAt: "2026-11-17T00:00:00.000Z",
};
const text = (value: string): { type: "text"; text: string } => ({
  type: "text",
  text: value,
});
const paragraph = (link: Record<string, unknown>): Record<string, unknown> => ({
  type: "paragraph",
  children: [text("See "), { type: "link", children: [text("this")], ...link }],
});

describe("rich text links", () => {
  // The blocks editor writes `{ type, url, children }`; `rel` and `target`
  // appear only when an editor sets them, though Strapi declares both required.
  it("accepts a link without rel or target, as the editor stores it", () => {
    const validate = fixture.validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    expect(
      validate({
        ...published,
        body: [paragraph({ url: "https://a.example" })],
      }),
    ).toBe(true);
    expect(
      validate({
        ...published,
        body: [
          {
            type: "list",
            format: "unordered",
            children: [
              {
                type: "list-item",
                children: [
                  { type: "link", url: "/a.pdf", children: [text("A")] },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  // Imported content carries superscript and subscript marks on text.
  it("accepts superscript and subscript text marks", () => {
    const validate = fixture.validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    const marked = (mark: Record<string, unknown>): boolean =>
      validate({
        ...published,
        body: [{ type: "paragraph", children: [{ ...text("2"), ...mark }] }],
      });
    expect(marked({ superscript: true })).toBe(true);
    expect(marked({ subscript: true })).toBe(true);
    expect(marked({ superscript: "yes" })).toBe(false);
  });

  it("still types rel and target when present", () => {
    const validate = fixture.validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    expect(
      validate({
        ...published,
        body: [paragraph({ url: "/a", rel: "noopener", target: "_blank" })],
      }),
    ).toBe(true);
    expect(
      validate({ ...published, body: [paragraph({ url: "/a", rel: 5 })] }),
    ).toBe(false);
    expect(validate({ ...published, body: [paragraph({})] })).toBe(false);
  });
});
describe("rich text paragraph size", () => {
  // Projects may store a paragraph font size; the default size is omitted.
  it("accepts an optional numeric fontSize on paragraphs", () => {
    const validate = fixture.validateDocument(
      "ApiArticleArticlePublishedDocument",
    );
    const sized = (size: unknown): boolean =>
      validate({
        ...published,
        body: [{ type: "paragraph", fontSize: size, children: [text("A")] }],
      });
    expect(sized(24)).toBe(true);
    expect(sized(16)).toBe(true);
    expect(sized("24")).toBe(false);
    expect(
      validate({
        ...published,
        body: [{ type: "quote", fontSize: 24, children: [text("A")] }],
      }),
    ).toBe(false);
  });
});
