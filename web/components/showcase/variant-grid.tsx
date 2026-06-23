'use client'

import styled from 'styled-components'
import { fontSize, fontWeight, colors } from '@/lib/responsive'
import { LiquidGlass } from '@/components/liquid-glass-client'
import CopyButton from '@/components/copy-button'

const VariantGridStyled = styled.section`
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: center;

  & > * {
    filter: drop-shadow(0px 0px 8px rgba(0, 0, 0, 0.5));
  }

  .variant-card__body {
    text-align: center;
    padding: 8px;
  }

  .variant-card__title {
    font-size: ${fontSize['2xl']};
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.02em;
    margin-bottom: 6px;
    color: ${colors.foreground};
  }

  .variant-card__text {
    font-size: ${fontSize.base};
    opacity: 0.6;
    line-height: 1.5;
    max-width: 180px;
    margin: 0 auto;
    color: ${colors.foreground};
  }
`

export default function VariantGrid() {
  return (
    <VariantGridStyled>
      <LiquidGlass
        borderRadius={30}
        blur={10}
        opacity={0.93}
        brightness={50}
        width={280}
        height={180}
      >
        <div className="variant-card__body">
          <h2 className="variant-card__title">Natural</h2>
          <p className="variant-card__text">Default frosted glass with subtle distortion.</p>
        </div>
        <CopyButton
          text={`<LiquidGlass borderRadius={30} blur={10} opacity={0.93} brightness={50} />`}
          visible
        />
      </LiquidGlass>

      <LiquidGlass
        borderRadius={30}
        blur={24}
        opacity={0.88}
        brightness={42}
        displace={2}
        distortionScale={-220}
        width={280}
        height={180}
      >
        <div className="variant-card__body">
          <h2 className="variant-card__title">Deep Blur</h2>
          <p className="variant-card__text">High blur look with gentle liquid warp.</p>
        </div>
        <CopyButton
          text={`<LiquidGlass borderRadius={30} blur={24} opacity={0.88} brightness={42} displace={2} distortionScale={-220} />`}
          visible
        />
      </LiquidGlass>

      <LiquidGlass
        borderRadius={30}
        blur={8}
        opacity={0.95}
        brightness={55}
        redOffset={18}
        greenOffset={0}
        blueOffset={-18}
        distortionScale={-300}
        width={280}
        height={180}
      >
        <div className="variant-card__body">
          <h2 className="variant-card__title">Chromatic</h2>
          <p className="variant-card__text">Strong RGB channel split for a prismatic look.</p>
        </div>
        <CopyButton
          text={`<LiquidGlass borderRadius={30} blur={8} opacity={0.95} brightness={55} redOffset={18} greenOffset={0} blueOffset={-18} distortionScale={-300} />`}
          visible
        />
      </LiquidGlass>
    </VariantGridStyled>
  )
}
