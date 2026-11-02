# Managed scene and Studio material

Showcase, Demo and ScrollEdge each use one public `LiquidGlassScene` with ordinary HTML/CSS. Consumers do not create a canvas or annotate text. The shared `Navbar` is rendered inside the scene, while the native `GlassControls` panel remains outside it so sliders and buttons stay interactive without triggering native-field fallback. The Demo and ScrollEdge pages use `VideoBackground` as a direct scene video source; it does not create a mirror canvas.

## Public contract

`src/studio-props.ts` defines the raw material names, ranges and defaults from Liquid Glass Studio at commit `f7b28c36305a862f5cffed3ddd51511cf1204f56`. The canonical controls are `refThickness`, `refDistance`, `refFactor`, `refDispersion`, the `refFresnel*` and `glare*` groups, `blurRadius`, `blurEdge`, `tint`, the `shadow*` group, `shapeRadius` and `shapeRoundness`. Public percentages and angles retain the reference UI units; conversion happens at the renderer boundary. The README contains the complete defaults table.

The center is flat by default. `convexity` remains an optional normalized body-lens extension at zero; explicit `magnification` is used only when convexity is omitted. Layout dimensions stay CSS-controlled, with optional `shapeWidth` and `shapeHeight` pixel aliases. The reference editor's second shape, merging, backend, language and media selection are not invented no-op component props.

`LiquidGlass` registers its element and resolved Studio material with the scene. Canonical props are removed before HTML attributes are forwarded. Basic old aliases are resolved only when canonical values are absent. Standalone SVG/WebKit capture behavior remains available outside a scene. These managed APIs require `0.3.0` or newer; published npm `0.2.1` contains only the older public surface.

## Rendering

`src/scene/dom-scene.ts` compiles supported DOM text/inline styling, colors, gradients, borders, images, SVG and media. It caches static rasters, tracks fixed/sticky/clipped geometry and preserves HTML for unsupported content. Studio panes skip legacy SVG displacement-map generation. Their descendants use the same superellipse clipping radius and roundness as the surface.

`src/scene/renderer.ts` owns one WebGL context and one composed-scene framebuffer. `studio-pass.ts` / `studio-shader.ts` implement the adapted reference material:

1. Subtract the reference shadow from prior scene content while preserving alpha.
2. Copy the required source region, including refraction/dispersion and blur padding.
3. Apply horizontal and vertical Gaussian passes using the reference radius/3 kernel.
4. Refract with SDF-derived normals and the reference incident/transmitted-angle equations.
5. Apply RGB dispersion, tint, LCH Fresnel and directional glare.
6. Blend the optical boundary with the reference SDF anti-aliasing profile before fixed-point color clamping.

The former map-travel clamp and artificial finite-mask profile are not used by Studio panes. The internal legacy path is retained for standalone behavior and its tests. Studio render targets and Gaussian kernels are reused; changing scroll does not upload static text/image textures. Real source video frames still upload as needed. Gaussian blur is bounded to the public radius range and must not depend on a large fragment-uniform array on mobile WebGL1.

The port carries MIT notices for Charles Yin and Adam Lastowka in `THIRD_PARTY_NOTICES.md`, included in the npm package. Source references:

- [Controls/defaults](https://github.com/iyinchao/liquid-glass-studio/blob/f7b28c36305a862f5cffed3ddd51511cf1204f56/src/Controls.tsx#L72-L238)
- [Raw-to-GPU units](https://github.com/iyinchao/liquid-glass-studio/blob/f7b28c36305a862f5cffed3ddd51511cf1204f56/src/App.tsx#L637-L686)
- [Reference surface](https://github.com/iyinchao/liquid-glass-studio/blob/f7b28c36305a862f5cffed3ddd51511cf1204f56/src/shaders/fragment-main.glsl#L463-L580)

## Frame ownership and limits

One scroll sample feeds the entire visible scene. The scheduler stops when idle and wakes for scrolling, media, CSS animation, resize and content changes. Ordinary overflow must not set global live geometry; nested scroll has its own invalidation. Stretchable viewBox SVGs reuse their texture across height-only changes. Native backdrop filters are disabled underneath a ready opaque scene, preserving HTML/media presence and stacking isolation.

The backing-resolution budget remains at most two million viewport pixels and normally at most 2x. Reference normal/light calculations can retain the device DPR while the backing resolution is capped. Defaults/formulas matching does not mean pixel identity at every device scale. Actual iPhone timing and appearance require device acceptance.

Unsupported CSS/DOM includes arbitrary CSS shadows/filters, generated pseudo-content, masks, rotation/perspective, embedded documents, Shadow DOM and complex nested clipping. Material shadows are supported by the Studio GPU path; arbitrary page CSS shadows are a separate compiler limitation. Native editing/select controls retain HTML. Source HTML remains available if assets or GPU rendering fail, reported by `onStatusChange`. Text selection is not mirrored into canvas. Cross-origin media requires CORS.

The ScrollEdge page keeps its four scrollable examples as app-local native foreground portals. They are positioned and clipped from `liquid-glass:scene-frame` updates so scrolling remains responsive, but their text is not a general escape hatch for unsupported DOM and is not refracted by the scene canvas. This page composition does not expand the library's supported CSS/DOM subset.

## Verification and preview updates

Run root `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` and `npm pack --dry-run` (including third-party notices). Sync the built package into the demo before its lint/typecheck/build.

`web/scripts/verify-studio-renderer.mjs` bundles current source and compares against the pinned upstream WebGL2 shaders on matching backgrounds/geometry, including defaults, changed material groups, clipping, maximum blur and resource reuse. Existing managed-DOM, video, viewport and legacy optics harnesses remain separate regression coverage. Runtime hosts emit `liquid-glass:scene-status`; the canvas emits `liquid-glass:scene-frame`.

Run the comparison from `web/` as `node scripts/verify-studio-renderer.mjs <reference-checkout>`, or provide the checkout path through `LIQUID_GLASS_REFERENCE`. The checkout must be at the pinned upstream commit.

`web/scripts/verify-responsive-pages.mjs` checks the three demo routes at 33 viewport combinations, including the navbar breakpoint and short desktop windows. It also exercises the navbar's outer gap, mobile menu open/Escape behavior, controls outside the scene, all four native ScrollEdge modes, horizontal scrolling, portal alignment and SPA cleanup. These are browser viewport checks; real iPhone timing and visual acceptance still require a device.

Build previews with a unique `LIQUID_GLASS_DIST_DIR=.next-preview-<version>` for both build and start. Validate on another port before replacing the live process. Keep the tunnel running where possible; anonymous quick tunnels may be invalidated by Cloudflare independently of the local process.
