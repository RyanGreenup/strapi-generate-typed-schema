# @ryangreenup/tui-components

OpenTUI SolidJS component kit: the full component library extracted from the
`tui` showcase app (buttons, dialogs, selects, tables, tree views, theme system,
keymap helpers, and more).

## Workspace development

From the workspace root:

```sh
pnpm --filter "@ryangreenup/tui-components" build
pnpm --filter "@ryangreenup/tui-components" check-types
pnpm --filter "@ryangreenup/tui-components" lint
```

The example app consumes the compiled package through a workspace dependency.
Build the component kit before launching the app, or use the workspace dev task
to rebuild it in watch mode.

## Install

```sh
pnpm add @ryangreenup/tui-components
```

`solid-js`, `@opentui/core`, `@opentui/solid`, and `@opentui/keymap` are peer
dependencies and must be installed by the consumer.

## Usage

Everything is exported from the package root; no JSX or babel configuration is
required on the consumer side:

```tsx
import { render } from "@opentui/solid";
import { Button, ThemeProvider } from "@ryangreenup/tui-components";

void render(() => (
  <ThemeProvider>
    <Button label="Hello" onPress={() => {}} />
  </ThemeProvider>
));
```

### First frame and `waitForTerminal`

By default `ThemeProvider` renders its children only after it has detected the
terminal palette, so the first frame already uses the right theme and dark/light
mode. Detection can add about 300ms to startup (the
`OTUI_PALETTE_IDLE_TIMEOUT_MS` quiet period). Pass `waitForTerminal={false}` to
render at once with the `theme`/`mode` props; detection still runs and updates
the theme when it finishes, so the mode can switch after the first frames on a
light terminal.

### Themes

The bundled themes are included in both builds; consumers do not need to copy
JSON assets. Select one with `<ThemeProvider theme="catppuccin">`. The package
root also exports `DEFAULT_THEMES`, `allThemes`, and the theme registration
helpers.

### Tree selection and scrolling

`TreeView` tracks `highlighted` and visible rows reactively. Its deferred
post-layout scroll reads the latest selection, including changes made before the
next frame. Constrain the scrollbox viewport height in the surrounding layout
when displaying a long tree.

## Packaging notes

The build ships pre-compiled Solid "universal" output (JSX already compiled
against `@opentui/solid`), mirroring `@opentui/solid`'s own packaging:

- `dist/index.js` (node/default): `solid-js` imports are redirected to the
  client dist files, because solid-js's `node` export condition resolves to
  server-only builds that cannot drive a terminal renderer. `solid-js/store` is
  bundled into this output: its dist file itself imports bare `solid-js`, which
  node would resolve to the server build and split the reactive system (store
  writes would silently never reach the UI).
- `dist/index.bun.js` (`bun` condition): keeps bare `solid-js` imports so the
  `@opentui/solid` preload plugin resolves a single shared solid instance.

There is intentionally no preserved-JSX `solid` export condition: downstream
Solid toolchains default to `generate: 'dom'`, which emits DOM renderer calls
that cannot run under OpenTUI.

Keep the consumer's `typescript` version aligned with this package (currently
`^6.0.3`). pnpm keys `@opentui/solid`'s peer resolution on it; mismatched
versions split `@opentui/solid` into two instances and break rendering with "No
renderer found".
