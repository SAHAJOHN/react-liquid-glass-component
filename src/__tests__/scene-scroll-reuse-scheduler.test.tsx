import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import * as reuseModule from '../scene/scroll-reuse'
import type {
  CompiledScene,
  SceneCompiler,
  SceneFrame,
  SceneItem,
  SceneRenderer,
} from '../scene/types'

class Viewport extends EventTarget {
  width = 400
  height = 800
  offsetLeft = 0
  offsetTop = 0
  scale = 1
}

function rect(element: Element, read: () => DOMRect) {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: read })
}

function required<T extends Element>(element: T | null): T {
  if (!element) throw new Error('Missing test element')
  return element
}

function testAnimation(target: Element, playState: AnimationPlayState) {
  return {
    playState,
    pending: false,
    timeline: document.timeline,
    currentTime: 1000,
    playbackRate: 1,
    effect: {
      target,
      pseudoElement: null,
      getKeyframes: () => [{ opacity: '1' }, { opacity: '0.8' }],
      getTiming: () => ({ duration: 1000, fill: 'both' }),
    },
  }
}

function sourceAnimations(source: Element, read: () => readonly object[]) {
  Object.defineProperty(source, 'getAnimations', {
    configurable: true,
    value: (options?: GetAnimationsOptions) => (options?.subtree ? read() : []),
  })
}

