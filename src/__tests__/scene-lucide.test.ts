import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paintLucide } from '../scene/paint-lucide'

const SVG = 'http://www.w3.org/2000/svg'

function fixture() {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'lucide lucide-test')
  svg.setAttribute('viewBox', '0 0 24 24')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'M4 5h16')
  svg.append(path)
  const defaults: Record<string, string> = {
    display: 'inline',
    visibility: 'visible',
    opacity: '1',
    fill: 'none',
    stroke: 'rgb(18, 52, 86)',
    strokeOpacity: '1',
    strokeWidth: '2px',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeDasharray: 'none',
    strokeDashoffset: '0px',
    vectorEffect: 'none',
    paintOrder: 'normal',
    shapeRendering: 'auto',
    transform: 'none',
    rotate: 'none',
    scale: 'none',
    translate: 'none',
    perspective: 'none',
    filter: 'none',
    backdropFilter: 'none',
    clipPath: 'none',
    maskImage: 'none',
    mixBlendMode: 'normal',
    outlineStyle: 'none',
    boxShadow: 'none',
    textShadow: 'none',
    overflowX: 'hidden',
    overflowY: 'hidden',
    objectFit: 'fill',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
  }
  const rootValues = { ...defaults }
  const childValues = { ...defaults }
  const properties: Record<string, string> = {}
  const readStyle = (values: Record<string, string>) =>
    new Proxy({} as CSSStyleDeclaration, {
      get(_target, name) {
        if (name === 'getPropertyValue') return (property: string) => properties[property] ?? ''
        return typeof name === 'string' ? (values[name] ?? '') : undefined
      },
    })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element) =>
    readStyle(element === svg ? rootValues : childValues)
  )
  return { svg, path, rootValues, childValues, properties }
}

