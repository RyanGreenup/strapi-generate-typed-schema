import { describe, expect, test } from "bun:test";

import { ListState, scrollOffset } from "../index.js";

describe("scrollOffset", () => {
  test("centers the cursor and clamps at either end", () => {
    expect(scrollOffset(0, 10, 30)).toBe(0);
    expect(scrollOffset(15, 10, 30)).toBe(10);
    expect(scrollOffset(29, 10, 30)).toBe(20);
  });

  test("handles short, empty, unselected, and single-row lists", () => {
    expect(scrollOffset(2, 10, 3)).toBe(0);
    expect(scrollOffset(0, 1, 0)).toBe(0);
    expect(scrollOffset(-1, 10, 30)).toBe(0);
    expect(scrollOffset(3, 1, 10)).toBe(3);
  });
});

describe("ListState", () => {
  test("starts at the first entry without a choice", () => {
    const list = new ListState(["a", "b", "c"]);
    expect(list.entries).toEqual(["a", "b", "c"]);
    expect(list.cursor).toBe(0);
    expect(list.selected).toBe("a");
    expect(list.chosen).toBeNull();
  });

  test("moves the cursor and clamps at either end", () => {
    const list = new ListState(["a", "b", "c"]);
    list.move(1);
    expect(list.selected).toBe("b");
    list.move(10);
    expect(list.cursor).toBe(2);
    list.move(-10);
    expect(list.cursor).toBe(0);
    list.bottom();
    expect(list.selected).toBe("c");
    list.top();
    expect(list.selected).toBe("a");
  });

  test("clamps direct movement to the list boundaries", () => {
    const list = new ListState(["a", "b", "c"]);
    list.moveTo(1);
    expect(list.selected).toBe("b");
    list.moveTo(Number.MAX_SAFE_INTEGER);
    expect(list.cursor).toBe(2);
    list.moveTo(-Number.MAX_SAFE_INTEGER);
    expect(list.cursor).toBe(0);
  });

  test("keeps a choice independent of later navigation and permits replacing it", () => {
    const list = new ListState(["a", "b", "c"]);
    list.move(1);
    list.choose();
    expect(list.chosen).toBe("b");
    list.bottom();
    expect(list.selected).toBe("c");
    expect(list.chosen).toBe("b");
    list.choose();
    expect(list.chosen).toBe("c");
    list.top();
    expect(list.chosen).toBe("c");
  });

  test("owns its entries rather than exposing mutable JavaScript arrays", () => {
    const input = ["a", "b"];
    const list = new ListState(input);
    input[0] = "changed";
    const snapshot = list.entries;
    snapshot[0] = "also changed";
    snapshot.push("c");
    expect(list.entries).toEqual(["a", "b"]);
    expect(list.selected).toBe("a");
  });

  test("keeps native instances independent", () => {
    const first = new ListState(["a", "b"]);
    const second = new ListState(["x", "y"]);
    first.bottom();
    first.choose();
    expect(second.cursor).toBe(0);
    expect(second.selected).toBe("x");
    expect(second.chosen).toBeNull();
  });

  test("handles every movement and choosing on an empty list", () => {
    const list = new ListState([]);
    for (const move of [
      () => list.move(1),
      () => list.move(-1),
      () => list.moveTo(10),
      () => list.moveTo(-10),
      () => list.top(),
      () => list.bottom(),
      () => list.choose(),
    ]) {
      move();
      expect(list.entries).toEqual([]);
      expect(list.cursor).toBe(0);
      expect(list.selected).toBeNull();
      expect(list.chosen).toBeNull();
    }
  });

  test("handles a single-entry list", () => {
    const list = new ListState(["only"]);
    list.bottom();
    list.move(10);
    list.move(-10);
    list.choose();
    expect(list.cursor).toBe(0);
    expect(list.selected).toBe("only");
    expect(list.chosen).toBe("only");
  });
});

