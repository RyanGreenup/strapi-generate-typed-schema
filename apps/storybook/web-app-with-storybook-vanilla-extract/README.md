# Strapi OpenAPI Spec Generator — Storybook with vanilla-extract

SolidJS app built with Vite, vanilla-extract recipes, and Storybook. The example
Button, Header, and Page stories include controls, autodocs, and a login
interaction test. Storybook's configuration guide and its assets are included in
`src/stories`.

## Scripts

Install dependencies from the repository root with `pnpm install`. Then run
commands from `apps/storybook/web-app-with-storybook-vanilla-extract`, or use
`pnpm --filter '@ryangreenup/strapi-openapi-spec-generator-web-app-with-storybook-vanilla-extract' run <script>`
from the root.

- `pnpm run dev`: start the app at <http://localhost:3000>.
- `pnpm run build`: build the app into `dist`.
- `pnpm run serve`: preview the production app.
- `pnpm run storybook`: start Storybook at <http://localhost:6006>.
- `pnpm run build-storybook`: build Storybook into `storybook-static`.
- `pnpm run check-types`: type-check with the shared Solid/Vite TypeScript
  preset.
- `pnpm run lint`, `format`, `fix`: use the shared lint and formatting
  configuration.

## Browser tests and styling

Run `pnpm exec playwright install chromium` once, then
`pnpm exec vitest run --project=storybook` from
`apps/storybook/web-app-with-storybook-vanilla-extract`. The Vite configuration
runs Storybook stories in headless Chromium with the Playwright browser
provider. Accessibility checks currently report violations without failing
tests.

The `.css.ts` files beside the example components define vanilla-extract
recipes. Vite loads the vanilla-extract plugin before the Solid plugin and
pre-bundles the recipes runtime so cold browser-test runs do not reload during
execution.

See the [Storybook documentation](https://storybook.js.org/docs) for story
authoring and
[vanilla-extract documentation](https://vanilla-extract.style/documentation/)
for styling.
