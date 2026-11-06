import { describe, expect, it } from 'vitest'
import { parseBackdropFilter } from '../scene/backdrop-filter'

describe('backdrop filter parsing', () => {
  it.each([
    ['blur(12px)', 12, 1, 1],
    [' blur(0px) saturate(1.8) brightness(1.1) ', 0, 1.8, 1.1],
    ['blur(1.5px) saturate(180%) brightness(120%)', 1.5, 1.8, 1.2],
    ['blur(2px) brightness(0.4)', 2, 1, 0.4],
    ['blur(2px) saturate(0)', 2, 0, 1],
    ['blur(.5px) saturate(1e+0) brightness(1e2%)', 0.5, 1, 1],
  ])('reads %s', (value, sigma, saturation, brightness) => {
    expect(parseBackdropFilter(value)).toEqual({ sigma, saturation, brightness })
  })

  it.each([
    '',
    'none',
    'blur(-1px)',
    'blur(1em)',
    'blur(201px)',
    'blur(1px) saturate(-1)',
    'blur(1px) saturate(401%)',
    'blur(1px) brightness(5)',
    'blur(1px) saturate(calc(2))',
    'blur(1px) brightness(1) saturate(1)',
    'blur(1px) contrast(1)',
    'url(#filter) saturate(1.8)',
    'blur(1px) saturate(Infinity)',
    'blur(1px) saturate(1) saturate(1)',
  ])('rejects unsupported or unsafe %s', (value) => {
    expect(parseBackdropFilter(value)).toBeNull()
  })
})
