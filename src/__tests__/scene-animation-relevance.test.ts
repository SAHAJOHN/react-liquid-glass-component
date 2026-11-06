import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasRelevantAnimations } from '../scene/animation-relevance'
import type { SceneRect } from '../scene/types'

const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
const regions: SceneRect[] = [
  { x: 0, y: 0, width: 400, height: 200 },
  { x: 0, y: 600, width: 400, height: 100 },
]

function style(): CSSStyleDeclaration {
  const result = document.createElement('div').style
  const defaults: Record<string, string> = {
    display: 'block',
    position: 'static',
    opacity: '1',
    overflowX: 'visible',
    overflowY: 'visible',
    transform: 'none',
    translate: 'none',
    rotate: 'none',
    scale: 'none',
    filter: 'none',
    backdropFilter: 'none',
    perspective: 'none',
    boxShadow: 'none',
    textShadow: 'none',
    outlineStyle: 'none',
    borderImageSource: 'none',
    clipPath: 'none',
    maskImage: 'none',
    mixBlendMode: 'normal',
    content: 'none',
  }
  for (const [key, value] of Object.entries(defaults))
    Object.defineProperty(result, key, { value, configurable: true, writable: true })
  return result
}

function animation(
  target: Element | null,
  frames: Record<string, unknown>[],
  playState = 'running'
) {
  return {
    playState,
    effect: { target, pseudoElement: null, getKeyframes: () => frames },
  } as unknown as Animation
}

const marquee = [
  {
    transform: 'translateX(0%)',
    offset: 0,
    computedOffset: 0,
    easing: 'linear',
    composite: 'auto',
  },
  {
    transform: 'translateX(-100%)',
    offset: 1,
    computedOffset: 1,
    easing: 'linear',
    composite: 'auto',
  },
]

function fixture() {
  const source = document.createElement('main')
  const clip = document.createElement('section')
  const target = document.createElement('div')
  const pane = document.createElement('div')
  source.append(clip, pane)
  clip.append(target)
  document.body.append(source)
  const sourceStyle = style()
  const clipStyle = style()
  const targetStyle = style()
  const paneStyle = style()
  clipStyle.position = 'relative'
  clipStyle.overflowX = clipStyle.overflowY = 'hidden'
  const pseudoStyle = style()
  const styles = new Map<Element, CSSStyleDeclaration>([
    [source, sourceStyle],
    [clip, clipStyle],
    [target, targetStyle],
    [pane, paneStyle],
  ])
  const read = vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (pseudo) return pseudoStyle
    const found = styles.get(element)
    if (!found) throw new Error('Unexpected style read')
    return found
  })
  const rect = vi
    .spyOn(clip, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(10, 1000, 200, 100))
  vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 1500))
  const check = (
    animations: Animation[],
    sourceRegions: readonly SceneRect[] | undefined = regions
  ) => hasRelevantAnimations({ source, animations, regions: sourceRegions, panes: [pane] })
  return { source, clip, target, pane, clipStyle, targetStyle, styles, read, rect, check }
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  if (originalGetAnimations)
    Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations)
  else Reflect.deleteProperty(Element.prototype, 'getAnimations')
  document.body.replaceChildren()
})

