import { styled } from 'styled-components'

export const LiquidGlassStyled = styled.div.withConfig({ componentId: 'liquid-glass-root' })`
  &.liquid-glass {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    @media (prefers-reduced-motion: no-preference) {
      transition: opacity 0.26s ease-out;
    }
  }

  .liquid-glass__filter {
    width: 100%;
    height: 100%;
    pointer-events: none;
    position: absolute;
    inset: 0;
    opacity: 0;
    z-index: -1;
  }

  &.liquid-glass--managed {
    isolation: isolate;
  }

  [data-liquid-glass-scene-ready='true'] &.liquid-glass--managed,
  [data-liquid-glass-scene-pending='true'] &.liquid-glass--managed {
    /* The scene already paints the glass. Avoid a second native backdrop pass. */
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .liquid-glass__content {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: inherit;
    position: relative;
    z-index: 1;
  }

  .liquid-glass__webgl {
    display: none;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    border-radius: inherit;
  }

  &.liquid-glass--fallback.liquid-glass--webgl {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  &.liquid-glass--webgl .liquid-glass__webgl {
    display: block;
    filter: blur(var(--glass-webgl-blur, 0px)) saturate(var(--glass-saturation, 1));
  }

  &.liquid-glass--webgl::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: color-mix(
      in oklch,
      var(--glass-color, light-dark(white, black)) calc(var(--glass-frost, 0) * 100%),
      transparent
    );
  }

  &.liquid-glass--svg {
    background: color-mix(
      in oklch,
      var(--glass-color, light-dark(white, black)) calc(var(--glass-frost, 0) * 100%),
      transparent
    );
    backdrop-filter: var(--filter-id, url(#glass-filter)) saturate(var(--glass-saturation, 1));
    box-shadow:
      0 0 2px 1px
        light-dark(
          color-mix(in oklch, black, transparent 85%),
          color-mix(in oklch, white, transparent 65%)
        )
        inset,
      0 0 10px 4px
        light-dark(
          color-mix(in oklch, black, transparent 90%),
          color-mix(in oklch, white, transparent 85%)
        )
        inset,
      0px 4px 16px rgba(17, 17, 26, 0.05),
      0px 8px 24px rgba(17, 17, 26, 0.05),
      0px 16px 56px rgba(17, 17, 26, 0.05),
      0px 4px 16px rgba(17, 17, 26, 0.05) inset,
      0px 8px 24px rgba(17, 17, 26, 0.05) inset,
      0px 16px 56px rgba(17, 17, 26, 0.05) inset;
  }

  &.liquid-glass--fallback {
    background: rgba(255, 255, 255, 0.08);
    background: color-mix(
      in oklch,
      var(--glass-color, light-dark(white, black)) calc(var(--glass-frost, 0) * 100%),
      transparent
    );
    backdrop-filter: blur(2px) saturate(var(--glass-saturation, 1));
    -webkit-backdrop-filter: blur(2px) saturate(var(--glass-saturation, 1));
  }

  @supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
    &.liquid-glass--fallback {
      background: rgba(255, 255, 255, 0.4);
    }
  }

  @supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
    @media (prefers-color-scheme: dark) {
      &.liquid-glass--fallback {
        background: rgba(0, 0, 0, 0.4);
      }
    }
  }

  &.liquid-glass:focus-visible {
    outline: 2px solid light-dark(#007aff, #0a84ff);
    outline-offset: 2px;
  }
`
