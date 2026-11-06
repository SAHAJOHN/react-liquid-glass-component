import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import * as nativeBorder from '../scene/native-border'
import type * as PaintBox from '../scene/paint-box'
import type { SceneFrame, SceneRect } from '../scene/types'

const borderIssue = 'Unequal rounded borders require native HTML rendering'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => (value: string) =>
    value === 'transparent' ? [0, 0, 0, 0] : [1, 1, 1, 1],
  paintBox: vi.fn(
    (
      style: CSSStyleDeclaration,
      _width: number,
      _height: number,
      _ratio: number,
      issues: Set<string>
    ) => {
      if (style.borderBottomWidth === '1px') issues.add(borderIssue)
      return document.createElement('canvas')
    }
  ),
}))

const frame: SceneFrame = { width: 400, height: 800, pixelRatio: 1, scrollX: 0, scrollY: 0 }
const pane: SceneRect = { x: 50, y: 20, width: 250, height: 100 }

function fixture() {
  const root = document.createElement('main')
  const heading = document.createElement('h3')
  root.append(heading)
  document.body.append(root)

  const defaults: Record<string, string> = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    position: 'static',
    transform: 'none',
    translate: 'none',
    rotate: 'none',
    scale: 'none',
    filter: 'none',
    backdropFilter: 'none',
    boxShadow: 'none',
    textShadow: 'none',
    borderImageSource: 'none',
    backgroundBlendMode: 'normal',
    perspective: 'none',
    listStyleType: 'none',
    clipPath: 'none',
    maskImage: 'none',
    mixBlendMode: 'normal',
    backgroundClip: 'border-box',
    backgroundAttachment: 'scroll',
    writingMode: 'horizontal-tb',
    zIndex: 'auto',
    isolation: 'auto',
    contain: 'none',
    willChange: 'auto',
    overflowX: 'visible',
    overflowY: 'visible',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'none',
    borderLeftStyle: 'solid',
    borderTopColor: 'rgb(229, 237, 239)',
    borderRightColor: 'rgb(229, 237, 239)',
    borderBottomColor: 'rgb(0, 0, 0)',
    borderLeftColor: 'rgb(229, 237, 239)',
  }
  function makeStyle() {
    const style = document.createElement('div').style
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(style, name, { value, configurable: true, writable: true })
    return style
  }
  const rootStyle = makeStyle()
  const headingStyle = makeStyle()
  headingStyle.backgroundColor = 'rgb(255, 233, 227)'
  headingStyle.borderBottomWidth = '1px'
  headingStyle.borderBottomStyle = 'solid'
  headingStyle.borderBottomColor = 'rgb(229, 237, 239)'
  headingStyle.borderTopLeftRadius = '12px'
  headingStyle.borderTopRightRadius = '12px'
  headingStyle.borderBottomRightRadius = '12px'
  headingStyle.borderBottomLeftRadius = '12px'
  const pseudo = makeStyle()
  Object.defineProperty(pseudo, 'content', { value: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    return element === root ? rootStyle : headingStyle
  })
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 2000))
  const bounds = vi
    .spyOn(heading, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(60, 30, 218, 49))
  const images: HTMLImageElement[] = []
  vi.stubGlobal(
    'Image',
    vi.fn(function Image() {
      const image = document.createElement('img')
      images.push(image)
      return image
    })
  )
  const bitmap = document.createElement('canvas')
  bitmap.width = 218
  bitmap.height = 49
  const paint = vi.spyOn(nativeBorder, 'paintNativeBorder').mockReturnValue(bitmap)
  const invalidate = vi.fn()
  const compiler = createSceneCompiler(invalidate)
  return { root, heading, headingStyle, bounds, images, bitmap, paint, invalidate, compiler }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native border scene integration', () => {
  it('waits for the SVG, invalidates on load and uses the verified bitmap', () => {
    const { root, headingStyle, images, bitmap, paint, invalidate, compiler } = fixture()
    expect(nativeBorder.createNativeBorderSource(headingStyle, 218, 49, 1)).not.toBeNull()
    const loading = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(loading.issues).toContain('SVG is loading')
    expect(loading.issues).not.toContain(borderIssue)
    expect(images).toHaveLength(1)
    expect(paint).not.toHaveBeenCalled()

    images[0]?.dispatchEvent(new Event('load'))
    expect(invalidate).toHaveBeenCalled()
    const ready = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(ready.issues).not.toContain(borderIssue)
    expect(ready.issues).not.toContain('SVG is loading')
    expect(ready.scene.items).toEqual(expect.arrayContaining([expect.objectContaining({ bitmap })]))
    expect(paint).toHaveBeenCalledOnce()
    compiler.compile(root, new Map(), frame, 'white', pane)
    expect(paint).toHaveBeenCalledOnce()
    compiler.dispose()
  })

  it('keeps native fallback if SVG decoding fails', () => {
    const { root, images, paint, compiler } = fixture()
    compiler.compile(root, new Map(), frame, 'white', pane)
    images[0]?.dispatchEvent(new Event('error'))
    const failed = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(failed.issues).toContain(borderIssue)
    expect(failed.issues).not.toContain('SVG is loading')
    expect(paint).not.toHaveBeenCalled()
    compiler.dispose()
  })

  it('keeps native fallback when verification rejects blank or tainted output', () => {
    const { root, images, paint, compiler } = fixture()
    paint.mockReturnValue(null)
    compiler.compile(root, new Map(), frame, 'white', pane)
    images[0]?.dispatchEvent(new Event('load'))
    const rejected = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(rejected.issues).toContain(borderIssue)
    expect(rejected.issues).not.toContain('SVG is loading')
    compiler.dispose()
  })

  it('does not use a stale bitmap while a changed color loads', () => {
    const { root, headingStyle, images, bitmap, paint, compiler } = fixture()
    compiler.compile(root, new Map(), frame, 'white', pane)
    images[0]?.dispatchEvent(new Event('load'))
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toEqual([])

    headingStyle.borderBottomColor = 'rgb(1, 2, 3)'
    const changed = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(changed.issues).toContain('SVG is loading')
    expect(changed.scene.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ bitmap })])
    )
    expect(images).toHaveLength(2)
    const replacement = document.createElement('canvas')
    paint.mockReturnValue(replacement)
    images[1]?.dispatchEvent(new Event('load'))
    const ready = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(ready.issues).toEqual([])
    expect(ready.scene.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ bitmap: replacement })])
    )
    compiler.dispose()
  })

  it('rerasterizes a cached SVG when the scene pixel ratio changes', () => {
    const { root, images, paint, compiler } = fixture()
    compiler.compile(root, new Map(), frame, 'white', pane)
    images[0]?.dispatchEvent(new Event('load'))
    expect(compiler.compile(root, new Map(), frame, 'white', pane).issues).toEqual([])
    expect(paint).toHaveBeenCalledTimes(1)
    expect(paint.mock.calls[0]?.[1].ratio).toBe(1)

    expect(
      compiler.compile(root, new Map(), { ...frame, pixelRatio: 2 }, 'white', pane).issues
    ).toEqual([])
    expect(paint).toHaveBeenCalledTimes(2)
    expect(paint.mock.calls[1]?.[1].ratio).toBe(2)
    expect(images).toHaveLength(1)
    compiler.dispose()
  })

  it('defers the outside border and draws it after entering the sampling area', () => {
    const { root, bounds, images, compiler } = fixture()
    bounds.mockReturnValue(new DOMRect(60, 300, 218, 49))
    const outside = compiler.compile(root, new Map(), frame, 'white', pane)
    expect(outside.issues).not.toContain(borderIssue)
    expect(outside.issues).not.toContain('SVG is loading')
    if (images[0]) images[0].dispatchEvent(new Event('load'))
    bounds.mockReturnValue(new DOMRect(60, 30, 218, 49))
    let entering = compiler.compile(root, new Map(), frame, 'white', pane)
    if (entering.issues.includes('SVG is loading')) {
      images[images.length - 1]?.dispatchEvent(new Event('load'))
      entering = compiler.compile(root, new Map(), frame, 'white', pane)
    }
    expect(entering.issues).not.toContain(borderIssue)
    expect(entering.issues).not.toContain('SVG is loading')
    compiler.dispose()
  })
})
