---
title: 'API Reference'
project: 'react-liquid-glass-component'
type: 'reference'
status: '✅ Active'
last_updated: '2026-06-21'
ai_context: 'Complete API reference for the LiquidGlass component. Props, types, defaults, and usage patterns.'
related:
  - 'architecture'
tags:
  - 'api'
  - 'props'
  - 'typescript'
---

# API Reference

## Import

```tsx
import { LiquidGlass } from 'react-liquid-glass-component'
import type { LiquidGlassProps } from 'react-liquid-glass-component'
```

---

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | `null` | Content inside the glass pane |
| `width` | `number \| string` | `'auto'` | Width (`number` = px, `string` = any CSS unit; omitted = CSS/`style` controls) |
| `height` | `number \| string` | `'auto'` | Height (`number` = px, `string` = any CSS unit; omitted = CSS/`style` controls) |
| `borderRadius` | `number` | `20` | Corner radius in px |
| `borderWidth` | `number` | `0.07` | Edge inset ratio for glass border |
| `brightness` | `number` | `50` | Brightness of glass fill (0–100) |
| `opacity` | `number` | `0.93` | Opacity of glass fill |
| `blur` | `number` | `11` | Frosted blur in px |
| `displace` | `number` | `0` | Post-filter Gaussian blur on output |
| `backgroundOpacity` | `number` | `0` | Frost background opacity (`--glass-frost`) |
| `glassColor` | `string` | `'light-dark(white, black)'` | Glass tint color — any CSS color value |
| `saturation` | `number` | `1` | Saturation multiplier (`--glass-saturation`) |
| `distortionScale` | `number` | `-180` | Liquid distortion intensity (negative = inverted warp) |
| `redOffset` | `number` | `0` | Extra distortion offset for red channel |
| `greenOffset` | `number` | `10` | Extra distortion offset for green channel |
| `blueOffset` | `number` | `20` | Extra distortion offset for blue channel |
| `xChannel` | `'R' \| 'G' \| 'B'` | `'R'` | Source channel for red displacement |
| `yChannel` | `'R' \| 'G' \| 'B'` | `'G'` | Source channel for green/blue displacement |
| `mixBlendMode` | `CSSBlendMode` | `'difference'` | Blend mode for RGB gradient layers |
| `className` | `string` | `''` | Additional CSS classes (inherited from `HTMLAttributes`) |
| `style` | `CSSProperties` | `{}` | Additional inline styles (inherited from `HTMLAttributes`) |
| `ref` | `Ref<HTMLDivElement>` | — | Forwarded ref to root element |
| HTML attributes | — | — | `tabIndex`, `aria-*`, `data-*`, `onClick`, etc. |

### Extended HTML Attributes

`LiquidGlassProps` extends `React.HTMLAttributes<HTMLDivElement>`, so you can pass any native HTML attribute — they are passed through to the root `<div>` via `...rest`:

```tsx
<LiquidGlass
  tabIndex={0}
  role="region"
  aria-label="Glass panel"
  data-testid="glass"
  onClick={handleClick}
>
  Content
</LiquidGlass>
```

---

## TypeScript Interface

```tsx
export interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string
  height?: number | string
  borderRadius?: number
  borderWidth?: number
  brightness?: number
  opacity?: number
  blur?: number
  displace?: number
  backgroundOpacity?: number
  glassColor?: string
  saturation?: number
  distortionScale?: number
  redOffset?: number
  greenOffset?: number
  blueOffset?: number
  xChannel?: 'R' | 'G' | 'B'
  yChannel?: 'R' | 'G' | 'B'
  mixBlendMode?:
    | 'normal' | 'multiply' | 'screen' | 'overlay'
    | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
    | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'
    | 'hue' | 'saturation' | 'color' | 'luminosity'
    | 'plus-darker' | 'plus-lighter'
}
```

---

## Usage Patterns

### Basic
```tsx
<LiquidGlass borderRadius={24} blur={12}>
  <h1>Hello</h1>
  <p>Behind the glass.</p>
</LiquidGlass>
```

### Chromatic aberration effect
```tsx
<LiquidGlass
  borderRadius={16}
  redOffset={20}
  greenOffset={0}
  blueOffset={-20}
  distortionScale={-300}
>
  <h2>Chromatic</h2>
</LiquidGlass>
```

### Circular glass (avatar)
```tsx
<LiquidGlass borderRadius={60} width={120} height={120} blur={8}>
  <span>🧊</span>
</LiquidGlass>
```

### Ref forwarding
```tsx
const ref = useRef<HTMLDivElement>(null)

<LiquidGlass ref={ref}>
  Content
</LiquidGlass>
```

---

## CSS Custom Properties

The component sets these custom properties on the root element for CSS-based customization:

| Property | Source Prop | Description |
|---|---|---|
| `--glass-color` | `glassColor` | Glass tint color |
| `--glass-frost` | `backgroundOpacity` | Background opacity of the glass |
| `--glass-saturation` | `saturation` | Backdrop saturation multiplier |
| `--filter-id` | (internal) | SVG filter reference `url(#...)` |

---

## BEM Class Names

The root element uses BEM-like class names for styling:

| Class | Purpose |
|---|---|
| `.liquid-glass` | Root — always present |
| `.liquid-glass--svg` | SVG filter path (modern browsers) |
| `.liquid-glass--fallback` | CSS `backdrop-filter` path (fallback) |
| `.liquid-glass__filter` | Hidden SVG container |
| `.liquid-glass__content` | Children wrapper |
