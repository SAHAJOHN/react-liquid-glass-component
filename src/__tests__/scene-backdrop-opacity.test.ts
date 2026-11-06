import { describe, expect, it } from 'vitest'
import { createOpacityGroupPainter } from '../scene/opacity-group'
import { proveBackdropSampling } from '../scene/backdrop-sampling'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { SceneBackdrop, SceneItem } from '../scene/types'

const frame = { width: 300, height: 600, pixelRatio: 2, scrollX: 0, scrollY: 0 }

function fixture() {
  const bitmap = document.createElement('canvas')
  bitmap.width = bitmap.height = 8
  const backdrop: SceneBackdrop = {
    kind: 'backdrop',
    bitmap,
    sigma: 10,
    radius: 10,
    rect: { x: 20, y: 30, width: 120, height: 80 },
    space: 'viewport',
    opacity: 0.5,
  }
  const solid: SceneItem = {
    kind: 'solid',
    color: [1, 0, 0, 1],
    radius: 0,
    rect: { x: 30, y: 40, width: 20, height: 20 },
    space: 'viewport',
    opacity: 0.5,
  }
  const glass: SceneItem = {
    kind: 'glass',
    rect: { x: 20, y: 30, width: 120, height: 80 },
    space: 'viewport',
    opacity: 1,
    radius: 10,
    displacement: [0, 0, 0],
    blur: 0,
    saturation: 1,
    tint: [0, 0, 0, 0],
    studio: { ...GLASS_STUDIO_DEFAULTS, shapeRoundness: 2, shadowFactor: 0 },
  }
  const painter = createOpacityGroupPainter()
  const compose = (items: SceneItem[]) =>
    painter.compose({
      owner: document.createElement('div'),
      items,
      inheritedOpacity: 1,
      groupOpacity: 0.5,
      frame,
    })
  return { backdrop, solid, glass, painter, compose }
}

describe('backdrop inside opacity groups', () => {
  it('groups the first backdrop and content, applying opacity once', () => {
    const { backdrop, solid, painter, compose } = fixture()
    const result = compose([backdrop, solid])
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Missing GPU group')
    expect(result.item.opacity).toBe(0.5)
    expect(result.item.items.map((item) => [item.kind, item.opacity])).toEqual([
      ['backdrop', 1],
      ['solid', 1],
    ])
    painter.dispose()
  })

  it('rejects later or multiple backdrop layers and mixed lens order', () => {
    const { backdrop, solid, glass, painter, compose } = fixture()
    for (const items of [
      [solid, backdrop],
      [backdrop, backdrop],
      [backdrop, { ...glass, opacity: 0.5 }],
      [{ ...glass, opacity: 0.5 }, backdrop],
    ]) {
      expect(compose(items).status).toBe('unsupported')
    }
    painter.dispose()
  })

  it('includes the first grouped backdrop in reverse sampling proof', () => {
    const { backdrop, glass, painter, compose } = fixture()
    const grouped = compose([backdrop])
    if (grouped.status !== 'ready') throw new Error('Missing GPU group')
    const groupedBackdrop =
      grouped.item.kind === 'opacity-group' ? grouped.item.items[0] : undefined
    const proof = proveBackdropSampling({
      items: [grouped.item, glass],
      frame,
      samplingRegion: glass.rect,
      targetWidth: 600,
      targetHeight: 1200,
    })
    expect(groupedBackdrop?.kind).toBe('backdrop')
    if (groupedBackdrop?.kind === 'backdrop') expect(proof?.needed.has(groupedBackdrop)).toBe(true)
    painter.dispose()
  })
})
