import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 10_000 });

describe("cli", () => {
  it("prints the provided message", () => {
    const { stdout } = spawnSync(
      process.execPath,
      ["./dist/index.mjs", "list", "--message", "hello world"],
      { encoding: "utf8" },
    );

    expect(stdout.trim()).toBe("hello world");
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

  it("includes list options in the completion definition", () => {
    const { stdout, stderr, status } = spawnSync(
      process.execPath,
      ["./dist/index.mjs", "complete", "fig"],
      { encoding: "utf8" },
    );

    expect({ status, stderr }).toStrictEqual({ status: 0, stderr: "" });
    expect(stdout).toContain('"name": "strapi-openapi-spec-generator-cli list"');
    expect(stdout).toContain('"name": "--message"');
  });
});
