'use client'

import styled from 'styled-components'
import { fontSize, colors } from '@/lib/responsive'

const ColorPickerStyled = styled.div`
  margin-bottom: 14px;

  .color-picker__label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: ${fontSize.base};
    color: ${colors.foregroundMuted};
    margin-bottom: 4px;
  }

  .color-picker__value {
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: ${colors.foregroundFaint};
    text-transform: uppercase;
  }

  .color-picker__input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 32px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: none;
    padding: 0;

    &::-webkit-color-swatch-wrapper {
      padding: 0;
    }

    &::-webkit-color-swatch {
      border: 1px solid ${colors.buttonBorder};
      border-radius: 6px;
    }

    &::-moz-color-swatch {
      border: 1px solid ${colors.buttonBorder};
      border-radius: 6px;
    }
  }
`

interface ColorPickerProps {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <ColorPickerStyled>
      <div className="color-picker__label-row">
        <span>{label}</span>
        <span className="color-picker__value">{value}</span>
      </div>
      <input
        className="color-picker__input"
        type="color"
        value={value}
        onChange={onChange}
      />
    </ColorPickerStyled>
  )
}
