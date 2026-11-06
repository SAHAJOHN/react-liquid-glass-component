# Liquid Glass demo

This Next.js App Router site contains the [Showcase](https://react-liquid-glass-component.vercel.app/), [Demo](https://react-liquid-glass-component.vercel.app/demo), and [ScrollEdge](https://react-liquid-glass-component.vercel.app/scroll-edge) pages.

## Run locally

From `web/`:

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). For a production-style check:

```bash
yarn build --webpack
yarn start
```

The site uses Plus Jakarta Sans and `styled-components` for its own UI. Keep its styled-components registry even when testing the library's plain CSS implementation.

## Test local library changes

The demo normally uses the published version pinned in `package.json`. To test local library changes, build the package from the repository root and use a temporary local package installation in the demo. Restore the published dependency and `yarn.lock` before deploying.

Import library components through `components/liquid-glass-client.tsx` so they stay behind a client boundary. See the [package README](../README.md) for examples and the [setup guide](../docs/knowledge/setup.md) for the local workflow.
