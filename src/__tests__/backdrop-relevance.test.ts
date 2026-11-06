import { describe, expect, it } from 'vitest'
import { expandBackdropRelevance } from '../scene/backdrop-relevance'
import { samplingRelation } from '../scene/sampling-boundary'
import type { SceneFrame, SceneRect } from '../scene/types'

const frame: SceneFrame = { width: 400, height: 800, scrollX: 0, scrollY: 0, pixelRatio: 2 }
const pane: SceneRect = { x: 50, y: 20, width: 100, height: 50 }

function fixture() {
  const root = document.createElement('div')
  const styles = new Map<Element, CSSStyleDeclaration>()
  const bounds = new Map<Element, DOMRect>()
  function add(parent: Element, rect: SceneRect, properties: Record<string, string> = {}) {
    const element = document.createElement('div')
    const style = document.createElement('div').style
    Object.defineProperties(style, {
      display: { value: properties.display ?? 'block', configurable: true },
      visibility: { value: properties.visibility ?? 'visible', configurable: true },
      opacity: { value: properties.opacity ?? '1', configurable: true },
      transform: { value: properties.transform ?? 'none', configurable: true },
      translate: { value: properties.translate ?? 'none', configurable: true },
      rotate: { value: properties.rotate ?? 'none', configurable: true },
      scale: { value: properties.scale ?? 'none', configurable: true },
      perspective: { value: properties.perspective ?? 'none', configurable: true },
      backdropFilter: { value: properties.backdropFilter ?? 'none', configurable: true },
      getPropertyValue: {
        value: (name: string) => properties[name] ?? '',
        configurable: true,
      },
    })
    styles.set(element, style)
    bounds.set(element, new DOMRect(rect.x, rect.y, rect.width, rect.height))
    parent.appendChild(element)
    return element
  }
  const rootStyle = document.createElement('div').style
  Object.defineProperty(rootStyle, 'backdropFilter', { value: 'none', configurable: true })
  styles.set(root, rootStyle)
  bounds.set(root, new DOMRect(0, 0, frame.width, frame.height))
  const input = (regions: readonly SceneRect[] = [pane]) => ({
    root,
    regions,
    frame,
    readStyle(element: Element) {
      const style = styles.get(element)
      if (!style) throw new Error('Missing test style')
      return style
    },
    readRect(element: Element) {
      const rect = bounds.get(element)
      if (!rect) throw new Error('Missing test rect')
      return rect
    },
  })
  return { root, add, bounds, styles, input }
}

