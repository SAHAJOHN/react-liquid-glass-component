import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeBorderSource, paintNativeBorder } from '../scene/native-border'

function style() {
  const result = document.createElement('div').style
  result.backgroundImage = 'none'
  result.backgroundClip = 'border-box'
  result.backgroundColor = 'rgb(255, 233, 227)'
  result.borderTopWidth = '0px'
  result.borderRightWidth = '0px'
  result.borderLeftWidth = '0px'
  result.borderTopStyle = 'solid'
  result.borderRightStyle = 'solid'
  result.borderLeftStyle = 'solid'
  result.borderTopColor = 'rgb(229, 237, 239)'
  result.borderRightColor = 'rgb(229, 237, 239)'
  result.borderLeftColor = 'rgb(229, 237, 239)'
  result.borderBottomWidth = '1px'
  result.borderBottomStyle = 'solid'
  result.borderBottomColor = 'rgb(229, 237, 239)'
  result.borderTopLeftRadius = '12px'
  result.borderTopRightRadius = '12px'
  result.borderBottomRightRadius = '12px'
  result.borderBottomLeftRadius = '12px'
  return result
}

function image(width: number, height: number) {
  const result = document.createElement('img')
  Object.defineProperty(result, 'naturalWidth', { value: width })
  Object.defineProperty(result, 'naturalHeight', { value: height })
  return result
}

function pixel(rgba: number[]) {
  return { data: new Uint8ClampedArray(rgba) } as ImageData
}

afterEach(() => vi.restoreAllMocks())

describe('native rounded bottom border source', () => {
  it('emits only normalized colors and geometry with a sentinel outside the target', () => {
    const result = createNativeBorderSource(style(), 218, 50, 1.5)
    expect(result).not.toBeNull()
    if (!result) throw new Error('Expected a supported box')
    expect(result.sentinelX).toBe(222)
    expect(result.sourceWidth).toBe(242)
    const svg = decodeURIComponent(result.source.split(',')[1] ?? '')
    expect(svg).toContain('width:218px;height:50px')
    expect(svg).toContain('border-top:0px solid rgba(229,237,239,1)')
    expect(svg).toContain('border-right:0px solid rgba(229,237,239,1)')
    expect(svg).toContain('border-bottom:1px solid rgba(229,237,239,1)')
    expect(svg).toContain('border-left:0px solid rgba(229,237,239,1)')
    expect(svg).toContain('background:rgba(255,233,227,1)')
    expect(svg).toContain('<foreignObject x="222" y="2"')
    expect(svg).not.toContain('<script')
  })

  it('preserves distinct zero-width side styles and colors', () => {
    const input = style()
    input.borderTopColor = 'rgb(25, 60, 90)'
    input.borderRightStyle = 'dashed'
    input.borderRightColor = 'transparent'
    input.borderLeftStyle = 'dotted'
    input.borderLeftColor = 'rgb(5, 6, 7)'
    const result = createNativeBorderSource(input, 218, 49, 1)
    if (!result) throw new Error('Expected supported sides')
    const svg = decodeURIComponent(result.source.split(',')[1] ?? '')
    expect(svg).toContain('border-top:0px solid rgba(25,60,90,1)')
    expect(svg).toContain('border-right:0px dashed rgba(0,0,0,0)')
    expect(svg).toContain('border-left:0px dotted rgba(5,6,7,1)')
  })

  it('rejects unrecognized side styles and colors', () => {
    const badStyle = style()
    Object.defineProperty(badStyle, 'borderTopStyle', { value: 'solid;position:fixed' })
    expect(createNativeBorderSource(badStyle, 218, 49, 1)).toBeNull()
    const badColor = style()
    Object.defineProperty(badColor, 'borderLeftColor', { value: 'var(--untrusted)' })
    expect(createNativeBorderSource(badColor, 218, 49, 1)).toBeNull()
  })

  it('accepts a transparent background', () => {
    const input = style()
    input.backgroundColor = 'transparent'
    expect(createNativeBorderSource(input, 218, 49, 1)?.background).toEqual([0, 0, 0, 0])
  })

  it('permits only CSS fractions aligned to device pixels and ignores tiny layout noise', () => {
    expect(createNativeBorderSource(style(), 218.5, 49.5, 2)).not.toBeNull()
    const near = createNativeBorderSource(style(), 218 + 1e-7, 50, 1.5)
    expect(near?.width).toBe(218)
    expect(createNativeBorderSource(style(), 218.25, 49.5, 1)).toBeNull()
    expect(createNativeBorderSource(style(), 218, 49, 1.5)).toBeNull()
  })

  it('rejects device-aligned boxes when sentinel edges do not align', () => {
    // 220 and 50 both map to integral pixels at 1.1x, but the sentinel does not.
    expect(createNativeBorderSource(style(), 220, 50, 1.1)).toBeNull()
  })

  it.each([
    [
      'background image',
      (input: CSSStyleDeclaration) => (input.backgroundImage = 'linear-gradient(red, blue)'),
    ],
    ['background clip', (input: CSSStyleDeclaration) => (input.backgroundClip = 'padding-box')],
    ['other border', (input: CSSStyleDeclaration) => (input.borderLeftWidth = '1px')],
    ['border thickness', (input: CSSStyleDeclaration) => (input.borderBottomWidth = '2px')],
    ['border style', (input: CSSStyleDeclaration) => (input.borderBottomStyle = 'dashed')],
    [
      'translucent border',
      (input: CSSStyleDeclaration) => (input.borderBottomColor = 'rgba(1,2,3,0.5)'),
    ],
    ['unequal corners', (input: CSSStyleDeclaration) => (input.borderTopLeftRadius = '3px')],
    ['relative radius', (input: CSSStyleDeclaration) => (input.borderTopLeftRadius = '20%')],
    [
      'border image',
      (input: CSSStyleDeclaration) =>
        (input.borderImageSource = 'url(https://example.com/image.png)'),
    ],
  ])('rejects unsupported %s', (_name, mutate) => {
    const input = style()
    mutate(input)
    expect(createNativeBorderSource(input, 218, 49, 1)).toBeNull()
  })

  it.each([
    [Number.NaN, 49, 1],
    [218, Number.POSITIVE_INFINITY, 1],
    [0, 49, 1],
    [218, 49, 0.2],
    [218, 49, 3],
    [8000, 49, 1],
    [218, 10, 1],
  ])('rejects invalid or oversized geometry %s x %s at %s', (width, height, ratio) => {
    expect(createNativeBorderSource(style(), width, height, ratio)).toBeNull()
  })
})

