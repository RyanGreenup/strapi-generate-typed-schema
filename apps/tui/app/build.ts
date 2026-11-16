// Compile the app into a single self-contained executable at dist/rust-example.
// The Solid plugin is required here: bunfig.toml's preload only applies to
// `bun run`, not to Bun.build.
import type { BunPlugin } from "bun";

import solidPlugin from "@opentui/solid/bun-plugin";

// @opentui/core dynamically imports a native package for every platform, and
// Bun resolves all of them while compiling. pnpm installs only the host's
// variant (e.g. not linux-x64-musl on glibc), so keep absent variants external
// rather than failing the build. Same approach as opentui's examples build.
const nativeVariantsPlugin: BunPlugin = {
  name: "opentui-native-variants",
  setup(build) {
    build.onResolve(
      { filter: /^@opentui\/core-(?:darwin|linux|win32)-/ },
      (args) => {
        try {
          Bun.resolveSync(args.path, args.resolveDir);
          return undefined;
        } catch {
          return { path: args.path, external: true };
        }
      },
    );
    // NAPI-RS's generated loader probes other platforms and optional WASI
    // packages. Embed the installed host addon; leave absent probes external.
    build.onResolve(
      { filter: /^(?:@[^/]+\/tui-example-lib-|\.\/rs-lib\.)/ },
      (args) => {
        if (
          args.path.startsWith("@") &&
          !args.path.startsWith("@ryangreenup/tui-example-lib-")
        ) {
          return undefined;
        }
        try {
          Bun.resolveSync(args.path, args.resolveDir);
          return undefined;
        } catch {
          return { path: args.path, external: true };
        }
      },
    );
  },
};

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  target: "bun",
  minify: true,
  // Precompile to JavaScriptCore bytecode for faster startup. OpenTUI uses
  // top-level await, which bytecode only supports in ESM output.
  bytecode: true,
  format: "esm",
  plugins: [nativeVariantsPlugin, solidPlugin],
  compile: {
    outfile: "./dist/rust-example",
    // A compiled binary otherwise loads bunfig.toml and .env from whatever
    // directory it runs in. A CLI tool runs inside other projects, where a
    // bunfig preload breaks startup and a .env leaks settings into the app.
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
});

// Show warnings and info even on success, not only errors on failure.
for (const log of result.logs) {
  if (log.level === "error") console.error(log);
  else console.warn(log);
}

if (!result.success) process.exit(1);

console.log(`Built ${result.outputs.map((o) => o.path).join(", ")}`);
