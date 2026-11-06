import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintSubtreeMask } from '../scene/subtree-mask'

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const stops: Array<[number, string]> = []
  const gradient = {
    addColorStop: vi.fn((offset: number, color: string) => stops.push([offset, color])),
  }
  const context = {
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    fillStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  const style = document.createElement('div').style
  Object.defineProperty(style, 'maskImage', { value: '', writable: true, configurable: true })
  return { style, stops, context }
}

describe('subtree gradient mask', () => {
  it('converts KA scroll fade stops to a compact alpha mask', () => {
    const { style, stops, context } = fixture()
    style.maskImage =
      'linear-gradient(to bottom, black 0px, black calc(100% - 24px), transparent 100%)'
    const bitmap = paintSubtreeMask(style, 680, 600, 2)
    expect(bitmap?.width).toBe(1)
    expect(bitmap?.height).toBe(1200)
    expect(context.createLinearGradient).toHaveBeenCalledWith(0, 0, 0, 1200)
    expect(stops).toEqual([
      [0, 'rgba(0, 0, 0, 1)'],
      [0.96, 'rgba(0, 0, 0, 1)'],
      [1, 'rgba(0, 0, 0, 0)'],
    ])
  })

  it('handles computed RGB colors and a horizontal fade', () => {
    const { style, stops } = fixture()
    style.maskImage =
      'linear-gradient(to right, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 24px, rgb(0, 0, 0) 100%)'
    const bitmap = paintSubtreeMask(style, 240, 60, 1)
    expect(bitmap?.width).toBe(240)
    expect(bitmap?.height).toBe(1)
    expect(stops).toEqual([
      [0, 'rgba(0, 0, 0, 0)'],
      [0.1, 'rgba(0, 0, 0, 1)'],
      [1, 'rgba(0, 0, 0, 1)'],
    ])
  })

  it.each([
    'linear-gradient(to bottom, black 0px, transparent calc(100% - 900px))',
    'linear-gradient(to bottom, black 0px, transparent 50%, black 25%)',
    'linear-gradient(45deg, black 0%, transparent 100%)',
    'linear-gradient(to bottom, black 0%, red 100%)',
    'linear-gradient(to bottom, black 0%, transparent 100%), linear-gradient(to bottom, black 0%, transparent 100%)',
  ])('rejects unsupported or ambiguous masks: %s', (value) => {
    const { style } = fixture()
    style.maskImage = value
    expect(paintSubtreeMask(style, 680, 600, 2)).toBeNull()
  })
})

describe('intersecting subtree gradient masks', () => {
  const horizontal =
    'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 24px, rgb(0, 0, 0) calc(100% - 24px), rgba(0, 0, 0, 0) 100%)'
  const vertical = 'linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 20%, rgba(0, 0, 0, 0) 100%)'
  function intersectionFixture(properties: Record<string, string> = {}) {
    const result = fixture()
    const image = `${horizontal}, ${vertical}`
    result.style.maskImage = image
    const values: Record<string, string> = {
      'mask-image': image,
      '-webkit-mask-image': image,
      'mask-mode': 'match-source, match-source',
      'mask-size': 'auto, auto',
      '-webkit-mask-size': 'auto, auto',
      'mask-position': '0% 0%, 0% 0%',
      '-webkit-mask-position': '0% 0%, 0% 0%',
      'mask-repeat': 'repeat, repeat',
      '-webkit-mask-repeat': 'repeat, repeat',
      'mask-origin': 'border-box, border-box',
      '-webkit-mask-origin': 'border-box, border-box',
      'mask-clip': 'border-box, border-box',
      '-webkit-mask-clip': 'border-box, border-box',
      'mask-composite': 'intersect, intersect',
      '-webkit-mask-composite': 'source-in, source-in',
      ...properties,
    }
    vi.spyOn(result.style, 'getPropertyValue').mockImplementation((name) => values[name] ?? '')
    return result
  }

  it('intersects horizontal and vertical alpha gradients in one bounded bitmap', () => {
    const { style, context } = intersectionFixture()
    const operations: string[] = []
    let operation = ''
    Object.defineProperty(context, 'globalCompositeOperation', {
      set(value: string) {
        operation = value
      },
      get() {
        return operation
      },
    })
    context.fillRect.mockImplementation(() => operations.push(operation))
    const bitmap = paintSubtreeMask(style, 366, 100, 2)
    expect(bitmap?.width).toBe(732)
    expect(bitmap?.height).toBe(200)
    expect(context.createLinearGradient.mock.calls).toEqual([
      [0, 0, 732, 0],
      [0, 0, 0, 200],
    ])
    expect(operations).toEqual(['source-over', 'destination-in'])
    expect(context.fillRect).toHaveBeenCalledTimes(2)
  })

  it('accepts the Chromium prefixed alias when it matches the standard composite', () => {
    const { style } = intersectionFixture({
      'mask-composite': 'intersect, intersect',
      '-webkit-mask-composite': 'intersect, intersect',
    })
    expect(paintSubtreeMask(style, 366, 100, 1)).not.toBeNull()
  })

  it('accepts an ignored default composite on the last mask layer', () => {
    const { style } = intersectionFixture({
      'mask-composite': 'intersect, add',
      '-webkit-mask-composite': 'source-in, source-over',
    })
    expect(paintSubtreeMask(style, 366, 100, 1)).not.toBeNull()
  })

  it.each([
    { 'mask-composite': 'add, add' },
    { '-webkit-mask-composite': 'source-over, source-over' },
    { 'mask-composite': '', '-webkit-mask-composite': 'intersect, intersect' },
    { 'mask-composite': 'intersect, intersect', '-webkit-mask-composite': 'intersect, add' },
    { 'mask-composite': 'intersect, add', '-webkit-mask-composite': 'intersect, intersect' },
    { 'mask-composite': '', '-webkit-mask-composite': '' },
    { 'mask-mode': 'alpha, luminance' },
    { 'mask-size': 'auto, 50% 50%' },
    { 'mask-origin': 'border-box, content-box' },
    { 'mask-composite': 'intersect, intersect, intersect' },
  ])('rejects incompatible layer properties: %o', (properties) => {
    const { style } = intersectionFixture(properties)
    expect(paintSubtreeMask(style, 366, 100, 1)).toBeNull()
  })

  it('rejects masks larger than the bounded combined bitmap', () => {
    const { style } = intersectionFixture()
    expect(paintSubtreeMask(style, 2001, 1000, 1)).toBeNull()
    expect(paintSubtreeMask(style, 1000, 500, 2)).not.toBeNull()
  })

  it('rejects parallel gradients and mismatched prefixed images', () => {
    const { style } = intersectionFixture({
      'mask-image': `${horizontal}, ${horizontal}`,
      '-webkit-mask-image': `${horizontal}, ${horizontal}`,
    })
    expect(paintSubtreeMask(style, 366, 100, 1)).toBeNull()
    vi.mocked(style.getPropertyValue).mockImplementation((name) =>
      name === 'mask-image'
        ? `${horizontal}, ${vertical}`
        : name === '-webkit-mask-image'
          ? horizontal
          : ''
    )
    expect(paintSubtreeMask(style, 366, 100, 1)).toBeNull()
  })
})
