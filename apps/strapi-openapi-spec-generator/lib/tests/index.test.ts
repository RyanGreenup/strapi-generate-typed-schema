import { describe, expect, it, vi } from "vitest";

import { add, formatMessage } from "../src/index.js";

vi.setConfig({ testTimeout: 5000 });

describe("formatMessage", () => {
  it("formats a greeting with default punctuation", () => {
    expect(formatMessage({ name: "World" })).toBe("Hello, World!");
  });

  it("formats a greeting with custom punctuation", () => {
    expect(formatMessage({ name: "World", punctuation: "." })).toBe(
      "Hello, World.",
    );
  });
});

describe("add", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
