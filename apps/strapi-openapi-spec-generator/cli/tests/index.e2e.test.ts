import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 10_000 });

const marker = {
  uid: "api::home.home",
  kind: "singleType",
  draftAndPublish: false,
  localized: false,
};
const specification = {
  openapi: "3.1.0",
  info: { title: "CLI fixture", version: "1" },
  servers: [{ url: "/api" }],
  components: {
    schemas: {
      Home: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          title: { type: "string" },
        },
        "x-strapi-model": {
          ...marker,
          fields: { documentId: { kind: "scalar" }, title: { kind: "scalar" } },
        },
      },
    },
    securitySchemes: {},
  },
  paths: {
    "/home": {
      get: {
        "x-strapi-dump": marker,
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: "#/components/schemas/Home" } },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("cli", () => {
  it("fails with a message when the directory is not a Strapi project", () => {
    const { stdout, stderr, status } = spawnSync(
      process.execPath,
      ["./dist/index.mjs", "generate", tmpdir()],
      { encoding: "utf8" },
    );

    expect({ status, stdout }).toStrictEqual({ status: 1, stdout: "" });
    expect(stderr).toContain("is not a Strapi project");
  });

  it.each(["bash", "zsh", "fish", "powershell"])(
    "generates a %s completion script",
    (shell) => {
      const { stdout, stderr, status } = spawnSync(
        process.execPath,
        ["./dist/index.mjs", "complete", shell],
        { encoding: "utf8" },
      );

      expect({ status, stderr }).toStrictEqual({ status: 0, stderr: "" });
      expect(stdout).toContain("strapi-openapi-spec-generator-cli");
    },
  );

  it("includes generate and dump options in the completion definition", () => {
    const { stdout, stderr, status } = spawnSync(
      process.execPath,
      ["./dist/index.mjs", "complete", "fig"],
      { encoding: "utf8" },
    );

    expect({ status, stderr }).toStrictEqual({ status: 0, stderr: "" });
    expect(stdout).toContain(
      '"name": "strapi-openapi-spec-generator-cli generate"',
    );
    expect(stdout).toContain('"name": "--output"');
    expect(stdout).toContain(
      '"name": "strapi-openapi-spec-generator-cli dump"',
    );
    for (const option of ["--spec", "--url", "--media", "--validate"]) {
      expect(stdout).toContain(`"name": "${option}"`);
    }
  });

  it("requires an API token before it reads the specification", () => {
    const { stdout, stderr, status } = spawnSync(
      process.execPath,
      [
        "./dist/index.mjs",
        "dump",
        "out",
        "--spec",
        "missing.json",
        "--url",
        "https://cms.invalid",
      ],
      { encoding: "utf8", env: { ...process.env, STRAPI_API_TOKEN: "" } },
    );
    expect({ status, stdout }).toStrictEqual({ status: 1, stdout: "" });
    expect(stderr).toContain("STRAPI_API_TOKEN");
  });

  it("dumps outside the project with --no-validate", async ({
    onTestFinished,
  }) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "strapi-cli-dump-"));
    onTestFinished(() => rm(cwd, { force: true, recursive: true }));
    await writeFile(path.join(cwd, "spec.json"), JSON.stringify(specification));

    // The document has an ID but its title fails response schema validation.
    const data = { documentId: "abc", title: 7 };
    const server = createServer((request, response) => {
      if (
        request.url?.split("?")[0] !== "/api/home" ||
        request.headers.authorization !== "Bearer cli-test"
      ) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data, meta: {} }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(() => server[Symbol.asyncDispose]());
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected the HTTP fixture to listen on a local port.");
    }

    const cli = path.resolve("dist/index.mjs");
    const options = [
      "--spec",
      "spec.json",
      "--url",
      `http://127.0.0.1:${address.port}`,
    ];
    const environment = {
      cwd,
      env: { ...process.env, STRAPI_API_TOKEN: "cli-test" },
    };
    const run = promisify(execFile);
    await expect(
      run(process.execPath, [cli, "dump", "strict", ...options], environment),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("title"),
    });
    const { stdout } = await run(
      process.execPath,
      [cli, "dump", "raw", ...options, "--no-validate"],
      environment,
    );
    const manifest = path.join(cwd, "raw", "manifest.json");
    expect(stdout.trim()).toBe(`Documents: 1. Manifest: ${manifest}`);
    expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({
      entries: [{ documentId: "abc", status: "published", uid: marker.uid }],
    });
  });
});
