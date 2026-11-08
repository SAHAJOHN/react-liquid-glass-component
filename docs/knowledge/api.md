---
title: 'API Reference'
project: 'react-liquid-glass-component'
type: 'reference'
status: '✅ Active'
last_updated: '2026-11-08'
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

The managed scene, Studio material props, and `ScrollEdge` require the current `0.4.x` release
or newer. Older npm releases may not contain these exports; install the current published
package or use the local package during development.

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
module marked `'use client'`. The library does not require `styled-components`; it forwards
`className`, `style`, refs, native HTML attributes, and runtime polymorphic `as` values to the
root element so it can still be wrapped by a consumer's styling system.

The components render their plain CSS in the React tree, which keeps server-rendered markup and
hydration self-contained. A consumer that manages styles separately can also import
`react-liquid-glass-component/styles.css` from the package and load it before the component is
painted. Each standalone `LiquidGlass` and each `ScrollEdge` renders its own static `<style>` tag;
managed panes inside one `LiquidGlassScene` share the scene's style tag. The external stylesheet
does not suppress those tags or dynamic `style` attributes. It can help with policies that block
inline style elements, but a policy that blocks inline style attributes must also permit the
dynamic attributes used by the components. The demo application keeps `styled-components` for its
own UI and registry.

## `LiquidGlass`

`LiquidGlass` extends `React.HTMLAttributes<HTMLDivElement>`, forwards native attributes and
forwards its ref to the root element. `width` and `height` default to `'auto'`.

### Standalone props

These props apply when `LiquidGlass` is outside a `LiquidGlassScene`.

| Prop                                     | Type                  |        Default | Description                                                          |
| ---------------------------------------- | --------------------- | -------------: | -------------------------------------------------------------------- |
| `children`                               | `ReactNode`           |         `null` | Content inside the surface.                                          |
| `includeStyles`                          | `boolean`             |        `true` | Render the component's embedded static style tag. Set `false` when the package stylesheet is loaded. |
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
| `glareAngleMode`      |                         `'manual'` | `'interactive'` follows touch or mouse position. |
| `nativeContent`       |                            `false` | Keep pane children as native HTML in an experimental layered scene. |
| `blurRadius`          |                                `1` | `1–200`, Gaussian radius.                    |
| `blurEdge`            |                             `true` | Blur throughout the refracting edge.         |
| `tint`                | `{ r: 255, g: 255, b: 255, a: 0 }` | RGB `0–255`, alpha `0–1`.                    |
| `shadowExpand`        |                               `25` | `2–100`.                                     |
| `shadowFactor`        |                               `15` | `0–100`.                                     |
| `shadowPosition`      |                 `{ x: 0, y: -10 }` | Each axis `-20–20`.                          |
| `shapeRadius`         |                               `80` | `1–100`, percent of half the shorter side.   |
| `shapeRoundness`      |                                `5` | `2–7`, superellipse exponent.                |

`glareAngleMode="interactive"` applies to managed glass inside a scene and adjusts the glare
around the configured `glareAngle` while a finger touches the screen, including during scrolling,
or follows mouse movement on desktop. Scrolling alone does not affect the glare. It does not use
device sensors or request permission. Reduced-motion preferences disable the effect.

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
| `maxPixelRatio`               | `number`          |                     `2` | Maximum canvas backing pixel ratio. |
| `maxCanvasPixels`             | `number`          |               `2000000` | Pixel budget; finite values of at least 1 are capped at 4096². |
| `presentation`                | `'scene' \| 'glass-only'` |              `'scene'` | Canvas coverage; `glass-only` retains native content outside the pane. |
| `onStatusChange`              | `(state) => void` |                       — | Receives `ready`, `pending`, or `fallback` with reasons. |
| `canvasContainer`             | `HTMLElement \| null` | — | In `glass-only`, mounts the canvas inside a fixed container that contains every managed pane. |
| `foreground`                  | `'canvas' \| 'native' \| 'layered'` | `'canvas'` | `'native'` retains marked controls in glass-only mode; experimental `'layered'` supports native pane content in a regular scene. |
| `includeStyles`               | `boolean`             |                  `true` | Render the scene's embedded static style tag. Set `false` when the package stylesheet is loaded. |
| `children`, `ref`, HTML attrs | React/HTML types  |                       — | Normal React content and root attributes.             |

