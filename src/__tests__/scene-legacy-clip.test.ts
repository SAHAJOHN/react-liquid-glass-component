import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEmptyLegacyClip } from '../scene/clip-geometry'
import { createSceneCompiler } from '../scene/dom-scene'
import type * as PaintBoxModule from '../scene/paint-box'
import * as content from '../scene/paint-content'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  createColorReader: () => () => [1, 1, 1, 1],
  paintBox: (style: CSSStyleDeclaration) => {
    const canvas = document.createElement('canvas')
    canvas.dataset.source = style.backgroundColor
    return canvas
  },
}))

const frame = { scrollX: 0, scrollY: 0, width: 400, height: 800, pixelRatio: 1 }
const clipError = 'CSS clip requires native HTML rendering'

function computedStyle(position: string, clip: string): CSSStyleDeclaration {
  const style = document.createElement('div').style
  const values: Record<string, string> = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    position,
    clip,
    transform: 'none',
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
    backgroundColor: 'white',
    backgroundImage: 'none',
    objectFit: 'fill',
    objectPosition: '50% 50%',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px',
    borderBottomLeftRadius: '0px',
  }
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(style, key, { value, configurable: true, writable: true })
  return style
}

function fixture(position: string, clip: string) {
  const root = document.createElement('main')
  const clipped = document.createElement('div')
  const button = document.createElement('button')
  const canvas = document.createElement('canvas')
  const span = document.createElement('span')
  clipped.append('Accessible content', button, canvas, span)
  button.textContent = 'Action'
  canvas.width = canvas.height = 20
  root.append(clipped)
  document.body.append(root)
  const styles = new Map<Element, CSSStyleDeclaration>([
    [root, computedStyle('static', 'auto')],
    [clipped, computedStyle(position, clip)],
    [button, computedStyle('static', 'auto')],
    [canvas, computedStyle('static', 'auto')],
    [span, computedStyle('static', 'auto')],
  ])
  const pseudo = computedStyle('absolute', 'auto')
  Object.defineProperty(pseudo, 'content', { value: 'none', configurable: true })
  const getStyle = vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, kind) => {
    if (kind) return pseudo
    const style = styles.get(element)
    if (!style) throw new Error(`Unexpected element ${element.tagName}`)
    return style
  })
  for (const element of styles.keys())
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 60))
  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: vi.fn(),
    getBoundingClientRect: () => new DOMRect(15, 15, 30, 15),
  } as unknown as Range)
  const textBitmap = document.createElement('canvas')
  vi.spyOn(content, 'paintText').mockReturnValue(textBitmap)
  const compiler = createSceneCompiler(() => {})
  return { root, clipped, button, canvas, span, styles, getStyle, compiler, textBitmap }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('legacy zero-area clip', () => {
  it.each(['absolute', 'fixed'])(
    'skips an invisible %s subtree but leaves the native DOM intact',
    (position) => {
      const { root, clipped, button, canvas, span, getStyle, compiler, textBitmap } = fixture(
        position,
        'rect(0px, 0px, 0px, 0px)'
      )
      const before = root.outerHTML
      const result = compiler.compile(root, new Map(), frame, 'white')
      expect(result.issues).not.toContain(clipError)
      expect(result.media).not.toContain(canvas)
      expect(result.targets.some((target) => target.element === button)).toBe(false)
      expect(
        result.scene.items.some((item) => item.kind === 'sprite' && item.bitmap === textBitmap)
      ).toBe(false)
      expect(getStyle.mock.calls.some(([element]) => element === span)).toBe(false)
      expect(root.contains(clipped)).toBe(true)
      expect(root.outerHTML).toBe(before)
      compiler.dispose()
    }
  )

  it('keeps content when clip is ignored on a static element', () => {
    const { root, button, canvas, compiler, textBitmap } = fixture(
      'static',
      'rect(0px, 0px, 0px, 0px)'
    )
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).not.toContain(clipError)
    expect(result.targets.some((target) => target.element === button)).toBe(true)
    expect(result.media).toContain(canvas)
    expect(
      result.scene.items.some((item) => item.kind === 'sprite' && item.bitmap === textBitmap)
    ).toBe(true)
    compiler.dispose()
  })

  it.each(['absolute', 'fixed'])('preserves fallback for visible %s legacy clips', (position) => {
    const { root, compiler } = fixture(position, 'rect(0px, 12px, 12px, 0px)')
    const result = compiler.compile(root, new Map(), frame, 'white')
    expect(result.issues).toContain(clipError)
    compiler.dispose()
  })

  it.each(['rect(0px, 0px, 0px, 0px)', 'rect( 0 0 0 0 )', 'RECT(0px,0px,0px,0px)'])(
    'recognizes an empty clip serialization %s',
    (value) => expect(isEmptyLegacyClip(computedStyle('absolute', value))).toBe(true)
  )

  it.each([
    'auto',
    '',
    'rect(auto, 0px, 0px, 0px)',
    'rect(0px, 1px, 0px, 0px)',
    'rect(0%, 0%, 0%, 0%)',
    'rect(0px, 0px, 0px)',
    'inset(0)',
  ])('does not misclassify unsupported clip %s as empty', (value) =>
    expect(isEmptyLegacyClip(computedStyle('absolute', value))).toBe(false)
  )

  it.each(['static', 'relative', 'sticky'])(
    'does not skip ignored clip on position %s',
    (position) => {
      expect(isEmptyLegacyClip(computedStyle(position, 'rect(0px, 0px, 0px, 0px)'))).toBe(false)
    }
  )
})
