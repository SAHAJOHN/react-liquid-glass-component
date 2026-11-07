import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBox from '../scene/paint-box'

vi.mock('../scene/paint-box', async (original) => ({
  ...(await original<typeof PaintBox>()),
  createColorReader: () => () => [1, 1, 1, 1],
  paintBox: () => document.createElement('canvas'),
}))

const frame = { scrollX: 0, scrollY: 0, width: 1512, height: 807, pixelRatio: 1 }
const stackingError = 'Escaping descendant stacking order requires native HTML rendering'

function fixture() {
  const root = document.createElement('main')
  const process = document.createElement('section')
  const processInner = document.createElement('div')
  const technology = document.createElement('section')
  const viewport = document.createElement('div')
  const scroller = document.createElement('div')
  const categoryFrame = document.createElement('div')
  const card = document.createElement('article')
  root.append(process, technology)
  process.append(processInner)
  technology.append(viewport)
  viewport.append(scroller)
  scroller.append(categoryFrame)
  categoryFrame.append(card)
  document.body.append(root)

  const elements = [root, process, processInner, technology, viewport, scroller, categoryFrame, card]
  const styles = new Map<Element, CSSStyleDeclaration>()
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
    outlineStyle: 'none',
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
  }
  for (const element of elements) {
    const style = document.createElement('div').style
    for (const [name, value] of Object.entries(defaults))
      Object.defineProperty(style, name, { value, writable: true, configurable: true })
    vi.spyOn(style, 'getPropertyValue').mockImplementation(() => '')
    styles.set(element, style)
  }
  styles.get(process)!.position = 'relative'
  styles.get(processInner)!.position = 'relative'
  styles.get(processInner)!.zIndex = '1'
  styles.get(technology)!.position = 'relative'
  styles.get(technology)!.isolation = 'isolate'
  styles.get(technology)!.overflowX = styles.get(technology)!.overflowY = 'hidden'
  styles.get(viewport)!.position = 'relative'
  styles.get(viewport)!.overflowX = styles.get(viewport)!.overflowY = 'hidden'
  styles.get(scroller)!.display = 'flex'
  styles.get(scroller)!.overflowX = 'hidden'
  styles.get(scroller)!.overflowY = 'auto'
  styles.get(categoryFrame)!.overflowX = styles.get(categoryFrame)!.overflowY = 'clip'
  styles.get(card)!.backgroundColor = 'blue'

  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -4879, 1512, 10995))
  vi.spyOn(process, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -828, 1512, 836))
  vi.spyOn(processInner, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, -716, 1432, 612))
  const technologyRect = vi
    .spyOn(technology, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 8, 1512, 904))
  const viewportRect = vi
    .spyOn(viewport, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(792, 120, 680, 680))
  const scrollerRect = vi
    .spyOn(scroller, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(792, 120, 680, 680))
  vi.spyOn(categoryFrame, 'getBoundingClientRect').mockReturnValue(new DOMRect(816, -176, 632, 206))
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(816, -176, 632, 206))
  const pseudo = document.createElement('div').style
  Object.defineProperty(pseudo, 'content', { value: 'none' })
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, name) => {
    if (name) return pseudo
    const style = styles.get(element)
    if (!style) throw new Error(`unexpected element ${element.tagName}`)
    return style
  })
  const compiler = createSceneCompiler(() => {})
  const compile = () => compiler.compile(root, new Map(), frame, 'white')
  return { compiler, compile, technologyRect, viewportRect, scrollerRect }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('KA nested-scroll stacking compiler regression', () => {
  it('ignores raw overlap that is fully outside the nested scroll clip', () => {
    const { compiler, compile } = fixture()
    expect(compile().issues).not.toContain(stackingError)
    compiler.dispose()
  })

  it('retains fallback when the scroll clip moves into the earlier stacking paint', () => {
    const { compiler, compile, technologyRect, viewportRect, scrollerRect } = fixture()
    technologyRect.mockReturnValue(new DOMRect(0, -200, 1512, 904))
    viewportRect.mockReturnValue(new DOMRect(792, -200, 680, 680))
    scrollerRect.mockReturnValue(new DOMRect(792, -200, 680, 680))
    expect(compile().issues).toContain(stackingError)
    compiler.dispose()
  })
})