describe('synchronous Lucide scene painting', () => {
  let stroke: ReturnType<typeof vi.fn>
  let constructed: string[]
  beforeEach(() => {
    constructed = []
    class FakePath {
      constructor(path?: string) {
        if (path) constructed.push(path)
      }
      arc() {}
      rect() {}
      roundRect() {}
      moveTo() {}
      lineTo() {}
    }
    vi.stubGlobal('Path2D', FakePath)
    stroke = vi.fn()
    const context = {
      scale: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      stroke,
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns the same bitmap when content and paint are unchanged and redraws for color or geometry', () => {
    const { svg, path, rootValues, childValues } = fixture()
    const first = paintLucide(svg, 24, 24, 2)
    const second = paintLucide(svg, 24, 24, 2)
    expect(first.status).toBe('ready')
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('SVG rejected')
    expect(second.bitmap).toBe(first.bitmap)
    expect(stroke).toHaveBeenCalledTimes(1)
    rootValues.stroke = childValues.stroke = 'rgb(0, 0, 0)'
    const recolored = paintLucide(svg, 24, 24, 2)
    expect(recolored.status).toBe('ready')
    if (recolored.status === 'ready') expect(recolored.bitmap).not.toBe(first.bitmap)
    path.setAttribute('d', 'M5 5h14')
    expect(paintLucide(svg, 24, 24, 2).status).toBe('ready')
    expect(constructed).toEqual(['M4 5h16', 'M4 5h16', 'M5 5h14'])
  })

  it('paints symmetric padding and circular clipping and invalidates the cache when either changes', () => {
    const { svg, rootValues } = fixture()
    const first = paintLucide(svg, 32, 32, 2)
    if (first.status !== 'ready') throw new Error('Plain SVG rejected')
    for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'])
      rootValues[key] = '4px'
    for (const key of [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ])
      rootValues[key] = '50%'
    const padded = paintLucide(svg, 32, 32, 2)
    const cached = paintLucide(svg, 32, 32, 2)
    expect(padded.status).toBe('ready')
    if (padded.status !== 'ready' || cached.status !== 'ready')
      throw new Error('Padded SVG rejected')
    expect(padded.bitmap).not.toBe(first.bitmap)
    expect(cached.bitmap).toBe(padded.bitmap)
    for (const key of [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ])
      rootValues[key] = '8px'
    const rerounded = paintLucide(svg, 32, 32, 2)
    expect(rerounded.status).toBe('ready')
    if (rerounded.status === 'ready') expect(rerounded.bitmap).not.toBe(padded.bitmap)
    rootValues.paddingLeft = '3px'
    expect(paintLucide(svg, 32, 32, 2).status).toBe('unsupported')
    rootValues.paddingLeft = '4px'
    rootValues.borderTopLeftRadius = '2px'
    expect(paintLucide(svg, 32, 32, 2).status).toBe('unsupported')
    for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'])
      rootValues[key] = '16px'
    expect(paintLucide(svg, 32, 32, 2).status).toBe('unsupported')
  })

  it('uses the browser-resolved CSS path rather than a stale d attribute', () => {
    const { svg, properties } = fixture()
    properties.d = 'path("M 3 3 L 18 18")'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('ready')
    expect(constructed).toEqual(['M 3 3 L 18 18'])
    properties.d = 'none'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
  })

  it('fails closed for unsupported geometry, filters, opacity and box sizing', () => {
    const { svg, path, rootValues, childValues } = fixture()
    rootValues.paddingTop = '1px'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    rootValues.paddingTop = '0px'
    childValues.filter = 'blur(1px)'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    childValues.filter = 'none'
    childValues.opacity = '0.5'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    childValues.opacity = '1'
    path.setAttribute('transform', 'scale(2)')
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    path.removeAttribute('transform')
    svg.append(document.createElementNS(SVG, 'foreignObject'))
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    expect(stroke).not.toHaveBeenCalled()
  })

  it('rejects incomplete viewport, unsupported fill, dash and clipped shapes', () => {
    const { svg, rootValues, childValues } = fixture()
    expect(paintLucide(svg, 24, 20, 1).status).toBe('unsupported')
    svg.setAttribute('viewBox', '0 0 48 48')
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    svg.setAttribute('viewBox', '0 0 24 24')
    rootValues.fill = 'rgb(0, 0, 0)'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    rootValues.fill = 'none'
    childValues.strokeDasharray = '2px, 2px'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    childValues.strokeDasharray = 'none'
    childValues.clipPath = 'inset(20%)'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    childValues.clipPath = 'none'
    rootValues.objectFit = 'contain'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    rootValues.objectFit = 'fill'
    rootValues.borderTopLeftRadius = '4px'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
    rootValues.borderTopLeftRadius = '0px'
    rootValues.stroke = childValues.stroke = 'rgba(0, 0, 0, 0.5)'
    expect(paintLucide(svg, 24, 24, 1).status).toBe('unsupported')
  })

  it('supports simple circle, rounded rect and line shapes but rejects CSS visibility and transforms', () => {
    const { svg, path, childValues } = fixture()
    path.remove()
    const circle = document.createElementNS(SVG, 'circle')
    circle.setAttribute('cx', '10')
    circle.setAttribute('cy', '8')
    circle.setAttribute('r', '5')
    const rect = document.createElementNS(SVG, 'rect')
    rect.setAttribute('x', '3')
    rect.setAttribute('y', '3')
    rect.setAttribute('width', '18')
    rect.setAttribute('height', '18')
    rect.setAttribute('rx', '2')
    const line = document.createElementNS(SVG, 'line')
    line.setAttribute('x1', '3')
    line.setAttribute('y1', '9')
    line.setAttribute('x2', '20')
    line.setAttribute('y2', '9')
    svg.append(circle, rect, line)
    expect(paintLucide(svg, 24, 24, 2).status).toBe('ready')
    expect(stroke).toHaveBeenCalledTimes(3)
    childValues.visibility = 'hidden'
    expect(paintLucide(svg, 24, 24, 2).status).toBe('unsupported')
    childValues.visibility = 'visible'
    childValues.transform = 'matrix(1, 0, 0, 1, 2, 0)'
    expect(paintLucide(svg, 24, 24, 2).status).toBe('unsupported')
  })
})
