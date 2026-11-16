import { testRender } from "@opentui/solid";
import { afterEach, describe, expect, test } from "bun:test";

import { App } from "./App.tsx";

// Integration tests: render with OpenTUI's headless renderer and drive it
// with mock key presses.
describe("App", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;

  afterEach(() => {
    setup?.renderer.destroy();
    setup = undefined;
  });

  async function open(items?: readonly string[]) {
    setup = await testRender(() => <App items={items} />, {
      width: 80,
      height: 12,
    });
    return setup;
  }

  // Render until the frame contains `text`.
  async function frameWith(text: string): Promise<string> {
    let frame = "";
    for (let i = 0; i < 50; i++) {
      await setup!.renderOnce();
      frame = setup!.captureCharFrame();
      if (frame.includes(text)) return frame;
      await Bun.sleep(10);
    }
    throw new Error(
      `timed out waiting for ${JSON.stringify(text)} in frame:\n${frame}`,
    );
  }

  test("shows the title, items and footer", async () => {
    await open(["first", "second"]);
    const frame = await frameWith("1/2");
    expect(frame).toContain("Rust Example");
    expect(frame).toContain("first");
    expect(frame).toContain("second");
    expect(frame).toContain("nothing chosen yet");
  });

  test("moves and chooses with the keyboard", async () => {
    const s = await open(["first", "second", "third"]);
    s.mockInput.pressKey("j");
    s.mockInput.pressKey("j");
    await frameWith("3/3");
    s.mockInput.pressEnter();
    await frameWith("chose: third");
  });

  test("scrolls to the bottom and back through native key dispatch", async () => {
    const items = Array.from({ length: 20 }, (_, index) => `row-${index + 1}`);
    const s = await open(items);
    await frameWith("1/20");
    s.mockInput.pressKey("G");
    const bottom = await frameWith("20/20");
    expect(bottom).toContain("row-20");
    expect(bottom).not.toContain("row-1 ");
    s.mockInput.pressEnter();
    await frameWith("chose: row-20");
    s.mockInput.pressKey("g");
    const top = await frameWith("1/20");
    expect(top).toContain("row-1");
    expect(top).toContain("chose: row-20");
  });

  test("keeps empty native lists navigable without a selection", async () => {
    const s = await open([]);
    await frameWith("0/0");
    s.mockInput.pressKey("j");
    s.mockInput.pressKey("G");
    s.mockInput.pressEnter();
    const frame = await frameWith("nothing chosen yet");
    expect(frame).toContain("0/0");
    expect(frame).toContain("empty");
  });
});
