# AGENTS.md — react-liquid-glass-component

## Repo layout

- **Root**: npm library package `react-liquid-glass-component`.
- **`web/`**: Next.js 16 App Router demo site deployed to Vercel at `https://react-liquid-glass-component.vercel.app`.
- **`docs/knowledge/`**: agent knowledge docs; excluded from the npm tarball.
- The old `examples/` Vite playground was removed and replaced by `web/`.

## Library package

- Entrypoint: `src/index.ts` exports `LiquidGlass`, `LiquidGlassScene`, Studio controls, and `ScrollEdge` with their public types.
- Styles live in `src/styles.ts` (single styled-component).
- Peer deps: `react >=18`, `react-dom >=18`, `styled-components >=6`.
- `width`/`height` default to `'auto'`; when `'auto'` no inline size is set, so sizing is controlled by CSS / `className` / `style`.

## Root commands (npm)

- `npm run dev` — tsup watch build.
- `npm run build` — production build to `dist/` (ESM + CJS + `.d.ts`, minified).
- `npm test` / `npm run test:watch` — Vitest with jsdom and `@testing-library/jest-dom`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint on `src/`.
- `npm run format` — Prettier on `src/**/*.{ts,tsx,json,md}`.

## Library modules

- Main entry (`src/index.ts`): exports `LiquidGlass`, `LiquidGlassScene`, Studio constants/types, and `ScrollEdge`.
- Subpath entry (`src/scroll-edge.ts`): `react-liquid-glass-component/scroll-edge` for tree-shaken imports and ScrollEdge union types.
- Parent-target `ScrollEdge` uses transparent CSS masks for scroll-aware content fades, with optional gradual blur layers at any edge (`top`, `bottom`, `left`, `right`). Page-target mode retains fixed colored compatibility overlays.
- The `ScrollEdge` root element wraps the actual `.scroll-edge__scrollable` viewport. Edge masks and blur layers stay attached to the viewport while content scrolls.

## Release flow

1. In root: bump the package version, run `npm run build`, run the release checks, then `npm publish`.
2. Version `0.3.0` adds `LiquidGlassScene`, Studio exports, and `ScrollEdge` that are absent from npm `0.2.1`.
3. `web/package.json` uses the published npm release. For local testing it may temporarily use `file:..`; restore the published version and reinstall inside `web/` before deploying.
4. `web/vercel.json` runs `yarn install && yarn build --webpack`; the Vercel project root is `web/`.

## Demo site (`web/`)

- Package manager is **yarn** (`web/yarn.lock`). Run all commands from inside `web/`.
- Commands: `yarn dev`, `yarn build --webpack`, `yarn start`, `yarn lint`.
- Next.js 16 + styled-components + Tailwind v4. Styled-components SSR works via `app/registry.tsx` and `compiler.styledComponents: true` in `next.config.ts`.
- Do not import `LiquidGlass` directly from `react-liquid-glass-component` in server pages; import from `@/components/liquid-glass-client`, which re-exports it behind `'use client'`.
- Design tokens live in `@/lib/responsive.ts` (not `app/lib/responsive.ts`).
- Mobile hamburger menu breakpoint is `max-width: 420px`.
- `next.config.ts` sets `turbopack.root` to the repo root (`..`). This matters when running with `--turbopack`.

## README image assets

- README references images via `raw.githubusercontent.com/.../main/web/public/images/`.
- The images live in `web/public/images/` and must be committed and pushed to `main` before those URLs resolve.

## Style / lint

- Root Prettier: single quotes, no semicolons, print width 100, trailing comma `es5`.
- Root ESLint uses `.eslintrc.cjs` and ESLint 8. `web/` uses `eslint.config.mjs` and ESLint 9 with `eslint-config-next`.
