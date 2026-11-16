import { describe, expect, it, vi } from "vitest";

import { createCliCommand } from "../src/index.js";

vi.setConfig({ testTimeout: 5000 });

describe("createCliCommand", () => {
  it("creates a CLI with list as its default command", () => {
    const command = createCliCommand();

    expect(command.default).toBe("list");
    expect(command.subCommands).toHaveProperty("list");
  });
});
