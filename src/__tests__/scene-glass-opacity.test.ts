import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpacityGroupPainter } from '../scene/opacity-group'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import { proveBackdropSampling } from '../scene/backdrop-sampling'
import type { SceneGlass, SceneItem } from '../scene/types'

const frame = { width: 300, height: 600, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const glass: SceneGlass = {
  kind: 'glass',
  rect: { x: 10, y: 20, width: 200, height: 80 },
  space: 'viewport',
  opacity: 0.5,
  radius: 20,
  displacement: [0, 0, 0],
  blur: 0,
  saturation: 1,
  tint: [0, 0, 0, 0],
  studio: { ...GLASS_STUDIO_DEFAULTS, shapeRoundness: 2, shadowFactor: 0 },
}

function fixture(items: SceneItem[]) {
  const painter = createOpacityGroupPainter()
  return painter.compose({
    owner: document.createElement('div'),
    items,
    inheritedOpacity: 1,
    groupOpacity: 0.5,
    frame,
  })
}

afterEach(() => vi.restoreAllMocks())

describe('glass inside opacity groups', () => {
  it('keeps a single first shadowless Studio glass on the GPU and applies group opacity once', () => {
    const solid: SceneItem = {
      kind: 'solid',
      rect: { x: 50, y: 30, width: 20, height: 20 },
      space: 'viewport',
      opacity: 0.5,
      radius: 0,
      color: [1, 0, 0, 1],
    }
    const result = fixture([glass, solid])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Missing GPU group')
    expect(result.item.opacity).toBe(0.5)
    expect(result.item.items.map((item) => [item.kind, item.opacity])).toEqual([
      ['glass', 1],
      ['solid', 1],
    ])
  })

  it('retains native fallback for a lens after other paint, a second lens, legacy optics or shadows', () => {
    const solid: SceneItem = {
      kind: 'solid',
      rect: glass.rect,
      space: 'viewport',
      opacity: 0.5,
      radius: 0,
      color: [1, 0, 0, 1],
    }
    const legacy = { ...glass }
    delete legacy.studio
    const shadow = { ...glass, studio: { ...GLASS_STUDIO_DEFAULTS, shadowFactor: 1 } }
    for (const items of [[solid, glass], [glass, glass], [legacy], [shadow]])
      expect(fixture(items).status).toBe('unsupported')
  })

  it('includes grouped glass when computing the backdrop sampling proof', () => {
    const result = fixture([glass])
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Missing GPU group')
    const backdrop: SceneItem = {
      kind: 'backdrop',
      bitmap: document.createElement('canvas'),
      sigma: 1,
      radius: 0,
      opacity: 1,
      space: 'viewport',
      rect: { x: 0, y: 0, width: 300, height: 600 },
    }
    const proof = proveBackdropSampling({
      items: [backdrop, result.item],
      frame,
      samplingRegion: glass.rect,
      targetWidth: 600,
      targetHeight: 1200,
    })
    expect(proof?.needed.has(backdrop)).toBe(true)
  })
})
