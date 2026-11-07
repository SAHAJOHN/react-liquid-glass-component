import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintGradient } from '../scene/paint-box'

// Record the user-space transform at the time the gradient is painted. Canvas
// applies a radial gradient through the current transform when filling.
function contextFixture() {
  let transform = { x: 0, y: 0, sx: 1, sy: 1 }
  const saved: (typeof transform)[] = []
  const fills: Array<{
    x: number
    y: number
    width: number
    height: number
    transform: typeof transform
  }> = []
  const gradient = { addColorStop: vi.fn() }
  const context = {
    fillStyle: '',
    save: vi.fn(() => saved.push({ ...transform })),
    restore: vi.fn(() => {
      transform = saved.pop() ?? transform
    }),
    translate: vi.fn((x: number, y: number) => {
      transform.x += x * transform.sx
      transform.y += y * transform.sy
    }),
    scale: vi.fn((x: number, y: number) => {
      transform.sx *= x
      transform.sy *= y
    }),
    createRadialGradient: vi.fn(() => gradient),
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
      fills.push({ x, y, width, height, transform: { ...transform } })
    }),
  }
  return { context: context as unknown as CanvasRenderingContext2D, fills, gradient }
}

afterEach(() => vi.unstubAllGlobals())

describe('radial gradient painting', () => {
  it('paints the browser-canonical position-only form over the whole box', () => {
    vi.stubGlobal('CSS', {
      supports: (_property: string, value: string) => /^#[\da-f]+$/i.test(value),
    })
    const { context, fills } = contextFixture()
    expect(
      paintGradient(context, 'radial-gradient(at 50% 0%, #8ebcff 14%, #16478e 100%)', 350, 182)
    ).toBe(true)
    expect(fills).toHaveLength(1)
    expect(fills[0]?.transform.x).toBeCloseTo(175)
    expect(fills[0]?.transform.y).toBeCloseTo(0)
    expect(fills[0]?.transform.sx).toBeCloseTo(175 * Math.SQRT2)
    expect(fills[0]?.transform.sy).toBeCloseTo(182 * Math.SQRT2)
  })

  it('paints an explicit ellipse while its gradient transform is active', () => {
    vi.stubGlobal('CSS', {
      supports: (_property: string, value: string) => /^#[\da-f]+$/i.test(value),
    })
    const { context, fills } = contextFixture()
    expect(paintGradient(context, 'radial-gradient(ellipse at 50% 0%, #fff, #000)', 350, 182)).toBe(
      true
    )
    expect(fills).toHaveLength(1)
    const fill = fills[0]
    if (!fill) throw new Error('Missing painted rectangle')
    expect(fill.transform.x).toBeCloseTo(175)
    expect(fill.transform.sx).toBeCloseTo(175 * Math.SQRT2)
    expect(fill.x * fill.transform.sx + fill.transform.x).toBeCloseTo(0)
    expect(fill.y * fill.transform.sy + fill.transform.y).toBeCloseTo(0)
    expect(fill.width * fill.transform.sx).toBeCloseTo(350)
    expect(fill.height * fill.transform.sy).toBeCloseTo(182)
  })

  it.each([
    { prelude: '', x: 100, y: 50, rx: 100 * Math.SQRT2, ry: 50 * Math.SQRT2 },
    { prelude: 'at top left, ', x: 0, y: 0, rx: 200 * Math.SQRT2, ry: 100 * Math.SQRT2 },
    { prelude: 'at bottom right, ', x: 200, y: 100, rx: 200 * Math.SQRT2, ry: 100 * Math.SQRT2 },
    { prelude: 'circle closest-side at 20px 30px, ', x: 20, y: 30, rx: 20, ry: 20 },
    { prelude: 'ellipse farthest-side at 25% 25%, ', x: 50, y: 25, rx: 150, ry: 75 },
    { prelude: 'ellipse 25% 50% at center, ', x: 100, y: 50, rx: 50, ry: 50 },
  ])('handles radial prelude $prelude', ({ prelude, x, y, rx, ry }) => {
    vi.stubGlobal('CSS', {
      supports: (_property: string, value: string) => /^#[\da-f]+$/i.test(value),
    })
    const { context, fills } = contextFixture()
    expect(paintGradient(context, `radial-gradient(${prelude}#fff, #000)`, 200, 100)).toBe(true)
    expect(fills).toHaveLength(1)
    expect(fills[0]?.transform.x).toBeCloseTo(x)
    expect(fills[0]?.transform.y).toBeCloseTo(y)
    expect(fills[0]?.transform.sx).toBeCloseTo(rx)
    expect(fills[0]?.transform.sy).toBeCloseTo(ry)
  })

  it.each([
    'radial-gradient(at unknown 0%, #fff, #000)',
    'radial-gradient(square at center, #fff, #000)',
    'radial-gradient(ellipse 0px 20px at center, #fff, #000)',
    'radial-gradient(circle 25% at center, #fff, #000)',
    'radial-gradient(ellipse closest-side at top, #fff, #000)',
  ])('returns unsupported instead of silently painting invalid or degenerate %s', (gradient) => {
    vi.stubGlobal('CSS', {
      supports: (_property: string, value: string) => /^#[\da-f]+$/i.test(value),
    })
    const { context, fills } = contextFixture()
    expect(paintGradient(context, gradient, 200, 100)).toBe(false)
    expect(fills).toHaveLength(0)
  })
})
