# @ryangreenup/typescript-config

Shared `tsconfig` presets for packages in this workspace. Extend the preset for
your runtime, then override package-specific file paths and types.

## Usage

Add the config package to the consuming package's `devDependencies`:

```json
{
  "devDependencies": {
    "@ryangreenup/typescript-config": "workspace:*"
  }
}
```

Extend it from that package's `tsconfig.json`:

```json
{
  "extends": "@ryangreenup/typescript-config/node-app.json",
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist"]
}
```

Always set `include` in the consuming config. TypeScript resolves relative paths
where they are declared: the base preset's `include: ["src"]` points to this
config package, not the consuming package. Set any package-specific `paths`,
`types`, and `exclude` there too. Arrays such as `types` replace inherited
values rather than adding to them.

Node presets require `@types/node` in the consuming package. The base preset
loads `@tsconfig/strictest` through this package's runtime dependency.

## Presets

| Preset                | For                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base.json`           | Strictest checks, ES2022 target, ESNext modules, bundler resolution, DOM libraries, type stripping, and isolated declarations. Type-checks without emitting. |
| `node-app.json`       | Node CLI and library packages built with tsdown. Inherits the base, uses ES2022 libraries without DOM types, and adds `types: ["node"]`.                     |
| `node-app-cjs.json`   | Node packages that need NodeNext module resolution and CommonJS-compatible import syntax. Inherits the base, including `noEmit` and isolated declarations.   |
| `solid-vite-app.json` | SolidJS apps built by Vite. Inherits the base and adds `jsx: preserve`, `jsxImportSource: solid-js`, and `vite/client` types. Retains isolated declarations. |
| `nextjs.json`         | Next.js apps. Inherits the base and adds the Next.js TypeScript plugin and `jsx: preserve`. JavaScript files are disabled with `allowJs: false`.             |
| `strapi.json`         | Strapi servers. Standalone strict CommonJS configuration with incremental emission to `dist`; does not inherit the no-emit base.                             |

`node-app-cjs.json` does not force every file to be CommonJS: NodeNext uses the
nearest `package.json` `"type"` and `.cts`/`.mts` extensions to choose the
module format. Use `"type": "commonjs"` or `.cts` for CommonJS files. Use the
standalone Strapi preset for Strapi's build.

## Strictness and build behavior

`base.json` extends `@tsconfig/strictest/tsconfig.json`. Its checks include
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: indexed values can
be `undefined`, and an absent optional property differs from a property
explicitly set to `undefined`. Guard indexed values before using them; `.at()`
also returns a possibly undefined value.

The base and its derived presets also enable:

- `verbatimModuleSyntax`: use `import type` and `export type` for type-only
  symbols. The CommonJS preset disables this flag to permit regular import
  syntax.
- `erasableSyntaxOnly`: avoid enums, parameter properties, and namespaces that
  generate runtime code.
- `isolatedModules`: each file must support independent transpilation.
- `isolatedDeclarations`: add explicit types to exported declarations where
  needed so declaration generation can process files independently.
- `declaration` and `declarationMap`: configure declaration output and source
  navigation when an emitting build tool uses these settings.
- `noEmit`: `tsgo` only type-checks; tsdown or the framework build tool emits
  JavaScript and any declarations. Setting `declaration: true` alone does not
  override `noEmit`.

Bundler resolution matches tsdown's input but can differ from Node's resolution
of published dependencies. Check that published JavaScript and declaration files
resolve correctly for their consumers.

## Strapi usage

Strapi needs its own emitting configuration. Override the preset's relative
paths in the Strapi app's `tsconfig.json` so output and source discovery refer
to the app, not this config package:

```json
{
  "extends": "@ryangreenup/typescript-config/strapi.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["./", "./**/*.ts", "./**/*.js", "src/**/*.json"],
  "exclude": [
    "node_modules/",
    "build/",
    "dist/",
    ".cache/",
    ".tmp/",
    ".strapi/",
    "src/admin/",
    "**/*.test.*",
    "src/plugins/**"
  ]
}
```

The preset lists JavaScript paths for Strapi's layout but does not enable
`allowJs`. Its strict checks include unused locals and parameters, unchecked
side-effect imports, explicit overrides, and return-path checking.
