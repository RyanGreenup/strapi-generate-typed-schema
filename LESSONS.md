# Strapi REST contract lessons

These notes record findings from tracing Strapi 5.62 and improving the OpenAPI
generator on 2026-11-17. They describe the core REST Content API, not arbitrary
custom controllers, GraphQL, or the admin Content Manager API.

## Sources of truth

| Concern                           | Source                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| Content-type configuration        | [Sibling CMS API models](../../cms/src/api/)                   |
| Component configuration           | [Sibling CMS components](../../cms/src/components/)            |
| Generated Strapi descriptors      | [Sibling CMS declarations](../../cms/types/generated/)         |
| HTTP contract consumed at runtime | [specification.json](specification.json)                       |
| Client compile-time contract      | [schema.d.ts](schema.d.ts)                                     |
| Client behavior and commands      | [Package README](../README.md) and [manifest](../package.json) |

The generator checkout used for this work is external to the application
repository:

```text
/var/home/ryan/Sync/journals/2026/11/17/strapi-openapi-spec-generator
```

Its library is `apps/strapi-openapi-spec-generator/lib/`. This absolute path
identifies the local checkout, not a portable project dependency. Replace it if
the checkout moves. Its README documents supported behavior and limitations.

## The type-flow distinction

There are separate runtime and compile-time paths:

1. Strapi loads content-type JSON into its runtime registry, assigns UIDs,
   injects system fields, and applies registration hooks.
2. Runtime schemas drive database metadata, route construction, validation, and
   sanitization.
3. `strapi ts:generate-types` emits descriptor interfaces from the loaded
   registry and augments `Public.ContentTypeSchemas` and the component registry.
4. The OpenAPI generator compiles its REST type template against those
   declarations with typia. Source JSON supplements metadata omitted from the
   declarations, especially `conditions.visible`.
5. This client bundles the resulting specification for AJV validation.
   `pnpm run generate` separately derives `schema.d.ts` from that specification.

A descriptor such as
`Schema.Attribute.String & Schema.Attribute.Required & Schema.Attribute.SetMinMaxLength<{ minLength: 1 }>`
records constraints. Strapi's ordinary string value type is still `string`; the
generator must translate descriptor metadata into JSON Schema keywords. Koa does
not automatically receive a schema-specific request body type or validate a
payload because that descriptor exists.

## Rules that caused mistakes

### Required does not mean always returned

`fields` and `populate` can omit attributes, including schema-required ones.
Keep response attribute keys optional. IDs and dynamic-zone component
discriminators have separate structural roles.

A selected required scalar can be non-null in a fully validated published branch
without making its key mandatory in every response. Conditional visibility can
weaken even that value guarantee.

### Draft and published are different contracts

| Rule                                          | Published validation   | Draft validation |
| --------------------------------------------- | ---------------------- | ---------------- |
| Required scalar values                        | Enforced               | Relaxed          |
| String minimum length and numeric minimum     | Enforced               | Relaxed          |
| Email format and built-in UID pattern         | Enforced               | Relaxed          |
| Scalar maximum length/range and integer shape | Enforced               | Retained         |
| Component/dynamic-zone item-count constraints | Enforced as applicable | Relaxed          |

Do not infer that a draft accepts every missing or null value.
Repeatable-component and dynamic-zone arrays must remain non-null when supplied.
Required arrays without defaults can still need to be supplied during creation,
even for drafts.

The core REST service defaults to **published**. The lower-level Document
Service's draft default is not the REST default.

OpenAPI cannot directly correlate a query parameter with a request body schema.
The generator exposes separate `*DraftCreateRequest`, `*PublishedCreateRequest`,
`*DraftUpdateRequest`, and `*PublishedUpdateRequest` schemas. Its
`x-strapi-request-status` extension identifies the query parameter, default, and
precise schemas. The generic request body allows draft input; consumers needing
publication validation must select the appropriate state-specific schema.

### Create, patch, and component replacement differ

- Creation can omit required fields with applicable defaults.
- An omitted update field retains the stored value; a patch is not a complete
  document.
- An existing component identified by `id` can accept a partial update.
- A new component in a published update needs creation validation.
- Nested components inherit the write state. Do not validate a draft component
  as published merely because its schema marks fields required.
- A valid patch does not prove the merged stored document can be published.

These distinctions matter for importers: create drafts first when references do
not yet exist, link entries after creating them, and publish only after runtime
checks succeed. Types cannot prove that a referenced document exists.

### Conditional visibility changes validation

Strapi's entity validator skips field validation when `conditions.visible`
evaluates false. A hidden field can retain null or values that violate its usual
bounds. Do not generate a link or redirect type that requires every possible
destination simultaneously.

Important evaluation differences:

- Creation conditions see applicable schema defaults, such as an omitted `kind`
  defaulting to `page`.
- Update conditions use the written payload at the validator boundary; do not
  invent knowledge of stored discriminator values.
- An omitted response discriminator is unknown because field selection may have
  removed it. It is not evidence that the field was hidden.

Generated Strapi declarations omit this conditional metadata. Read the original
content-type and component JSON as well. Supported expressions become
conditional JSON Schema constraints. Unsupported expressions retain
`x-strapi-conditions` and produce warnings rather than fabricated precision.

### Preserve hidden structured shapes

Replacing a hidden relation, component, media value, or dynamic zone with `{}`
prevents false validation errors but destroys useful generated client types.
Retaining only the original published reference is also wrong: it restores
nested required, format, and length rules that Strapi skipped.

Keep the public typed alternative and a recursively relaxed structural
alternative. The generator uses `*Unvalidated` aliases for the latter. Preserve
object/array/scalar structure and component tags while dropping unsupported
validation guarantees. Use non-exclusive unions when branches overlap.

