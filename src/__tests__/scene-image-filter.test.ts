import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectImageFilter, paintImageFilter } from '../scene/image-filter'

afterEach(() => vi.restoreAllMocks())

describe('bounded image color filtering', () => {
  it.each([
    'brightness(0) invert(1)',
    '  brightness(0%)   invert(100%)  ',
    'BRIGHTNESS(+0.0) INVERT(1.00)',
  ])('recognizes the supported chain: %s', (value) => {
    expect(inspectImageFilter(value)).toBe('brightness(0) invert(1)')
  })

  it.each([
    'none',
    'brightness(0)',
    'invert(1)',
    'invert(1) brightness(0)',
    'brightness(0) invert(0.5)',
    'brightness(0) invert(1) blur(1px)',
    'brightness(0) invert(1) url(#filter)',
    'brightness(NaN) invert(1)',
  ])('rejects a different or unbounded filter: %s', (value) => {
    expect(inspectImageFilter(value)).toBeNull()
  })

  it('filters a same-sized raster without reading its pixels', () => {
    const source = document.createElement('canvas')
    source.width = 20
    source.height = 12
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => {
      throw new Error('origin-tainted')
    })
    const fillRect = vi.fn()
    const context = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      drawImage,
      fillRect,
      getImageData,
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )

    const output = paintImageFilter(source, 'brightness(0) invert(1)')
    expect(output).not.toBe(source)
    expect(output?.width).toBe(20)
    expect(output?.height).toBe(12)
    expect(context.globalCompositeOperation).toBe('source-in')
    expect(context.fillStyle).toBe('#fff')
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0)
    expect(fillRect).toHaveBeenCalledWith(0, 0, 20, 12)
    expect(getImageData).not.toHaveBeenCalled()
  })

  it('fails closed if compositing is unavailable', () => {
    const source = document.createElement('canvas')
    const drawImage = vi.fn()
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
    const ignored = {
      drawImage,
      get globalCompositeOperation() {
        return 'source-over'
      },
      set globalCompositeOperation(_value: string) {},
    }
    context.mockReturnValue(ignored as unknown as CanvasRenderingContext2D)
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('rejects empty and oversized input and handles drawing failures', () => {
    const source = document.createElement('canvas')
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    source.width = 0
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
    source.width = 4097
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
    source.width = 2000
    source.height = 1001
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
    expect(context).not.toHaveBeenCalled()
    source.width = 10
    source.height = 10
    context.mockReturnValue({
      globalCompositeOperation: 'source-over',
      drawImage: () => {
        throw new Error('draw failed')
      },
    } as unknown as CanvasRenderingContext2D)
    expect(paintImageFilter(source, 'brightness(0) invert(1)')).toBeNull()
  })
})
