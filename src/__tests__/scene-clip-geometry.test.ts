import { describe, expect, it } from 'vitest'
import { roundedClipContainsRect } from '../scene/clip-geometry'

const outer = { x: 0, y: 0, width: 100, height: 100 }

describe('roundedClipContainsRect', () => {
  it('accepts a rectangle fully inside a rounded clip', () => {
    expect(roundedClipContainsRect(outer, 20, 2, { x: 10, y: 10, width: 80, height: 80 })).toBe(
      true
    )
  })

  it('rejects a rectangle crossing a rounded corner even inside the bounds', () => {
    expect(roundedClipContainsRect(outer, 20, 2, { x: 0, y: 0, width: 30, height: 30 })).toBe(false)
  })

  it('respects the actual superellipse roundness', () => {
    const corner = { x: 4, y: 4, width: 4, height: 4 }
    expect(roundedClipContainsRect(outer, 20, 2, corner)).toBe(false)
    expect(roundedClipContainsRect(outer, 20, 5, corner)).toBe(true)
  })

  it('rejects a rectangle extending outside a square clip', () => {
    expect(roundedClipContainsRect(outer, 0, 2, { x: -1, y: 0, width: 50, height: 50 })).toBe(false)
  })

  it('keeps the outer clip when the inner bounds touch its antialiased edge', () => {
    expect(roundedClipContainsRect(outer, 20, 2, { x: 20, y: 0, width: 60, height: 20 })).toBe(
      false
    )
  })
})
