import { copyLayerSnapshot, layeredShapePolygon, planLayerAtlas } from '../scene/layered-snapshot'
import type { SceneFrame } from '../scene/types'

const frame: SceneFrame = { width: 200, height: 100, pixelRatio: 2, scrollX: 0, scrollY: 0 }
const square = { shapeRadius: 0, shapeRoundness: 2 }

function fixture() {
  const source = document.createElement('canvas')
  source.width = 400
  source.height = 200
  const target = document.createElement('canvas')
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() }
  vi.spyOn(target, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  return { source, target, context }
}

describe('pane layer snapshot', () => {
  afterEach(() => vi.restoreAllMocks())

  it('copies the exact viewport region into the pane canvas at backing resolution', () => {
    const { source, target, context } = fixture()
    const rect = { x: 20, y: 10, width: 80, height: 40 }
    expect(copyLayerSnapshot(source, target, rect, frame, square)).toBe(true)
    expect([target.width, target.height]).toEqual([160, 80])
    expect(context.drawImage).toHaveBeenCalledWith(source, 40, 20, 160, 80, 0, 0, 160, 80)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 160, 80)
  })

  it('preserves the position of a pane clipped by the top and left viewport edges', () => {
    const { source, target, context } = fixture()
    const rect = { x: -10, y: -5, width: 80, height: 40 }
    expect(copyLayerSnapshot(source, target, rect, frame, square)).toBe(true)
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 140, 70, 20, 10, 140, 70)
  })

  it('clips the right and bottom viewport edges without stretching the snapshot', () => {
    const { source, target, context } = fixture()
    const rect = { x: 180, y: 90, width: 80, height: 40 }
    expect(copyLayerSnapshot(source, target, rect, frame, square)).toBe(true)
    expect(context.drawImage).toHaveBeenCalledWith(source, 360, 180, 40, 20, 0, 0, 40, 20)
  })

  it('packs aligned panes at DPR 2 and skips a clipped pane', () => {
    const slots = planLayerAtlas([
      { x: 10, y: 5, width: 80, height: 40 },
      { x: 110, y: 5, width: 80, height: 40 },
      { x: 180.25, y: 90.25, width: 80, height: 40 },
    ], frame, 400, 200)
    expect(slots).toEqual([
      { sourceX: 19, sourceY: 9, width: 162, height: 82, atlasX: 0, atlasY: 0 },
      { sourceX: 219, sourceY: 9, width: 162, height: 82, atlasX: 162, atlasY: 0 },
      null,
    ])
    const { source, target, context } = fixture()
    expect(copyLayerSnapshot(source, target, { x: 180.25, y: 90.25, width: 80, height: 40 }, frame, square,
      { x: 141 - 359, y: 0 - 179 })).toBe(true)
    expect(context.drawImage).toHaveBeenCalledWith(source, 142.5, 1.5, 39.5, 19.5, 0, 0, 39.5, 19.5)
  })

  it('packs fully visible subpixel positions but leaves fractional backing sizes on the direct path', () => {
    const slots = planLayerAtlas([
      { x: 10.125, y: 5.25, width: 80, height: 40 },
      { x: 110.25, y: 5.125, width: 80, height: 40 },
      { x: 20, y: 60, width: 80.25, height: 20 },
    ], frame, 400, 200)
    expect(slots).toEqual([
      { sourceX: 19, sourceY: 9, width: 163, height: 83, atlasX: 0, atlasY: 0 },
      { sourceX: 219, sourceY: 9, width: 163, height: 83, atlasX: 163, atlasY: 0 },
      null,
    ])
  })

  it('uses the original path when only one pane is visible or the atlas cannot fit', () => {
    expect(planLayerAtlas([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 300, y: 0, width: 20, height: 20 },
    ], frame, 400, 200)).toBeNull()
    expect(planLayerAtlas([
      { x: 0, y: 0, width: 200, height: 75 },
      { x: 0, y: 0, width: 200, height: 75 },
    ], frame, 400, 200)).toBeNull()
  })

  it('does not allocate or draw for panes completely outside the viewport', () => {
    const { source, target, context } = fixture()
    const original = [target.width, target.height]
    expect(copyLayerSnapshot(source, target, { x: 300, y: 0, width: 100, height: 40 }, frame, square)).toBe(true)
    expect([target.width, target.height]).toEqual(original)
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it('rejects invalid or excessive backing dimensions', () => {
    const { source, target, context } = fixture()
    expect(copyLayerSnapshot(source, target, { x: 0, y: 0, width: NaN, height: 40 }, frame, square)).toBe(false)
    expect(copyLayerSnapshot(source, target, { x: 0, y: 0, width: 5000, height: 40 }, frame, square)).toBe(false)
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it('follows the shader superellipse boundary at circular and rounded-square extremes', () => {
    for (const shape of [{ shapeRadius: 100, shapeRoundness: 2 }, { shapeRadius: 80, shapeRoundness: 7 }]) {
      const width = 200
      const height = 100
      const radius = (height * 0.5 * shape.shapeRadius) / 100
      const polygon = layeredShapePolygon(width, height, shape)
      expect(polygon).not.toBeNull()
      const points = [...polygon!.matchAll(/([\d.]+)% ([\d.]+)%/g)].map((match) => [
        Number(match[1]) * width / 100,
        Number(match[2]) * height / 100,
      ])
      expect(points.length).toBeGreaterThan(8)
      for (const [x, y] of points) {
        const cornerX = Math.max(0, radius - Math.min(x!, width - x!))
        const cornerY = Math.max(0, radius - Math.min(y!, height - y!))
        expect(Math.abs(Math.hypot(cornerX, cornerY))).toBeGreaterThan(0)
        const distance = Math.pow(Math.pow(cornerX, shape.shapeRoundness) + Math.pow(cornerY, shape.shapeRoundness), 1 / shape.shapeRoundness)
        expect(distance).toBeCloseTo(radius, 3)
      }
      for (let index = 0; index < points.length; index++) {
        const [ax, ay] = points[index]!
        const [bx, by] = points[(index + 1) % points.length]!
        const x = (ax! + bx!) / 2
        const y = (ay! + by!) / 2
        const cx = Math.max(0, radius - Math.min(x, width - x))
        const cy = Math.max(0, radius - Math.min(y, height - y))
        const boundaryDistance = Math.pow(cx ** shape.shapeRoundness + cy ** shape.shapeRoundness, 1 / shape.shapeRoundness)
        expect(Math.abs(boundaryDistance - radius)).toBeLessThan(0.25)
      }
    }
  })

  it('updates the CSS mask when the shape changes and avoids repeated writes', () => {
    const { source, target } = fixture()
    const rect = { x: 20, y: 10, width: 80, height: 40 }
    const style = target.style
    expect(copyLayerSnapshot(source, target, rect, frame, { shapeRadius: 100, shapeRoundness: 2 })).toBe(true)
    const first = style.clipPath
    const setProperty = vi.spyOn(style, 'setProperty')
    expect(copyLayerSnapshot(source, target, rect, frame, { shapeRadius: 100, shapeRoundness: 2 })).toBe(true)
    expect(setProperty).not.toHaveBeenCalled()
    expect(copyLayerSnapshot(source, target, rect, frame, { shapeRadius: 80, shapeRoundness: 7 })).toBe(true)
    expect(style.clipPath).not.toBe(first)
  })
})
