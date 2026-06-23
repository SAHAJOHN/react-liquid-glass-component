---
title: 'Setup & Workflow'
project: 'react-liquid-glass-component'
type: 'reference'
status: '✅ Active'
last_updated: '2026-06-22'
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

- Node.js 18+
- npm 9+

---

## Install

```bash
npm install
```

---

## Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `tsup --watch` | Watch mode — rebuilds `src/` on changes |
| `build` | `tsup` | Production build → `dist/` |
| `typecheck` | `tsc --noEmit` | TypeScript type checking |
| `test` | `vitest run` | Run tests once |
| `test:watch` | `vitest` | Watch mode for tests |
| `lint` | `eslint src --ext .ts,.tsx` | ESLint check |
| `format` | `prettier --write "src/**/*.{ts,tsx,json,md}"` | Auto-format code |

---

## Development Workflow

### 1. Watch component changes

```bash
npm run dev
```

Rebuilds `dist/` automatically when `src/` changes.

### 2. Playground (`web/`)

```bash
cd web
yarn install
yarn dev
```

Opens at `localhost:3000`. Imports the library via a direct symlink — uses the built `dist/` output, so run `npm run build` in the root after making library changes.

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

`npm run build` produces:

| File | Format | Size |
|---|---|---|
| `dist/index.js` | ESM | ~8 KB minified |
| `dist/index.cjs` | CommonJS | ~8 KB minified |
| `dist/index.d.ts` | TypeScript declarations | ~1 KB |
| `dist/index.js.map` / `.cjs.map` | Sourcemaps | — |

Bundle is tree-shaken and minified. `react`, `react-dom`, and `styled-components` are externalized (peer dependencies).

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
npm version patch    # 0.1.0 → 0.1.1
# or: npm version minor  # 0.1.0 → 0.2.0

# 3. Publish
npm publish

# 4. (Optional) Tag version
git tag v0.1.0
git push origin v0.1.0
```

### what gets published

`npm pack --dry-run` shows exactly which files will be in the tarball:

- `dist/` (compiled output)
- `README.md`
- `LICENSE`
- `package.json`

No source files, configs, or demos are included.

---

## Verification Checklist (pre-publish)

- [ ] `npm run lint` — 0 errors, 0 warnings
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run test` — all tests pass
- [ ] `npm run build` — ESM + CJS + .d.ts generated
- [ ] `npm pack --dry-run` — only the right files are included
- [ ] `cd web && yarn install && yarn build` — demo site builds
