---
title: 'Architecture'
project: 'react-liquid-glass-component'
type: 'architecture'
status: '✅ Active'
last_updated: '2026-06-21'
ai_context: 'Internal architecture of the LiquidGlass component. SVG filter pipeline, fallback chain, resize handling, auto width/height, and SSR considerations.'
related:
  - 'api'
  - 'setup'
tags:
  - 'architecture'
  - 'svg-filters'
  - 'react'
---

# Architecture

## Overview

For the managed `LiquidGlassScene` renderer, automatic DOM compilation and shared-frame
WebGL composition, see [Managed scene and showcase](canvas-showcase.md). The pipeline below
describes standalone `LiquidGlass` usage outside that wrapper.

`LiquidGlass` is a React component that renders children inside a visually distorted glass pane. It uses an **SVG filter pipeline** for the liquid/glass effect, with a CSS `backdrop-filter` fallback for browsers that don't support the SVG approach.

```
┌──────────────────────────────────┐
│   <LiquidGlassStyled> (root)     │
│  ┌────────────────────────────┐  │
│  │  <svg> (hidden filter)     │  │
│  │  • feImage                │  │
│  │  • feDisplacementMap ×3   │  │
│  │  • feColorMatrix ×3       │  │
│  │  • feBlend ×2             │  │
│  │  • feGaussianBlur         │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  .liquid-glass__content    │  │
│  │  │   {children}          │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## SVG Filter Pipeline

The liquid glass effect is achieved through a multi-stage SVG filter:

### 1. Displacement Map Generation

`feImage` loads an inline SVG created dynamically via `generateDisplacementMap()`:

- A gradient tile with red (horizontal) and blue (vertical) linear gradients
- An inset rectangle with configurable `brightness`, `opacity`, and `blur`
- The `mixBlendMode` controls how the red/blue gradient layers composite

### 2. Channel Displacement

Three `feDisplacementMap` elements apply distortion to each RGB channel:

| Channel | Displacement Source | Extra Offset |
|---------|-------------------|--------------|
| Red     | `xChannel` (default: R) | `redOffset` |
| Green   | `xChannel` (default: R) | `greenOffset` |
| Blue    | `yChannel` (default: G) | `blueOffset` |

Each channel uses `distortionScale + offset` as the displacement scale.

### 3. Color Matrices

After displacement, `feColorMatrix` isolates each channel:

- Red: `[1 0 0 0 0 / 0 0 0 0 0 / 0 0 0 0 0 / 0 0 0 1 0]`
- Green: `[0 0 0 0 0 / 0 1 0 0 0 / 0 0 0 0 0 / 0 0 0 1 0]`
- Blue: `[0 0 0 0 0 / 0 0 0 0 0 / 0 0 1 0 0 / 0 0 0 1 0]`

### 4. Blend + Final Blur

- `feBlend(mode="screen")` composites red+green, then +blue
- `feGaussianBlur` applies final polish with `stdDeviation="0.7"`

---

## Fallback Chain

On mount, the component checks the SVG backdrop-filter syntax and uses a WebKit-specific feature as an engine heuristic. WebKit takes the CSS path because it can accept SVG filter syntax without rendering the effect. The syntax check is not a pixel-level rendering test.

### Tier 1: SVG Filters (`liquid-glass--svg`)

- `backdrop-filter: url(#filter-id)` applies the custom SVG filter
- CSS custom properties `--glass-frost` and `--glass-saturation` configure the glass
- Multiple inset/ambient box-shadows for depth

### Tier 2: WebGL DOM capture (`liquid-glass--webgl`)

- WebKit panes share a periodically refreshed viewport capture and one WebGL context
- html2canvas reconstructs DOM, including best-effort video frames and animation styles; it is not a compositor screenshot
- Cross-origin/protected media and unsupported CSS can be absent or inaccurate; frame rate depends on capture cost
- If capture or WebGL fails, the CSS fallback remains active

### Tier 3: CSS `backdrop-filter` (`liquid-glass--fallback`)

- Subtle backdrop blur, saturation, and tint
- This approximates glass and does not displace the backdrop

### Tier 4: No `backdrop-filter` support (`@supports not`)

- Plain semi-transparent background
- Plain translucent fill when backdrop filtering is unavailable

---

## Resize Handling

A `ResizeObserver` attached to the root element regenerates the displacement map SVG whenever the element's dimensions change. This ensures the distortion effect always matches the element's actual size.

The observer callback is debounced via `setTimeout(updateDisplacementMap, 0)` and the timeout is cleaned up on unmount.

---

## Props / HTML Attributes Passthrough

`LiquidGlassProps` extends `React.HTMLAttributes<HTMLDivElement>`. All native HTML attributes (`tabIndex`, `role`, `aria-*`, `onClick`, `data-*`, etc.) are forwarded to the root element via `...rest`.

**Width/Height defaults:** `width` and `height` default to `'auto'`. When set to `'auto'`, no inline `width`/`height` is set on the root element, allowing CSS or the `style` prop to control sizing freely.

CSS custom properties (`--glass-frost`, `--glass-saturation`, `--filter-id`) are set inline on the root element.

---

## SSR Considerations

- `useId()` generates stable filter/gradient IDs between server and client
- `svgSupported` initializes as `false`, matching server and client first paint
- Feature detection runs in `useEffect` → client-only, never during SSR
- `typeof window` / `typeof document` guards in the detection function
