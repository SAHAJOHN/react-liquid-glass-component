'use client'

import styled from 'styled-components'
import { fontSize, fontWeight, colors, borderRadius } from '@/lib/responsive'
import { LiquidGlass } from '@/components/liquid-glass-client'

const HeroStyled = styled.section`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 80px;

  .hero__content {
    text-align: center;
    padding: 32px;
      max-width: 100%;

    & > * {
      filter: drop-shadow(0px 0px 8px rgba(0, 0, 0, 0.5));
    }
  }

  .hero__title {
    font-size: ${fontSize['4xl']};
    font-weight: ${fontWeight.bold};
    letter-spacing: -0.03em;
    margin-bottom: 10px;
    color: ${colors.foreground};

    @media (max-width: 700px) {
      font-size: ${fontSize['3xl']};
    }
  }

  .hero__subtitle {
    font-size: ${fontSize.xl};
    opacity: 0.7;
    font-weight: ${fontWeight.normal};
    max-width: 360px;
    margin: 0 auto 24px;
    line-height: 1.6;
    color: ${colors.foreground};
    filter: drop-shadow(0px 0px 8px rgba(0, 0, 0, 1));
  }

  .hero__code {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: ${fontSize.sm};
    background: ${colors.codeBackground};
    border-radius: ${borderRadius.md};
    padding: 8px 16px;
    opacity: 0.65;
    color: ${colors.foreground};

    @media (max-width: 700px) {
      font-size: ${fontSize.xs};
      padding: 6px 12px;
    }
  }
`

export default function HeroCard() {
  return (
    <HeroStyled>
      <LiquidGlass
        borderRadius={28}
        blur={14}
        opacity={0.92}
        brightness={48}
        width={640}
        displace={0.6}
        distortionScale={-160}
        style={{
            minHeight: '284px',
            maxWidth: '100%'
        }}
      >
        <div className="hero__content">
          <h1 className="hero__title">React Liquid Glass Component</h1>
          <p className="hero__subtitle">
            Frosted glass effect for React — SVG distortion, chromatic aberration, blur.
          </p>
          <code className="hero__code">
            {'{ LiquidGlass }'} from {'react-liquid-glass-component'}
          </code>
        </div>
      </LiquidGlass>
    </HeroStyled>
  )
}
