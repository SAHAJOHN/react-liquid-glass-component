---
title: 'API Reference'
project: 'react-liquid-glass-component'
type: 'reference'
status: '✅ Active'
last_updated: '2026-11-02'
ai_context: 'Complete API reference for LiquidGlass, LiquidGlassScene, Studio material props, and ScrollEdge.'
related:
  - 'architecture'
  - 'canvas-showcase'
tags:
  - 'api'
  - 'props'
  - 'typescript'
---

# API reference

The managed scene, Studio material props, and `ScrollEdge` require `0.3.0` or newer.
Published npm `0.2.1` does not contain them; use the local package during development or
install a published `0.3.0+` release.

## Imports

```tsx
import {
  GLASS_STUDIO_DEFAULTS,
  GLASS_STUDIO_RANGES,
  LiquidGlass,
  LiquidGlassScene,
  ScrollEdge,
} from 'react-liquid-glass-component'
import type {
  GlassStudioProps,
  GlassStudioPosition,
  GlassStudioTint,
  LiquidGlassProps,
  LiquidGlassSceneProps,
  LiquidGlassSceneStatus,
  ScrollEdgeProps,
} from 'react-liquid-glass-component'
```

```tsx
import { ScrollEdge } from 'react-liquid-glass-component/scroll-edge'
import type {
  ScrollEdgeCurve,
  ScrollEdgePosition,
  ScrollEdgePreset,
} from 'react-liquid-glass-component/scroll-edge'
```

The root entry exports `LiquidGlass`, `LiquidGlassScene`, Studio constants and `ScrollEdge`.
The `/scroll-edge` entry additionally exports `ScrollEdgePosition`, `ScrollEdgeCurve` and
`ScrollEdgePreset`.

In a Next.js App Router application, import these components from a client component or a
module marked `'use client'`.

## `LiquidGlass`

`LiquidGlass` extends `React.HTMLAttributes<HTMLDivElement>`, forwards native attributes and
forwards its ref to the root element. `width` and `height` default to `'auto'`.

### Standalone props

These props apply when `LiquidGlass` is outside a `LiquidGlassScene`.

| Prop                                     | Type                  |        Default | Description                                                          |
| ---------------------------------------- | --------------------- | -------------: | -------------------------------------------------------------------- |
| `children`                               | `ReactNode`           |         `null` | Content inside the surface.                                          |
| `width`, `height`                        | `number \| string`    |       `'auto'` | Numeric values are pixels; strings are CSS sizes.                    |
| `borderRadius`                           | `number`              |           `20` | Corner radius in pixels.                                             |
| `borderWidth`                            | `number`              |         `0.07` | Inner border ratio.                                                  |
| `brightness`                             | `number`              |           `50` | Glass brightness.                                                    |
| `opacity`                                | `number`              |         `0.93` | Surface opacity.                                                     |
| `blur`                                   | `number`              |           `11` | Frost blur in pixels.                                                |
| `displace`                               | `number`              |            `0` | Output Gaussian blur.                                                |
| `backgroundOpacity`                      | `number`              |            `0` | Frost fill opacity.                                                  |
| `glassColor`                             | `string`              |              — | CSS tint color.                                                      |
| `saturation`                             | `number`              |            `1` | Saturation multiplier.                                               |
| `distortionScale`                        | `number`              |         `-180` | SVG displacement amount.                                             |
| `redOffset`, `greenOffset`, `blueOffset` | `number`              |            `0` | Per-channel offsets.                                                 |
| `xChannel`, `yChannel`                   | `'R' \| 'G' \| 'B'`   |   `'R'`, `'G'` | Displacement source channels.                                        |
| `mixBlendMode`                           | CSS blend-mode string | `'difference'` | RGB layer blend mode; see `LiquidGlassProps` for the accepted union. |

### Managed Studio props

Use these props inside `LiquidGlassScene`. `GlassStudioProps` describes the complete
material; `LiquidGlassProps` extends `Partial<GlassStudioProps>`, so each material prop is
optional. Omitted values resolve from `GLASS_STUDIO_DEFAULTS`.

```tsx
export function StudioExample() {
  return (
    <LiquidGlassScene background="#142334">
      <main>Content behind the surface</main>
      <LiquidGlass refThickness={28} refDistance={0.05} blurRadius={2} shapeRadius={80}>
        Content remains normal React content.
      </LiquidGlass>
    </LiquidGlassScene>
  )
}
```

