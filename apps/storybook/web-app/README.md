# @ryangreenup/strapi-openapi-spec-generator-web-app

Strapi OpenAPI Spec Generator is a SolidJS and Vite web app.

Solid Devtools is enabled for development. The app uses the workspace's shared
TypeScript and Oxlint presets.

## Scripts

Install workspace dependencies with `pnpm install` from the repository root. Run
these commands from `apps/storybook/web-app`, or through Turbo from the
repository root:

- `pnpm run dev`: start the dev server on <http://localhost:3000>.
- `pnpm run build`: build for production into `dist`.
- `pnpm run serve`: preview the production build.
- `pnpm run check-types`: check TypeScript types without emitting files.
- `pnpm run lint`: run type-aware Oxlint checks and verify formatting.
- `pnpm run format`: format files with the shared Oxfmt configuration.
- `pnpm run fix`: apply Oxlint's suggested fixes.

Edit `src/app.tsx` and `src/comp.tsx` to replace the example UI. Delete
`apps/storybook/web-app` if you do not need this app.