In particular, published and draft response schemas can both match a projection
that omits `publishedAt`. Such state unions need `anyOf`, not exclusive `oneOf`.
Nullable relation alternatives must not accidentally make a valid value match
multiple exclusive branches.

### Relation publication state matters

The core query layer propagates the selected status to populated targets that
support draft-and-publish. A published response must not automatically accept a
draft version of such a related entry, or vice versa. Targets without
draft-and-publish keep their normal validated shape. Relations and media can
still be null after population and sanitization.

Relation/media `required` markers alone do not establish an unconditional
request guarantee. The inspected runtime defaults
`api.documents.strictRelations` to false. This generator does not execute
application configuration or check database relation existence. Do not claim it
enforces a project's enabled strict-relation policy without explicitly modeling
that policy.

## Regeneration workflow

Run these commands from `cms-client/`, the directory above this file. First
regenerate the CMS declarations after model changes:

```sh
pnpm --dir ../cms exec strapi ts:generate-types
```

The specification generator reads the CMS and its installed dependencies without
starting the HTTP server or requiring a database. The preceding Strapi
declaration-generation command is a separate registration step and can execute
application registration code.

Build the local generator and set explicit input/output paths:

```sh
export GENERATOR_LIB=/var/home/ryan/Sync/journals/2026/11/17/strapi-openapi-spec-generator/apps/strapi-openapi-spec-generator/lib
pnpm --dir "$GENERATOR_LIB" run build
export GENERATOR_ENTRY="$GENERATOR_LIB/dist/index.mjs"
export CMS_PROJECT="$(realpath ../cms)"
export SPEC_OUTPUT="$PWD/src/specification.json"
```

Generate the specification. Review warnings before accepting the output:

```sh
node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { generateSpecification } = await import(
  pathToFileURL(process.env.GENERATOR_ENTRY).href
);
const { document, warnings } = await generateSpecification({
  projectDirectory: process.env.CMS_PROJECT,
});
for (const warning of warnings) console.warn(warning);
await writeFile(process.env.SPEC_OUTPUT, JSON.stringify(document, null, 2) + '\n');
console.log({
  paths: Object.keys(document.paths).length,
  schemas: Object.keys(document.components.schemas).length,
  warnings: warnings.length,
});
JS
```

Then regenerate the client declarations and exercise the consumer:

```sh
pnpm run generate
pnpm run check-types
pnpm test
pnpm run lint
pnpm run build
```

The manifest pins `openapi-typescript` and TypeScript 5.9 for declaration
generation. Its compiler-API dependency is not interchangeable with the
workspace's TypeScript 7 toolchain. The first `pnpm run generate` can require
network access.

Do not hand-edit `specification.json` or `schema.d.ts` to repair a
schema-generation bug. Change the CMS schema or the generator, regenerate, and
verify both runtime and compile-time consumers. Do not assume declarations are
current merely because the specification changed.

## Where to change the external generator

Paths below are relative to its library directory:

| File                          | Responsibility                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `templates/rest-types.ts`     | REST value shapes, publication state, components, relations, and descriptor-to-keyword mapping |
| `src/work-directory.ts`       | Project dependency resolution, generated aliases, and typia compilation inputs                 |
| `src/schema-names.ts`         | Stable schema names, reference rewriting, and overlapping unions                               |
| `src/conditions.ts`           | Source-schema conditions applied to generated model schemas                                    |
| `src/condition-predicates.ts` | Supported JSONlogic-to-schema predicates and missing-variable handling                         |
| `src/shape-only.ts`           | Structurally typed alternatives without skipped validation guarantees                          |
| `src/document.ts`             | HTTP operations, request/response references, statuses, and state metadata                     |
| `tests/generated-fixture.ts`  | Isolated temporary CMS projects and generated-schema validation helpers                        |

Use stable semantic type aliases for component and dynamic-zone inputs. Typia
can flatten anonymous intersections into opaque helper schemas; matching only
readable top-level names misses those branches. Cover existing and new component
inputs through real `generateSpecification` calls, not source-text assertions.

## Verification checklist

- Run the external generator workspace's `pnpm run check` after generator
  changes. It includes build, lint, type checks, tests, CLI end-to-end tests,
  and dependency checks.
- Resolve every local `$ref`, then compile the generated component schemas with
  AJV and formats enabled.
- Exercise the built generator outside its test harness. For uncertain
  validation rules, compare generated-schema decisions with the installed Strapi
  validator or a real HTTP scenario.
- Include boundary cases: empty strings, null versus omission, defaults, draft
  upper bounds, partial components with IDs, new components without IDs, missing
  response discriminators, hidden structured values, and relation publication
  state.
- Run this package's tests after replacing its bundled specification. Passing
  generator tests alone does not prove the consumer still works.
- Keep fixture projects isolated and remove them even when setup or generation
  fails.
- Preserve concurrent changes. During this work, files changed between reads and
  edits; refresh anchors and merge current contents rather than restoring old
  snapshots.

At the end of the implementation pass, the generator workspace check passed, the
library had 43 passing regressions, the CMS client had three passing tests, and
a smoke scenario agreed with Strapi 5.62's validator. These are historical
verification results, not permanent schema-count or test-count requirements.

## Limits to keep explicit

Static generation does not execute all runtime registration hooks or application
configuration. Custom controllers, middleware, private-attribute configuration,
direct database writes, uniqueness checks, custom validators, source regexes
absent from descriptors, and database-backed publication checks can exceed the
generated contract. Read generator warnings and verify the changed runtime path
before strengthening a schema guarantee.