The effective backing ratio is limited by the device DPR, `maxPixelRatio`, `maxCanvasPixels`,
and 4096 pixels per canvas side. Increasing the pixel budget raises memory and rendering cost;
individual captured bitmaps and effects may have separate limits, and devices can still fall back
when WebGL allocations fail. Invalid pixel budgets use the default of 2,000,000 pixels.

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
include unsupported CSS effects, generated pseudo-content, rotation/perspective, iframes, Shadow
DOM, deeply nested clipping and active native editing controls when their paint cannot be proven
outside the glass sampling regions. Focused `text`, `search`, `email`, `url`, and `tel` inputs plus
textareas remain native and do not force a scene fallback when their bounds, focus effects, and
ancestors are proven outside every expanded sampling region. If the control or focus effect
intersects a glass region, or the proof is incomplete, the scene keeps native fallback so the
browser owns caret, selection, and IME rendering. Password and number inputs remain fallback paths.
A single `brightness()` filter
is supported when its value darkens from `0` through `1`; `blur(0px)` is treated as an identity
while preserving containing-block semantics. Pure 2D translations are supported on eligible
positioned elements and pseudo-elements, while rotation, individual scaling and 3D transforms remain
unsupported.

The scene can also defer a bounded unsupported subtree while it is outside every glass sampling
region. This keeps the native page visible and avoids compiling pixels that cannot affect the pane.
The proof is conservative: generated content, media, box shadows, unknown filter functions, fixed
backgrounds, transformed subtrees, escaping descendants, and unmanaged clipping keep the native
fallback. When the effect or its halo reaches a glass region, the scene must render it or report
fallback; it never hides the source content just to keep WebGL active.

The following narrow effects have dedicated raster paths when their structure is provable:

- A single direct text node with one linear `background-clip: text` gradient.
- A single direct text node with one supported `text-shadow` or `-webkit-text-stroke`.
- An isolated image using exactly `brightness(0) invert(1)`.
- An isolated element with one image child and `filter: blur(...)`, a translation-only geometry,
  and a bounded overflow/radius clip. The image must pass the normal same-origin or CORS checks.

These paths use bounded canvases and caches. Complex text trees, multiple effects, unsupported
filter chains, arbitrary font overhang, scaled or rotated geometry, tainted images, and failed
asset loads remain native HTML and report their reason through `onStatusChange`.

Managed panes use native backdrop blur during fallback. The fallback approximates Studio `tint`
and `blurRadius` when the browser supports them; it does not refract the background.

Bounded static subtrees can use one vertical or horizontal black-to-transparent linear gradient
mask with pixel, percentage or `calc(100% - …px)` stops. They can also use exactly two orthogonal
alpha-only linear gradients, intersected with `mask-composite: intersect` and
`-webkit-mask-composite: source-in`. Chromium may serialize the prefixed value as `intersect`; the
standard and prefixed lists must still match. The combined mask is limited to 4096 pixels per side
and 2 million pixels total. Unsupported nested opacity, live media, additional mask layers or clipping
within the subtree still reports fallback.

Some solid, pixel-aligned boxes with a single rounded bottom border use a verified, self-contained
SVG image for their background and border. If data images or SVG `foreignObject` are unavailable,
or if raster verification fails, the normal fallback remains active.

The scene has limited backdrop-filter support. It can compose an empty element with one alpha
`linear-gradient()` mask, and a uniform-radius card with `backdrop-filter: blur(...)`, when the
element has safe geometry and no unsupported backdrop-root ancestor. Backdrop blur may be followed
by `saturate(...)` and then `brightness(...)`, each between `0` and `4`. Supported sprite and video
groups are composited before group opacity is applied. A 2D canvas inside such a group must declare
`data-liquid-glass-canvas="2d"`; do not use this attribute on a WebGL canvas. A group can also fade
one shadowless Studio pane or one supported backdrop when it is the group's first paint and the scene background is opaque.

For a default sRGB 8-bit 2D canvas, its owner may set `data-liquid-glass-canvas-format="srgb8"`
after the context is initialized, in addition to `data-liquid-glass-canvas="2d"`. This allows the
glass-only renderer to crop safe source uploads without changing their pixel resolution. The
attribute is an assertion about the existing context, not a request to create or change it.

