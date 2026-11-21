# Strapi OpenAPI Spec Generator

CLI to generate an OpenAPI spec for a Strapi project.

## Overview

The Strapi OpenAPI generator is quite limited and inaccurate as it relies on Zod
schemas independent of the actual types. This uses Typia to infer the types and
emit them as an OpenAPI specification which is much more detailed.

## When To Use This

If you want really narrow types so you can stop guessing in your frontend.

Close the tab if:

1. You're not using GraphQL
   - GraphQL gives you types for free, so you don't want this.
   - However, the query complexity and database load using the GraphQL plugin
     means this is not an option.
2. You're happy with [Strapi Typed Client] [^@e4623bb]  
   TypeScript CLI, library, SolidJS web apps, and a Rust-backed OpenTUI example.
3. The amount of LLM generated code bothers you
   - In my defense
     - Nobody wants to type Strapi's API, not even the Strapi maintainers
     - It emits an OpenAPI spec, so the code itself not exactly _load bearing_.

[^@e4623bb]:
    Strapi. (n.d.). Retrieved November 21, 2026, from
    https://community.strapi.io/marketplace/strapi-typed-client

[Strapi Typed Client]:
  https://community.strapi.io/marketplace/strapi-typed-client

## Usage

To write the OpenAPI spec `specification.json` into the project generate the
strapi types and call the CLI:

> [!NOTE]
> This is read-only, it uses the types from the Strapi project.
>
> Strapi is not started, no database is required.

1. Build the Strapi types:

   ```sh
   pnpm install
   pnpm build
   pnpm strapi ts:generate-types
   ```

2. Run the command to generate the spec:

   ```sh
   strapi-openapi-spec-generator-cli generate path/to/strapi-project
   ```

The CLI has some configuration:

- `--output`
  - chooses another file
- `--server-url`
  - Sets the REST prefix (default `/api`)
- `--cache-dir`
  - Moves the cache (default `~/.cache/strapi-openapi-spec-generator`).

## How it works

