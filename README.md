# Strapi OpenAPI Spec Generator

CLI to generate an OpenAPI spec for a Strapi project.

## Overview

The Strapi OpenAPI generator is quite limited and inaccurate as it relies on Zod
schemas independent of the actual types. This uses Typia to infer the types and
emit them as an OpenAPI specification which is much more detailed.

## When To Use This

If you want really narrow types so you can stop guessing in your frontend.

Close the tab if:

1. You're using GraphQL
   - GraphQL gives you types for free, so you don't want this.
   - However, the query complexity and database load using the GraphQL plugin
     means this is not an option.
2. You're happy with [Strapi Typed Client] [^@e4623bb]
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

### Generate OpenAPI Spec

To write the OpenAPI spec `specification.json` into the project generate the
strapi types and call the CLI:

> [!NOTE]
> This reads the Strapi types, writes the specification to the project and
> writes compiler files to the cache.
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

### Export CMS Data

To export CMS data to Json, e.g. for a seed or testing fixture:

```sh
strapi-openapi-spec-generator-cli dump ./backup  --spec ./specification.json --url https://cms.example
```

## How it works

1. Content types come from `src/api/*/content-types/*/schema.json`.
2. Routes come from `src/api/*/routes/*`
3. Request and response schemas come from the types in
   `apps/strapi-openapi-spec-generator/lib/templates/rest-types.ts`. The library
   copies that file and generated discovery and entry files into a work
   directory in the cache, and [typia](https://typia.io) turns the types into
   JSON Schema under `ttsx`.

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

### Response Constraints and Assumptions

#### Overview

The generated response schema has a few limitations:

1. Keys marked as optional
   - Attribute keys are optional, as `fields` and `populate` can omit required
     fields.
   - Note that IDs remain required
2. Relations and media may be `null`.
3. Strings without a configured maximum default to 255 characters. Draft and
4. Optional component arrays can be empty even with a minimum.

#### Draft and Published

##### Behaviour

For Draft and published content note the following:

1. Draft-and-publish models have both `*PublishedDocument` and `*DraftDocument`
   schemas and the ordinary `*Document` accepts either.

   | Schema                                               | Use                                                     |
   | ---------------------------------------------------- | ------------------------------------------------------- |
   | `*PublishedCreateRequest`, `*PublishedUpdateRequest` | Published writes; the operation's default `requestBody` |
   | `*DraftCreateRequest`, `*DraftUpdateRequest`         | Draft writes; see `x-strapi-request-status.schemas`     |

2. The `publishedAt` field is a date-time for published documents and null for
   drafts.
3. Components
   - Child
     - Components inherit their parent's state
   - Related
     - Related draft-and-publish models follow the requested state.
4. Other models use published restrictions.

Published types have some differences in strictness, this was required for the
[strapi-instant-preview] implementation in a client project [^6a32955]:

[^6a32955]: Specifically [John Holland's brochure site]

[strapi-instant-preview]: https://github.com/RyanGreenup/strapi-instant-preview
[John Holland's brochure site]: https://johnholland.com.au/

| Constraint                                       | Published | Draft    |
| ------------------------------------------------ | --------- | -------- |
| String minimum, email format, numeric minimum    | Enforced  | Relaxed  |
| String maximum, numeric maximum, integer type    | Enforced  | Enforced |
| Component item counts                            | Enforced  | Relaxed  |
| Required scalar or component value when returned | Non-null  | Nullable |

### Request states

- Updates
  - Updates may omit fields
  - existing components identified by `id` accept partial updates.
  - New components in published updates use create requirements.
- Required repeatable-component
  - Required repeatable-component and dynamic-zone arrays that don't have
    defaults
    - Must be provided on creation, even for drafts. These arrays cannot be null
      when sent.
- Defaults
  - Defaults allow required scalar fields to be omitted on creation.
    - System and `writable: false` attributes are excluded.
- Relations and Media Fields
  - Relation and media fields are not mandatory simply because they are marked
    required.
    - The generator does not evaluate `api.documents.strictRelations`, check
      relation existence or validate the merged document for publication.
- Numeric inputs
  - Numeric inputs accept numbers or signed decimal strings with an optional
    exponent.
  - The string pattern checks syntax, not Strapi's coercion or bounds, e.g.
    `"11"` can pass the pattern for a field capped at 10, while values Strapi
    can cast, such as `" 3 "` or `"0x3"`, do not. Responses remain numeric.

### Conditional fields

`conditions.visible` rules are validated for visible fields without making
hidden fields required unconditionally.

| Condition                                                                 | Generated behavior                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Primitive equality/inequality, `and`, `or`, `!`, literal-array membership | Translated when representable                                                                       |
| Unsupported expression                                                    | Warning and conservative validation                                                                 |
| Hidden input                                                              | Unconstrained                                                                                       |
| Hidden scalar response                                                    | Primitive shape or null, without validation bounds                                                  |
| Hidden structured response                                                | Public references and relaxed `*Unvalidated` shapes preserve structure and component discriminators |

Original rules are preserved in `x-strapi-conditions`.

### Core query parameters

> [!NOTE]
> Passwords and statically declared private fields are excluded from `fields`.

| Parameter          | Behavior                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `fields`           | Comma-separated names or an array of strings; use `*` alone for unrestricted selection. Mixed wildcards do not narrow the response. |
| `populate`         | Selects components and relations; JSON and rich-text blocks are selectable with `fields`.                                           |
| `page`, `pageSize` | Page-based pagination; do not mix with `start` or `limit`.                                                                          |
| `start`, `limit`   | Offset pagination; `limit: -1` is accepted by the schema.                                                                           |

### Metadata

| Metadata                          | Meaning                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `default`                         | Create-time default; not advertised on responses or evaluated if it is a function.                                          |
| `x-strapi-unique`                 | Configured uniqueness, not a guarantee about drafts or database state.                                                      |
| `x-strapi-allowed-types`          | Configured media categories, not MIME types or attachment validation.                                                       |
| `x-strapi-coerces-numeric-string` | Numeric input accepts a string subject to the syntax limitation above.                                                      |
| `x-strapi-configured-bounds`      | Configured numeric bounds, not necessarily effective validation rules.                                                      |
| `x-strapi-relations`              | Source relation, target, ownership fields and non-empty plugin options for emitted relation properties on response objects. |

## Development

| Command                            | Purpose                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm install`                     | Install workspace dependencies                                                                    |
| `pnpm run build`                   | Build workspace packages                                                                          |
| `pnpm run test`                    | Run unit tests                                                                                    |
| `pnpm run test:e2e`                | Build and test the CLI executable                                                                 |
| `pnpm run check`                   | Check scripts, lockfile, dependency versions, build, lint, types, tests and dependency boundaries |
| `pnpm run deps:cruise`             | Check dependency boundaries                                                                       |
| `pnpm run format` / `pnpm run fix` | Apply formatting / fixes                                                                          |

Run the CLI from the workspace:

```sh
pnpm --dir apps/strapi-openapi-spec-generator/cli run cli -- generate path/to/strapi-project
```

`mise` enter hooks build and link the CLI, which is equally convenient and
annoying, set `cli_auto_setup = false` in `mise.toml` to disable the hooks.
