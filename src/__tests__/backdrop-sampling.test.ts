import { describe, expect, it } from 'vitest'
import { proveBackdropSampling } from '../scene/backdrop-sampling'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { SceneFrame, SceneItem, SceneRect } from '../scene/types'

const frame: SceneFrame = { width: 100, height: 100, scrollX: 0, scrollY: 0, pixelRatio: 1 }
const sceneRegion: SceneRect = { x: 40, y: 48, width: 20, height: 10 }
const bitmap = document.createElement('canvas')
const glass: Extract<SceneItem, { kind: 'glass' }> = {
  kind: 'glass',
  rect: sceneRegion,
  space: 'viewport',
  opacity: 1,
  radius: 4,
  displacement: [0, 0, 0],
  blur: 0,
  saturation: 1,
  tint: [0, 0, 0, 0],
  studio: { ...GLASS_STUDIO_DEFAULTS, refDistance: 0, blurRadius: 0, shadowFactor: 0 },
}

function backdrop(rect: SceneRect, sigma: number, space: 'viewport' | 'document' = 'viewport') {
  const item: Extract<SceneItem, { kind: 'backdrop' }> = {
    kind: 'backdrop',
    rect,
    space,
    sigma,
    opacity: 1,
    radius: 0,
    bitmap,
  }
  return item
}

function proof(items: SceneItem[], f: SceneFrame = frame, samplingRegion = sceneRegion) {
  return proveBackdropSampling({
    items,
    frame: f,
    samplingRegion,
    targetWidth: Math.max(1, Math.round(f.width * f.pixelRatio)),
    targetHeight: Math.max(1, Math.round(f.height * f.pixelRatio)),
  })
}

function splitProof(items: SceneItem[], regions: readonly SceneRect[], f: SceneFrame = frame) {
  return proveBackdropSampling({
    items,
    frame: f,
    samplingRegion: sceneRegion,
    samplingRegions: regions,
    targetWidth: Math.max(1, Math.round(f.width * f.pixelRatio)),
    targetHeight: Math.max(1, Math.round(f.height * f.pixelRatio)),
  })
}

