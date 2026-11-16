import { render } from "@opentui/solid";
import { createComponent } from "solid-js";

import { App } from "./App.tsx";

// Usage: rust-example [item...]. Print help before taking over the terminal.
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: rust-example [item...]");
} else {
  render(
    () => createComponent(App, { items: args.length ? args : undefined }),
    {
      exitOnCtrlC: true,
    },
  );
}
