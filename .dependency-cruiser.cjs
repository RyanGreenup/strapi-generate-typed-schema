/**
 * dependency-cruiser configuration: gold standard baseline.
 *
 * This file is intentionally project-agnostic. It encodes the rules that
 * dependency-cruiser's maintainers and the wider community treat as best
 * practice for any JavaScript or TypeScript codebase. Adapt the `options`
 * section (tsConfig, webpackConfig, exclude globs) to a concrete repository;
 * keep the `forbidden` rules as they are unless a rule provably does not
 * apply.
 *
 * Severity ladder:
 *   error -> breaks the build; structural defects that must never land.
 *   warn  -> hygiene problems; fix soon, visible in CI output.
 *   info  -> informational; useful for reports and graphs only.
 *
 * Run:
 *   depcruise src --config .dependency-cruiser.cjs
 *   depcruise src --config .dependency-cruiser.cjs --output-type dot | dot -T svg > deps.svg
 *   depcruise src --config .dependency-cruiser.cjs --output-type err-html > report.html
 *
 * Reference: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* -------------------------------------------------------------------- */
    /* Structural correctness: errors                                       */
    /* -------------------------------------------------------------------- */
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make modules impossible to reason about or " +
        "test in isolation and can cause undefined values at runtime " +
        "(especially with CommonJS). Break the cycle by extracting the " +
        "shared part into its own module or by inverting the dependency.",
      from: {},
      to: {
        circular: true,
        // Type-only cycles are erased at compile time and are harmless.
        viaOnly: {
          dependencyTypesNot: ["type-only"],
        },
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "An orphan is a module nothing imports and that imports nothing. " +
        "It is usually dead code or a file that was forgotten after a " +
        "refactor. Either wire it in or delete it. Declaration files, " +
        "dotfiles, config files, tool config folders and test fixtures are " +
        "excluded because they are consumed by tooling or loaded by path " +
        "rather than by import statements.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$", // dotfiles
          "(^|/)[.](?:storybook|vitepress|husky)/", // tool config folders
          "(^|/)fixtures/", // loaded by path from tests
          "[.]d[.](?:c|m)?ts$", // TypeScript declaration files
          "(^|/)tsconfig[.]json$",
          "(^|/)(?:babel|webpack|vite|vitest|jest|rollup|tsup|tsdown|eslint|prettier|oxlint)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      comment:
        "These Node.js core modules are deprecated and will eventually be " +
        "removed. Migrate to the documented replacements.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: [
          "^v8/tools/codemap$",
          "^v8/tools/consarray$",
          "^v8/tools/csvparser$",
          "^v8/tools/logreader$",
          "^v8/tools/profile_view$",
          "^v8/tools/profile$",
          "^v8/tools/SourceMap$",
          "^v8/tools/splaytree$",
          "^v8/tools/tickprocessor-driver$",
          "^v8/tools/tickprocessor$",
          "^node-inspect/lib/_inspect$",
          "^node-inspect/lib/internal/inspect_client$",
          "^node-inspect/lib/internal/inspect_repl$",
          "^async_hooks$",
          "^punycode$",
          "^domain$",
          "^constants$",
          "^sys$",
          "^_linklist$",
          "^_stream_wrap$",
        ],
      },
    },
    {
      name: "not-to-deprecated",
      severity: "error",
      comment:
        "Depending on an npm package that its own maintainers have marked " +
        "deprecated means depending on unmaintained, possibly insecure " +
        "code. Upgrade or replace it.",
      from: {},
      to: {
        dependencyTypes: ["deprecated"],
      },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment:
        "Importing a package that is not declared in package.json works " +
        "only by accident of hoisting. It breaks on a fresh install, a " +
        "stricter package manager, or a dependency bump upstream. Declare " +
        "every package you import.",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "The module cannot be found on disk or in node_modules. This is a " +
        "typo, a missing install, or a resolver misconfiguration. It will " +
        "fail at runtime or build time regardless. Exception: napi-rs " +
        "loaders probe every platform binary (`./name.<platform>.node`, " +
        "`./name.wasi.cjs`, `<pkg>-<platform>`) inside try/catch, so all " +
        "but the host's are expected to be missing.",
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: [
          "[.](?:node|wasi(?:-browser)?[.]c?js)$",
          "-(?:android|darwin|freebsd|linux|openharmony|win32|wasm32)-[a-z0-9-]+(?:/package[.]json)?$",
        ],
      },
    },
    {
      name: "no-duplicate-dep-types",
      severity: "warn",
      comment:
        "A package is listed under more than one dependency type (for " +
        "example both dependencies and devDependencies). This is almost " +
        "always a mistake and makes the published artifact ambiguous. " +
        "Type-only dependencies are exempt because they are legitimately " +
        "both type and value in some setups. Peer dependencies are exempt " +
        "because a library mirrors them in devDependencies to build and " +
        "test against them.",
      from: {},
      to: {
        moreThanOneDependencyType: true,
        dependencyTypesNot: ["type-only", "npm-peer"],
      },
    },

    /* -------------------------------------------------------------------- */
    /* Production vs. test boundary                                         */
    /* -------------------------------------------------------------------- */
    {
      name: "not-to-spec",
      severity: "error",
      comment:
        "Production code must not import from test files. Test files are " +
        "excluded from builds and exist to exercise the code, not to be " +
        "part of it. If a test helper is useful in production, promote it " +
        "to a real module.",
      from: {},
      to: {
        path: "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
      },
    },
    {
      name: "not-to-test",
      severity: "error",
      comment:
        "Production code must not import from test directories such as " +
        "__tests__, __mocks__ or test/. See not-to-spec.",
      from: {
        pathNot: [
          "^(?:test|tests|spec|__tests__|__mocks__|e2e|fixtures)/",
          "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
        ],
      },
      to: {
        path: "^(?:test|tests|spec|__tests__|__mocks__|e2e|fixtures)/",
      },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Production source imports a package that is declared only in " +
        "devDependencies. That package will be absent after a production " +
        "install (`npm install --omit=dev`), so the import fails at " +
        "runtime. Move it to dependencies, or make the import type-only.",
      from: {
        path: "^(?:src|lib|app|source)/",
        pathNot: [
          "[.](?:spec|test|stories)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
          "[.]d[.](?:c|m)?ts$",
          "^(?:src|lib|app|source)/(?:test|tests|__tests__|__mocks__|fixtures)/",
        ],
      },
      to: {
        dependencyTypes: ["npm-dev"],
        // Type-only imports are erased at compile time; @types/* packages
        // are correctly devDependencies. A peer that is also a dev
        // dependency is supplied by the consumer at runtime.
        dependencyTypesNot: ["type-only", "npm-peer"],
        pathNot: ["node_modules/@types/"],
      },
    },
    {
      name: "optional-deps-used",
      severity: "info",
      comment:
        "An optional dependency may be absent at runtime. Every import of " +
        "one must be wrapped in a try/catch or an existence check. This " +
        "rule surfaces the import sites so they can be audited.",
      from: {},
      to: {
        dependencyTypes: ["npm-optional"],
      },
    },
    {
      name: "peer-deps-used",
      severity: "warn",
      comment:
        "Peer dependencies are the consumer's responsibility to install. " +
        "Importing one is fine for a library, but surprising for an " +
        "application. A library that deliberately uses a peer also lists " +
        "it in devDependencies (to build and test against it), so peers " +
        "mirrored that way are exempt.",
      from: {},
      to: {
        dependencyTypes: ["npm-peer"],
        dependencyTypesNot: ["npm-dev"],
      },
    },

    /* -------------------------------------------------------------------- */
    /* Module hygiene                                                       */
    /* -------------------------------------------------------------------- */
    {
      name: "no-reaching-into-sibling-internals",
      severity: "warn",
      comment:
        "A directory that exposes an index.{js,ts} barrel defines its " +
        "public surface there. Reaching past it into an `internal/` or " +
        "`private/` folder couples callers to implementation details. " +
        "Export what is needed from the barrel. As in Go, such a folder is " +
        "visible to every module under its parent directory: the capture " +
        "groups take the importer's first four path segments so that " +
        "`pathNot` can allow targets whose parent is one of its ancestors.",
      from: {
        // `(x|)` rather than `(x)?`: unmatched groups are dropped before
        // substitution, which would shift $2..$4.
        path: "^([^/]*)(/[^/]*|)(/[^/]*|)(/[^/]*|)",
      },
      to: {
        path: "(?:^|/)(?:internal|private|_[^/]+)/",
        pathNot: [
          "(?:^|/)node_modules/",
          "^(?:internal|private|_[^/]+)/",
          "^$1/(?:internal|private|_[^/]+)/",
          "^$1$2/(?:internal|private|_[^/]+)/",
          "^$1$2$3/(?:internal|private|_[^/]+)/",
          "^$1$2$3$4/(?:internal|private|_[^/]+)/",
        ],
      },
    },
    {
      name: "no-unsafe-dynamic-imports",
      severity: "info",
      comment:
        "Dynamic imports with non-literal specifiers cannot be analysed " +
        "statically and defeat tree shaking and this very tool. Prefer " +
        "a literal specifier or an explicit import map.",
      from: {},
      to: {
        dependencyTypes: ["dynamic-import"],
        couldNotResolve: true,
      },
    },
    {
      name: "no-json-outside-config",
      severity: "info",
      comment:
        "Importing JSON at runtime ships data as code and bypasses " +
        "validation. Fine for package.json metadata, static fixtures and " +
        "bundled data folders (assets/, generated/); treat other cases as " +
        "a prompt to load and validate at runtime.",
      from: {
        pathNot: "^(?:test|tests|__tests__|fixtures)/",
      },
      to: {
        path: "[.]json$",
        pathNot: [
          "(^|/)package[.]json$",
          "(^|/)node_modules/",
          "(^|/)(?:assets|generated)/",
        ],
      },
    },

    /* -------------------------------------------------------------------- */
    /* Layering template (left generic; tighten per repository)             */
    /* -------------------------------------------------------------------- */
    {
      name: "no-upward-layer-import",
      severity: "error",
      comment:
        "Lower layers must not import higher layers. Default layering, " +
        "lowest to highest: shared/utils -> domain/core -> services -> " +
        "application/ui -> entrypoints. Adjust the directory names to " +
        "match the repository; keep the direction.",
      from: {
        path: "^(?:src|lib|app|source)/(?:shared|utils|common|domain|core)/",
      },
      to: {
        path: "^(?:src|lib|app|source)/(?:services|application|features|ui|components|pages|routes|cli|server|bin)/",
      },
    },
    {
      name: "entrypoints-only-depend-downward",
      severity: "error",
      comment:
        "Nothing may import an entrypoint (bin/, cli/, main.*, index.* at " +
        "the package root used as executable). Entrypoints compose the " +
        "application; they are not a reusable library surface.",
      from: {
        pathNot: "^(?:src|lib|app|source)?/?(?:bin|cli|entrypoints?)/",
      },
      to: {
        path: "^(?:src|lib|app|source)?/?(?:bin|cli|entrypoints?)/",
      },
    },
  ],

  /* ---------------------------------------------------------------------- */
  /* Allowed list                                                           */
  /* ---------------------------------------------------------------------- */
  // Leave `allowed` undefined for a deny-list model (recommended default).
  // Switch to an allow-list only in highly regulated layers where every
  // permitted edge should be written down.
  // allowed: [],
  // allowedSeverity: "warn",

  /* ---------------------------------------------------------------------- */
  /* Required rules                                                         */
  /* ---------------------------------------------------------------------- */
  // Use `required` to assert that certain modules MUST depend on something,
  // for example that every controller imports the auth middleware. Left
  // empty in the generic baseline.
  // required: [],

  options: {
    /* Modules to leave out of the cruise entirely. Keep this tight: the
     * more you exclude, the less the rules can see. node_modules is
     * excluded from the *from* side by the rules above but still resolved
     * so that dependency types are known. */
    doNotFollow: {
      // Do not descend into these; still record the edge pointing at them.
      // `../` covers sibling workspace packages, which pnpm links by real
      // path: each package is cruised on its own (scripts/depcruise.mjs).
      path: ["node_modules", "^[.][.]/"],
    },
    exclude: {
      path: [
        "(^|/)[.]git/",
        // Build output of the cruised package only. Unanchored, these also
        // match inside node_modules and silently drop every edge to a
        // package whose entry point lives in its own dist/.
        "^(?:dist|build|out|coverage)/",
        // A fixture Strapi project, and types that are compiled inside the
        // consumer's Strapi project: both import @strapi/strapi, which this
        // workspace does not install.
        "^tests/fixtures/",
        "^templates/",
        "(^|/)[.](?:turbo|cache|next|nuxt|svelte-kit|output)/",
        "[.]min[.](?:js|cjs|mjs)$",
      ],
      // Do not report (but still resolve) dynamic imports whose target
      // could be computed; they are covered by no-unsafe-dynamic-imports.
      // dynamic: true,
    },

    /* Treat these as "internal" modules even though they live in
     * node_modules, for example workspace packages symlinked by pnpm. Leave
     * empty unless the repository is a monorepo. */
    // includeOnly: "",

    /* Resolve TypeScript path aliases and `paths`/`baseUrl`. Point this at
     * the root tsconfig. */
    tsConfig: {
      fileName: "tsconfig.json",
    },

    /* Pre-compile TypeScript before analysing so `import type` is
     * recognised and erased dependencies are tagged "type-only". Required
     * for the type-only exemptions above to work. */
    tsPreCompilationDeps: true,

    /* Also read dependencies declared only in type annotations. Cheap and
     * catches more. */
    // combinedDependencies: false,

    /* Bundler config: uncomment the one that applies so aliases and
     * `resolve.modules` are honoured. */
    // webpackConfig: { fileName: "webpack.config.js", env: {}, arguments: {} },
    // babelConfig: { fileName: ".babelrc" },

    /* Resolution: mirror Node's algorithm with modern conditions so that
     * package `exports` maps resolve the same way at analysis time as at
     * runtime. Put "types" first so declaration files are preferred when
     * present (needed for type-only detection), then runtime conditions. */
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".json",
        ".d.ts",
      ],
    },

    /* Which module systems to recognise. All of them; cheap. */
    moduleSystems: ["es6", "cjs", "tsd", "amd"],

    /* Report the npm dependency type of every edge so the npm-* rules can
     * fire. Requires package.json to be discoverable from the cruised
     * folder. */
    // externalModuleResolutionStrategy: "node_modules", // default

    /* Prefix for links in HTML/dot output. Set to the repository URL so
     * report nodes link to source on the hosting platform. */
    // prefix: "https://github.com/ORG/REPO/blob/main/",

    /* Detecting unused exports and other metrics. `metrics: true` adds
     * instability/afferent/efferent coupling numbers to the output, which
     * `--output-type metrics` consumes. */
    metrics: true,

    /* Cache results between runs; large speed-up in CI with a persisted
     * cache directory. */
    cache: {
      folder: "node_modules/.cache/dependency-cruiser",
      strategy: "metadata",
      compress: false,
    },

    /* Exit status: the `err` and `err-long` reporters exit non-zero when
     * any rule at severity `error` fires, so `depcruise ... --output-type
     * err` is the CI gate. Warnings are printed but do not fail the run. */

    /* Reporter tuning for graphs. These influence only presentation. */
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/(?:@[^/]+/[^/]+|[^/]+)",
        theme: {
          graph: {
            splines: "ortho",
            rankdir: "LR",
            ranksep: "1.0",
            nodesep: "0.4",
          },
          modules: [
            {
              criteria: { source: "^(?:src|lib|app|source)/" },
              attributes: { fillcolor: "#ccffcc" },
            },
            {
              criteria: { source: "[.](?:spec|test)[.]" },
              attributes: { fillcolor: "#ffffcc" },
            },
            {
              criteria: { source: "^node_modules/" },
              attributes: { fillcolor: "#eeeeee" },
            },
            {
              criteria: { orphan: true },
              attributes: { fillcolor: "#ffcccc" },
            },
          ],
          dependencies: [
            {
              criteria: { circular: true },
              attributes: { color: "red", penwidth: 2 },
            },
            {
              criteria: { "rules[0].severity": "error" },
              attributes: { color: "red" },
            },
            {
              criteria: { "rules[0].severity": "warn" },
              attributes: { color: "orange" },
            },
            {
              criteria: { dependencyTypes: ["type-only"] },
              attributes: { style: "dashed" },
            },
          ],
        },
      },
      archi: {
        // High-level architecture graph: one node per top-level folder.
        collapsePattern:
          "^(?:src|lib|app|source)/[^/]+|^node_modules/(?:@[^/]+/[^/]+|[^/]+)",
      },
      text: {
        highlightFocused: true,
      },
    },

    /* Progress output for long cruises. "cli-feedback" is fine locally;
     * set to "none" in CI logs. */
    progress: { type: "cli-feedback" },
  },
};
