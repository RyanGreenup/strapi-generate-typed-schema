import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 10_000 });

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

  it("includes generate options in the completion definition", () => {
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
  });
});
