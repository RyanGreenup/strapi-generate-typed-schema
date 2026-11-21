import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { unnamedSchemas } from "../src/schema-names.js";
import { generatedFixture } from "./generated-fixture.js";

vi.setConfig({ testTimeout: 5000 });

describe("unnamedSchemas", () => {
  it("reports only typia instantiation names", () => {
    expect(
      unnamedSchemas({
        "RestPublishedDocumentapi_x3A__x3A_article_x2E_article-x0D2C2A730D26B44A":
          {},
        ApiArticleArticlePublishedDocument: {},
        RestError: {},
        "Ends-x123": {},
      }),
    ).toStrictEqual([
      "RestPublishedDocumentapi_x3A__x3A_article_x2E_article-x0D2C2A730D26B44A",
    ]);
  });
});

/* oxlint-disable unicorn/no-null -- Hidden fields can retain null values. */
describe("plugin content types extended by the project", () => {
  const published = { id: 1, documentId: "file" };
  const fixture = generatedFixture(async (directory) => {
    // The Content-Type Builder writes an edited plugin type's full schema here.
    const extension = path.join(
      directory,
      "src/extensions/upload/content-types/file",
    );
    await mkdir(extension, { recursive: true });
    await writeFile(
      path.join(extension, "schema.json"),
      JSON.stringify({
        kind: "collectionType",
        info: { singularName: "file", pluralName: "files" },
        attributes: {
          name: {
            type: "string",
            required: true,
            conditions: { visible: { "==": [{ var: "width" }, 1] } },
          },
          hash: { type: "string", required: true },
          width: { type: "integer" },
        },
      }),
    );
    // A content-types folder may hold only lifecycles, with no schema.json.
    await mkdir(
      path.join(directory, "src/extensions/upload/content-types/folder"),
      { recursive: true },
    );
  });

  it("applies their visibility rules to reachable plugin schemas", () => {
    const accepts = fixture.validateDocument(
      "PluginUploadFilePublishedDocument",
    );
    expect(accepts({ ...published, name: null })).toBe(true);
    expect(accepts({ ...published, hash: null })).toBe(false);
  });

  it("names every emitted schema after a model role", () => {
    expect(fixture.warnings.join("\n")).not.toContain(
      "typia's generated names",
    );
  });
});
