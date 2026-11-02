import { describe, expect, it } from 'vitest'
import { GLASS_STUDIO_DEFAULTS, resolveStudioProps } from '../studio-props'

describe('Studio material contract', () => {
  it('matches the raw reference controls and defaults', () => {
    expect(GLASS_STUDIO_DEFAULTS).toEqual({
      refThickness: 20,
      refDistance: 0.05,
      refFactor: 1.4,
      refDispersion: 7,
      refFresnelRange: 30,
      refFresnelHardness: 20,
      refFresnelFactor: 20,
      glareRange: 30,
      glareHardness: 20,
      glareFactor: 90,
      glareConvergence: 50,
      glareOppositeFactor: 80,
      glareAngle: -45,
      blurRadius: 1,
      blurEdge: true,
      tint: { r: 255, g: 255, b: 255, a: 0 },
      shadowExpand: 25,
      shadowFactor: 15,
      shadowPosition: { x: 0, y: -10 },
      shapeRadius: 80,
      shapeRoundness: 5,
    })
    expect(resolveStudioProps({})).toEqual(GLASS_STUDIO_DEFAULTS)
  })

  it('keeps canonical controls authoritative and normalizes at the API boundary', () => {
    expect(
      resolveStudioProps({ thickness: 40, refThickness: 12, displace: 9, blurRadius: 3 })
    ).toEqual(expect.objectContaining({ refThickness: 12, blurRadius: 3 }))
    expect(
      resolveStudioProps({
        refThickness: Number.NaN,
        refDistance: 2,
        glareAngle: -500,
        blurRadius: 2.6,
      })
    ).toEqual(
      expect.objectContaining({
        refThickness: 20,
        refDistance: 0.2,
        glareAngle: -180,
        blurRadius: 3,
      })
    )
    expect(
      resolveStudioProps({
        tint: { r: -1, g: 500, b: 128, a: 2 },
        shadowPosition: { x: 30, y: -40 },
      })
    ).toEqual(
      expect.objectContaining({
        tint: { r: 0, g: 255, b: 128, a: 1 },
        shadowPosition: { x: 20, y: -20 },
      })
    )
  })
})
