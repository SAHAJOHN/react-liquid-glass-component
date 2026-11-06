import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintBackdropMask } from '../scene/backdrop-mask'
import * as box from '../scene/paint-box'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof box>()),
  paintGradient: vi.fn(() => true),
}))

const gradient =
  'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 50%, rgba(0, 0, 0, 0) 100%)'
const defaults: Record<string, string> = {
  'mask-image': gradient,
  '-webkit-mask-image': gradient,
  'mask-mode': 'match-source',
  'mask-position': '0% 0%',
  '-webkit-mask-position': '0% 0%',
  'mask-size': 'auto',
  '-webkit-mask-size': 'auto',
  'mask-repeat': 'repeat',
  '-webkit-mask-repeat': 'repeat',
  'mask-origin': 'border-box',
  '-webkit-mask-origin': 'border-box',
  'mask-clip': 'border-box',
  '-webkit-mask-clip': 'border-box',
  'mask-composite': 'add',
  '-webkit-mask-composite': 'source-over',
}

function fixture(overrides: Record<string, string> = {}) {
  const values = { ...defaults, ...overrides }
  const style = document.createElement('div').style
  vi.spyOn(style, 'getPropertyValue').mockImplementation((name) => values[name] ?? '')
  const context = { setTransform: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  vi.stubGlobal('CSS', {
    supports: (_type: string, color: string) => /^(?:rgba?\(.*\)|black|transparent)$/.test(color),
  })
  return { style, context }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('backdrop alpha mask', () => {
  it('paints a single default alpha gradient at the requested resolution', () => {
    const { style, context } = fixture()
    const canvas = paintBackdropMask(style, 100, 40, 2)
    expect(canvas).toMatchObject({ width: 200, height: 80 })
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(box.paintGradient).toHaveBeenCalledWith(context, gradient, 100, 40)
  })

  it('accepts explicit alpha, full-size mask, and Chromium composite aliases', () => {
    const { style } = fixture({
      'mask-mode': 'alpha',
      'mask-size': '100% 100%',
      '-webkit-mask-size': '100% 100%',
      'mask-repeat': 'no-repeat',
      '-webkit-mask-repeat': 'no-repeat',
      '-webkit-mask-composite': 'add',
    })
    expect(paintBackdropMask(style, 100, 40, 1)).not.toBeNull()
  })

  it.each([
    ['mask-mode', 'luminance'],
    ['mask-position', '10% 0%'],
    ['-webkit-mask-position', '5px 0px'],
    ['mask-size', '50% 100%'],
    ['mask-repeat', 'space'],
    ['mask-origin', 'content-box'],
    ['mask-clip', 'padding-box'],
    ['mask-composite', 'intersect'],
    ['-webkit-mask-composite', 'xor'],
    ['mask-border-source', 'url(example.png)'],
    ['-webkit-mask-box-image-source', 'url(example.png)'],
    ['-webkit-mask-image', 'linear-gradient(black, transparent)'],
  ])('rejects unsupported %s = %s', (property, value) => {
    const { style } = fixture({ [property]: value })
    expect(paintBackdropMask(style, 100, 40, 1)).toBeNull()
  })

  it.each([
    'radial-gradient(black, transparent)',
    'linear-gradient(black, transparent), linear-gradient(black, transparent)',
    'linear-gradient(black -20%, transparent 100%)',
    'linear-gradient(black 0%, transparent 120%)',
    'linear-gradient(black 20px, transparent 100%)',
    'linear-gradient(black 0%, 30%, transparent 100%)',
    'linear-gradient(to left right, black, transparent)',
  ])('rejects gradient it cannot paint reliably: %s', (value) => {
    const { style } = fixture({ 'mask-image': value, '-webkit-mask-image': value })
    expect(paintBackdropMask(style, 100, 40, 1)).toBeNull()
  })

  it('rejects unsafe dimensions and unsupported gradients', () => {
    const { style } = fixture()
    expect(paintBackdropMask(style, 0, 10, 1)).toBeNull()
    expect(paintBackdropMask(style, Infinity, 10, 1)).toBeNull()
    expect(paintBackdropMask(style, 10000, 10, 1)).toBeNull()
    vi.mocked(box.paintGradient).mockReturnValueOnce(false)
    expect(paintBackdropMask(style, 100, 40, 1)).toBeNull()
  })

  it.each([
    'linear-gradient(currentcolor, transparent)',
    'linear-gradient(var(--color), transparent)',
    'linear-gradient(rgba(var(--red), 0, 0, 0.5), transparent)',
  ])(
    'rejects unresolved context-dependent colors even if CSS.supports accepts them: %s',
    (value) => {
      const { style } = fixture({ 'mask-image': value, '-webkit-mask-image': value })
      vi.stubGlobal('CSS', { supports: () => true })
      expect(paintBackdropMask(style, 100, 40, 1)).toBeNull()
    }
  )
})