| Prop                  |                            Default | Range / meaning                              |
| --------------------- | ---------------------------------: | -------------------------------------------- |
| `refThickness`        |                               `20` | `1–80`, refracting edge thickness in CSS px. |
| `refDistance`         |                             `0.05` | `0–0.2`, optical background distance.        |
| `refFactor`           |                              `1.4` | `1–4`, refraction factor.                    |
| `refDispersion`       |                                `7` | `0–50`, RGB dispersion.                      |
| `refFresnelRange`     |                               `30` | `0–100`, Fresnel size.                       |
| `refFresnelHardness`  |                               `20` | `0–100`.                                     |
| `refFresnelFactor`    |                               `20` | `0–100`, Fresnel intensity.                  |
| `glareRange`          |                               `30` | `0–100`, glare size.                         |
| `glareHardness`       |                               `20` | `0–100`.                                     |
| `glareFactor`         |                               `90` | `0–120`, glare intensity.                    |
| `glareConvergence`    |                               `50` | `0–100`.                                     |
| `glareOppositeFactor` |                               `80` | `0–100`.                                     |
| `glareAngle`          |                              `-45` | `-180–180` degrees.                          |
| `blurRadius`          |                                `1` | `1–200`, Gaussian radius.                    |
| `blurEdge`            |                             `true` | Blur throughout the refracting edge.         |
| `tint`                | `{ r: 255, g: 255, b: 255, a: 0 }` | RGB `0–255`, alpha `0–1`.                    |
| `shadowExpand`        |                               `25` | `2–100`.                                     |
| `shadowFactor`        |                               `15` | `0–100`.                                     |
| `shadowPosition`      |                 `{ x: 0, y: -10 }` | Each axis `-20–20`.                          |
| `shapeRadius`         |                               `80` | `1–100`, percent of half the shorter side.   |
| `shapeRoundness`      |                                `5` | `2–7`, superellipse exponent.                |

`shapeWidth` and `shapeHeight` are pixel sizing aliases. When supplied, they become the
defaults for `width` and `height`; explicit `width` or `height` props take precedence.
`shapeRadius` is a percentage of half the shorter surface side. Compatibility aliases are
`thickness` → `refThickness`, `displace` → `blurRadius`, and the magnitude of
`distortionScale` → `refDistance` when canonical props are omitted. `convexity` ranges from
`0` (flat) to `1`; `magnification` defaults to `1` and is used when `convexity` is omitted.
`GLASS_STUDIO_RANGES` contains numeric `[min, max, step]` tuples.

## `LiquidGlassScene`

`LiquidGlassScene` owns one composed canvas and reads supported HTML, text, images, SVG, video
and canvas content from its children. Consumers do not create a canvas or add markers.

| Prop                          | Type              |                 Default | Description                                           |
| ----------------------------- | ----------------- | ----------------------: | ----------------------------------------------------- |
| `background`                  | `string`          | wrapper/page background | Opaque base behind the scene.                         |
| `maxPixelRatio`               | `number`          |                     `2` | Backing resolution cap and mobile pixel-budget input. |
| `onStatusChange`              | `(state) => void` |                       — | Receives `ready` or `fallback` with reasons.          |
| `children`, `ref`, HTML attrs | React/HTML types  |                       — | Normal React content and root attributes.             |

```tsx
export function SceneWithStatus() {
  const handleStatus = (state: LiquidGlassSceneStatus) => {
    if (state.status === 'fallback') console.warn(state.reasons)
  }
  return (
    <LiquidGlassScene onStatusChange={handleStatus}>
      <main>Supported page content</main>
      <LiquidGlass refThickness={24}>Glass</LiquidGlass>
    </LiquidGlassScene>
  )
}
```

Unsupported CSS/DOM keeps original HTML visible and reports fallback reasons. Current limits
include arbitrary CSS filters/shadows, generated pseudo-content, masks, rotation/perspective,
iframes, Shadow DOM, complex nested clipping and active native editing controls. Translate,
scale and opacity animations are tracked. Text selection is not mirrored into the canvas;
cross-origin media needs CORS.

## `ScrollEdge`

`ScrollEdge` renders a root wrapper and an inner `.scroll-edge__scrollable` viewport. With the
default `target="parent"`, `shadow` uses transparent CSS masks that fade content into the real
background. It does not paint a shadow color. `blur` adds masked backdrop-blur layers.
Parent fade length is clamped between zero and half the viewport on each axis.

```tsx
export function ScrollExample() {
  return (
    <ScrollEdge edges={['top', 'bottom']} shadowSize={24} style={{ height: 240 }}>
      {Array.from({ length: 20 }, (_, index) => (
        <p key={index}>Item {index + 1}</p>
      ))}
    </ScrollEdge>
  )
}
```

