import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpacityGroupPainter } from '../scene/opacity-group'
import type { SceneClip, SceneItem } from '../scene/types'

const frame = { width: 300, height: 600, pixelRatio: 2, scrollX: 0, scrollY: 0 }

function setup() {
  const calls: string[] = []
  const context = {
    drawImage: vi.fn(() => calls.push('image')),
    fillRect: vi.fn(() => calls.push('solid')),
    fillStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  const bitmap = document.createElement('canvas')
  bitmap.width = 40
  bitmap.height = 20
  const owner = document.createElement('div')
  const sprite: SceneItem = {
    kind: 'sprite',
    bitmap,
    space: 'document',
    opacity: 0.2,
    rect: { x: 10, y: 20, width: 20, height: 10 },
  }
  const solid: SceneItem = {
    kind: 'solid',
    color: [0.1, 0.2, 0.3, 1],
    radius: 0,
    space: 'document',
    opacity: 0.2,
    rect: { x: 15, y: 22, width: 10, height: 5 },
  }
  const painter = createOpacityGroupPainter()
  const input = { owner, inheritedOpacity: 0.4, groupOpacity: 0.5, frame, items: [sprite, solid] }
  return { bitmap, owner, sprite, solid, painter, input, context, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('opacity group compositor', () => {
  it('accepts an owner clip when overlapping paint is entirely inside its coverage', () => {
    const { painter, input, owner, sprite, solid } = setup()
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 12, y: 21, width: 15, height: 7 },
      radius: 0,
      owner,
    }
    const items: SceneItem[] = [
      { ...sprite, clips: [clip] },
      { ...solid, clips: [clip] },
      { ...solid },
    ]
    const result = painter.compose({ ...input, items, preferGpu: true })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Expected GPU group')
    expect(result.item.items[0]?.clips).toEqual([clip])
    expect(result.item.items[1]?.clips).toEqual([clip])
    expect(result.item.items[2]?.clips).toBeUndefined()
    const edge = { ...clip, rect: { x: 15, y: 22, width: 10, height: 5 } }
    const unsafe: SceneItem[] = [
      { ...sprite, clips: [edge] },
      { ...solid, clips: [edge] },
      { ...solid },
    ]
    expect(painter.compose({ ...input, items: unsafe, preferGpu: true })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
  })
  it('preserves a single translucent flat paint inside an opaque GPU mask group', () => {
    const { painter, input, sprite, solid } = setup()
    for (const paint of [sprite, solid]) {
      const result = painter.compose({
        ...input,
        inheritedOpacity: 1,
        groupOpacity: 1,
        items: [{ ...paint, opacity: 0.35 }],
        preferGpu: true,
      })
      if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
        throw new Error('Expected GPU group')
      expect(result.item.opacity).toBe(1)
      expect(result.item.items[0]?.opacity).toBe(0.35)
    }
    const nested = { ...sprite, opacity: 0.35 }
    expect(
      painter.compose({
        ...input,
        inheritedOpacity: 1,
        groupOpacity: 1,
        items: [nested, nested],
        preferGpu: true,
      }).status
    ).toBe('unsupported')
    expect(
      painter.compose({
        ...input,
        inheritedOpacity: 1,
        groupOpacity: 1,
        items: [{ ...nested, brightness: 0.5 }],
        preferGpu: true,
      }).status
    ).toBe('unsupported')
    expect(painter.compose({ ...input, items: [nested], preferGpu: true }).status).toBe(
      'unsupported'
    )
  })

  it('preserves independently composed flat opacities only with an explicit opaque GPU contract', () => {
    const { painter, input, sprite, solid } = setup()
    const items: SceneItem[] = [
      { ...sprite, opacity: 0.35 },
      { ...solid, opacity: 0.7 },
    ]
    const base = {
      ...input,
      inheritedOpacity: 1,
      groupOpacity: 1,
      preferGpu: true,
      items,
    }
    expect(painter.compose(base).status).toBe('unsupported')
    const result = painter.compose({ ...base, preserveFlatOpacities: true })
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Expected GPU group')
    expect(result.item.opacity).toBe(1)
    expect(result.item.items.map((item) => item.opacity)).toEqual([0.35, 0.7])

    expect(painter.compose({ ...base, preserveFlatOpacities: true, preferGpu: false }).status).toBe(
      'unsupported'
    )
    expect(
      painter.compose({ ...base, preserveFlatOpacities: true, inheritedOpacity: 0.8 }).status
    ).toBe('unsupported')
    expect(
      painter.compose({ ...base, preserveFlatOpacities: true, groupOpacity: 0.8 }).status
    ).toBe('unsupported')
    expect(
      painter.compose({
        ...base,
        preserveFlatOpacities: true,
        items: [{ ...items[0]!, brightness: 0.8 }, items[1]!],
      }).status
    ).toBe('unsupported')
    expect(
      painter.compose({
        ...base,
        preserveFlatOpacities: true,
        items: [{ ...items[0]!, opacity: -0.1 }, items[1]!],
      }).status
    ).toBe('unsupported')
    expect(
      painter.compose({
        ...base,
        preserveFlatOpacities: true,
        items: [{ ...items[0]!, opacity: 1.1 }, items[1]!],
      }).status
    ).toBe('unsupported')
    const media: SceneItem = {
      kind: 'media',
      source: document.createElement('video'),
      rect: sprite.rect,
      space: 'document',
      opacity: 0.35,
      fit: 'fill',
      position: [0.5, 0.5],
      radius: 0,
    }
    expect(
      painter.compose({ ...base, preserveFlatOpacities: true, items: [media, solid] }).status
    ).toBe('unsupported')
    expect(
      painter.compose({
        ...base,
        preserveFlatOpacities: true,
        items: [
          { ...media, opacity: 1 },
          { ...solid, opacity: 1 },
        ],
      }).status
    ).toBe('unsupported')
    const nested: SceneItem = {
      kind: 'opacity-group',
      rect: sprite.rect,
      space: 'document',
      opacity: 0.35,
      items: [sprite],
    }
    expect(
      painter.compose({ ...base, preserveFlatOpacities: true, items: [nested, solid] }).status
    ).toBe('unsupported')
  })
  it('can use a bounded viewport GPU target for oversized clipped content', () => {
    const { painter, input, sprite, context } = setup()
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 0, y: 0, width: 300, height: 600 },
      radius: 0,
      owner: input.owner,
    }
    const large = { ...sprite, rect: { x: 0, y: 0, width: 700, height: 5000 }, clips: [clip] }
    expect(painter.compose({ ...input, items: [large] })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group bitmap exceeds safe size',
    })
    const gpu = painter.compose({ ...input, items: [large], preferGpu: true })
    expect(gpu.status).toBe('ready')
    if (gpu.status !== 'ready' || gpu.item.kind !== 'opacity-group')
      throw new Error('Expected GPU group')
    expect(gpu.item.items).toHaveLength(1)
    expect(gpu.item.items[0]?.opacity).toBe(1)
    expect(gpu.item.clips).toEqual([clip])
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('preserves viewport allocation and nested opacity safety for GPU groups', () => {
    const { painter, input, sprite } = setup()
    const large = { ...sprite, rect: { x: 0, y: 0, width: 700, height: 5000 } }
    expect(
      painter.compose({
        ...input,
        items: [large],
        preferGpu: true,
        frame: { ...frame, width: 3000, height: 3000, pixelRatio: 2 },
      })
    ).toMatchObject({ status: 'unsupported', reason: 'Opacity group bitmap exceeds safe size' })
    expect(
      painter.compose({ ...input, items: [{ ...large, opacity: 0.1 }], preferGpu: true })
    ).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group contains nested alpha, brightness or mixed coordinates',
    })
    const boundedFrame = {
      width: 1280,
      height: 720,
      pixelRatio: Math.sqrt(2_000_000 / (1280 * 720)),
      scrollX: 0,
      scrollY: 0,
    }
    expect(
      painter.compose({ ...input, items: [large], preferGpu: true, frame: boundedFrame }).status
    ).toBe('ready')
  })
  it('keeps nested child clips when overlapping paint stays clear of their edges', () => {
    const { painter, input, sprite, solid } = setup()
    const childOwner = document.createElement('div')
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 20, height: 10 },
      radius: 0,
      owner: childOwner,
    }
    const inside = { ...solid, rect: { x: 15, y: 23, width: 8, height: 4 } }
    const result = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [clip] },
        { ...inside, clips: [clip] },
      ],
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Expected clipped GPU group')
    expect(result.item.items[0]?.clips).toEqual([clip])
    expect(result.item.items[1]?.clips).toEqual([clip])
    const atEdge = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [clip] },
        { ...solid, rect: sprite.rect, clips: [clip] },
      ],
    })
    expect(atEdge.status).toBe('unsupported')
  })
  it('paints overlapping sprites and solids in order, applying the group opacity once', () => {
    const { painter, input, context, calls, bitmap } = setup()
    const result = painter.compose(input)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'sprite') return
    expect(result.item.opacity).toBeCloseTo(0.2)
    expect(result.item.space).toBe('document')
    expect(result.item.rect).toEqual({ x: 9.5, y: 19.5, width: 21, height: 11 })
    expect(result.item.bitmap.width).toBe(42)
    expect(result.item.bitmap.height).toBe(22)
    expect(calls).toEqual(['image', 'solid'])
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 1, 1, 40, 20)
    expect(context.fillRect).toHaveBeenCalledWith(11, 5, 20, 10)
    expect(context.fillStyle).toBe('rgba(25.5, 51, 76.5, 1)')
  })

  it('reuses rasterization when only group opacity changes', () => {
    const { painter, input, context } = setup()
    const first = painter.compose(input)
    const second = painter.compose({
      ...input,
      groupOpacity: 0.25,
      items: input.items.map((item) => ({ ...item, opacity: 0.1 })),
    })
    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    if (
      first.status === 'ready' &&
      second.status === 'ready' &&
      first.item.kind === 'sprite' &&
      second.item.kind === 'sprite'
    ) {
      expect(second.item.bitmap).toBe(first.item.bitmap)
      expect(second.item.opacity).toBeCloseTo(0.1)
    }
    expect(context.drawImage).toHaveBeenCalledTimes(1)
  })

  it('rerasterizes when pixels or relative geometry change', () => {
    const { painter, input, context } = setup()
    const first = painter.compose(input)
    const changed = painter.compose({
      ...input,
      items: input.items.map((item, i) =>
        i ? { ...item, rect: { ...item.rect, x: item.rect.x + 1 } } : item
      ),
    })
    expect(first.status).toBe('ready')
    expect(changed.status).toBe('ready')
    if (
      first.status === 'ready' &&
      changed.status === 'ready' &&
      first.item.kind === 'sprite' &&
      changed.item.kind === 'sprite'
    )
      expect(first.item.bitmap).not.toBe(changed.item.bitmap)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
  })

  it('preserves a shared rounded clip even when it cuts the group', () => {
    const { painter, input, owner } = setup()
    const safe: SceneClip = {
      space: 'document',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      radius: 5,
      owner,
    }
    const clipped: SceneClip = { ...safe, rect: { x: 10, y: 20, width: 10, height: 5 } }
    const containing = painter.compose({
      ...input,
      items: input.items.map((item) => ({ ...item, clips: [safe] })),
    })
    const intersecting = painter.compose({
      ...input,
      items: input.items.map((item) => ({ ...item, clips: [clipped] })),
    })
    expect(containing.status).toBe('ready')
    expect(intersecting.status).toBe('ready')
    if (
      containing.status === 'ready' &&
      intersecting.status === 'ready' &&
      containing.item.kind === 'sprite' &&
      intersecting.item.kind === 'sprite'
    ) {
      expect(intersecting.item.clips).toEqual([clipped])
      expect(intersecting.item.bitmap).toBe(containing.item.bitmap)
    }
  })

  it('canonicalizes clip and clips and preserves their space, order, and roundness', () => {
    const { painter, input, sprite, solid, owner } = setup()
    const documentClip: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 12, height: 8 },
      radius: 3,
      owner,
    }
    const viewportClip: SceneClip = {
      space: 'viewport',
      rect: { x: 1, y: 2, width: 30, height: 30 },
      radius: 5,
      roundness: 3,
      owner,
    }
    const legacy = painter.compose({
      ...input,
      items: [
        { ...sprite, clip: documentClip },
        { ...solid, clips: [{ ...documentClip, roundness: 2 }] },
      ],
    })
    const stack = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [documentClip, viewportClip] },
        { ...solid, clips: [documentClip, viewportClip] },
      ],
    })
    expect(legacy.status).toBe('ready')
    expect(stack.status).toBe('ready')
    if (legacy.status === 'ready') expect(legacy.item.clips).toEqual([documentClip])
    if (stack.status === 'ready') expect(stack.item.clips).toEqual([documentClip, viewportClip])
  })

  it('uses GPU per-child clips for differing intersecting clips and keeps CPU for redundant clips', () => {
    const { painter, input, sprite, solid } = setup()
    const cut: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 10, height: 5 },
      radius: 3,
    }
    const safe: SceneClip = {
      space: 'document',
      rect: { x: -100, y: -100, width: 300, height: 300 },
      radius: 4,
    }
    const split = painter.compose({ ...input, items: [{ ...sprite, clip: cut }, solid] })
    expect(split.status).toBe('ready')
    if (split.status === 'ready' && split.item.kind === 'opacity-group') {
      expect(split.item.items[0]?.clips).toEqual([cut])
      expect(split.item.items[1]?.clips).toBeUndefined()
    } else throw new Error('Expected GPU group')
    const separate = painter.compose({
      ...input,
      items: [
        { ...sprite, clip: cut },
        { ...solid, clip: { ...cut, radius: 4 } },
      ],
    })
    expect(separate.status).toBe('ready')
    if (separate.status === 'ready') expect(separate.item.kind).toBe('opacity-group')
    const result = painter.compose({ ...input, items: [{ ...sprite, clip: safe }, solid] })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.item.clips).toBeUndefined()
  })

  it('fails closed for invalid or excessively deep shared clips', () => {
    const { painter, input } = setup()
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 0, y: 0, width: 20, height: 20 },
      radius: 0,
    }
    const check = (clips: SceneClip[]) =>
      painter.compose({ ...input, items: input.items.map((item) => ({ ...item, clips })) }).status
    expect(check(Array.from({ length: 5 }, () => clip))).toBe('unsupported')
    expect(check([{ ...clip, rect: { ...clip.rect, x: Infinity } }])).toBe('unsupported')
    expect(check([{ ...clip, radius: -1 }])).toBe('unsupported')
    expect(check([{ ...clip, roundness: 1 }])).toBe('unsupported')
  })

  it('rejects nested per-item opacity, brightness, and mixed coordinate spaces', () => {
    const { painter, input, sprite, solid } = setup()
    for (const item of [
      { ...sprite, opacity: 0.1 },
      { ...sprite, brightness: 0.8 },
      { ...sprite, space: 'viewport' as const },
    ])
      expect(painter.compose({ ...input, items: [solid, item] }).status).toBe('unsupported')
  })

  it('rejects rounded solids and invalid geometry', () => {
    const { painter, input, sprite, solid } = setup()
    const rejected: SceneItem[] = [
      { ...solid, kind: 'solid', radius: 2 },
      { ...sprite, rect: { ...sprite.rect, width: 0 } },
      { ...sprite, rect: { ...sprite.rect, width: 10000 } },
    ]
    for (const item of rejected)
      expect(painter.compose({ ...input, items: [item] }).status).toBe('unsupported')
  })

  it('keeps dynamic canvas and video as original GPU media without probing their contexts', () => {
    const { painter, input, bitmap, sprite, owner } = setup()
    const source = document.createElement('canvas')
    source.width = 40
    source.height = 20
    source.setAttribute('data-liquid-glass-canvas', '2d')
    const video = document.createElement('video')
    const spy = vi.spyOn(source, 'getContext')
    const rect = { x: 10, y: 20, width: 20, height: 10 }
    const canvasMedia: SceneItem = {
      kind: 'media',
      source,
      rect,
      opacity: 0.2,
      space: 'document',
      fit: 'fill',
      position: [0, 0],
      radius: 0,
    }
    const videoMedia: SceneItem = { ...canvasMedia, source: video }
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 10, height: 5 },
      radius: 1,
      owner,
    }
    const result = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [clip] },
        { ...canvasMedia, clips: [clip] },
        { ...videoMedia, clips: [clip] },
      ],
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group') return
    expect(result.item.opacity).toBeCloseTo(0.2)
    expect(result.item.clips).toEqual([clip])
    expect(result.item.items).toMatchObject([
      { kind: 'sprite', bitmap, opacity: 1 },
      { kind: 'media', source, opacity: 1 },
      { kind: 'media', source: video, opacity: 1 },
    ])
    expect(result.item.items.every((item) => !item.clip && !item.clips)).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('retains per-child clips for dynamic groups', () => {
    const { painter, input, sprite } = setup()
    const source = document.createElement('canvas')
    source.setAttribute('data-liquid-glass-canvas', '2d')
    const media: SceneItem = {
      kind: 'media',
      source,
      rect: sprite.rect,
      opacity: 0.2,
      space: 'document',
      fit: 'fill',
      position: [0, 0],
      radius: 0,
    }
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 10, height: 5 },
      radius: 1,
    }
    const result = painter.compose({ ...input, items: [{ ...sprite, clips: [clip] }, media] })
    expect(result.status).toBe('ready')
    if (result.status === 'ready' && result.item.kind === 'opacity-group') {
      expect(result.item.items[0]?.clips).toEqual([clip])
      expect(result.item.items[1]?.clips).toBeUndefined()
    } else throw new Error('Expected GPU group')
  })

  it('extracts a common clip prefix and fails closed for overlapping ambiguous nested clips', () => {
    const { painter, input, sprite, solid, owner } = setup()
    const outer: SceneClip = {
      space: 'document',
      rect: { x: 0, y: 0, width: 40, height: 40 },
      radius: 4,
      owner,
    }
    const inner: SceneClip = {
      space: 'document',
      rect: { x: 12, y: 21, width: 10, height: 5 },
      radius: 1,
      owner,
    }
    const separate = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [outer, inner] },
        { ...solid, clips: [outer] },
      ],
    })
    expect(separate.status).toBe('ready')
    if (separate.status === 'ready' && separate.item.kind === 'opacity-group') {
      expect(separate.item.clips).toEqual([outer])
      expect(separate.item.items[0]?.clips).toEqual([inner])
      expect(separate.item.items[1]?.clips).toBeUndefined()
    } else throw new Error('Expected GPU group')
    const ambiguous = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [outer, inner] },
        { ...solid, clips: [outer, inner] },
        { ...solid, clips: [outer] },
      ],
    })
    expect(ambiguous).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
  })

  it('promotes a proven rectangular DOM ancestor clip even when inner stacks omit it', () => {
    const { painter, input, owner, sprite, solid } = setup()
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    parent.style.overflowX = parent.style.overflowY = 'hidden'
    parent.style.borderWidth = '0px'
    parent.style.borderRadius = '0px'
    parent.style.borderTopLeftRadius = parent.style.borderTopRightRadius = '0px'
    parent.style.borderBottomRightRadius = parent.style.borderBottomLeftRadius = '0px'
    owner.style.position = 'relative'
    parent.appendChild(owner)
    document.body.appendChild(parent)
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 40))
    const outer: SceneClip = {
      space: 'document',
      rect: { x: 0, y: 0, width: 40, height: 40 },
      radius: 0,
      owner: parent,
    }
    const inner: SceneClip = {
      space: 'document',
      rect: { x: 12, y: 21, width: 10, height: 5 },
      radius: 1,
    }
    const items: SceneItem[] = [
      { ...sprite, clips: [outer] },
      { ...solid, clips: [outer] },
      { ...solid, clips: [inner] },
    ]
    const result = painter.compose({ ...input, items })
    expect(result.status).toBe('ready')
    if (result.status === 'ready' && result.item.kind === 'opacity-group') {
      expect(result.item.clips).toEqual([outer])
      expect(result.item.items[0]?.clips).toBeUndefined()
      expect(result.item.items[1]?.clips).toBeUndefined()
      expect(result.item.items[2]?.clips).toEqual([inner])
    } else throw new Error('Expected GPU group with proven ancestor clip')
    const fixed = document.createElement('span')
    fixed.style.position = 'fixed'
    owner.appendChild(fixed)
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.position = 'static'
    owner.style.transform = 'matrix(1, 0, 0, 1, 0, 0)'
    const contained = painter.compose({ ...input, items })
    expect(contained.status).toBe('ready')
    if (contained.status === 'ready' && contained.item.kind === 'opacity-group') {
      expect(contained.item.clips).toEqual([outer])
      expect(contained.item.items[2]?.clips).toEqual([inner])
    } else throw new Error('Expected transformed group with proven ancestor clip')
    owner.style.display = 'contents'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.display = 'block'
    owner.style.transform = 'none'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.translate = '0px'
    const translated = painter.compose({ ...input, items })
    expect(translated.status).toBe('ready')
    if (translated.status === 'ready' && translated.item.kind === 'opacity-group') {
      expect(translated.item.clips).toEqual([outer])
      expect(translated.item.items[2]?.clips).toEqual([inner])
    } else throw new Error('Expected translated group with proven ancestor clip')
    owner.style.display = 'contents'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.display = 'block'
    owner.style.translate = 'none'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.position = 'absolute'
    owner.style.translate = '0px'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.position = 'relative'
    owner.style.translate = 'none'
    fixed.remove()
    owner.style.position = 'absolute'
    owner.style.transform = 'matrix(1, 0, 0, 1, 0, 0)'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    owner.style.position = 'static'
    parent.style.borderTopWidth = '1px'
    expect(painter.compose({ ...input, items })).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group has an ambiguous nested clip',
    })
    parent.remove()
  })

  it('promotes a static subtree ancestor clip only when positioned content cannot escape', () => {
    const { painter, input, owner, sprite, solid } = setup()
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    parent.style.overflowX = parent.style.overflowY = 'hidden'
    parent.style.borderWidth = '0px'
    parent.style.borderRadius = '0px'
    parent.style.borderTopLeftRadius = parent.style.borderTopRightRadius = '0px'
    parent.style.borderBottomRightRadius = parent.style.borderBottomLeftRadius = '0px'
    owner.style.position = 'static'
    owner.style.display = 'block'
    parent.append(owner)
    document.body.append(parent)
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 21, 10, 5))
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 12, y: 21, width: 10, height: 5 },
      radius: 0,
      owner: parent,
    }
    const items: SceneItem[] = [
      { ...sprite, clips: [clip] },
      { ...solid, clips: [clip] },
      { ...solid },
    ]
    const nativeStyle = getComputedStyle
    let pseudoPosition = 'static'
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) =>
      pseudo
        ? ({ content: '"x"', position: pseudoPosition } as CSSStyleDeclaration)
        : nativeStyle(element)
    )
    const result = painter.compose({ ...input, items })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.item.kind !== 'opacity-group')
      throw new Error('Expected GPU group')
    expect(result.item.clips).toEqual([clip])
    const child = document.createElement('div')
    owner.append(child)
    for (const position of ['absolute', 'fixed']) {
      child.style.position = position
      expect(painter.compose({ ...input, items })).toMatchObject({ status: 'unsupported' })
    }
    child.style.position = 'static'
    for (const position of ['absolute', 'fixed']) {
      pseudoPosition = position
      expect(painter.compose({ ...input, items })).toMatchObject({ status: 'unsupported' })
    }
    pseudoPosition = 'static'
    child.setAttribute('popover', '')
    expect(painter.compose({ ...input, items })).toMatchObject({ status: 'unsupported' })
  })

  it('does not combine independent sibling clips that happen to have identical bounds', () => {
    const { painter, input, owner, sprite, solid } = setup()
    const left = document.createElement('div')
    const right = document.createElement('div')
    owner.append(left, right)
    const rect = { x: 10, y: 20, width: 10, height: 5 }
    const a: SceneClip = { space: 'document', rect, radius: 3, owner: left }
    const b: SceneClip = { space: 'document', rect, radius: 3, owner: right }
    const result = painter.compose({
      ...input,
      items: [
        { ...sprite, clips: [a] },
        { ...solid, clips: [b] },
      ],
    })
    expect(result.status).toBe('ready')
    if (result.status === 'ready' && result.item.kind === 'opacity-group') {
      expect(result.item.clips).toBeUndefined()
      expect(result.item.items[0]?.clips).toEqual([a])
      expect(result.item.items[1]?.clips).toEqual([b])
    } else throw new Error('Expected GPU group with independent clips')
  })

  it('fails closed for overlapping coincident clips with unknown provenance', () => {
    const { painter, input, sprite, solid } = setup()
    const clip: SceneClip = {
      space: 'document',
      rect: { x: 10, y: 20, width: 10, height: 5 },
      radius: 3,
    }
    expect(
      painter.compose({
        ...input,
        items: [
          { ...sprite, clips: [clip] },
          { ...solid, clips: [{ ...clip }] },
        ],
      })
    ).toMatchObject({ status: 'unsupported', reason: 'Opacity group has an ambiguous nested clip' })
  })

  it('does not probe or mutate an unmarked canvas and leaves it to native rendering', () => {
    const { painter, input } = setup()
    const source = document.createElement('canvas')
    const spy = vi.spyOn(source, 'getContext')
    const media: SceneItem = {
      kind: 'media',
      source,
      rect: { x: 10, y: 20, width: 20, height: 10 },
      opacity: 0.2,
      space: 'document',
      fit: 'fill',
      position: [0, 0],
      radius: 0,
    }
    const result = painter.compose({ ...input, items: [media] })
    expect(result).toMatchObject({
      status: 'unsupported',
      reason: 'Opacity group canvas requires a declared 2D context',
    })
    expect(spy).not.toHaveBeenCalled()
    expect(source.hasAttribute('data-liquid-glass-canvas')).toBe(false)
  })

  it('uses stable device-pixel bounds for fractional positions and asymmetric buffer rounding', () => {
    const { painter, input, sprite } = setup()
    const result = painter.compose({
      ...input,
      frame: { ...frame, width: 301, height: 601, pixelRatio: 1.33 },
      items: [{ ...sprite, rect: { x: 10.1, y: 20.2, width: 20, height: 10 } }],
    })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      const sx = Math.round(301 * 1.33) / 301
      const sy = Math.round(601 * 1.33) / 601
      expect(result.item.rect.x * sx).toBeCloseTo(Math.floor(10.1 * sx) - 1)
      expect(result.item.rect.y * sy).toBeCloseTo(Math.floor(20.2 * sy) - 1)
    }
  })

  it('returns empty for an empty subtree and rejects invalid opacity or missing canvas support', () => {
    const { painter, input } = setup()
    expect(painter.compose({ ...input, items: [] }).status).toBe('empty')
    expect(painter.compose({ ...input, groupOpacity: 0 }).status).toBe('unsupported')
    expect(painter.compose({ ...input, inheritedOpacity: NaN }).status).toBe('unsupported')
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    expect(painter.compose(input).status).toBe('unsupported')
  })
})
