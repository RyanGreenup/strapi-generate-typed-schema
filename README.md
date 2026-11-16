# Strapi OpenAPI Spec Generator

TypeScript CLI, library, SolidJS web apps, and a Rust-backed OpenTUI example.

## Packages

- `apps/strapi-openapi-spec-generator/lib` exports `generateSpecification`,
  which builds the OpenAPI 3.1 document of a Strapi 5 project.
- `apps/strapi-openapi-spec-generator/cli` exposes the
  `strapi-openapi-spec-generator-cli` command and depends on
  `@ryangreenup/strapi-openapi-spec-generator-lib` via `workspace:*`.
- `apps/strapi-openapi-spec-generator-rs` is a Cargo workspace with a `lib`
  crate and a `cli` crate (clap, with shell completions). Its `package.json`
  wraps `cargo` so the root `build`, `lint`, `check-types`, `test`, `format` and
  `fix` tasks include it.
- `packages/oxlint-config` provides shared oxlint and oxfmt config consumed by
  both packages. Its `generate-artifacts` task writes the recommended-rule JSON
  under `src/generated/`, which is gitignored; `build`, `lint`, `test` and
  `check-types` depend on that task.
- `packages/typescript_config` provides shared strict TypeScript presets. See
  its README for Node, CommonJS, Next.js, Solid/Vite, and Strapi usage.

## Generate a specification

```sh
strapi-openapi-spec-generator-cli generate path/to/strapi-project
```

This writes `specification.json` into the project. `--output` chooses another
file, `--server-url` sets the REST prefix (default `/api`), and `--cache-dir`
moves the cache (default `~/.cache/strapi-openapi-spec-generator`).

The project is only read: Strapi is not started and no database is needed. It
must have its dependencies installed and its generated types
(`strapi ts:generate-types` writes `types/generated/`).

How it works:

1. Content types come from `src/api/*/content-types/*/schema.json`.
2. Routes come from `src/api/*/routes/*`, read as source text without running
   it: `createCoreRouter` calls (with `only`, `except`, `prefix` and
   `config.<action>.auth`) and custom `{ routes: [...] }` objects. A route that
   is not written as literals is skipped with a warning.