describe('backdrop relevance prepass', () => {
  it('includes an off-pane unavailable image in a relevant blur source halo', () => {
    const { root, add, input } = fixture()
    add(root, { x: 0, y: 0, width: 200, height: 100 }, { backdropFilter: 'blur(10px)' })
    const { regions, hasBackdrop } = expandBackdropRelevance(input())
    expect(hasBackdrop).toBe(true)
    expect(regions).toHaveLength(1)
    expect(samplingRelation({ x: 70, y: 0, width: 20, height: 5 }, regions?.[0])).toBe('inside')
  })

  it('accumulates dependencies through layers regardless of DOM order', () => {
    const { root, add, input } = fixture()
    add(root, { x: 0, y: 0, width: 200, height: 40 }, { backdropFilter: 'blur(5px)' })
    add(root, { x: 0, y: 34, width: 200, height: 50 }, { backdropFilter: 'blur(5px)' })
    const { regions } = expandBackdropRelevance(input([{ x: 50, y: 55, width: 100, height: 10 }]))
    expect(regions).toHaveLength(1)
    expect(samplingRelation({ x: 70, y: 20, width: 20, height: 3 }, regions?.[0])).toBe('inside')
  })

  it('limits source relevance to a thin backdrop stripe instead of expanding the whole pane', () => {
    const { root, add, input } = fixture()
    add(root, { x: 50, y: 0, width: 3, height: 150 }, { backdropFilter: 'blur(10px)' })
    const { regions } = expandBackdropRelevance(input())
    expect(regions).toBeDefined()
    // This marquee is within a uniformly expanded pane but outside both the
    // pane and the backdrop border box, so the stripe cannot read from it.
    const marquee = { x: 170, y: 40, width: 10, height: 10 }
    expect(regions?.every((region) => samplingRelation(marquee, region) === 'outside')).toBe(true)
    const source = { x: 50, y: 5, width: 3, height: 2 }
    expect(regions?.some((region) => samplingRelation(source, region) === 'inside')).toBe(true)
  })

  it('fails closed when an unknown layer connects through another relevant layer', () => {
    const { root, add, input } = fixture()
    add(root, { x: 50, y: 25, width: 10, height: 25 }, { backdropFilter: 'blur(2px)' })
    add(root, { x: 50, y: 49, width: 10, height: 70 }, { backdropFilter: 'url(#unknown)' })
    expect(expandBackdropRelevance(input())).toEqual({ regions: undefined, hasBackdrop: true })
  })

  it('keeps disjoint pane regions separate and leaves an unrelated gap irrelevant', () => {
    const { root, add, input } = fixture()
    add(root, { x: 0, y: 0, width: 200, height: 80 }, { backdropFilter: 'blur(3px)' })
    add(root, { x: 0, y: 600, width: 200, height: 100 }, { backdropFilter: 'blur(3px)' })
    const { regions } = expandBackdropRelevance(
      input([
        { x: 50, y: 20, width: 100, height: 20 },
        { x: 50, y: 630, width: 100, height: 20 },
      ])
    )
    expect(regions).toHaveLength(2)
    expect(
      regions?.every(
        (region) => samplingRelation({ x: 50, y: 300, width: 30, height: 20 }, region) === 'outside'
      )
    ).toBe(true)
  })

  it('disables deferral if an unknown filter becomes reachable, but not while it is distant', () => {
    const { root, add, bounds, input } = fixture()
    const layer = add(
      root,
      { x: 50, y: 300, width: 80, height: 60 },
      { backdropFilter: 'url(#unknown)' }
    )
    expect(expandBackdropRelevance(input())).toEqual({ regions: [pane], hasBackdrop: true })
    bounds.set(layer, new DOMRect(50, 40, 80, 60))
    expect(expandBackdropRelevance(input())).toEqual({ regions: undefined, hasBackdrop: true })
  })

  it('allows translations but disables deferral for reachable unbounded transforms', () => {
    const a = fixture()
    a.add(
      a.root,
      { x: 40, y: 10, width: 130, height: 80 },
      { backdropFilter: 'blur(4px)', transform: 'matrix(1, 0, 0, 1, 10, 0)' }
    )
    expect(expandBackdropRelevance(a.input()).regions?.[0]?.y).toBeLessThan(pane.y)
    const b = fixture()
    const ancestor = b.add(
      b.root,
      { x: 0, y: 0, width: 300, height: 300 },
      { transform: 'matrix(2, 0, 0, 2, 0, 0)' }
    )
    b.add(ancestor, { x: 40, y: 10, width: 130, height: 80 }, { backdropFilter: 'blur(4px)' })
    expect(expandBackdropRelevance(b.input()).regions).toBeUndefined()
  })

  it('re-reads layout and filter values on each call', () => {
    const { root, add, bounds, styles, input } = fixture()
    const layer = add(
      root,
      { x: 50, y: 300, width: 80, height: 60 },
      { backdropFilter: 'blur(8px)' }
    )
    expect(expandBackdropRelevance(input()).regions).toEqual([pane])
    bounds.set(layer, new DOMRect(50, 40, 80, 60))
    const first = expandBackdropRelevance(input()).regions
    const nearBottom = { x: 60, y: 98, width: 2, height: 1 }
    expect(first?.every((region) => samplingRelation(nearBottom, region) === 'outside')).toBe(true)
    Object.defineProperty(styles.get(layer), 'backdropFilter', {
      value: 'blur(16px)',
      configurable: true,
    })
    const updated = expandBackdropRelevance(input()).regions
    expect(updated?.some((region) => samplingRelation(nearBottom, region) === 'inside')).toBe(true)
  })

  it('conservatively contains an exact discrete dependency model across layer orders', () => {
    const grid = 12
    const smallFrame: SceneFrame = {
      width: grid,
      height: grid,
      pixelRatio: 1,
      scrollX: 0,
      scrollY: 0,
    }
    type TestLayer = { rect: SceneRect; sigma: number }
    const rectangles: SceneRect[] = [
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 2, y: 1, width: 4, height: 6 },
      { x: 4, y: 3, width: 5, height: 4 },
      { x: 7, y: 0, width: 3, height: 8 },
      { x: 0, y: 7, width: 8, height: 3 },
      { x: 6, y: 6, width: 5, height: 5 },
    ]
    const initial: SceneRect = { x: 3, y: 2, width: 2, height: 2 }
    const within = (rect: SceneRect, x: number, y: number) =>
      x + 0.5 >= rect.x &&
      x + 0.5 < rect.x + rect.width &&
      y + 0.5 >= rect.y &&
      y + 0.5 < rect.y + rect.height
    // A backward integer-grid oracle applies each layer once in paint order.
    // Its square kernel deliberately overestimates the actual Gaussian support.
    const exact = (layers: readonly TestLayer[]) => {
      const required = new Set<number>()
      for (let y = 0; y < grid; y += 1)
        for (let x = 0; x < grid; x += 1) if (within(initial, x, y)) required.add(y * grid + x)
      for (const layer of [...layers].reverse()) {
        const halo = Math.ceil(3 * layer.sigma) + 2
        const impact = [...required].filter((value) =>
          within(layer.rect, value % grid, Math.floor(value / grid))
        )
        for (const value of impact) {
          const x = value % grid
          const y = Math.floor(value / grid)
          for (let dy = -halo; dy <= halo; dy += 1) {
            for (let dx = -halo; dx <= halo; dx += 1) {
              const sx = x + dx
              const sy = y + dy
              if (sx >= 0 && sx < grid && sy >= 0 && sy < grid && within(layer.rect, sx, sy))
                required.add(sy * grid + sx)
            }
          }
        }
      }
      return required
    }
    let scenarios = 0
    for (const a of rectangles) {
      for (const b of rectangles) {
        for (const c of rectangles) {
          for (let sigmaMask = 0; sigmaMask < 8; sigmaMask += 1) {
            const layers: TestLayer[] = [
              { rect: a, sigma: sigmaMask & 1 },
              { rect: b, sigma: (sigmaMask >> 1) & 1 },
              { rect: c, sigma: (sigmaMask >> 2) & 1 },
            ]
            const { root, add, input } = fixture()
            for (const layer of layers)
              add(root, layer.rect, { backdropFilter: `blur(${layer.sigma}px)` })
            const result = expandBackdropRelevance({ ...input([initial]), frame: smallFrame })
            expect(result.regions, `scenario ${scenarios}`).toBeDefined()
            for (const cell of exact(layers)) {
              const x = cell % grid
              const y = Math.floor(cell / grid)
              expect(
                result.regions?.some((region) => within(region, x, y)),
                `scenario ${scenarios}, cell ${x},${y}`
              ).toBe(true)
            }
            scenarios += 1
          }
        }
      }
    }
    expect(scenarios).toBe(1728)
  })

  it('honors hidden groups but still visits visible descendants of visibility:hidden', () => {
    const hidden = fixture()
    const hiddenParent = hidden.add(hidden.root, pane, { display: 'none' })
    hidden.add(hiddenParent, pane, { backdropFilter: 'url(#unknown)' })
    expect(expandBackdropRelevance(hidden.input())).toEqual({ regions: [pane], hasBackdrop: false })
    const visible = fixture()
    const parent = visible.add(visible.root, pane, { visibility: 'hidden' })
    visible.add(parent, pane, { visibility: 'visible', backdropFilter: 'url(#unknown)' })
    expect(expandBackdropRelevance(visible.input()).regions).toBeUndefined()
  })

  it('remeasures while a backdrop is off-region and skips painted SVG descendants', () => {
    const { root, add, styles, bounds, input } = fixture()
    add(root, { x: 50, y: 300, width: 80, height: 60 }, { backdropFilter: 'blur(8px)' })
    const placeholder = add(root, { x: 0, y: 0, width: 30, height: 30 })
    const style = styles.get(placeholder)
    if (!style) throw new Error('Missing test style')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'))
    placeholder.replaceWith(svg)
    styles.set(svg, style)
    bounds.set(svg, new DOMRect(0, 0, 30, 30))
    expect(expandBackdropRelevance(input())).toEqual({ regions: [pane], hasBackdrop: true })
  })

  it('disables deferral for unreadable styles, invalid rectangles and invalid input', () => {
    const { root, add, bounds, input } = fixture()
    const layer = add(root, pane, { backdropFilter: 'blur(2px)' })
    bounds.set(layer, new DOMRect(NaN, 0, 100, 100))
    expect(expandBackdropRelevance(input())).toEqual({ regions: undefined, hasBackdrop: true })
    expect(
      expandBackdropRelevance({
        ...input(),
        readStyle: () => {
          throw new Error('unavailable')
        },
      }).regions
    ).toBeUndefined()
    expect(expandBackdropRelevance(input([]))).toEqual({ regions: undefined, hasBackdrop: true })
  })
})
