import { describe, expect, it } from 'vitest'
import { getGlassOnlyClip, type GlassOnlyPane } from '../scene/glass-only-clip'

const viewport = { width: 400, height: 800 }
const host = { x: 0, y: -200, width: 400, height: 1200 }
const pane = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): GlassOnlyPane => ({
  rect: { x, y, width, height },
  radius,
  roundness: 2,
  shadowFactor: 0,
})

describe('glass-only presentation clip', () => {
  it('clips to the enclosing rounded pane and follows its position and size', () => {
    expect(getGlassOnlyClip([pane(20, 700, 360, 70, 35)], viewport, host)).toEqual({
      status: 'ready',
      clipPath: 'inset(700px 20px 30px 20px round 35px)',
    })
    expect(getGlassOnlyClip([pane(30, 680, 340, 80, 40)], viewport, host)).toEqual({
      status: 'ready',
      clipPath: 'inset(680px 30px 40px 30px round 40px)',
    })
  })

  it('allows a rounded active indicator contained within the enclosing pill', () => {
    const outer = pane(20, 700, 360, 70, 35)
    const left = pane(24, 704, 114, 62, 31)
    const center = pane(143, 704, 114, 62, 31)
    const right = pane(262, 704, 114, 62, 31)
    for (const child of [left, center, right]) {
      expect(getGlassOnlyClip([outer, child], viewport, host).status).toBe('ready')
    }
  })

  it('rejects disjoint panes and rectangular children that extend through a rounded corner', () => {
    const outer = pane(20, 700, 360, 70, 35)
    expect(getGlassOnlyClip([outer, pane(0, 600, 15, 15, 0)], viewport, host)).toEqual({
      status: 'fallback',
      reason: 'Glass-only presentation requires all panes inside one enclosing pane.',
    })
    expect(getGlassOnlyClip([outer, pane(20, 700, 40, 40, 0)], viewport, host).status).toBe(
      'fallback'
    )
  })

  it('rejects missing, invalid, unsupported, or out-of-bounds geometry', () => {
    expect(getGlassOnlyClip([], viewport, host).status).toBe('fallback')
    expect(getGlassOnlyClip([pane(20, 700, 0, 70, 0)], viewport, host).status).toBe('fallback')
    expect(getGlassOnlyClip([pane(-5, 700, 100, 70, 35)], viewport, host).status).toBe('fallback')
    expect(
      getGlassOnlyClip([{ ...pane(20, 700, 360, 70, 35), roundness: 5 }], viewport, host)
    ).toEqual({
      status: 'fallback',
      reason: 'Glass-only presentation requires shapeRoundness={2}.',
    })
    expect(
      getGlassOnlyClip([{ ...pane(20, 700, 360, 70, 35), shadowFactor: 15 }], viewport, host)
    ).toEqual({ status: 'fallback', reason: 'Glass-only presentation requires shadowFactor={0}.' })
  })
})
