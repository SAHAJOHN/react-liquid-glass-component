# React Liquid Glass

React components for glass surfaces, WebGL scenes, and scroll edge effects.

[![npm](https://img.shields.io/npm/v/react-liquid-glass-component)](https://www.npmjs.com/package/react-liquid-glass-component)
[![license](https://img.shields.io/npm/l/react-liquid-glass-component)](LICENSE)

[Showcase](https://react-liquid-glass-component.vercel.app/) · [Interactive demo](https://react-liquid-glass-component.vercel.app/demo) · [ScrollEdge demo](https://react-liquid-glass-component.vercel.app/scroll-edge) · [API reference](https://github.com/SAHAJOHN/react-liquid-glass-component/blob/main/docs/knowledge/api.md)

![Glass surfaces in the showcase](https://raw.githubusercontent.com/SAHAJOHN/react-liquid-glass-component/main/web/public/images/showcase-current.png)

![Glass settings in the interactive demo](https://raw.githubusercontent.com/SAHAJOHN/react-liquid-glass-component/main/web/public/images/demo-current.png)

![ScrollEdge examples](https://raw.githubusercontent.com/SAHAJOHN/react-liquid-glass-component/main/web/public/images/scroll-edge-current.png)

Sites using the library include [KA Technology](https://dev.kacorptech.com/) and [Code Terminal](https://codeterminal.io/).

## Install

Install the package with React 18 or newer and React DOM 18 or newer:

```bash
npm install react-liquid-glass-component
```

The library supplies its own CSS. No stylesheet import or `styled-components` dependency is required for the default setup. In Next.js App Router, use the components from a client component.

## Quick start

Use `LiquidGlass` on its own for a single surface:

```tsx
'use client'

import { LiquidGlass } from 'react-liquid-glass-component'

export function Card() {
  return (
    <LiquidGlass width={320} borderRadius={24}>
      <p>Hello through glass.</p>
    </LiquidGlass>
  )
}
```

`width` and `height` default to `auto`. Use props, `className`, or `style` to size the surface. Children remain regular React elements.

## Refract page content

Wrap the content and its glass surfaces in `LiquidGlassScene`. The scene builds a WebGL view of supported content and updates it as the page changes.

```tsx
'use client'

import { LiquidGlass, LiquidGlassScene } from 'react-liquid-glass-component'

export function Page() {
  return (
    <LiquidGlassScene background="#142334">
      <main>
        <h1>Your page</h1>
        <p>Content behind the glass can be refracted.</p>
        <LiquidGlass width={320} refThickness={24} refFactor={1.4}>
          <button type="button">Open</button>
        </LiquidGlass>
      </main>
    </LiquidGlassScene>
  )
}
```

Use `presentation="glass-only"` to keep the page visible outside managed panes. It requires `shapeRoundness={2}` and `shadowFactor={0}`. Each visible pane must fit inside the scene and viewport. For multiple separate panes, the browser also needs CSS `clip-path: path(...)` support.

For fixed navigation, pass the element containing the glass to `canvasContainer`. This keeps the scene canvas with the native controls during scrolling:

```tsx
'use client'

import { useState } from 'react'
import { LiquidGlass, LiquidGlassScene } from 'react-liquid-glass-component'

export function FixedNavigation() {
  const [navigation, setNavigation] = useState<HTMLElement | null>(null)

  return (
    <LiquidGlassScene presentation="glass-only" canvasContainer={navigation}>
      <main>Page content</main>
      <nav ref={setNavigation} style={{ position: 'fixed', bottom: 24 }}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          <button type="button">Open</button>
        </LiquidGlass>
      </nav>
    </LiquidGlassScene>
  )
}
```

The container must be inside the scene, use `position: fixed`, and contain every managed pane. It must not be scaled, and its ancestors must not use transforms, perspective, or filters. Passing `null` waits for the element to mount.

Scene rendering supports common text, images, SVG, video, canvas, backgrounds, borders, and layout changes. Some CSS and DOM combinations cannot be captured safely. In that case the scene keeps the original HTML visible and reports `fallback` through `onStatusChange`; the native fallback does not refract the background. Cross-origin media needs CORS permission. See [scene support and limitations](https://github.com/SAHAJOHN/react-liquid-glass-component/blob/main/docs/knowledge/api.md#liquidglassscene) for details.

### Main scene options

| Prop | Default | Purpose |
| --- | --- | --- |
| `background` | Page or wrapper background | Base color behind the scene. |
| `maxPixelRatio` | `2` | Limits canvas backing resolution. |
| `presentation` | `'scene'` | Choose `'scene'` or `'glass-only'`. |
| `canvasContainer` | `undefined` | Fixed container for a glass-only canvas. |
| `onStatusChange` | `undefined` | Receives `ready`, `pending`, or `fallback`. |
| `includeStyles` | `true` | Include the scene's CSS in rendered markup. |

## Glass settings

Inside a scene, use material props to adjust the surface. A few useful starting points:

```tsx
'use client'

import { LiquidGlass, LiquidGlassScene } from 'react-liquid-glass-component'

export function MaterialExample() {
  return (
    <LiquidGlassScene>
      <LiquidGlass
        refThickness={24}
        refFactor={1.4}
        refDispersion={7}
        blurRadius={2}
        tint={{ r: 255, g: 255, b: 255, a: 0.08 }}
      >
        Content
      </LiquidGlass>
    </LiquidGlassScene>
  )
}
```

`refThickness` controls the refracting edge, `refFactor` changes how it bends the background, and `refDispersion` adds color separation. `blurRadius` and `tint` adjust the material. `GLASS_STUDIO_DEFAULTS` and `GLASS_STUDIO_RANGES` are exported for building controls. See the [full list of props and defaults](https://github.com/SAHAJOHN/react-liquid-glass-component/blob/main/docs/knowledge/api.md#liquidglass).

## ScrollEdge

Use `ScrollEdge` to fade or blur the edges of a scrollable area. The subpath keeps the import focused on this component:

```tsx
'use client'

import { ScrollEdge } from 'react-liquid-glass-component/scroll-edge'

export function List() {
  return (
    <ScrollEdge edges={['top', 'bottom']} shadowSize={24} style={{ height: 240 }}>
      {Array.from({ length: 20 }, (_, index) => (
        <p key={index}>Item {index + 1}</p>
      ))}
    </ScrollEdge>
  )
}
```

The default fade uses transparent masks, so it blends with the background. To use blur without the fade, pass `shadow={false}` and `blur`. `onScroll` receives events from the inner viewport; the forwarded ref points to the outer wrapper. See [ScrollEdge options](https://github.com/SAHAJOHN/react-liquid-glass-component/blob/main/docs/knowledge/api.md#scrolledge).

## CSS

By default, each standalone `LiquidGlass` and `ScrollEdge` renders its own static `<style>` tag. Managed glass panes inside one `LiquidGlassScene` share the scene's tag. The CSS is present in server-rendered HTML, and no import is needed.

To load the rules once yourself, import the stylesheet and disable embedded styles on each independent component:

```tsx
'use client'

import 'react-liquid-glass-component/styles.css'
import { LiquidGlass, LiquidGlassScene, ScrollEdge } from 'react-liquid-glass-component'

export function Page() {
  return (
    <>
      <LiquidGlassScene includeStyles={false}>
        <LiquidGlass>Managed pane</LiquidGlass>
      </LiquidGlassScene>
      <ScrollEdge includeStyles={false} style={{ height: 240 }}>
        Scrollable content
      </ScrollEdge>
    </>
  )
}
```

`includeStyles={false}` on a scene also covers its managed glass panes. Set it on each standalone `LiquidGlass` and `ScrollEdge` that uses the external stylesheet. The components still use dynamic `style` attributes, so importing the CSS alone does not satisfy a CSP that blocks those attributes.

## Browser behavior

Managed scenes use WebGL. Standalone surfaces use browser-specific SVG or WebKit capture paths and can fall back to native blur. Performance depends on the page, device, and effects behind the glass; no frame rate is guaranteed.

## Local development

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build

cd web
yarn install
yarn dev
```

The demo uses the published package pinned in `web/package.json` and keeps `styled-components` for its own UI. To test library changes before publishing, use a temporary local package build. See the [setup guide](https://github.com/SAHAJOHN/react-liquid-glass-component/blob/main/docs/knowledge/setup.md).

## License

[MIT](LICENSE)