| Prop                                      | Type                             |                Default | Description                                                                                  |
| ----------------------------------------- | -------------------------------- | ---------------------: | -------------------------------------------------------------------------------------------- |
| `edges`                                   | `ScrollEdgePosition[]`           |    `['top', 'bottom']` | Active edges.                                                                                |
| `shadow`                                  | `boolean`                        |                 `true` | Transparent content fade for parent target.                                                  |
| `blur`                                    | `boolean`                        |                `false` | Gradual backdrop blur layers.                                                                |
| `disabled`                                | `boolean`                        |                `false` | Disable edge effects.                                                                        |
| `shadowSize`                              | `number \| string`               |                   `24` | Fade length.                                                                                 |
| `shadowColor`                             | `string`                         |      `rgba(0,0,0,.55)` | Deprecated for parent target; used by page overlays.                                         |
| `blurStrength`                            | `number`                         |                    `1` | Blur multiplier.                                                                             |
| `edgeSize`                                | `string`                         |               `'24px'` | Blur overlay size.                                                                           |
| `divCount`                                | `number`                         |                    `8` | Blur layer count.                                                                            |
| `exponential`                             | `boolean`                        |                 `true` | Exponential blur progression.                                                                |
| `opacity`                                 | `number`                         |                    `1` | Blur opacity.                                                                                |
| `curve`                                   | `ScrollEdgeCurve`                |             `'bezier'` | Blur progression curve.                                                                      |
| `responsive`                              | `boolean`                        |                `false` | Enable responsive `edgeSize` selection.                                                      |
| `mobileSize`, `tabletSize`, `desktopSize` | `string`                         |                      — | `edgeSize` values for widths `≤480`, `≤768` and `≤1024`; widths above `1024` use `edgeSize`. |
| `animated`                                | `boolean \| 'scroll'`            |                `false` | Animate opacity or intersection visibility.                                                  |
| `duration`, `easing`                      | `string`                         | `'0.3s'`, `'ease-out'` | Animation timing.                                                                            |
| `zIndex`                                  | `number`                         |                 `1000` | Overlay stacking level.                                                                      |
| `hoverIntensity`                          | `number`                         |                      — | Hover blur multiplier.                                                                       |
| `target`                                  | `'parent' \| 'page'`             |             `'parent'` | Parent masks or fixed page overlays.                                                         |
| `preset`                                  | `ScrollEdgePreset`               |                      — | Named preset; explicit props take precedence.                                                |
| `dependencies`                            | `React.DependencyList`           |                   `[]` | Re-run observers when dependencies change.                                                   |
| `onScroll`                                | `UIEventHandler<HTMLDivElement>` |                      — | Called by the actual scrolling viewport.                                                     |
| `onAnimationComplete`                     | `() => void`                     |                      — | Called after an `animated="scroll"` intersection transition.                                 |
| `ref`                                     | `Ref<HTMLDivElement>`            |                      — | Ref to the root wrapper.                                                                     |

`target="page"` retains colored fixed overlays for compatibility and uses `shadowColor`.
It does not mask the host document. The public position, curve and preset unions are exported
from the `/scroll-edge` entry. Preset values resolve in this order: explicit props, then the
selected preset, then component defaults. The `page-header` and `page-footer` presets select
`target="page"` unless you override `target` explicitly.

`ScrollEdgePosition` is `'top' | 'bottom' | 'left' | 'right'`. `ScrollEdgeCurve` is
`'linear' | 'bezier' | 'ease-in' | 'ease-out' | 'ease-in-out'`. `ScrollEdgePreset` includes
`top`, `bottom`, `left`, `right`, `subtle`, `intense`, `smooth`, `sharp`, `header`, `footer`,
`sidebar`, `page-header`, and `page-footer`.

With `animated="scroll"`, visibility is observed with `IntersectionObserver` and
`onAnimationComplete` runs after the component becomes visible and the configured duration
elapses. Page-target overlays use that visibility; parent-target blur overlays remain visible.
For the callback, use a duration in seconds such as `0.3s`: the current implementation
parses the numeric value as seconds, even when a different CSS unit is supplied.

## CSS hooks and release status

`LiquidGlass` exposes `.liquid-glass`, `.liquid-glass__content`, `.liquid-glass--managed`,
`.liquid-glass--svg` and `.liquid-glass--fallback`. `ScrollEdge` exposes `.scroll-edge`,
`.scroll-edge__scrollable`, mask wrappers and blur overlay classes. Treat these as styling
hooks rather than a stable DOM contract.

Published npm `0.2.1` contains only the older public API. The managed scene, Studio exports
and ScrollEdge documented here require `0.3.0` or newer.
