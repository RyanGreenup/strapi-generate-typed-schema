import { babel } from "@rollup/plugin-babel";
import moduleResolver from "babel-plugin-module-resolver";
import { defineConfig } from "tsdown";

// Ship compiled Solid "universal" output only. Unlike packages/lib/* there is
// no preserved-JSX "solid" export condition: downstream Solid toolchains
// default to generate:'dom', which emits DOM renderer calls that cannot run
// under OpenTUI. Pre-compiling with generate:'universal' means consumers need
// zero JSX or babel config.
//
// Two outputs mirror @opentui/solid's own packaging:
// - dist/index.js (node/default): solid-js's "node" export condition resolves
//   to server-only builds, so imports are redirected to the universal dist
//   files Solid's compiled output expects (opentui.com/docs/bindings/solid).
// - dist/index.bun.js ("bun" condition): keeps bare solid-js imports; the
//   @opentui/solid preload plugin swaps in the client build at load time, and
//   a hardcoded dist path would create a second solid-js instance there.
function solidBabel(redirectSolid: boolean) {
  return babel({
    babelHelpers: "bundled",
    // .js is included in redirect mode so the bundled solid-js/store file
    // (see noExternal below) gets its bare "solid-js" import rewritten too.
    extensions: redirectSolid ? [".ts", ".tsx", ".js"] : [".ts", ".tsx"],
    babelrc: false,
    configFile: false,
    plugins: redirectSolid
      ? [
          [
            moduleResolver,
            {
              resolvePath(specifier: string) {
                if (specifier === "solid-js") return "solid-js/dist/solid.js";
                if (specifier === "solid-js/store") return "solid-js/store/dist/store.js";
                return specifier;
              },
            },
          ],
        ]
      : [],
    presets: [
      ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
      ["@babel/preset-typescript"],
    ],
  }) as never;
}

// dts comes from the non-redirected build: the redirect would otherwise leak
// "solid-js/dist/solid.js" (which ships no types) into the declarations.
//
// The node build additionally bundles solid-js/store (noExternal): the store
// dist file itself imports bare "solid-js", which node resolves to the server
// build - a second reactive system whose store writes the client build never
// observes (children gated on the theme store's `ready` then silently never
// mount). The redirect can't reach inside an external file, so the store is
// bundled and babel (extensions includes .js in redirect mode) rewrites its
// internal import to the client dist.
export default defineConfig([
  {
    entry: ["./src/index.ts"],
    platform: "neutral",
    format: "esm",
    dts: false,
    noExternal: [/^solid-js\/store\//],
    plugins: [solidBabel(true)],
  },
  {
    entry: ["./src/index.ts"],
    platform: "neutral",
    format: "esm",
    dts: true,
    outExtensions: () => ({ js: ".bun.js", dts: ".d.ts" }),
    plugins: [solidBabel(false)],
  },
]);
