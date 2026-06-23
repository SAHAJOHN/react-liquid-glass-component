'use client'

import { useState } from 'react'
import styled from 'styled-components'
import { fontSize, fontWeight, colors, sectionPadding, breakpoints } from '@/lib/responsive'
import { LiquidGlass } from '@/components/liquid-glass-client'
import { Slider } from './slider'
import { Select } from './select'
import { ColorPicker } from './color-picker'
import { DEFAULT_PROPS, BLEND_MODES, type DemoProps } from '@/lib/demo-props'

const DemoStyled = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 80px;

  .demo__controls {
    width: 100%;
    padding: ${sectionPadding.controls};
    height: 100%;
    overflow-y: auto;
    align-self: stretch;
    justify-self: stretch;
  }

  .demo__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .demo__title {
    font-size: ${fontSize.lg};
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.01em;
    color: ${colors.foreground};
  }

  .demo__reset-btn {
    background: ${colors.buttonBackground};
    border: 1px solid ${colors.buttonBorder};
    color: ${colors.foregroundDim};
    font: inherit;
    font-size: ${fontSize.sm};
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      color: ${colors.foreground};
    }
  }

  .demo__control-group {
    margin-bottom: 14px;
  }

  .demo__control-label {
    display: block;
    font-size: ${fontSize.base};
    color: ${colors.foregroundMuted};
    margin-bottom: 8px;
  }

  .demo__chroma-row {
    display: flex;
    gap: 12px;

    @media (max-width: ${breakpoints.mobile}) {
      flex-direction: column;
      gap: 8px;
    }
  }
`

export function DemoPanel() {
  const [p, set] = useState<DemoProps>(DEFAULT_PROPS)

  const setNum = (key: keyof DemoProps) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))

  const setChan = (key: 'xChannel' | 'yChannel') =>
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      set((prev) => ({ ...prev, [key]: e.target.value as 'R' | 'G' | 'B' }))

  const setBlendMode = (e: React.ChangeEvent<HTMLSelectElement>) =>
    set((prev) => ({
      ...prev,
      mixBlendMode: e.target.value as DemoProps['mixBlendMode'],
    }))

  const setColor = (e: React.ChangeEvent<HTMLInputElement>) =>
    set((prev) => ({ ...prev, glassColor: e.target.value }))

  return (
    <DemoStyled>
      <LiquidGlass
        borderRadius={p.borderRadius}
        borderWidth={p.borderWidth}
        blur={p.blur}
        opacity={p.opacity}
        brightness={p.brightness}
        saturation={p.saturation}
        distortionScale={p.distortionScale}
        displace={p.displace}
        backgroundOpacity={p.backgroundOpacity}
        glassColor={p.glassColor}
        redOffset={p.redOffset}
        greenOffset={p.greenOffset}
        blueOffset={p.blueOffset}
        xChannel={p.xChannel}
        yChannel={p.yChannel}
        mixBlendMode={p.mixBlendMode}
        style={{
          padding: 0,
          maxWidth: '100%',
          maxHeight: '80dvh',
          width: '440px',
        }}
      >
        <div className="demo__controls">
          <div className="demo__header">
            <h3 className="demo__title">Properties</h3>
            <button className="demo__reset-btn" onClick={() => set(DEFAULT_PROPS)}>
              Reset
            </button>
          </div>

          <Slider
            label="Border Radius"
            value={p.borderRadius}
            min={0}
            max={400}
            onChange={setNum('borderRadius')}
          />
          <Slider
            label="Border Width"
            value={p.borderWidth}
            min={0}
            max={0.3}
            step={0.01}
            onChange={setNum('borderWidth')}
          />
          <Slider
            label="Blur"
            value={p.blur}
            min={0}
            max={80}
            onChange={setNum('blur')}
          />
          <Slider
            label="Opacity"
            value={p.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={setNum('opacity')}
          />
          <Slider
            label="Brightness"
            value={p.brightness}
            min={0}
            max={100}
            onChange={setNum('brightness')}
          />
          <Slider
            label="Saturation"
            value={p.saturation}
            min={0}
            max={6}
            step={0.1}
            onChange={setNum('saturation')}
          />
          <Slider
            label="Distortion Scale"
            value={p.distortionScale}
            min={-600}
            max={600}
            onChange={setNum('distortionScale')}
          />
          <Slider
            label="Displace"
            value={p.displace}
            min={0}
            max={10}
            step={0.1}
            onChange={setNum('displace')}
          />
          <Slider
            label="Background Opacity"
            value={p.backgroundOpacity}
            min={0}
            max={1}
            step={0.01}
            onChange={setNum('backgroundOpacity')}
          />
          <ColorPicker
            label="Glass Color"
            value={p.glassColor}
            onChange={setColor}
          />

          <div className="demo__control-group">
            <span className="demo__control-label">Chromatic Offsets</span>
            <div className="demo__chroma-row">
              <Slider
                label="R"
                value={p.redOffset}
                min={-60}
                max={60}
                onChange={setNum('redOffset')}
                compact
              />
              <Slider
                label="G"
                value={p.greenOffset}
                min={-60}
                max={60}
                onChange={setNum('greenOffset')}
                compact
              />
              <Slider
                label="B"
                value={p.blueOffset}
                min={-60}
                max={60}
                onChange={setNum('blueOffset')}
                compact
              />
            </div>
          </div>

          <div className="demo__control-group">
            <span className="demo__control-label">Channels</span>
            <div className="demo__chroma-row">
              <Select
                label="X Channel"
                value={p.xChannel}
                options={['R', 'G', 'B']}
                onChange={setChan('xChannel')}
              />
              <Select
                label="Y Channel"
                value={p.yChannel}
                options={['R', 'G', 'B']}
                onChange={setChan('yChannel')}
              />
            </div>
          </div>

          <Select
            label="Mix Blend Mode"
            value={p.mixBlendMode}
            options={BLEND_MODES}
            onChange={setBlendMode}
          />
        </div>
      </LiquidGlass>
    </DemoStyled>
  )
}