describe('retained scroll capture scheduling', () => {
  const originalTimeline = Object.getOwnPropertyDescriptor(document, 'timeline')
  const originalAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  const documentSizes = ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(document.documentElement, key)] as const
  )
  const compile = vi.fn<SceneCompiler['compile']>()
  const renderFrame = vi.fn((frame: SceneFrame) => {
    void frame
    return true
  })
  const setScene = vi.fn<SceneRenderer['setScene']>()
  const status = vi.fn()
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let viewport: Viewport
  let failPadded: boolean
  let certified: boolean
  let normalHeight: number | undefined
  let media: HTMLCanvasElement | undefined

  const tick = () =>
    act(() => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(100))
    })

  beforeEach(() => {
    if (!document.timeline)
      Object.defineProperty(document, 'timeline', {
        configurable: true,
        value: { currentTime: 0 },
      })
    callbacks = new Map()
    nextId = 0
    viewport = new Viewport()
    failPadded = false
    certified = true
    normalHeight = undefined
    media = undefined
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('scrollX', 0)
    vi.stubGlobal('scrollY', 200)
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    })
    for (const [name, value] of Object.entries({
      scrollWidth: 400,
      scrollHeight: 5000,
      clientWidth: 400,
      clientHeight: 800,
    }))
      Object.defineProperty(document.documentElement, name, { configurable: true, value })
    vi.spyOn(reuseModule, 'readScrollStyleEpoch').mockReturnValue('unchanged-css')
    compile.mockImplementation(
      (_root, _panes, _frame, _background, region, regions, fixedContainer): CompiledScene => {
        normalHeight ??= region?.height
        const padded = !!region && !!normalHeight && region.height > normalHeight + 100
        const issues = padded && failPadded ? ['SVG is loading'] : []
        const items: SceneItem[] = media
          ? [
              {
                kind: 'media',
                source: media,
                fit: 'fill',
                position: [0, 0],
                radius: 0,
                rect: { x: 30, y: 200, width: 300, height: 600 },
                space: 'document',
                opacity: 1,
              },
            ]
          : []
        return {
          scene: {
            background: [1, 1, 1, 1],
            items,
            ...(region ? { samplingRegion: region } : {}),
            ...(regions
              ? { samplingRegions: regions, renderRegions: regions }
              : region
                ? { renderRegions: [region] }
                : {}),
          },
          targets: [],
          issues,
          liveGeometry: true,
          media: media ? [media] : [],
          ...(fixedContainer && certified && !issues.length ? { scrollTranslationSafe: true } : {}),
        }
      }
    )
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({ compile, dispose: vi.fn() })
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: renderFrame,
      setScene,
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    if (originalTimeline) Object.defineProperty(document, 'timeline', originalTimeline)
    else Reflect.deleteProperty(document, 'timeline')
    if (originalAnimations)
      Object.defineProperty(Element.prototype, 'getAnimations', originalAnimations)
    else Reflect.deleteProperty(Element.prototype, 'getAnimations')
    for (const [key, descriptor] of documentSizes) {
      if (descriptor) Object.defineProperty(document.documentElement, key, descriptor)
      else Reflect.deleteProperty(document.documentElement, key)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function fixture(
    liveCanvas = false,
    configure?: (source: HTMLElement, pane: HTMLElement) => void
  ) {
    function Fixture() {
      const [nav, setNav] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene presentation="glass-only" canvasContainer={nav} onStatusChange={status}>
          <div data-testid="scrollable">
            <canvas data-testid="media" />
          </div>
          <nav ref={setNav} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
              Menu
            </LiquidGlass>
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = required(container.querySelector<HTMLElement>('[data-liquid-glass-scene]'))
    const source = required(container.querySelector<HTMLElement>('.liquid-glass-scene__content'))
    const pane = required(container.querySelector<HTMLElement>('.liquid-glass'))
    const nav = required(container.querySelector<HTMLElement>('nav'))
    const scrollable = required(container.querySelector<HTMLElement>('[data-testid="scrollable"]'))
    const canvas = required(container.querySelector<HTMLCanvasElement>('[data-testid="media"]'))
    let paneTop = 20
    let paneWidth = 360
    rect(host, () => new DOMRect(0, -window.scrollY, window.innerWidth, 5000))
    rect(source, () => new DOMRect(0, -window.scrollY, window.innerWidth, 5000))
    rect(nav, () => new DOMRect(20, 20, 360, 70))
    rect(pane, () => new DOMRect(20, paneTop, paneWidth, 70))
    if (liveCanvas) media = canvas
    configure?.(source, pane)
    await act(async () => {})
    tick()
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    const scroll = (y: number) => {
      vi.stubGlobal('scrollY', y)
      act(() => window.dispatchEvent(new Event('scroll')))
      tick()
    }
    return {
      host,
      source,
      pane,
      nav,
      scrollable,
      scroll,
      movePane: (y: number, width = 360) => {
        paneTop = y
        paneWidth = width
      },
    }
  }

  it('warms one padded capture then renders current scroll coordinates without compiling again', async () => {
    const { host, scroll } = await fixture()
    expect(compile).toHaveBeenCalledTimes(2)
    const first = compile.mock.calls[0]?.[4]
    const padded = compile.mock.calls[1]?.[4]
    expect(padded?.height).toBeGreaterThan(first?.height ?? Infinity)
    const renders = renderFrame.mock.calls.length
    scroll(250)
    scroll(300)
    expect(compile).toHaveBeenCalledTimes(2)
    expect(renderFrame).toHaveBeenCalledTimes(renders + 2)
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 300 }))
    expect(setScene.mock.lastCall?.[0]?.samplingRegion).toEqual(first)
    expect(setScene.mock.lastCall?.[0]?.samplingRegions).toEqual(compile.mock.calls[0]?.[5])
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })

  it('stops warming when wrapper validation rejects an otherwise certified compile', async () => {
    const { host } = await fixture()
    await act(async () => {
      host.style.filter = 'blur(1px)'
    })
    tick()
    expect(status.mock.lastCall?.[0].status).toBe('fallback')
    const count = compile.mock.calls.length
    tick()
    expect(compile).toHaveBeenCalledTimes(count)
    expect(callbacks.size).toBe(0)
  })

  it('continues drawing live canvas frames within the retained capture', async () => {
    await fixture(true)
    const count = compile.mock.calls.length
    const renders = renderFrame.mock.calls.length
    const epochReads = vi.mocked(reuseModule.readScrollStyleEpoch).mock.calls.length
    tick()
    tick()
    expect(compile).toHaveBeenCalledTimes(count)
    expect(renderFrame).toHaveBeenCalledTimes(renders + 2)
    expect(reuseModule.readScrollStyleEpoch).toHaveBeenCalledTimes(epochReads)
  })

  it('rebuilds when scrolling leaves captured source coverage', async () => {
    const { scroll, host } = await fixture()
    const before = compile.mock.calls.length
    scroll(600)
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(compile.mock.lastCall?.[2].scrollY).toBe(600)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })

  it('recompiles changed DOM instead of retaining old content', async () => {
    const { scrollable, scroll } = await fixture()
    const before = compile.mock.calls.length
    await act(async () => {
      scrollable.textContent = 'Updated content'
    })
    scroll(230)
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('invalidates on nested scrolling even without a document scroll offset change', async () => {
    const { scrollable } = await fixture()
    const before = compile.mock.calls.length
    act(() => scrollable.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 200 }))
  })

  it('rebuilds after layout viewport size changes', async () => {
    const { host } = await fixture()
    const before = compile.mock.calls.length
    vi.stubGlobal('innerHeight', 900)
    act(() => window.dispatchEvent(new Event('resize')))
    tick()
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ height: 900 }))
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })

  it('rejects reuse when a pane moves inside the fixed container', async () => {
    const { movePane, scroll } = await fixture()
    const before = compile.mock.calls.length
    movePane(25)
    scroll(225)
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('recompiles with a relevant running document animation', async () => {
    const { source, scroll } = await fixture()
    const animation = testAnimation(source, 'running')
    sourceAnimations(source, () => [animation])
    const before = compile.mock.calls.length
    scroll(225)
    expect(compile.mock.calls.length).toBeGreaterThan(before)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it.each(['pending', 'unresolved time', 'unreadable timing', 'other timeline'] as const)(
    'uses ordinary compilation when a paused animation has %s',
    async (reason) => {
      const { scroll } = await fixture(false, (source) => {
        const base = testAnimation(source, 'paused')
        const animation = {
          ...base,
          pending: reason === 'pending',
          currentTime: reason === 'unresolved time' ? null : base.currentTime,
          timeline: reason === 'other timeline' ? { currentTime: 0 } : document.timeline,
          effect: {
            ...base.effect,
            getTiming: () => {
              if (reason === 'unreadable timing') throw new Error('Unavailable timing')
              return base.effect.getTiming()
            },
          },
        }
        sourceAnimations(source, () => [animation])
      })
      expect(callbacks.size).toBe(0)
      const before = compile.mock.calls.length
      scroll(230)
      scroll(250)
      expect(compile).toHaveBeenCalledTimes(before + 2)
      expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    }
  )

  it('refreshes an animated fixed pane without recompiling document paint and retains its latest suffix', async () => {
    const body: SceneItem = {
      kind: 'solid',
      space: 'document',
      rect: { x: 0, y: 0, width: 400, height: 5000 },
      radius: 0,
      opacity: 1,
      color: [0.2, 0.4, 0.6, 1],
    }
    let fixedNav: HTMLElement | null = null
    compile.mockImplementation(
      (root, panes, _frame, _background, region, regions): CompiledScene => {
        const entry = Array.from(panes)[0]
        if (!entry?.[1].studio) throw new Error('Fixture requires a Studio pane')
        const [pane, options] = entry
        const bounds = pane.getBoundingClientRect()
        const glass: SceneItem = {
          kind: 'glass',
          space: 'viewport',
          rect: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
          radius: bounds.height / 2,
          opacity: 1,
          displacement: [0, 0, 0],
          blur: 0,
          saturation: 1,
          tint: [0, 0, 0, 0],
          studio: entry[1].studio,
        }
        const control: SceneItem = {
          kind: 'solid',
          space: 'viewport',
          rect: { x: bounds.left + 10, y: bounds.top + 10, width: 20, height: 20 },
          radius: 2,
          opacity: options.opacity,
          color: [1, 1, 1, 1],
        }
        const local = root === fixedNav
        return {
          scene: {
            background: local ? [0, 0, 0, 0] : [1, 1, 1, 1],
            items: local ? [glass, control] : [body, glass, control],
            ...(region ? { samplingRegion: region } : {}),
            ...(regions ? { samplingRegions: regions, renderRegions: regions } : {}),
          },
          targets: [],
          issues: [],
          liveGeometry: true,
          media: [],
          ...(!local ? { scrollTranslationSafe: true } : {}),
        }
      }
    )
    const { nav, source, pane, movePane, scroll } = await fixture(false, (_source, element) => {
      fixedNav = required(element.closest('nav'))
    })
    const fullCalls = () => compile.mock.calls.filter(([root]) => root !== nav).length
    const viewportCalls = () => compile.mock.calls.filter(([root]) => root === nav).length
    expect(fullCalls()).toBe(2)
    expect(viewportCalls()).toBe(0)
    const initialRenders = renderFrame.mock.calls.length
    const frames = vi.fn()
    required(nav.querySelector('[data-liquid-glass-scene-canvas]')).addEventListener(
      'liquid-glass:scene-frame',
      frames
    )
    let running = true
    const animation = {
      playState: 'running',
      timeline: document.timeline,
      effect: {
        target: pane,
        pseudoElement: null,
        getKeyframes: () => [{ transform: 'translateY(0px)' }, { transform: 'translateY(20px)' }],
      },
    }
    Object.defineProperty(source, 'getAnimations', {
      configurable: true,
      value: (options?: GetAnimationsOptions) => (options?.subtree && running ? [animation] : []),
    })

    movePane(30, 340)
    scroll(230)
    expect(fullCalls()).toBe(2)
    expect(viewportCalls()).toBe(1)
    expect(frames.mock.lastCall?.[0]).toMatchObject({ detail: { generation: 3 } })
    expect(setScene.mock.lastCall?.[0].items[0]).toBe(body)
    expect(
      setScene.mock.lastCall?.[0].items.find((item) => item.kind === 'glass')?.rect
    ).toMatchObject({ y: 30, width: 340 })

    movePane(40, 320)
    tick()
    expect(fullCalls()).toBe(2)
    expect(viewportCalls()).toBe(2)
    expect(frames.mock.lastCall?.[0]).toMatchObject({ detail: { generation: 4 } })
    const movedSuffix = setScene.mock.lastCall?.[0].items.slice(1)
    expect(movedSuffix?.[0]?.rect).toMatchObject({ y: 40, width: 320 })
    expect(movedSuffix?.[1]?.rect.y).toBe(50)

    running = false
    scroll(260)
    expect(frames.mock.lastCall?.[0]).toMatchObject({ detail: { generation: 4 } })
    expect(fullCalls()).toBe(2)
    expect(viewportCalls()).toBe(2)
    expect(renderFrame).toHaveBeenCalledTimes(initialRenders + 3)
    expect(setScene.mock.lastCall?.[0].items[0]).toBe(body)
    expect(setScene.mock.lastCall?.[0].items.slice(1)).toEqual(movedSuffix)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it.each(['paused', 'finished'] as const)(
    'retains a %s document effect while idle and scrolling, then recompiles after a seek',
    async (state) => {
      let seek: () => void = () => {
        throw new Error('Missing animation')
      }
      const { scroll } = await fixture(false, (source) => {
        const animation = testAnimation(source, state)
        seek = () => {
          animation.currentTime = 1500
        }
        sourceAnimations(source, () => [animation])
      })
      expect(compile).toHaveBeenCalledTimes(2)
      expect(callbacks.size).toBe(0)
      const renders = renderFrame.mock.calls.length
      tick()
      expect(renderFrame).toHaveBeenCalledTimes(renders)
      scroll(230)
      expect(compile).toHaveBeenCalledTimes(2)
      seek()
      scroll(250)
      expect(compile.mock.calls.length).toBeGreaterThan(2)
      const rebuilt = compile.mock.calls.length
      scroll(270)
      expect(compile).toHaveBeenCalledTimes(rebuilt)
      expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    }
  )

  it.each(['replace', 'finish', 'resume', 'keyframes', 'timing'] as const)(
    'invalidates a paused document effect after %s',
    async (change) => {
      let update: () => void = () => {
        throw new Error('Missing animation')
      }
      const { scroll } = await fixture(false, (source) => {
        let animation = testAnimation(source, 'paused')
        sourceAnimations(source, () => [animation])
        update = () => {
          switch (change) {
            case 'replace':
              animation = testAnimation(source, 'paused')
              break
            case 'finish':
              animation.playState = 'finished'
              break
            case 'resume':
              animation.playState = 'running'
              break
            case 'keyframes':
              animation.effect.getKeyframes = () => [{ opacity: '0.2' }]
              break
            case 'timing':
              animation.effect.getTiming = () => ({ duration: 600, fill: 'both' })
              break
          }
        }
      })
      scroll(230)
      expect(compile).toHaveBeenCalledTimes(2)
      update()
      scroll(250)
      expect(compile.mock.calls.length).toBeGreaterThan(2)
      expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    }
  )

  it('compares paused ancestor effects before projecting the document', async () => {
    let seek: () => void = () => {
      throw new Error('Missing ancestor effect')
    }
    const { scroll } = await fixture(false, (source) => {
      const host = required(source.closest('[data-liquid-glass-scene]'))
      const animation = testAnimation(host, 'paused')
      Object.defineProperty(host, 'getAnimations', { configurable: true, value: () => [animation] })
      seek = () => {
        animation.currentTime = 1100
      }
    })
    scroll(230)
    expect(compile).toHaveBeenCalledTimes(2)
    seek()
    scroll(250)
    expect(compile.mock.calls.length).toBeGreaterThan(2)
  })

  it('discards speculative loading issues and presents the actual pane normally', async () => {
    failPadded = true
    const { host, scroll } = await fixture()
    expect(compile).toHaveBeenCalledTimes(3)
    expect(status.mock.calls.every(([state]) => state.status === 'ready')).toBe(true)
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    const paddedAttempts = () =>
      compile.mock.calls.filter((call) => (call[4]?.height ?? 0) > (normalHeight ?? 0) + 100).length
    expect(paddedAttempts()).toBe(1)
    scroll(230)
    expect(paddedAttempts()).toBe(1)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })

  it('ignores duplicate visual viewport scroll geometry but still draws the new document offset', async () => {
    await fixture()
    const before = compile.mock.calls.length
    vi.stubGlobal('scrollY', 240)
    act(() => viewport.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(before)
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 240 }))
  })

  it.each(['offsetTop', 'height', 'scale'] as const)(
    'invalidates changed visual viewport %s',
    async (property) => {
      await fixture()
      const before = compile.mock.calls.length
      viewport[property] += 1
      act(() => viewport.dispatchEvent(new Event('scroll')))
      tick()
      expect(compile.mock.calls.length).toBeGreaterThan(before)
      expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    }
  )

  it('keeps ordinary scroll compilation when the compiler does not certify translation safety', async () => {
    certified = false
    const { scroll } = await fixture()
    const before = compile.mock.calls.length
    scroll(230)
    expect(compile).toHaveBeenCalledTimes(before + 1)
  })

  it('does not repeat a denied certificate scan until the DOM is dirty', async () => {
    certified = false
    const { nav, scrollable, scroll } = await fixture()
    expect(compile.mock.calls[0]?.[6]).toBe(nav)
    scroll(230)
    scroll(260)
    expect(compile.mock.calls.slice(1).every((call) => call[6] === undefined)).toBe(true)
    await act(async () => {
      scrollable.setAttribute('data-updated', 'true')
    })
    scroll(280)
    expect(compile.mock.lastCall?.[6]).toBe(nav)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('keeps rebuilding while pinched rather than creating another retained capture', async () => {
    const { scroll } = await fixture()
    const paddedAttempts = () =>
      compile.mock.calls.filter((call) => (call[4]?.height ?? 0) > (normalHeight ?? 0) + 100).length
    const initialPadded = paddedAttempts()
    viewport.scale = 2
    act(() => viewport.dispatchEvent(new Event('resize')))
    tick()
    const before = compile.mock.calls.length
    scroll(230)
    scroll(260)
    expect(compile.mock.calls.length).toBeGreaterThanOrEqual(before + 2)
    expect(paddedAttempts()).toBe(initialPadded)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })
})
