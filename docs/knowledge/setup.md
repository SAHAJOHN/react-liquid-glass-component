---
title: 'Setup & Workflow'
project: 'react-liquid-glass-component'
type: 'reference'
status: '✅ Active'
last_updated: '2026-11-02'
ai_context: 'Development setup, build pipeline, testing, and npm publish workflow for react-liquid-glass-component.'
related:
  - 'architecture'
tags:
  - 'setup'
  - 'build'
  - 'test'
  - 'publish'
---

# Setup & Workflow

## Prerequisites

- Node.js 20.9+ for the demo (the library's tooling supports Node.js 18+)
- npm 9+
- Yarn for the Next.js demo in `web/`

---

## Install

```bash
npm install
```

The root package is the library. The demo has its own dependency install:

```bash
cd web
yarn install
```

The demo uses the published library version declared in `web/package.json`. For local
library development, temporarily replace that dependency with `file:..`; it is a local
package dependency, not a guaranteed symlink. After changing library source, build the
root package and sync the generated `dist/` into the installed copy before building the
demo:

```bash
# from the repository root
npm run build
rsync -a --delete dist/ web/node_modules/react-liquid-glass-component/dist/
```

If the installed copy is missing or stale, reinstall from `web/` with `yarn install` and
repeat the root build/sync step. The sync updates only `dist/`; if the library's
`package.json` exports or version change, reinstall the local dependency and verify the
installed `package.json` reflects those changes as well.

Version `0.3.0` adds the managed `LiquidGlassScene`, Studio material exports, and
`ScrollEdge` subpath. Published npm `0.2.1` does not contain those exports. Restore the
published dependency and run `yarn install` inside `web/` before deploying the demo.

---

## Scripts

| Script       | Command                                        | Description                             |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `dev`        | `tsup --watch`                                 | Watch mode — rebuilds `src/` on changes |
| `build`      | `tsup`                                         | Production build → `dist/`              |
| `typecheck`  | `tsc --noEmit`                                 | TypeScript type checking                |
| `test`       | `vitest run`                                   | Run tests once                          |
| `test:watch` | `vitest`                                       | Watch mode for tests                    |
| `lint`       | `eslint src --ext .ts,.tsx`                    | ESLint check                            |
| `format`     | `prettier --write "src/**/*.{ts,tsx,json,md}"` | Auto-format code                        |

---

## Development Workflow

### 1. Watch component changes

```bash
npm run dev
```

Rebuilds `dist/` automatically when `src/` changes.

### 2. Demo site (`web/`)

```bash
cd web
yarn install
yarn dev
```

Opens at `http://localhost:3000`. The demo uses Next.js App Router. Its own UI still uses
`styled-components`, but the library no longer depends on it.
Interactive pages import the library through `@/components/liquid-glass-client`; do not
import the package directly from a server page. For a production-style local build use
the webpack builder:

```bash
LIQUID_GLASS_DIST_DIR=.next-preview-local yarn build --webpack
LIQUID_GLASS_DIST_DIR=.next-preview-local yarn start
```

The custom `LIQUID_GLASS_DIST_DIR` keeps a preview build separate from another running
Next process. The repository's current Next/font setup is verified with `--webpack`, and
`web/vercel.json` uses the same builder for the hosted demo.

### 3. Run tests

```bash
npm test
```

Tests use Vitest + jsdom + Testing Library. A `ResizeObserver` mock is provided in `src/setupTests.ts`.

### 4. TypeScript check

```bash
npm run typecheck
```

TypeScript strict mode is enabled. Check the library builds cleanly before publishing.

### 5. Lint

```bash
npm run lint
```

---

## Build Output

`npm run build` produces two library entry points:

| File                                               | Format                                                         | Size |
| -------------------------------------------------- | -------------------------------------------------------------- | ---- |
| `dist/index.js` / `dist/index.cjs`                 | Main ESM/CommonJS bundle                                       | —    |
| `dist/scroll-edge.js` / `dist/scroll-edge.cjs`     | `react-liquid-glass-component/scroll-edge` ESM/CommonJS bundle | —    |
| `dist/index.d.ts` / `dist/index.d.cts`             | Main TypeScript declarations                                   | —    |
| `dist/scroll-edge.d.ts` / `dist/scroll-edge.d.cts` | ScrollEdge declarations                                        | —    |

Bundles are tree-shaken and minified. Source maps are disabled. `react`, `react-dom`, and
`html2canvas` are externalized by tsup. React and React DOM remain peer dependencies, while
html2canvas is a package dependency. The library's component CSS is bundled with the component
output; `react-liquid-glass-component/styles.css` is also available when a consumer wants to load
the static rules explicitly. Each standalone `LiquidGlass` and each `ScrollEdge` renders its own
static `<style>` tag; managed panes inside one `LiquidGlassScene` share the scene's style tag. The
components still use dynamic `style` attributes, so this import does not suppress those tags or
satisfy a CSP that blocks inline style attributes. Set `includeStyles={false}` on each standalone
`LiquidGlass` or `ScrollEdge` when using the external stylesheet. Set it on `LiquidGlassScene` to
cover the scene and its managed panes.

---

## Publish to npm

```bash
# 1. Verify everything
npm run lint
npm run typecheck
npm run test
npm run build
npm pack --dry-run   # Check tarball contents

# 2. Bump version (patch/minor/major)
npm version patch --no-git-tag-version    # choose the next release version
# or: npm version minor --no-git-tag-version

# 3. Publish
npm publish

# 4. (Optional) After committing the version change, tag that commit
git tag vX.Y.Z
git push origin vX.Y.Z
```

### what gets published

`npm pack --dry-run` shows exactly which files will be in the tarball:

- `dist/` (main and ScrollEdge compiled output)
- `README.md`
- `THIRD_PARTY_NOTICES.md`
- `LICENSE`
- `package.json`

No source files, configs, or demos are included.

---

## Verification Checklist (pre-publish)

- [ ] `npm run lint` — 0 errors, 0 warnings
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run test` — all tests pass
- [ ] `npm run build` — ESM + CJS + .d.ts generated
- [ ] `npm pack --dry-run` — includes `dist/` and `THIRD_PARTY_NOTICES.md`
- [ ] `npm run build`, then sync `dist/` into `web/node_modules/react-liquid-glass-component/dist/`
- [ ] `cd web && yarn lint` — demo lint passes
- [ ] `cd web && LIQUID_GLASS_DIST_DIR=.next-preview-check yarn build --webpack` — demo site builds
