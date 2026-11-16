# Strapi OpenAPI Spec Generator

TypeScript CLI, library, SolidJS web apps, and a Rust-backed OpenTUI example.

## Packages

- `apps/strapi-openapi-spec-generator/lib` exports reusable placeholder library functions.
- `apps/strapi-openapi-spec-generator/cli` exposes the `strapi-openapi-spec-generator-cli` command and depends on `@ryangreenup/strapi-openapi-spec-generator-lib` via `workspace:*`.
- `apps/strapi-openapi-spec-generator-rs` is a Cargo workspace with a `lib` crate and a `cli`
  crate (clap, with shell completions). Its `package.json` wraps `cargo` so the
  root `build`, `lint`, `check-types`, `test`, `format` and `fix` tasks include it.
- `packages/oxlint-config` provides shared oxlint and oxfmt config consumed by both packages.
  Its `generate-artifacts` task writes the recommended-rule JSON under
  `src/generated/`, which is gitignored; `build`, `lint`, `test` and
  `check-types` depend on that task.
- `packages/typescript_config` provides shared strict TypeScript presets.
  See its README for Node, CommonJS, Next.js, Solid/Vite, and Strapi usage.

## Rust example

```sh
pnpm exec turbo run build --filter=@ryangreenup/strapi-openapi-spec-generator-rs
./apps/strapi-openapi-spec-generator-rs/target/release/cli add
```

Turbo hashes only the crates' sources, the Cargo manifests, `Cargo.lock` and
`rust-toolchain.toml`, and caches only the `cli` binary; `target/` is cargo's
own incremental cache. A pre-commit hook runs `cargo fmt` when `.rs` files in
this workspace are staged. Delete the directory and its line in
`pnpm-workspace.yaml` if you do not need it.

The following independent web apps are included under `apps/storybook/`:

| Directory | Stack |
| --- | --- |
| `web-app` | SolidJS + Vite |
| `web-app-with-storybook` | SolidJS + Vite + Storybook, plain CSS |
| `web-app-with-storybook-tailwind` | SolidJS + Vite + Storybook + Tailwind CSS |
| `web-app-with-storybook-vanilla-extract` | SolidJS + Vite + Storybook + vanilla-extract |

Delete any app directories you do not want, then run `pnpm install` to refresh the
lockfile. No workspace-glob or shared-package changes are required. Keep Node 26+
while using these web apps.

The shared presets inherit `@tsconfig/strictest` and require erasable syntax,
type-only imports, and explicit exported declaration types. TypeScript checks
without emitting; `tsdown` emits JavaScript and declarations using the `tsgo`
generator. The Strapi preset keeps its independent CommonJS build settings.

## Commands

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run check
pnpm --dir apps/strapi-openapi-spec-generator/cli run cli -- World
```

`check` validates package scripts, the lockfile and catalog versions, then runs
build, lint, type checks, unit tests, and the CLI end-to-end tests without running
source-writing `format` or `fix` tasks. Dependency boundaries are checked last,
because they resolve built and generated files. Run `pnpm run format`
and `pnpm run fix` explicitly to apply changes before checking. Run
`pnpm run test:e2e` to build the CLI and its dependencies before testing the
built executable.

Run `pnpm run deps:cruise` to check dependency boundaries on their own. It runs
dependency-cruiser in each workspace package with a `tsconfig.json`, using the
shared `.dependency-cruiser.cjs` rules.

Turbo caches `test:coverage` output under each package's `coverage/` directory.
Lint tasks also track the workspace `.gitignore`; the shared ESLint package
tracks workspace manifests and Turbo configs because its Turbo rule reads them.

## Web apps and Storybook

Run one app or Storybook variant at a time; all apps default to Vite port 3000,
and all Storybooks default to port 6006. Override the port when running more than one.

```sh
pnpm --dir apps/storybook/web-app run dev
pnpm --dir apps/storybook/web-app-with-storybook run storybook
pnpm --dir apps/storybook/web-app-with-storybook run build-storybook
pnpm --dir apps/storybook/web-app-with-storybook exec playwright install chromium
pnpm --dir apps/storybook/web-app-with-storybook exec vitest run --project storybook
```

Substitute either styling variant's directory to use Tailwind or vanilla-extract.
The root build/check tasks include all retained web apps. Build Storybooks and run
their browser tests separately using the commands above; each app README lists
its scripts. Linux hosts may need `playwright install-deps chromium`.

## Terminal UI example

`apps/tui/app` runs the SolidJS/OpenTUI list example, `apps/tui/ui` provides the
component kit and themes, and `apps/tui/lib` owns the list model in Rust through
N-API bindings. Install Bun, Rust/Cargo, and a native linker toolchain before
building or checking these packages. `pnpm install` installs Lefthook hooks when
Git is initialized. If you initialize Git later, run `pnpm run prepare` to install
the hooks.

```sh
pnpm exec turbo run build --filter=@ryangreenup/opentui-template-app...
pnpm --dir apps/tui/app run start
```

Build through Turbo so the native backend and component kit are ready, then run
the app directly so it owns the terminal. Use `j`/`k` or arrow keys to move,
Enter to choose, `t` to cycle themes, and `q` to quit. To supply your own items
or run the compiled executable:

```sh
pnpm --dir apps/tui/app run start first second third
./apps/tui/app/dist/rust-example first second third
```

The root build/check tasks include all three TUI packages. Keep the TUI's named
catalogs: its Solid runtime must match its JSX compiler. Delete `apps/tui/` and
run `pnpm install` if you do not need the terminal example or Rust toolchain.

## Shell completions

`mise` enter hooks build the CLI, `bun link` it, and source `strapi-openapi-spec-generator-cli complete
<shell>` for fish, bash and zsh. Set `cli_auto_setup = false` under `[vars]` in `mise.toml` to
turn all of that off.