1. Content types come from `src/api/*/content-types/*/schema.json`.
2. Routes come from `src/api/*/routes/*`
3. Request and response schemas come from the types in
   `lib/templates/rest-types.ts`. The library copies that file and a generated
   entry file into a work directory in the cache, and [typia](https://typia.io)
   turns the types into JSON Schema under `ttsx`.

   The first run on a machine compiles the typia plugin, which takes a few
   minutes, subsequent runs are only a few seconds.

4. Source content-type and component JSON supplies `conditions.visible`, which
   Strapi's generated declarations do not provide. A second postprocessing pass
   applies those rules to the generated request / response schemas.

   Modified `users-permissions` are expressed in the schema as plugin content
   modified in `src/extensions/<plugin>/content-types/` are read too.

Schema names come from model UIDs and their roles (e.g. published response /
draft update), they're not inferred from Typia's component names. A per-project
naming table is not required.

Generation fails on ambiguous public names or unresolved local schema references
it shouldn't write a broken spec. If a schema reaches the document without a
model role for its name, it will fall back to typia's generated name and the
result has a warning.

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
required. Relations and media can still be null. The query layer propagates the
selected publication state to related content types that support
draft-and-publish; targets without that feature keep their normal validated
shape. Nested components inherit their parent's status restrictions. Optional
component arrays may be empty even when they declare a minimum count; the
minimum applies to nonempty arrays, or to required arrays.

When returned, `publishedAt` distinguishes the published date-time from draft
null. When `fields` omits it, the generic response must accept either shape;
consumers that know the requested status can use the status-specific schema.
Content types without draft-and-publish use the published restrictions directly.
Nullable relations retain `null` as a separate alternative while grouping their
overlapping draft/published variants under the document's `anyOf` schema.

### Request states

Draft-and-publish operations expose `*DraftCreateRequest`,
`*PublishedCreateRequest`, `*DraftUpdateRequest`, and `*PublishedUpdateRequest`
component schemas. The operation's `requestBody` uses the published schema,
matching REST requests without `status`. For `status=draft`, use the draft
schema in `x-strapi-request-status.schemas`: OpenAPI cannot select a body schema
based on a query parameter.

For integer, float, and decimal inputs, the schema accepts numbers and signed
decimal strings with an optional exponent. This is a client-side syntax check,
not Strapi's coercion algorithm. For an integer bounded to 0–10, `"3.5"` and
`"11"` pass the string pattern but fail after casting. Conversely, Strapi can
cast `" 3 "` and `"0x3"`, which the client pattern rejects. Responses remain
numeric.

Draft input relaxes required scalar values, minimum lengths/ranges, email
format, and UID patterns, while retaining scalar upper bounds. Components
inherit the write state. Repeatable-component and dynamic-zone arrays remain
non-null when sent; required arrays without defaults must be supplied on
creation, even for drafts. Scalar defaults allow required fields to be omitted
on creation. Updates allow omitted fields. Existing component IDs permit partial
component updates; new components in a published update use creation
requirements.

System attributes and `writable: false` fields are excluded from inputs.
Relation and media `required` markers do not make request fields mandatory:
Strapi's `api.documents.strictRelations` defaults to false. The generator does
not execute application configuration, check relation existence, or prove that a
merged update is publishable. Projects enabling strict relation checks need
additional runtime validation.

### Conditional fields

For source `conditions.visible` rules, visible fields retain their validation
constraints, while invisible fields do not remain unconditionally required.
Creation conditions account for schema defaults; update conditions use only the
written payload, matching Strapi's validator. Response attribute keys stay
optional for `fields` and `populate`. When a response omits a discriminator,
visibility is unknown, so the schema does not impose visibility-dependent
constraints that could reject a valid projection.

The generator translates primitive equality/inequality (`==`, `!=`, `===`,
`!==`), `and`, `or`, `!`, and membership in literal arrays. Coercive comparisons
are translated only where their matching values can be represented. Unsupported
expressions produce a warning and conservative validation instead of an invented
guarantee. The original rules remain in `x-strapi-conditions`.

Hidden input values are unconstrained because Strapi skips their entity
validation. Hidden scalar responses retain their JSON primitive shape and allow
null, without validation bounds. Hidden structured responses retain public model
references alongside recursively relaxed `*Unvalidated` shapes. Those
alternatives preserve JSON structure and component discriminators without
reintroducing nested required, format, or length rules that Strapi skipped.
Persistence and serialization can still reject or transform values; these
schemas do not replace running the API.

### Core query parameters

`fields` accepts comma-separated names or an array of those strings. Use `*`
alone to request unrestricted selection. `*,title` and `["*", "title"]` are
equivalent lists; do not rely on a mixed wildcard to narrow the response.
Selectability follows the model's declared attribute kinds, not the JSON shape
of the response: JSON and rich-text blocks are selectable, but components and
relations require `populate`. The generator excludes passwords and private
fields, including names in the model's `options.privateAttributes`. Runtime-only
fields and privacy settings are not visible to static analysis.

Use `page` and `pageSize` for page-based pagination, or `start` and `limit` for
offset-based pagination. Mixing the two families is invalid, even if only one
key from each family is present. The schema accepts `limit: -1`. Its remaining
bounds and `withCount` spellings describe recommended client input, not every
value the service accepts. For example, Strapi 5.62 normalizes `pageSize: 0` and
`limit: -2` to a limit of 1, and accepts `withCount: "f"`.

### Attribute metadata

The generator reads configured attribute facts from Strapi declarations,
including attributes added during registration. Explicit keys in model JSON take
precedence: a `null` default stays `null`, and a media category list keeps its
order. Runtime-only configuration is not available offline.

`default` describes an omitted field on creation. In a published component
update, an entry without an `id` is new and gets create-time defaults; an
existing entry keeps its omitted values. Responses do not advertise defaults,
and the generator never evaluates a default function.

`x-strapi-unique` describes configuration, not a guarantee about a draft or the
current database. `x-strapi-allowed-types` lists configured media categories,
not MIME types or checks performed when a file is attached.

Numeric inputs carry `x-strapi-coerces-numeric-string`. The extension
`x-strapi-configured-bounds` replaces `x-strapi-post-coercion-bounds`: its
`minimum` and `maximum` preserve the configured numbers or strings, not the
effective validation rules. Strapi skips minimums for draft writes, retains
maximums, and truncates configured integer bounds before checking them.

### Relation metadata

Strapi's generated declarations do not say which side of a relation owns it.
Each response schema of a model with relations gets an `x-strapi-relations` map,
keyed by field, with the source `relation`, `target`, `mappedBy`, `inversedBy`,
and any non-empty `pluginOptions`. Clients can use it to skip inverse relations
or to read per-field intent, such as a populate depth. Plugin types overridden
in `src/extensions` are covered too.

### Limits

- A custom handler gets its path, parameters and security, but no body schemas.
  A custom route whose handler is a core action (for example
  `api::page.page.findOne`) gets the core schemas.
- Plugin routes (upload, users-permissions, i18n) are not included.
- Unsupported validation rules include custom validators and biginteger ranges.
  For published writes, the generator reads string-like attributes' `regex`
  rules from model JSON. A custom UID pattern replaces its built-in pattern.
  Drafts, responses, and conditionally hidden fields do not inherit these
  checks. Strapi uses flagless JavaScript regexes; JSON Schema validators use
  Unicode matching. The generator enforces a conservative subset and emits a
  warning and `x-strapi-regex` metadata for unsupported expressions.
- Response restrictions describe the core REST API; custom controllers,
  middleware, or direct database writes can bypass Strapi's validation.
- Regenerate Strapi declarations after schema edits. The generator combines
  those declarations with source JSON; stale declarations or registration hooks
  that change schemas can make the two inputs disagree.

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
