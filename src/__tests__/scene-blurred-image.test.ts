import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlurredImageSource } from '../scene/blurred-image'

afterEach(() => vi.restoreAllMocks())

describe('bounded blurred image source', () => {
  it('adds a transparent halo around an origin-clean source bitmap', () => {
    const bitmap = document.createElement('canvas')
    bitmap.width = 100
    bitmap.height = 80
    const encode = vi.spyOn(bitmap, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')

    const result = createBlurredImageSource(bitmap, 100, 80, 12)
    expect(result).toMatchObject({ width: 176, height: 156, insetX: 38, insetY: 38 })
    expect(encode).toHaveBeenCalledOnce()
    const svg = decodeURIComponent(result?.source.split(',')[1] ?? '')
    expect(svg).toContain('<feGaussianBlur stdDeviation="12 12"/>')
    expect(svg).toContain('x="38" y="38" width="100" height="80"')
    expect(svg).toContain('href="data:image/png;base64,AA=="')
    expect(svg).toContain('color-interpolation-filters="sRGB"')
  })

  it('accounts for backing resolution independently on each axis', () => {
    const bitmap = document.createElement('canvas')
    bitmap.width = 200
    bitmap.height = 80
    vi.spyOn(bitmap, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')
    const result = createBlurredImageSource(bitmap, 100, 80, 12)
    expect(result).toMatchObject({ width: 174, height: 156, insetX: 37, insetY: 38 })
    expect(decodeURIComponent(result?.source.split(',')[1] ?? '')).toContain(
      '<feGaussianBlur stdDeviation="24 12"/>'
    )
  })

  it.each([
    [0, 80, 12],
    [100, 0, 12],
    [100, 80, 0],
    [100, 80, -1],
    [100, 80, 65],
    [NaN, 80, 12],
    [100, Infinity, 12],
  ])('rejects invalid logical geometry %s %s %s', (width, height, radius) => {
    const bitmap = document.createElement('canvas')
    const encode = vi.spyOn(bitmap, 'toDataURL')
    expect(createBlurredImageSource(bitmap, width, height, radius)).toBeNull()
    expect(encode).not.toHaveBeenCalled()
  })

  it('rejects empty, oversized, or halo-expanded bitmaps before encoding', () => {
    const bitmap = document.createElement('canvas')
    const encode = vi.spyOn(bitmap, 'toDataURL')
    bitmap.width = 0
    expect(createBlurredImageSource(bitmap, 100, 80, 12)).toBeNull()
    bitmap.width = 4097
    expect(createBlurredImageSource(bitmap, 100, 80, 12)).toBeNull()
    bitmap.width = 1400
    bitmap.height = 1400
    expect(createBlurredImageSource(bitmap, 1400, 1400, 12)).toBeNull()
    expect(encode).not.toHaveBeenCalled()
  })

  it('fails closed for a tainted bitmap', () => {
    const bitmap = document.createElement('canvas')
    vi.spyOn(bitmap, 'toDataURL').mockImplementation(() => {
      throw new DOMException('Tainted canvas', 'SecurityError')
    })
    expect(createBlurredImageSource(bitmap, 100, 80, 12)).toBeNull()
  })

  it.each([
    'data:,',
    'data:image/jpeg;base64,AA==',
    'data:image/png;base64,AA"/><script>alert(1)</script>',
  ])('rejects malformed or unsafe bitmap encoding', (encoded) => {
    const bitmap = document.createElement('canvas')
    vi.spyOn(bitmap, 'toDataURL').mockReturnValue(encoded)
    expect(createBlurredImageSource(bitmap, 100, 80, 12)).toBeNull()
  })
})
