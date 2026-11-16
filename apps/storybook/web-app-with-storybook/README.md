# Strapi OpenAPI Spec Generator — web app with Storybook

SolidJS app built with Vite, with Storybook example components, documentation,
accessibility checks, and Chromium interaction tests.

## Scripts

Run these commands from the generated repository root after installing workspace
dependencies with `pnpm install`:

- `pnpm --dir apps/storybook/web-app-with-storybook dev`: start the app on
  <http://localhost:3000>.
- `pnpm --dir apps/storybook/web-app-with-storybook build`: build the app into
  this package's `dist` directory.
- `pnpm --dir apps/storybook/web-app-with-storybook serve`: preview the
  production app build.
- `pnpm --dir apps/storybook/web-app-with-storybook storybook`: start Storybook
  on <http://localhost:6006>.
- `pnpm --dir apps/storybook/web-app-with-storybook build-storybook`: build
  Storybook into this package's `storybook-static` directory.
- `pnpm --dir apps/storybook/web-app-with-storybook check-types`: check
  TypeScript types.
- `pnpm --dir apps/storybook/web-app-with-storybook lint`: check lint rules and
  formatting.
- `pnpm --dir apps/storybook/web-app-with-storybook format`: format files.
- `pnpm --dir apps/storybook/web-app-with-storybook fix`: apply lint
  suggestions.

## Browser tests

Install Playwright's Chromium browser, then run the Storybook Vitest project:

```sh
pnpm --dir apps/storybook/web-app-with-storybook exec playwright install chromium
pnpm --dir apps/storybook/web-app-with-storybook exec vitest run --project storybook
```

The browser tests run headlessly. The `Example/Page` logged-in story exercises
the login interaction. Accessibility violations appear in the test UI without
failing tests; change `a11y.test` in `.storybook/preview.tsx` to `"error"` to
enforce them.

Storybook discovers stories and MDX docs under `src/`. Its configuration lives
in `.storybook/`, and `vite.config.ts` connects the stories to Vitest and
Playwright.
