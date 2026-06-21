# react-liquid-glass-component

**Liquid glass effect for React** — a frosted glass surface with real-time SVG distortion, chromatic aberration, and blur. Wraps any children in a liquid-like glass pane.

```
npm install react-liquid-glass-component styled-components
```

---

## Usage

```tsx
import { LiquidGlass } from 'react-liquid-glass-component'

<LiquidGlass borderRadius={24} blur={12}>
  <h1>Hello</h1>
  <p>Behind the glass.</p>
</LiquidGlass>
```

The glass effect wraps the children automatically:

```
┌────────────────────────────┐
│      (glass effect)        │
│  ┌──────────────────────┐  │
│  │    children content   │  │
│  └──────────────────────┘  │
└────────────────────────────┘
```

---

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | `null` | Content inside the glass pane |
| `width` | `number \| string` | `200` | Width (number = px, string = any CSS) |
| `height` | `number \| string` | `80` | Height (number = px, string = any CSS) |
| `borderRadius` | `number` | `20` | Corner radius in px |
| `borderWidth` | `number` | `0.07` | Edge inset ratio for the glass border |
| `brightness` | `number` | `50` | Brightness of the glass fill (0–100) |
| `opacity` | `number` | `0.93` | Opacity of the glass fill |
| `blur` | `number` | `11` | Frosted blur amount (px) |
| `displace` | `number` | `0` | Post-filter Gaussian blur on output |
| `backgroundOpacity` | `number` | `0` | Frost background (--glass-frost) |
| `saturation` | `number` | `1` | Saturation multiplier |
| `distortionScale` | `number` | `-180` | Intensity of the liquid distortion (negative = invert) |
| `redOffset` | `number` | `0` | Extra distortion for red channel |
| `greenOffset` | `number` | `10` | Extra distortion for green channel |
| `blueOffset` | `number` | `20` | Extra distortion for blue channel |
| `xChannel` | `'R' \| 'G' \| 'B'` | `'R'` | Red channel displacement source |
| `yChannel` | `'R' \| 'G' \| 'B'` | `'G'` | Green/Blue channel displacement source |
| `mixBlendMode` | `CSS mix-blend-mode` | `'difference'` | Blend mode for the RGB gradient layers |
| `className` | `string` | `''` | Additional CSS class |
| `style` | `CSSProperties` | `{}` | Additional inline styles |
| `ref` | `Ref<HTMLDivElement>` | — | Forwarded ref to root element |

---

## How It Works

The component renders two layers:

1. **SVG filter layer** — a hidden `<svg>` containing a `<filter>` with:
   - `feImage` + `feDisplacementMap` → liquid distortion
   - `feColorMatrix` → chromatic aberration (RGB channel split)
   - `feGaussianBlur` → final polish

2. **CSS backdrop-filter fallback** — used when SVG filters are not supported (`backdrop-filter: blur()` + `saturate()`).

The displacement map is generated dynamically to match the element's current size (via `ResizeObserver`), so the liquid effect always fits perfectly.

---

## Browser Support

- **Modern browsers** (Chrome, Firefox, Safari, Edge) — SVG filter path, full effect.
- **Older browsers** — falls back to `backdrop-filter: blur()` + `saturate()`, still looks like frosted glass.
- **Very old browsers** (`@supports not (backdrop-filter)`) — plain semi-transparent background.

---

## Local Development

```bash
# Watch mode (rebuild on src/ changes)
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Playground (Vite dev server)
cd examples
npm install
npm run dev
```

The playground imports directly from `../src/index.ts` via a Vite alias — no build step needed during development.

---

## License

MIT © 2026 Johnny Dev
