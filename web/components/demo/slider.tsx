'use client'

import styled from 'styled-components'
import { fonts, colors, fontSize } from '@/lib/responsive'

const SliderStyled = styled.div<{ $compact?: boolean }>`
  margin-bottom: ${({ $compact }) => ($compact ? '0' : '14px')};

  .slider__label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: ${({ $compact }) => ($compact ? '0.72rem' : fontSize.base)};
    color: ${colors.foregroundMuted};
    margin-bottom: ${({ $compact }) => ($compact ? '2px' : '4px')};
  }

  .slider__value {
    font-family: ${fonts.mono};
    font-size: 0.75rem;
    color: ${colors.foregroundFaint};
    min-width: 36px;
    text-align: right;
  }

  .slider__input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: ${colors.inputBackground};
    outline: none;
    cursor: pointer;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      border: none;
      cursor: pointer;
      transition: box-shadow 0.2s;

      &:hover {
        box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.15);
      }
    }

    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      border: none;
      cursor: pointer;
    }
  }
`

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  compact?: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  compact,
  onChange,
}: SliderProps) {
  return (
    <SliderStyled $compact={compact}>
      <div className="slider__label-row">
        <span>{label}</span>
        <span className="slider__value">{value}</span>
      </div>
      <input
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </SliderStyled>
  )
}
