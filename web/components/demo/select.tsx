'use client'

import styled from 'styled-components'
import { fontSize, colors } from '@/lib/responsive'

const SelectStyled = styled.div`
  flex: 1;

  .select__label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: ${fontSize.base};
    color: ${colors.foregroundMuted};
    margin-bottom: 4px;
  }

  .select__input {
    width: 100%;
    margin-top: 4px;
    background: ${colors.selectBackground};
    border: 1px solid ${colors.buttonBorder};
    color: ${colors.foreground};
    font: inherit;
    font-size: ${fontSize.base};
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
    appearance: auto;

    option {
      background: ${colors.selectOptionBackground};
      color: ${colors.foreground};
    }
  }
`

interface SelectProps {
  label: string
  value: string
  options: readonly string[]
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
}

export function Select({ label, value, options, onChange }: SelectProps) {
  return (
    <SelectStyled>
      <label className="select__label">{label}</label>
      <select className="select__input" value={value} onChange={onChange}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </SelectStyled>
  )
}