describe("handleKey", () => {
  test.each(["j", "down"])(
    "moves down once for %s and clamps at the end",
    (key) => {
      const list = new ListState(["a", "b", "c"]);
      expect(list.handleKey(key, "", false, 2)).toBe("handled");
      expect(list.cursor).toBe(1);
      list.bottom();
      expect(list.handleKey(key, "", false, 2)).toBe("handled");
      expect(list.cursor).toBe(2);
    },
  );

  test.each(["k", "up"])(
    "moves up once for %s and clamps at the start",
    (key) => {
      const list = new ListState(["a", "b", "c"]);
      list.bottom();
      expect(list.handleKey(key, "", false, 2)).toBe("handled");
      expect(list.cursor).toBe(1);
      list.top();
      expect(list.handleKey(key, "", false, 2)).toBe("handled");
      expect(list.cursor).toBe(0);
    },
  );

  test("moves to the top for lowercase g", () => {
    const list = new ListState(["a", "b", "c", "d"]);
    list.bottom();
    expect(list.handleKey("g", "g", false, 2)).toBe("handled");
    expect(list.cursor).toBe(0);
  });

  test.each([
    { name: "g", sequence: "G", shift: true },
    { name: "g", sequence: "", shift: true },
    { name: "G", sequence: "G", shift: false },
    { name: "g", sequence: "G", shift: false },
    { name: "G", sequence: "", shift: false },
  ])(
    "dispatches uppercase G representation %j",
    ({ name, sequence, shift }) => {
      const list = new ListState(["a", "b", "c", "d"]);
      expect(list.handleKey(name, sequence, shift, 2)).toBe("handled");
      expect(list.cursor).toBe(3);
    },
  );

  test("pages in both directions using the supplied page size and clamps", () => {
    const list = new ListState(["a", "b", "c", "d"]);
    expect(list.handleKey("pagedown", "", false, 2)).toBe("handled");
    expect(list.cursor).toBe(2);
    expect(list.handleKey("pagedown", "", false, 2)).toBe("handled");
    expect(list.cursor).toBe(3);
    expect(list.handleKey("pageup", "", false, 2)).toBe("handled");
    expect(list.cursor).toBe(1);
    expect(list.handleKey("pageup", "", false, 2)).toBe("handled");
    expect(list.cursor).toBe(0);
    list.handleKey("pagedown", "", false, 0);
    expect(list.cursor).toBe(0);
    list.handleKey("pagedown", "", false, 1);
    expect(list.cursor).toBe(1);
  });

  test.each(["return", "l"])("pages and chooses once for %s", (key) => {
    const list = new ListState(["a", "b", "c", "d"]);
    list.handleKey("pagedown", "", false, 2);
    expect(list.handleKey(key, key === "return" ? "\r" : "l", false, 2)).toBe(
      "handled",
    );
    expect(list.chosen).toBe("c");
    list.handleKey("pageup", "", false, 2);
    expect(list.chosen).toBe("c");
  });

  test.each([
    ["t", "theme"],
    ["q", "quit"],
    ["x", "unhandled"],
    ["", "unhandled"],
  ])("classifies %s as %s without changing native state", (key, action) => {
    const list = new ListState(["a", "b", "c"]);
    list.move(1);
    list.choose();
    expect(list.handleKey(key, key, false, 2)).toBe(action);
    expect(list.entries).toEqual(["a", "b", "c"]);
    expect(list.cursor).toBe(1);
    expect(list.selected).toBe("b");
    expect(list.chosen).toBe("b");
  });

  test("does not use a lowercase sequence as a fallback for an unknown name", () => {
    const list = new ListState(["a", "b"]);
    expect(list.handleKey("unknown", "j", false, 2)).toBe("unhandled");
    expect(list.cursor).toBe(0);
  });

  test.each([
    "j",
    "k",
    "down",
    "up",
    "g",
    "G",
    "pagedown",
    "pageup",
    "return",
    "l",
  ])("handles %s on an empty list", (key) => {
    const list = new ListState([]);
    expect(list.handleKey(key, "", false, 2)).toBe("handled");
    expect(list.cursor).toBe(0);
    expect(list.selected).toBeNull();
    expect(list.chosen).toBeNull();
  });
});
