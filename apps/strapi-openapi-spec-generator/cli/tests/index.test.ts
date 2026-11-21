import { describe, expect, it, vi } from "vitest";

import { createCliCommand } from "../src/index.js";

vi.setConfig({ testTimeout: 5000 });

describe("createCliCommand", () => {
  it("registers dump alongside the default generate command", () => {
    const command = createCliCommand();

    expect(command.default).toBe("generate");
    expect(command.subCommands).toHaveProperty("generate");
    expect(command.subCommands).toHaveProperty("dump");
  });
});