describe('native rounded bottom border verification', () => {
  function setup() {
    const spec = createNativeBorderSource(style(), 218, 50, 1.5)
    if (!spec) throw new Error('Expected a supported box')
    const scratch = {
      drawImage: vi.fn(),
      getImageData: vi
        .fn()
        .mockReturnValueOnce(pixel([12, 228, 76, 255]))
        .mockReturnValueOnce(pixel([232, 40, 20, 255]))
        .mockReturnValueOnce(pixel([255, 233, 227, 255]))
        .mockReturnValueOnce(pixel([229, 237, 239, 255])),
    }
    const output = { drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce(scratch as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce(output as unknown as CanvasRenderingContext2D)
    return { spec, scratch, output, image: image(spec.sourceWidth, spec.sourceHeight) }
  }

  it('validates the XHTML background and border then crops out the sentinel', () => {
    const { spec, scratch, output, image: source } = setup()
    const result = paintNativeBorder(source, spec)
    expect(result).not.toBeNull()
    expect(result?.width).toBe(327)
    expect(result?.height).toBe(75)
    expect(scratch.drawImage).toHaveBeenCalledWith(source, 0, 0, 363, 75)
    expect(scratch.getImageData).toHaveBeenCalledTimes(4)
    expect(output.drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0)
  })

  it('rejects an SVG that decodes at an unexpected size', () => {
    const { spec, scratch } = setup()
    expect(paintNativeBorder(image(1, 1), spec)).toBeNull()
    expect(scratch.drawImage).not.toHaveBeenCalled()
  })

  it('rejects a blank foreignObject even if the SVG decoded', () => {
    const { spec, scratch, image: source } = setup()
    scratch.getImageData.mockReset().mockReturnValue(pixel([0, 0, 0, 0]))
    expect(paintNativeBorder(source, spec)).toBeNull()
  })

  it('rejects a sentinel with missing border paint', () => {
    const { spec, scratch, image: source } = setup()
    scratch.getImageData
      .mockReset()
      .mockReturnValueOnce(pixel([12, 228, 76, 255]))
      .mockReturnValueOnce(pixel([12, 228, 76, 255]))
    expect(paintNativeBorder(source, spec)).toBeNull()
  })

  it('rejects origin-tainted or unreadable canvases', () => {
    const { spec, scratch, image: source } = setup()
    scratch.getImageData.mockReset().mockImplementation(() => {
      throw new DOMException('tainted', 'SecurityError')
    })
    expect(paintNativeBorder(source, spec)).toBeNull()
  })

  it('rejects a decoded sentinel if the actual box is blank', () => {
    const { spec, scratch, image: source } = setup()
    scratch.getImageData
      .mockReset()
      .mockReturnValueOnce(pixel([12, 228, 76, 255]))
      .mockReturnValueOnce(pixel([232, 40, 20, 255]))
      .mockReturnValueOnce(pixel([0, 0, 0, 0]))
    expect(paintNativeBorder(source, spec)).toBeNull()
  })

  it('rejects a missing visible border even when the background rendered', () => {
    const { spec, scratch, image: source } = setup()
    scratch.getImageData
      .mockReset()
      .mockReturnValueOnce(pixel([12, 228, 76, 255]))
      .mockReturnValueOnce(pixel([232, 40, 20, 255]))
      .mockReturnValueOnce(pixel([255, 233, 227, 255]))
      .mockReturnValueOnce(pixel([255, 233, 227, 255]))
    expect(paintNativeBorder(source, spec)).toBeNull()
  })
})
