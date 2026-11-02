'use client'

import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import styled from 'styled-components'
import { GLASS_STUDIO_RANGES, type GlassStudioProps } from '@/components/liquid-glass-client'
import { colors, fontWeight } from '@/lib/responsive'

const GlassControlsStyled = styled.aside`
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 20;
  width: min(360px, calc(100vw - 32px));
  max-height: min(
    calc(
      100dvh - max(16px, env(safe-area-inset-top)) - 62px - 16px -
        max(16px, env(safe-area-inset-bottom))
    ),
    680px
  );
  display: flex;
  flex-direction: column;
  padding: 8px 16px 12px;
  border: 1px solid ${colors.buttonBorder};
  border-radius: 16px;
  background: #101b29;
  color: ${colors.foreground};
  color-scheme: dark;

  .glass-controls__header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    min-height: 52px;
  }

  .glass-controls__title {
    flex: 1;
    margin: 0;
    font-size: 0.875rem;
    font-weight: ${fontWeight.semibold};
    line-height: 1.4;
  }

  .glass-controls__button {
    min-width: 44px;
    min-height: 44px;
    padding: 8px;
    border: 0;
    border-radius: 8px;
    background: ${colors.buttonBackground};
    color: ${colors.foreground};
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .glass-controls__body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-right: 4px;
  }

  .glass-controls__group {
    border-top: 1px solid ${colors.buttonBorder};
  }

  .glass-controls__summary {
    min-height: 44px;
    padding: 12px 0;
    font-size: 0.8rem;
    font-weight: ${fontWeight.semibold};
    cursor: pointer;
  }

  .glass-controls__group-body {
    padding: 0 0 12px;
  }

  .glass-controls__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .glass-controls__value {
    color: ${colors.foregroundMuted};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .glass-controls__slider {
    display: block;
    width: 100%;
    min-height: 44px;
    margin: 0;
    padding: 0;
    accent-color: #9bdfe4;
    cursor: pointer;
  }

  .glass-controls__check,
  .glass-controls__color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    margin-bottom: 8px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .glass-controls__checkbox {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: #9bdfe4;
  }

  .glass-controls__color {
    width: 64px;
    height: 44px;
    padding: 3px;
    border: 1px solid ${colors.buttonBorder};
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .glass-controls__hint {
    margin: 4px 0 0;
    color: ${colors.foregroundMuted};
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .glass-controls__button:focus-visible,
  .glass-controls__slider:focus-visible,
  .glass-controls__summary:focus-visible,
  .glass-controls__color:focus-visible,
  .glass-controls__checkbox:focus-visible {
    outline: 2px solid #b4eaff;
    outline-offset: 3px;
  }

  @media (max-width: 899px) {
    left: max(16px, env(safe-area-inset-left));
    right: max(16px, env(safe-area-inset-right));
    width: auto;
    max-height: 40dvh;
  }
`

type NumericKey = keyof typeof GLASS_STUDIO_RANGES

const labels: Record<NumericKey, string> = {
  refThickness: 'Thickness',
  refDistance: 'Background Distance',
  refFactor: 'Refraction Factor',
  refDispersion: 'Dispersion Gain',
  refFresnelRange: 'Fresnel Size',
  refFresnelHardness: 'Fresnel Hardness',
  refFresnelFactor: 'Fresnel Intensity',
  glareRange: 'Glare Size',
  glareHardness: 'Glare Hardness',
  glareFactor: 'Glare Intensity',
  glareConvergence: 'Glare Convergence',
  glareOppositeFactor: 'Glare Opposite Side',
  glareAngle: 'Glare Angle',
  blurRadius: 'Blur Radius',
  shadowExpand: 'Shadow Expand',
  shadowFactor: 'Shadow Intensity',
  shapeRadius: 'Radius (%)',
  shapeRoundness: 'SuperEllipse Factor',
}

const groups: readonly { id: string; title: string; keys: readonly NumericKey[] }[] = [
  {
    id: 'refraction',
    title: 'Refraction',
    keys: ['refThickness', 'refDistance', 'refFactor', 'refDispersion'],
  },
  {
    id: 'fresnel',
    title: 'Fresnel',
    keys: ['refFresnelRange', 'refFresnelHardness', 'refFresnelFactor'],
  },
  {
    id: 'glare',
    title: 'Glare',
    keys: [
      'glareRange',
      'glareHardness',
      'glareFactor',
      'glareConvergence',
      'glareOppositeFactor',
      'glareAngle',
    ],
  },
  { id: 'blur', title: 'Blur', keys: ['blurRadius'] },
  { id: 'tint', title: 'Tint', keys: [] },
  { id: 'shadow', title: 'Shadow', keys: ['shadowExpand', 'shadowFactor'] },
  { id: 'shape', title: 'Shape', keys: ['shapeRadius', 'shapeRoundness'] },
  { id: 'extra', title: 'Extra', keys: [] },
]

interface RangeControlProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  valueText?: string
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  valueText,
}: RangeControlProps) {
  const decimals = step < 1 ? (String(step).split('.')[1]?.length ?? 0) : 0
  const displayed = valueText ?? value.toFixed(decimals)
  return (
    <div>
      <div className="glass-controls__row">
        <label htmlFor={id}>{label}</label>
        <output className="glass-controls__value" htmlFor={id} aria-hidden="true">
          {displayed}
        </output>
      </div>
      <input
        id={id}
        className="glass-controls__slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={displayed}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </div>
  )
}