describe('glass-only backdrop sampling proof', () => {
  it('exposes the complete source footprint including every accumulated blur halo', () => {
    const earlier = backdrop({ x: 0, y: 0, width: 100, height: 100 }, 3)
    const later = backdrop({ x: 0, y: 0, width: 100, height: 100 }, 6)
    const result = proof([earlier, later, glass])
    if (!result) throw new Error('Expected a valid sampling proof')
    const sourceContains = (x: number, y: number) =>
      result.sourceRegions.some(
        (region) =>
          x >= region.x - 1e-9 &&
          y >= region.y - 1e-9 &&
          x <= region.x + region.width + 1e-9 &&
          y <= region.y + region.height + 1e-9
      )
    for (const layer of [earlier, later]) {
      const output = result.outputRegions.get(layer)
      if (!output) throw new Error('Expected a contributing backdrop')
      const halo = Math.ceil(3 * layer.sigma) + 2
      expect(sourceContains(Math.max(0, output.x - halo), Math.max(0, output.y - halo))).toBe(true)
      expect(
        sourceContains(
          Math.min(frame.width, output.x + output.width + halo),
          Math.min(frame.height, output.y + output.height + halo)
        )
      ).toBe(true)
    }
    expect(sourceContains(sceneRegion.x, sceneRegion.y)).toBe(true)
  })

  it('does not fill the source gap between distant panes without a contributing backdrop', () => {
    const first = { ...glass, rect: { x: 40, y: 10, width: 20, height: 10 } }
    const second = { ...glass, rect: { x: 40, y: 80, width: 20, height: 10 } }
    const result = splitProof([first, second], [first.rect, second.rect])
    if (!result) throw new Error('Expected a valid sampling proof')
    expect(result.sourceRegions).toHaveLength(2)
    expect(
      result.sourceRegions.some((region) => region.y <= 50 && region.y + region.height >= 50)
    ).toBe(false)
  })

  it('permits a clipped backdrop when the source halo stays inside the viewport', () => {
    const layer = backdrop({ x: 10, y: 20, width: 80, height: 120 }, 4)
    expect(proof([layer, glass])?.needed.has(layer)).toBe(true)
  })

  it('does not require a backdrop that cannot contribute to the pane', () => {
    const layer = backdrop({ x: 0, y: 20, width: 10, height: 120 }, 4)
    expect(proof([layer, glass])?.needed.has(layer)).toBe(false)
  })

  it('permits a source halo that crosses the viewport edge', () => {
    const layer = backdrop({ x: 10, y: 20, width: 80, height: 120 }, 12)
    expect(proof([layer, glass])?.needed.has(layer)).toBe(true)
  })

  it.each<[string, SceneRect, SceneRect]>([
    ['top', { x: 10, y: -30, width: 80, height: 80 }, { x: 40, y: 0, width: 20, height: 8 }],
    [
      'bottom',
      { x: 10, y: 50, width: 80, height: 80 },
      { x: 40, y: 92, width: 20, height: 8 },
    ],
    ['left', { x: -30, y: 10, width: 80, height: 80 }, { x: 0, y: 40, width: 8, height: 20 }],
    ['right', { x: 50, y: 10, width: 80, height: 80 }, { x: 92, y: 40, width: 8, height: 20 }],
  ])(
    'keeps a partially visible backdrop needed at the %s edge',
    (_edge, box, paneRect) => {
      const layer = backdrop(box, 8)
      const pane = { ...glass, rect: paneRect }
      expect(proof([layer, pane], frame, paneRect)?.needed.has(layer)).toBe(true)
    }
  )

  it('allows a halo to reach a real element edge at the viewport boundary', () => {
    const layer = backdrop({ x: 10, y: 20, width: 80, height: 80 }, 12)
    expect(proof([layer, glass])?.needed.has(layer)).toBe(true)
  })

  it('accumulates a halo through overlapping layers in reverse paint order', () => {
    const first = backdrop({ x: 10, y: 78, width: 80, height: 42 }, 6)
    const second = backdrop({ x: 10, y: 20, width: 80, height: 120 }, 6)
    expect(proof([first, glass])?.needed.has(first)).toBe(false)
    const result = proof([first, second, glass])
    expect(result?.needed.has(first)).toBe(true)
    expect(result?.needed.has(second)).toBe(true)
  })

  it('expands an earlier layer output for the later layer blur halo', () => {
    const earlier = backdrop({ x: 0, y: 0, width: 100, height: 100 }, 3)
    const later = backdrop({ x: 0, y: 0, width: 100, height: 100 }, 6)
    const result = proof([earlier, later, glass])
    const first = result?.outputRegions.get(earlier)
    const second = result?.outputRegions.get(later)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first!.x).toBeLessThan(second!.x)
    expect(first!.y).toBeLessThan(second!.y)
    expect(first!.x + first!.width).toBeGreaterThan(second!.x + second!.width)
    expect(first!.y + first!.height).toBeGreaterThan(second!.y + second!.height)
  })

  it('also propagates dependencies through backdrop layers painted after glass', () => {
    const first = backdrop({ x: 10, y: 78, width: 80, height: 42 }, 6)
    const second = backdrop({ x: 10, y: 20, width: 80, height: 120 }, 6)
    expect(proof([glass, first])?.needed.has(first)).toBe(false)
    const result = proof([glass, first, second])
    expect(result?.needed.has(first)).toBe(true)
    expect(result?.needed.has(second)).toBe(true)
  })

  it('uses document scroll to re-evaluate the source footprint', () => {
    const layer = backdrop({ x: 10, y: 120, width: 80, height: 120 }, 4, 'document')
    const scrolled = { ...frame, scrollY: 100 }
    expect(proof([layer, glass], scrolled)?.needed.has(layer)).toBe(true)
    expect(proof([layer, glass])?.needed.has(layer)).toBe(false)
  })

  it('calculates the halo using rounded backing dimensions', () => {
    const layer = backdrop({ x: 10, y: 20, width: 80, height: 120 }, 4)
    const scaled = { ...frame, width: 99.7, pixelRatio: 1.5 }
    expect(proof([layer, glass], scaled)?.needed.has(layer)).toBe(true)
    expect(
      proveBackdropSampling({
        items: [layer, glass],
        frame: scaled,
        samplingRegion: sceneRegion,
        targetWidth: 200,
        targetHeight: 150,
      })
    ).toBeNull()
  })

  it('includes every pane and interleaved backdrop in the source footprint', () => {
    const second = { ...glass, rect: { x: 65, y: 45, width: 15, height: 15 } }
    const layer = backdrop({ x: 61, y: 40, width: 22, height: 25 }, 1)
    const result = proof([glass, layer, second])
    expect(result?.needed.has(layer)).toBe(true)
  })

  it('keeps the gap between disjoint panes out of the required region', () => {
    const first = { ...glass, rect: { x: 40, y: 10, width: 20, height: 10 } }
    const second = { ...glass, rect: { x: 40, y: 80, width: 20, height: 10 } }
    const gap = backdrop({ x: 42, y: 43, width: 16, height: 8 }, 1)
    const result = splitProof([gap, first, second], [first.rect, second.rect])
    expect(result).not.toBeNull()
    expect(result?.needed.has(gap)).toBe(false)
    // The historical bounding rectangle deliberately includes the gap.
    expect(proof([gap, first, second])?.needed.has(gap)).toBe(true)
  })

  it('keeps a conservative output union for one layer affecting two disjoint panes', () => {
    const first = { ...glass, rect: { x: 40, y: 10, width: 20, height: 10 } }
    const second = { ...glass, rect: { x: 40, y: 80, width: 20, height: 10 } }
    const layer = backdrop({ x: 30, y: 0, width: 40, height: 100 }, 2)
    const output = splitProof([layer, first, second], [first.rect, second.rect])?.outputRegions.get(layer)
    expect(output).toBeDefined()
    expect(output!.y).toBeLessThanOrEqual(first.rect.y)
    expect(output!.y + output!.height).toBeGreaterThanOrEqual(second.rect.y + second.rect.height)
  })

  it('propagates a later backdrop halo backwards across multiple disjoint panes', () => {
    const first = { ...glass, rect: { x: 0, y: 10, width: 5, height: 5 } }
    const second = { ...glass, rect: { x: 70, y: 70, width: 10, height: 5 } }
    const earlier = backdrop({ x: 66, y: 36, width: 22, height: 12 }, 1)
    const later = backdrop({ x: 66, y: 47, width: 22, height: 13 }, 4)
    expect(
      splitProof([earlier, first, second], [first.rect, second.rect])?.needed.has(earlier)
    ).toBe(false)
    const result = splitProof([earlier, first, later, second], [first.rect, second.rect])
    expect(result?.needed.has(later)).toBe(true)
    expect(result?.needed.has(earlier)).toBe(true)
  })

  it('includes a glass pane inside an opacity group when deriving the optical regions', () => {
    const second = { ...glass, rect: { x: 40, y: 80, width: 20, height: 10 } }
    const group: Extract<SceneItem, { kind: 'opacity-group' }> = {
      kind: 'opacity-group',
      rect: second.rect,
      space: 'viewport',
      opacity: 0.5,
      items: [second],
    }
    const layer = backdrop({ x: 42, y: 75, width: 16, height: 20 }, 2)
    expect(splitProof([layer, glass, group], [glass.rect])?.needed.has(layer)).toBe(true)
  })

  it('keys the output region by the original backdrop inside an opacity group', () => {
    const layer = backdrop({ x: 10, y: 20, width: 80, height: 80 }, 2)
    const group: Extract<SceneItem, { kind: 'opacity-group' }> = {
      kind: 'opacity-group',
      rect: layer.rect,
      space: 'viewport',
      opacity: 0.5,
      items: [layer],
    }
    const result = proof([group, glass])
    expect(result?.needed.has(layer)).toBe(true)
    expect(result?.outputRegions.get(layer)).toBeDefined()
  })

  it('retains partial layers near disjoint panes when halos cross both viewport edges', () => {
    const first = { ...glass, rect: { x: 40, y: 10, width: 20, height: 10 } }
    const second = { ...glass, rect: { x: 40, y: 80, width: 20, height: 10 } }
    const top = backdrop({ x: 10, y: -25, width: 80, height: 50 }, 8)
    const bottom = backdrop({ x: 10, y: 75, width: 80, height: 50 }, 8)
    const result = splitProof([top, first, bottom, second], [first.rect, second.rect])
    expect(result?.needed.has(top)).toBe(true)
    expect(result?.needed.has(bottom)).toBe(true)
  })

  it('does not let an empty, invalid, or excessive region list enable a proof', () => {
    expect(splitProof([glass], [])).toBeNull()
    expect(splitProof([glass], [{ x: NaN, y: 0, width: 1, height: 1 }])).toBeNull()
    expect(
      splitProof(
        [glass],
        Array.from({ length: 129 }, () => sceneRegion)
      )
    ).toBeNull()
  })

  it('rejects missing or invalid geometry and unsupported glass panes', () => {
    const bad = backdrop({ x: 10, y: NaN, width: 80, height: 120 }, 4)
    expect(proof([bad, glass])).toBeNull()
    const legacyGlass = { ...glass }
    delete legacyGlass.studio
    expect(proof([glass, legacyGlass])).toBeNull()
    expect(
      proveBackdropSampling({
        items: [glass],
        frame,
        samplingRegion: undefined,
        targetWidth: 100,
        targetHeight: 100,
      })
    ).toBeNull()
  })
})