3. Request and response schemas come from the types in
   `lib/templates/rest-types.ts`. The library copies that file and a generated
   entry file into a work directory in the cache, and [typia](https://typia.io)
   turns the types into JSON Schema under `ttsx`. The first run on a machine
   compiles the typia plugin, which takes a few minutes; later runs take
   seconds.
4. Source content-type and component JSON supplies `conditions.visible`, which
   Strapi's generated declarations omit. A postprocessing pass applies those
   rules to the generated request and response schemas.

### Response constraints

Generated response schemas preserve the restrictions in the project's generated
Strapi types: string `minLength`/`maxLength`, email format, numeric `min`/`max`,
and component item counts. For example, a published string with `minLength: 5`
and `maxLength: 10` produces those OpenAPI keywords; a generated validator can
reject a four-character value without a separate handwritten rule. String
attributes without an explicit maximum use Strapi's default `maxLength: 255`.

Draft-and-publish content types expose separate status shapes, such as
`ApiArticleArticlePublishedDocument` and `ApiArticleArticleDraftDocument`. The
ordinary `ApiArticleArticleDocument` and operation response schemas accept
either state:

| Restriction                                       | Published response | Draft response |
| ------------------------------------------------- | ------------------ | -------------- |
| String minimum length and email format            | Enforced           | Relaxed        |
| String maximum length                             | Enforced           | Enforced       |
| Numeric minimum                                   | Enforced           | Relaxed        |
| Numeric maximum and integer type                  | Enforced           | Enforced       |
| Component minimum/maximum item count              | Enforced           | Relaxed        |
| Required scalar or component value, when returned | Non-null           | Nullable       |

Every attribute key remains optional because `fields` and `populate` can omit
it; `required` does not mean that a response always includes that key. IDs stay
required. Relations and media can still be null, and related documents use their
own status rather than inheriting the parent's status. Nested components inherit
their parent's status restrictions. Optional component arrays may be empty even
when they declare a minimum count; the minimum applies to nonempty arrays, or to
required arrays.

When returned, `publishedAt` distinguishes the published date-time from draft
null. When `fields` omits it, the generic response must accept either shape;
consumers that know the requested status can use the status-specific schema.
Content types without draft-and-publish use the published restrictions directly.
Nullable relations retain `null` as a separate alternative while grouping their
overlapping draft/published variants under the document's `anyOf` schema.

### Request states

Draft-and-publish operations expose `*DraftCreateRequest`,
`*PublishedCreateRequest`, `*DraftUpdateRequest`, and
`*PublishedUpdateRequest` component schemas. The generic create/update request
schema accepts draft input; the operation's `x-strapi-request-status` extension
maps `status=draft` and `status=published` to their precise body schemas and
records the core REST default, `published`. OpenAPI cannot express a dependency
between a query parameter and the request body with standard schema keywords.
Use the extension to select a state-specific validator.

Draft input relaxes required scalar values, minimum lengths/ranges, email format,
and UID patterns, while retaining scalar upper bounds. Components inherit the
write state. Repeatable-component and dynamic-zone arrays remain non-null when
sent; required arrays without defaults must be supplied on creation, even for
drafts. Scalar defaults allow required fields to be omitted on creation.
Updates allow omitted fields. Existing component IDs permit partial component
updates; new components in a published update use creation requirements.

System attributes and `writable: false` fields are excluded from inputs.
Relation and media `required` markers do not make request fields mandatory:
Strapi's `api.documents.strictRelations` defaults to false. The generator does
not execute application configuration, check relation existence, or prove that
a merged update is publishable. Projects enabling strict relation checks need
additional runtime validation.

### Conditional fields

For source `conditions.visible` rules, visible fields retain their validation
constraints, while invisible fields do not remain unconditionally required.
Creation conditions account for schema defaults; update conditions use only
the written payload, matching Strapi's validator. Response attribute keys stay
optional for `fields` and `populate`. When a response omits a discriminator,
visibility is unknown, so the schema does not impose visibility-dependent
constraints that could reject a valid projection.

The generator translates primitive equality/inequality (`==`, `!=`, `===`,
`!==`), `and`, `or`, `!`, and membership in literal arrays. Coercive comparisons
are translated only where their matching values can be represented. Unsupported
expressions produce a warning and conservative validation instead of an
invented guarantee. The original rules remain in `x-strapi-conditions`.

Hidden input values are unconstrained because Strapi skips their entity
validation. Hidden scalar responses retain their JSON primitive shape and
allow null, without validation bounds. Hidden structured responses are
conservatively unconstrained: preserving a published component reference would
incorrectly reintroduce nested validation that Strapi skipped. Persistence and
serialization can still reject or transform values; these schemas do not
replace running the API.


### Limits

- A custom handler gets its path, parameters and security, but no body schemas.
  A custom route whose handler is a core action (for example
  `api::page.page.findOne`) gets the core schemas.
- Plugin routes (upload, users-permissions, i18n) are not included.
- Unsupported rules include `unique`, custom validators, and biginteger ranges.
  Schema-defined `regex` patterns are also absent because Strapi's generated
  types do not carry them. The built-in UID pattern does not provide
  custom-regex support.
- Response restrictions describe the core REST API; custom controllers,
  middleware, or direct database writes can bypass Strapi's validation.
- Regenerate Strapi declarations after schema edits. The generator combines those
  declarations with source JSON; stale declarations or registration hooks that
  change schemas can make the two inputs disagree.

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

| Directory                                | Stack                                        |
| ---------------------------------------- | -------------------------------------------- |
| `web-app`                                | SolidJS + Vite                               |
| `web-app-with-storybook`                 | SolidJS + Vite + Storybook, plain CSS        |
| `web-app-with-storybook-tailwind`        | SolidJS + Vite + Storybook + Tailwind CSS    |
| `web-app-with-storybook-vanilla-extract` | SolidJS + Vite + Storybook + vanilla-extract |

Delete any app directories you do not want, then run `pnpm install` to refresh
the lockfile. No workspace-glob or shared-package changes are required. Keep
Node 26+ while using these web apps.

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
pnpm --dir apps/strapi-openapi-spec-generator/cli run cli -- generate path/to/strapi-project
```

`check` validates package scripts, the lockfile and catalog versions, then runs
build, lint, type checks, unit tests, and the CLI end-to-end tests without
running source-writing `format` or `fix` tasks. Dependency boundaries are
checked last, because they resolve built and generated files. Run
`pnpm run format` and `pnpm run fix` explicitly to apply changes before
checking. Run `pnpm run test:e2e` to build the CLI and its dependencies before
testing the built executable.

Run `pnpm run deps:cruise` to check dependency boundaries on their own. It runs
dependency-cruiser in each workspace package with a `tsconfig.json`, using the
shared `.dependency-cruiser.cjs` rules.

Turbo caches `test:coverage` output under each package's `coverage/` directory.
Lint tasks also track the workspace `.gitignore`; the shared ESLint package
tracks workspace manifests and Turbo configs because its Turbo rule reads them.

## Web apps and Storybook

Run one app or Storybook variant at a time; all apps default to Vite port 3000,
and all Storybooks default to port 6006. Override the port when running more
than one.

```sh
pnpm --dir apps/storybook/web-app run dev
pnpm --dir apps/storybook/web-app-with-storybook run storybook
pnpm --dir apps/storybook/web-app-with-storybook run build-storybook
pnpm --dir apps/storybook/web-app-with-storybook exec playwright install chromium
pnpm --dir apps/storybook/web-app-with-storybook exec vitest run --project storybook
```

Substitute either styling variant's directory to use Tailwind or
vanilla-extract. The root build/check tasks include all retained web apps. Build
Storybooks and run their browser tests separately using the commands above; each
app README lists its scripts. Linux hosts may need
`playwright install-deps chromium`.

## Terminal UI example

`apps/tui/app` runs the SolidJS/OpenTUI list example, `apps/tui/ui` provides the
component kit and themes, and `apps/tui/lib` owns the list model in Rust through
N-API bindings. Install Bun, Rust/Cargo, and a native linker toolchain before
building or checking these packages. `pnpm install` installs Lefthook hooks when
Git is initialized. If you initialize Git later, run `pnpm run prepare` to
install the hooks.

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

`mise` enter hooks build the CLI, `bun link` it, and source
`strapi-openapi-spec-generator-cli complete <shell>` for fish, bash and zsh. Set
`cli_auto_setup = false` under `[vars]` in `mise.toml` to turn all of that off.