describe('off-region animation relevance', () => {
  it('rechecks a moving clipped subtree against retained capture coverage', () => {
    const { source, clip, pane, rect, targetStyle, check } = fixture()
    const moving = animation(clip, marquee)
    const input = { source, animations: [moving], regions, panes: [pane], allowMovingClip: true }
    expect(check([moving])).toBe(true)
    expect(hasRelevantAnimations(input)).toBe(false)
    rect.mockReturnValue(new DOMRect(10, 650, 200, 100))
    expect(hasRelevantAnimations(input)).toBe(true)
    rect.mockReturnValue(new DOMRect(10, 1000, 200, 100))
    targetStyle.position = 'fixed'
    expect(hasRelevantAnimations(input)).toBe(true)
  })
  it('ignores a 2D marquee clipped outside both source regions without changing DOM', () => {
    const { source, clip, target, check } = fixture()
    const html = source.innerHTML
    expect(check([animation(target, marquee)])).toBe(false)
    expect(source.innerHTML).toBe(html)
    expect(clip.contains(target)).toBe(true)
  })

  it('rechecks bounds on every call when a clip enters or leaves either region', () => {
    const { target, rect, check } = fixture()
    const animations = [animation(target, marquee)]
    expect(check(animations)).toBe(false)
    rect.mockReturnValue(new DOMRect(10, 650, 200, 100))
    expect(check(animations)).toBe(true)
    rect.mockReturnValue(new DOMRect(10, 1000, 200, 100))
    expect(check(animations)).toBe(false)
  })

  it.each([
    [{ width: '20px' }, { width: '30px' }],
    [{ filter: 'blur(0px)' }, { filter: 'blur(2px)' }],
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(30deg)' }],
    [{ transform: 'translate3d(0px,0px,0px)' }, { transform: 'translate3d(10px,0px,0px)' }],
    [{ translate: '0px 0px 0px' }, { translate: '10px 0px 0px' }],
    [{ transform: 'scale(1)' }, { transform: 'scale(2)' }],
    [{ opacity: '' }, { opacity: '1' }],
  ])('keeps potentially layout-affecting or unsupported keyframes relevant', (...frames) => {
    const { target, check } = fixture()
    expect(check([animation(target, frames)])).toBe(true)
  })

  it('accepts 2D translation and opacity but fails closed for unknown keyframes', () => {
    const { source, target, pane, check } = fixture()
    expect(
      check([
        animation(target, [
          { translate: '-20% 0px', opacity: '0.2' },
          { translate: '0px', opacity: 1 },
        ]),
      ])
    ).toBe(false)
    expect(check([animation(target, [])])).toBe(true)
    expect(check([{ playState: 'running', effect: null } as Animation])).toBe(true)
    expect(check([animation(null, marquee)])).toBe(true)
    expect(check([animation(target, marquee)], [])).toBe(true)
    expect(
      hasRelevantAnimations({
        source,
        animations: [animation(target, marquee)],
        regions: undefined,
        panes: [pane],
      })
    ).toBe(true)
    expect(check([animation(target, marquee, 'paused')], [])).toBe(false)
  })

  it('keeps animation relevant for an absent, static, one-axis or visible clip', () => {
    const { target, clipStyle, check } = fixture()
    clipStyle.position = 'static'
    expect(check([animation(target, marquee)])).toBe(true)
    clipStyle.position = 'relative'
    clipStyle.overflowY = 'visible'
    expect(check([animation(target, marquee)])).toBe(true)
    clipStyle.overflowY = 'hidden'
    clipStyle.boxShadow = 'rgb(0, 0, 0) 0px 0px 10px'
    expect(check([animation(target, marquee)])).toBe(true)
  })

  it('rejects fixed descendants and animated clip ancestors', () => {
    const { clip, target, targetStyle, check } = fixture()
    targetStyle.position = 'fixed'
    expect(check([animation(target, marquee)])).toBe(true)
    targetStyle.position = 'static'
    const moveClip = animation(clip, marquee)
    expect(check([animation(target, marquee), moveClip])).toBe(true)
    vi.spyOn(clip, 'getAnimations').mockReturnValue([moveClip])
    expect(check([animation(target, marquee)])).toBe(true)
  })

  it('keeps pane animations and animations containing a pane relevant', () => {
    const { target, pane, check } = fixture()
    target.append(pane)
    expect(check([animation(target, marquee)])).toBe(true)
    expect(check([animation(pane, marquee)])).toBe(true)
  })

  it('shares CSS reads and clip proof within one call but never across calls', () => {
    const { clip, target, styles, read, rect, check } = fixture()
    const another = document.createElement('div')
    clip.append(another)
    styles.set(another, style())
    const both = [animation(target, marquee), animation(another, marquee)]
    expect(check(both)).toBe(false)
    const normalReads = () =>
      read.mock.calls.filter(([element, pseudo]) => element === clip && !pseudo).length
    expect(normalReads()).toBe(1)
    expect(rect).toHaveBeenCalledTimes(1)
    expect(check(both)).toBe(false)
    expect(normalReads()).toBe(2)
    expect(rect).toHaveBeenCalledTimes(2)
  })
})
