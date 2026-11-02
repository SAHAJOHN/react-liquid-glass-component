import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitEllipsis, graphemes, paintEllipsis } from '../scene/paint-ellipsis'

describe('ellipsis text fitting', () => {
  it('keeps text unchanged when it fits', () => {
    expect(fitEllipsis('hello', 10, (text) => text.length)).toBe('hello')
  })

  it('reserves width for the ellipsis', () => {
    expect(fitEllipsis('hello world', 6, (text) => text.length)).toBe('hello…')
  })

  it('does not split Thai combining marks or emoji sequences', () => {
    const parts = graphemes('ก้👩‍💻xy')
    expect(parts).toEqual(['ก้', '👩‍💻', 'x', 'y'])
    expect(fitEllipsis('ก้👩‍💻xy', 3, (text) => graphemes(text)?.length ?? Infinity)).toBe('ก้👩‍💻…')
  })

  it('fails closed if even the ellipsis cannot fit', () => {
    expect(fitEllipsis('overflow', 0.5, (text) => text.length)).toBeNull()
  })
})

describe('ellipsis sprite cache', () => {
  const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  afterEach(() => {
    vi.restoreAllMocks()
    if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor)
    else Reflect.deleteProperty(document, 'fonts')
    document.body.replaceChildren()
  })

  it('reuses a raster on scroll but invalidates it for text, style, size, DPR and font loads', () => {
    const fonts = Object.assign(new EventTarget(), { status: 'loaded', check: () => true })
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
    const element = document.createElement('div')
    element.style.cssText =
      'visibility:visible;direction:ltr;writing-mode:horizontal-tb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:rgb(0, 0, 0);font-size:16px;font-family:sans-serif;font-style:normal;font-weight:400'
    element.style.overflowX = 'hidden'
    element.textContent = 'overflowing text'
    let width = 8
    let offset = 0
    Object.defineProperties(element, {
      scrollWidth: { get: () => 100 },
      clientWidth: { get: () => width },
      clientHeight: { get: () => 20 },
      innerText: { get: () => (element.textContent ?? '').replace(/[\t\n\f\r ]+/g, ' ').trim() },
    })
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(10, 20 + offset, width, 20)
    )
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange()
      range.getBoundingClientRect = () => new DOMRect(10, 20 + offset, 100, 20)
      return range
    })
    const context = {
      scale: vi.fn(),
      measureText: (text: string) => ({
        width: text.length,
        fontBoundingBoxAscent: 12,
      }),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
    }
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    document.body.append(element)
    const first = paintEllipsis(element, 1)
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') return
    offset = -5
    const scrolled = paintEllipsis(element, 1)
    expect(scrolled.status).toBe('ready')
    if (scrolled.status !== 'ready') return
    expect(scrolled.bitmap).toBe(first.bitmap)
    expect(scrolled.rect.y).toBe(first.rect.y - 5)
    expect(getContext).toHaveBeenCalledTimes(1)

    element.textContent = 'different overflowing text'
    paintEllipsis(element, 1)
    element.style.color = 'red'
    paintEllipsis(element, 1)
    width = 7
    paintEllipsis(element, 1)
    paintEllipsis(element, 2)
    fonts.dispatchEvent(new Event('loadingdone'))
    paintEllipsis(element, 2)
    expect(getContext).toHaveBeenCalledTimes(6)

    element.style.whiteSpace = 'normal'
    expect(paintEllipsis(element, 2).status).toBe('unsupported')
    expect(getContext).toHaveBeenCalledTimes(6)
  })

  it('paints text separated by comments and collapses browser-normalized whitespace', () => {
    const element = document.createElement('div')
    element.style.cssText =
      'visibility:visible;direction:ltr;writing-mode:horizontal-tb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:black;font-size:16px;font-family:sans-serif;font-style:normal;font-weight:400'
    element.style.overflowX = 'hidden'
    element.append('18 มิ.ย. 2569', document.createComment(''), ' ถึง   31 ก.ค. 2569')
    Object.defineProperties(element, {
      scrollWidth: { value: 100 },
      clientWidth: { value: 16 },
      clientHeight: { value: 20 },
      innerText: { value: '18 มิ.ย. 2569 ถึง 31 ก.ค. 2569' },
    })
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 16, 20))
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange()
      range.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20)
      return range
    })
    const context = {
      scale: vi.fn(),
      measureText: (text: string) => ({ width: text.length, fontBoundingBoxAscent: 12 }),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )
    document.body.append(element)
    const result = paintEllipsis(element, 1)
    if (result.status === 'unsupported') throw new Error(result.reason)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.text).toBe('18 มิ.ย. 2569 …')
      expect(context.fillText).toHaveBeenCalledWith(result.text, 0, 12)
    }
    element.replaceChildren('Visual A', document.createComment(''), 'V and many more letters')
    expect(paintEllipsis(element, 1)).toEqual({
      status: 'unsupported',
      reason: 'Adjacent text runs require native HTML rendering',
    })
  })

  it('accepts an unused unloaded fallback only when DOM and canvas font metrics agree', () => {
    const fonts = Object.assign(new EventTarget(), { status: 'loaded', check: () => false })
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
    const element = document.createElement('div')
    element.style.cssText =
      'visibility:visible;direction:ltr;writing-mode:horizontal-tb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:black;font-size:16px;font-family:sans-serif;font-style:normal;font-weight:400'
    element.style.overflowX = 'hidden'
    element.textContent = 'overflowing text'
    Object.defineProperties(element, {
      scrollWidth: { value: 100 },
      clientWidth: { value: 8 },
      clientHeight: { value: 20 },
      innerText: { get: () => element.textContent },
    })
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 8, 20))
    let nativeWidth = 16
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange()
      range.getBoundingClientRect = () => new DOMRect(10, 20, nativeWidth, 20)
      return range
    })
    let loadOnMeasure = false
    const context = {
      scale: vi.fn(),
      measureText: (text: string) => {
        if (loadOnMeasure) fonts.status = 'loading'
        return { width: text.length, fontBoundingBoxAscent: 12 }
      },
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )
    document.body.append(element)
    expect(paintEllipsis(element, 1).status).toBe('ready')
    nativeWidth = 30
    expect(paintEllipsis(element, 1)).toEqual({
      status: 'unsupported',
      reason: 'Ellipsis font is not ready',
    })
    nativeWidth = 16
    fonts.status = 'loading'
    fonts.dispatchEvent(new Event('loading'))
    expect(paintEllipsis(element, 1).status).toBe('unsupported')
    fonts.status = 'loaded'
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(paintEllipsis(element, 1).status).toBe('ready')
    fonts.dispatchEvent(new Event('loadingdone'))
    loadOnMeasure = true
    expect(paintEllipsis(element, 1).status).toBe('unsupported')
    loadOnMeasure = false
    fonts.status = 'loaded'
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(paintEllipsis(element, 1).status).toBe('ready')
  })
})

