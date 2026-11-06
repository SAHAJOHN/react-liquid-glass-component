import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, SceneCompiler, SceneRect } from '../scene/types'

function mockRect(element: Element, rect: SceneRect) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) }),
  })
}

describe('scene animation scheduler', () => {
  const originalAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  const compile = vi.fn<SceneCompiler['compile']>()
  const renderFrame = vi.fn(() => true)
  const tick = () => act(() => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    pending.forEach((callback) => callback(100))
  })

  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    const result: CompiledScene = {
      scene: {
        background: [1, 1, 1, 1], items: [],
        renderRegions: [{ x: 0, y: 0, width: 400, height: 200 }],
      },
      targets: [], issues: [], liveGeometry: true, media: [],
    }
    compile.mockReturnValue(result)
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('scrollY', 0)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
    const nativeStyle = window.getComputedStyle.bind(window)
    const pseudoStyle = document.createElement('div').style
    pseudoStyle.content = 'none'
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) =>
      pseudo ? pseudoStyle : nativeStyle(element)
    )
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({ compile, dispose: vi.fn() })
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({ render: renderFrame, setScene: vi.fn(), dispose: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    if (originalAnimations) Object.defineProperty(Element.prototype, 'getAnimations', originalAnimations)
    else Reflect.deleteProperty(Element.prototype, 'getAnimations')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps checking an ignored animation, recompiles when it enters and on scroll', () => {
    const status = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={status}>
        <div data-testid="clip" style={{ position: 'relative', overflowX: 'hidden', overflowY: 'hidden' }}>
          <div data-testid="marquee" />
        </div>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>Navigation</LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const source = container.querySelector('.liquid-glass-scene__content')
    const clip = container.querySelector('[data-testid="clip"]')
    const target = container.querySelector('[data-testid="marquee"]')
    const pane = container.querySelector('.liquid-glass')
    if (!(host instanceof HTMLElement) || !(source instanceof HTMLElement) || !clip || !target || !pane)
      throw new Error('Missing scene elements')
    source.style.overflowX = source.style.overflowY = 'visible'
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(source, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(clip, { x: 10, y: 1000, width: 200, height: 100 })
    mockRect(pane, { x: 20, y: 20, width: 360, height: 70 })
    const animation = {
      playState: 'running',
      effect: { target, pseudoElement: null, getKeyframes: () => [{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }] },
    } as unknown as Animation
    Object.defineProperty(source, 'getAnimations', {
      configurable: true,
      value: (options?: GetAnimationsOptions) => options?.subtree ? [animation] : [],
    })
    tick()
    tick() // Transition from initially unknown animation relevance to ignored.
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    const initialCompileCount = compile.mock.calls.length
    const initialRenderCount = renderFrame.mock.calls.length
    expect(callbacks.size).toBeGreaterThan(0)
    tick()
    expect(compile).toHaveBeenCalledTimes(initialCompileCount)
    expect(renderFrame).toHaveBeenCalledTimes(initialRenderCount)
    expect(callbacks.size).toBeGreaterThan(0)

    mockRect(clip, { x: 10, y: 50, width: 200, height: 100 })
    tick()
    expect(compile).toHaveBeenCalledTimes(initialCompileCount + 1)
    expect(renderFrame).toHaveBeenCalledTimes(initialRenderCount + 1)

    mockRect(clip, { x: 10, y: 1000, width: 200, height: 100 })
    tick() // Transition from relevant to ignored must compile once.
    const beforeScroll = compile.mock.calls.length
    tick()
    expect(compile).toHaveBeenCalledTimes(beforeScroll)
    vi.stubGlobal('scrollY', 50)
    mockRect(host, { x: 0, y: -50, width: 400, height: 1200 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(beforeScroll + 1)
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })
})
