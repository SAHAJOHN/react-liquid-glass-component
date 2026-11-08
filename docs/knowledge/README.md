---
title: 'react-liquid-glass-component documentation'
project: 'react-liquid-glass-component'
type: 'hub'
status: '✅ Active'
last_updated: '2026-11-08'
ai_context: 'Entry point for the current API, architecture, setup, and demo notes.'
related:
  - 'architecture'
  - 'api'
  - 'setup'
  - 'canvas-showcase'
tags:
  - 'react'
  - 'liquid-glass'
  - 'documentation'
---

# Documentation hub

This folder documents the current `0.4.x` package and the Next.js demo in `web/`.

## Start here

- [API reference](api.md): imports, props, defaults, `LiquidGlassScene`, and `ScrollEdge`.
- [Architecture](architecture.md): standalone rendering, managed scenes, capture, and fallback behavior.
- [Setup and workflow](setup.md): install, build, test, local demo work, and release checks.
- [Showcase and managed scene](canvas-showcase.md): scene limits, frame ownership, and browser verification.

## Public entry points

```tsx
import {
  GLASS_STUDIO_DEFAULTS,
  GLASS_STUDIO_RANGES,
  LiquidGlass,
  LiquidGlassScene,
  ScrollEdge,
} from 'react-liquid-glass-component'

import { ScrollEdge as ScrollEdgeSubpath } from 'react-liquid-glass-component/scroll-edge'
```

Use a client component when importing these components in a Next.js App Router application.
The `/scroll-edge` subpath also exports the `ScrollEdgePosition`, `ScrollEdgeCurve`, and
`ScrollEdgePreset` types.

## Current checks

The library uses TypeScript, tsup, Vitest, Testing Library, and jsdom. The demo uses Next.js,
Yarn, and styled-components; its production build uses webpack. Before a release, run the root typecheck,
lint, test, build, and pack checks, then run the demo lint and webpack build.

The responsive browser check covers 33 route and viewport combinations. It
also checks the mobile menu, native controls, ScrollEdge modes, portal alignment, and route
cleanup.