describe('ellipsis safety checks', () => {
  it('does not attempt painting elements that do not overflow', async () => {
    const { paintEllipsis } = await import('../scene/paint-ellipsis')
    const element = document.createElement('div')
    element.style.textOverflow = 'ellipsis'
    element.textContent = 'short'
    expect(paintEllipsis(element, 2)).toEqual({ status: 'none' })
  })

  it('refuses nested content instead of revealing hidden text', async () => {
    const { paintEllipsis } = await import('../scene/paint-ellipsis')
    const element = document.createElement('div')
    element.style.cssText =
      'visibility:visible;direction:ltr;writing-mode:horizontal-tb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left'
    element.style.overflowX = 'hidden'
    element.innerHTML = 'visible <span>hidden text</span>'
    Object.defineProperties(element, {
      scrollWidth: { value: 300 },
      clientWidth: { value: 100 },
    })
    document.body.append(element)
    try {
      expect(paintEllipsis(element, 2)).toEqual({
        status: 'unsupported',
        reason: 'Nested ellipsis content requires native HTML rendering',
      })
    } finally {
      element.remove()
    }
  })

  it('rejects non-finite dimensions from a measurement callback', () => {
    expect(fitEllipsis('overflow', NaN, (text) => text.length)).toBeNull()
    expect(fitEllipsis('overflow', 5, () => NaN)).toBeNull()
  })
})
