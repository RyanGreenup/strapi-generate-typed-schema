import { describe, expect, it, vi } from "vitest";

import { createCliCommand } from "../src/index.js";

vi.setConfig({ testTimeout: 5000 });

describe("createCliCommand", () => {
  it("creates a CLI with generate as its default command", () => {
    const command = createCliCommand();

    expect(command.default).toBe("generate");
    expect(command.subCommands).toHaveProperty("generate");
  });
});
