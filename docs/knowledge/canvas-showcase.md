# Managed scene and demo behavior

Showcase, Demo, and ScrollEdge each use one `LiquidGlassScene` with normal React and HTML.
The scene owns one canvas. The shared navbar is inside the scene. The native settings panel
stays outside it so sliders and buttons remain normal form controls.

Demo and ScrollEdge use a direct video element as their scene source. ScrollEdge's scrolling
examples use page-local foreground portals that follow scene-frame geometry. This is demo
composition, not a general way to refract unsupported DOM.

## Public contract

`LiquidGlassScene` and managed material props require package version `0.3.0` or newer.
`LiquidGlass` keeps its standalone rendering path outside a scene.

Managed surfaces accept the material props listed in the API reference. `GLASS_STUDIO_DEFAULTS`
and `GLASS_STUDIO_RANGES` provide values to controls and reset actions. The center is flat by
default. `convexity` is optional. `shapeWidth` and `shapeHeight` are sizing aliases; explicit
`width` and `height` take precedence.

## Rendering

The scene compiler supports text, inline styles, colors, gradients, borders, images, SVG,
video, and canvas elements. It tracks layout, content, fonts, media, scroll, and supported
translate, scale, and opacity animation. It also handles identity `blur(0px)`, supported 2D
translations, one alpha-gradient backdrop mask, uniform-radius backdrop-blur cards, and static
opacity groups when their geometry is safe.

The renderer owns one WebGL context and one composed frame. It reuses render targets and blur
kernels between frames. The scheduler wakes for scrolling, media, animation, resize, and
content changes, then stops when the scene is idle.

Glass-only scenes with a fixed `canvasContainer` can retain a bounded vertical scroll capture.
Within that capture, document geometry follows the current scroll offset without another DOM
compile. Canvas and video pixels still update. Changed content, styles, viewport or pane bounds,
document animations, nested scrolling, and unsupported geometry return to normal compilation.
Motion within a validated fixed navigation refreshes that subtree while retaining the document
paint, provided its new optical bounds remain inside the capture and its paint remains last.
Extra content captured ahead of the pane cannot introduce a fallback: a failed speculative
capture is discarded and the current pane is compiled normally. The renderer limits work to the
current optical source and its backdrop dependencies, including when the retained capture is wider.

Unsupported CSS and DOM includes arbitrary CSS filters, unsupported shadow/group combinations,
generated pseudo-content, luminance or layered masks, rotation and perspective, iframes, Shadow
DOM, complex nested clipping, nested opacity, unsupported glass or backdrop opacity groups, and active native editing
controls. The original HTML stays visible on fallback. `onStatusChange` reports the reasons.
Backdrop blur is fail-closed when its Gaussian sampling footprint reaches unavailable viewport
pixels, and cross-origin media needs CORS.

An animated 2D canvas inside an opacity group needs `data-liquid-glass-canvas="2d"` on the canvas.
Only declare this for a 2D context; an unmarked canvas in such a group remains on the native path.

## ScrollEdge in the demo

`target="parent"` uses transparent CSS masks to fade content into the real background.
Optional blur uses masked `backdrop-filter` layers. `target="page"` keeps fixed compatibility
overlays and supports `shadowColor` for that mode.

The demo separates the effects into four examples: vertical fade, vertical blur, four-edge
fade, and four-edge blur.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

From `web/`, run the responsive browser check against a running build:

```bash
node scripts/verify-responsive-pages.mjs http://127.0.0.1:3102
```

The shader comparison script needs a clean pinned reference checkout passed as an argument or
through `LIQUID_GLASS_REFERENCE`. The checkout is used only for verification. License and
attribution details remain in `THIRD_PARTY_NOTICES.md`.

```bash
LIQUID_GLASS_DIST_DIR=.next-preview-check yarn build --webpack
LIQUID_GLASS_DIST_DIR=.next-preview-check yarn start
```