interface GlassControlsProps {
  settings: GlassStudioProps
  onSettingsChange: Dispatch<SetStateAction<GlassStudioProps>>
  convexity: number
  onConvexityChange: (value: number) => void
  onReset: () => void
}

export default function GlassControls({
  settings,
  onSettingsChange,
  convexity,
  onConvexityChange,
  onReset,
}: GlassControlsProps) {
  const id = useId()
  const [expanded, setExpanded] = useState(true)
  const [openGroups, setOpenGroups] = useState(() => new Set(['refraction']))
  const tintHex = `#${[settings.tint.r, settings.tint.g, settings.tint.b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
  const setNumber = (key: NumericKey, value: number) =>
    onSettingsChange((previous) => ({ ...previous, [key]: value }))

  return (
    <GlassControlsStyled aria-labelledby={`${id}-title`}>
      <div className="glass-controls__header">
        <h2 className="glass-controls__title" id={`${id}-title`}>
          Glass settings
        </h2>
        <button type="button" className="glass-controls__button" onClick={onReset}>
          Reset
        </button>
        <button
          type="button"
          className="glass-controls__button"
          aria-expanded={expanded}
          aria-controls={`${id}-body`}
          aria-label={expanded ? 'Hide glass controls' : 'Show glass controls'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="glass-controls__body" id={`${id}-body`} hidden={!expanded}>
        {groups.map((group) => (
          <details
            key={group.id}
            className="glass-controls__group"
            open={openGroups.has(group.id)}
            onToggle={(event) => {
              const open = event.currentTarget.open
              setOpenGroups((previous) => {
                if (previous.has(group.id) === open) return previous
                const next = new Set(previous)
                if (open) next.add(group.id)
                else next.delete(group.id)
                return next
              })
            }}
          >
            <summary className="glass-controls__summary">{group.title}</summary>
            <div className="glass-controls__group-body">
              {group.keys.map((key) => {
                const [min, max, step] = GLASS_STUDIO_RANGES[key]
                return (
                  <RangeControl
                    key={key}
                    id={`${id}-${key}`}
                    label={labels[key]}
                    value={settings[key]}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(value) => setNumber(key, value)}
                  />
                )
              })}
              {group.id === 'blur' && (
                <label className="glass-controls__check" htmlFor={`${id}-blurEdge`}>
                  Blur Edge
                  <input
                    id={`${id}-blurEdge`}
                    className="glass-controls__checkbox"
                    type="checkbox"
                    checked={settings.blurEdge}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      onSettingsChange((previous) => ({ ...previous, blurEdge: checked }))
                    }}
                  />
                </label>
              )}
              {group.id === 'tint' && (
                <>
                  <label className="glass-controls__color-row" htmlFor={`${id}-tint`}>
                    Tint
                    <input
                      id={`${id}-tint`}
                      className="glass-controls__color"
                      type="color"
                      value={tintHex}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        if (!/^#[0-9a-f]{6}$/i.test(value)) return
                        const r = Number.parseInt(value.slice(1, 3), 16)
                        const g = Number.parseInt(value.slice(3, 5), 16)
                        const b = Number.parseInt(value.slice(5, 7), 16)
                        onSettingsChange((previous) => ({
                          ...previous,
                          tint: { ...previous.tint, r, g, b },
                        }))
                      }}
                    />
                  </label>
                  <RangeControl
                    id={`${id}-tint-alpha`}
                    label="Tint Alpha"
                    value={settings.tint.a}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(a) =>
                      onSettingsChange((previous) => ({
                        ...previous,
                        tint: { ...previous.tint, a },
                      }))
                    }
                  />
                </>
              )}
              {group.id === 'shadow' && (
                <>
                  <RangeControl
                    id={`${id}-shadow-x`}
                    label="Shadow Position X"
                    value={settings.shadowPosition.x}
                    min={-20}
                    max={20}
                    step={0.01}
                    onChange={(x) =>
                      onSettingsChange((previous) => ({
                        ...previous,
                        shadowPosition: { ...previous.shadowPosition, x },
                      }))
                    }
                  />
                  <RangeControl
                    id={`${id}-shadow-y`}
                    label="Shadow Position Y"
                    value={settings.shadowPosition.y}
                    min={-20}
                    max={20}
                    step={0.01}
                    onChange={(y) =>
                      onSettingsChange((previous) => ({
                        ...previous,
                        shadowPosition: { ...previous.shadowPosition, y },
                      }))
                    }
                  />
                </>
              )}
              {group.id === 'extra' && (
                <>
                  <RangeControl
                    id={`${id}-convexity`}
                    label="Convexity"
                    value={Math.round(convexity * 100)}
                    min={0}
                    max={100}
                    step={1}
                    valueText={`${Math.round(convexity * 100)}%${convexity === 0 ? ' · Flat' : ''}`}
                    onChange={(value) => onConvexityChange(value / 100)}
                  />
                  <p className="glass-controls__hint">
                    The center stays flat at 0%. Increase this to add a body lens.
                  </p>
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </GlassControlsStyled>
  )
}