Nested opacity, unmarked canvases, other backdrop layers inside an opacity group, unsupported inset-shadow geometry,
unsupported mask modes or layers beyond the supported one- or two-gradient forms,
SVG `url(...)` filters, and complex clipping remain native HTML paths. In glass-only mode, a blur
layer crossing the viewport edge mirrors the visible snapshot. Its edge may differ from native blur
that samples pixels outside the viewport. Text selection is not mirrored into the canvas; cross-origin media needs CORS.

`presentation="glass-only"` shows the canvas only inside the visible managed panes. Each pane
must fit inside the scene and viewport. This mode requires `shapeRoundness={2}`, `shadowFactor={0}`
and CSS `clip-path` support; separate panes also require `clip-path: path(...)`. Content outside the panes
remains native and interactive. Unsupported content or geometry reports `fallback`.
During a short pending image or SVG load, this mode can retain the last rendered frame and report
`pending`; the visible backdrop may briefly belong to the previous frame. A prolonged load or
unsupported content reports `fallback` and restores native HTML.

For a fixed navigation bar on iOS, pass `canvasContainer` with the fixed element that contains
every registered pane. The scene portals its canvas into that element so the
canvas and native controls stay together during elastic scrolling:

```tsx
const [navigation, setNavigation] = useState<HTMLElement | null>(null)

return (
  <LiquidGlassScene presentation="glass-only" canvasContainer={navigation}>
    <main>Page content</main>
    <nav ref={setNavigation} style={{ position: 'fixed' }}>
      <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
        <button type="button">Open</button>
      </LiquidGlass>
    </nav>
  </LiquidGlassScene>
)
```

The container must be inside the scene, use `position: fixed`, and have no scale. Its
ancestors must not use `transform`, `perspective`, or `filter`; every
registered pane must be inside the container. Unsupported geometry reports `fallback` and
keeps native HTML visible. Omitting the prop keeps the default canvas placement.
Passing `null` waits for the container to mount before starting the scene.

### Native foreground controls

Set `foreground="native"` when a fixed glass container also contains text, logos, links, or
buttons that must remain crisp and interactive:

```tsx
const [navigation, setNavigation] = useState<HTMLElement | null>(null)

return (
  <LiquidGlassScene
    presentation="glass-only"
    canvasContainer={navigation}
    foreground="native"
  >
    <main>Page content</main>
    <nav ref={setNavigation} style={{ position: 'fixed', inset: '16px 16px auto', height: 64 }}>
      <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} style={{ position: 'absolute', inset: 0 }} />
      <a data-liquid-glass-foreground href="#contact" style={{ position: 'relative', zIndex: 1 }}>Contact</a>
    </nav>
  </LiquidGlassScene>
)
```

In this mode, descendants marked with `data-liquid-glass-foreground` stay in the native DOM
layer above the scene canvas. The marker is intended for the foreground controls only. Do not
mark a `LiquidGlass` pane, its wrapper, or background content, because marked content is omitted
from the canvas capture and will not be refracted as scene pixels. Keep the fixed container transparent where the canvas must show through, and use CSS stacking
to place the marked controls above the canvas and every managed pane. The option does not
change the default `foreground` behavior, and it does not remove native HTML fallback when the
scene cannot safely capture other content.

### Experimental layered pane content

Use `foreground="layered"` with a regular scene and `nativeContent` on each managed pane:

```tsx
<LiquidGlassScene foreground="layered">
  <LiquidGlass nativeContent>Sharp text and controls</LiquidGlass>
</LiquidGlassScene>
```

The scene retains captured pane content for other panes to refract, while a per-pane canvas
shows the glass beneath native HTML. Outside panes, the page is displayed as native HTML; set its
background with CSS because the `background` prop controls only the captured scene's base color.
If any pane uses `nativeContent`, all managed panes in
that scene must use it. Mixing pane types triggers fallback. The current mode supports opaque,
untransformed panes without borders or intervening stacking-context ancestors; detected
unsupported layouts fall back. Other overlapping DOM content and shadows outside a pane can
still render in the wrong order. Snapshot copying and stacking checks add work, so verify
performance and visual ordering on the intended devices before adopting this experimental API.

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
| `includeStyles`                           | `boolean`                        |                 `true` | Render the component's embedded static style tag. Set `false` when the package stylesheet is loaded. |
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

Older npm releases contain only part of this public API. The managed scene, Studio exports,
interactive glare, experimental layered mode, and ScrollEdge documented here require the current
`0.4.x` release or newer.
