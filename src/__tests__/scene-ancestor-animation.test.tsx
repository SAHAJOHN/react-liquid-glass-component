import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, SceneCompiler, SceneRect } from '../scene/types'

function mockRect(element: Element, rect: SceneRect) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }),
  })
}

describe('scene ancestor motion', () => {
  const originalAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let animations: WeakMap<Element, Animation[]>
  let ancestor: Element | null
  let transform: string
  const compile = vi.fn<SceneCompiler['compile']>()
  const renderFrame = vi.fn(() => true)
  const tick = () =>
    act(() => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(100))
    })
  const motion = (playState: AnimationPlayState): Animation => ({ playState }) as Animation

  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    animations = new WeakMap()
    ancestor = null
    transform = 'none'
    const result: CompiledScene = {
      scene: {
        background: [1, 1, 1, 1],
        items: [],
        renderRegions: [{ x: 0, y: 0, width: 400, height: 200 }],
      },
      targets: [],
      issues: [],
      liveGeometry: true,
      media: [],
    }
    compile.mockImplementation(() => ({ ...result, issues: [] }))
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('scrollY', 0)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: function (this: Element) {
        return animations.get(this) ?? []
      },
    })
    const nativeStyle = window.getComputedStyle.bind(window)
    const pseudoStyle = document.createElement('div').style
    pseudoStyle.content = 'none'
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (pseudo) return pseudoStyle
      const style = nativeStyle(element)
      if (element === ancestor)
        Object.defineProperty(style, 'transform', { configurable: true, value: transform })
      return style
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({ compile, dispose: vi.fn() })
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: renderFrame,
      setScene: vi.fn(),
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    if (originalAnimations)
      Object.defineProperty(Element.prototype, 'getAnimations', originalAnimations)
    else Reflect.deleteProperty(Element.prototype, 'getAnimations')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function fixture(strict = false) {
    const status = vi.fn()
    const scene = (
      <div data-testid="outer">
        <LiquidGlassScene presentation="glass-only" onStatusChange={status}>
          <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
            Pane
          </LiquidGlass>
        </LiquidGlassScene>
      </div>
    )
    const result = render(strict ? <StrictMode>{scene}</StrictMode> : scene)
    const host = result.container.querySelector('[data-liquid-glass-scene]')
    const pane = result.container.querySelector('.liquid-glass')
    const outer = result.container.querySelector('[data-testid="outer"]')
    if (!host || !pane || !outer) throw new Error('Missing fixture elements')
    ancestor = outer
    mockRect(host, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(pane, { x: 20, y: 20, width: 360, height: 70 })
    return { ...result, host, outer, status }
  }

  it('wakes for ancestor CSS motion, falls back while transformed, and recovers at the end', () => {
    const { host, outer, status } = fixture()
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(callbacks.size).toBe(0)
    animations.set(outer, [motion('running')])
    act(() => outer.dispatchEvent(new Event('animationstart', { bubbles: true })))
    expect(callbacks.size).toBeGreaterThan(0)
    transform = 'matrix(1, 0, 0, 1, 10, 0)'
    tick()
    expect(status).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['LiquidGlassScene needs ancestors without transform, perspective or filter.'],
    })
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(callbacks.size).toBeGreaterThan(0)
    animations.set(outer, [])
    transform = 'none'
    act(() => outer.dispatchEvent(new Event('animationend', { bubbles: true })))
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('discovers an ancestor animation already running at mount', () => {
    const { outer, status } = fixture()
    animations.set(outer, [motion('running')])
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(callbacks.size).toBeGreaterThan(0)
    transform = 'matrix(1, 0, 0, 1, 10, 0)'
    tick()
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'fallback' }))
  })

  it('does not wake for unrelated document animation events', () => {
    const { status } = fixture()
    const other = document.createElement('div')
    document.body.append(other)
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    const before = compile.mock.calls.length
    act(() => other.dispatchEvent(new Event('animationstart', { bubbles: true })))
    expect(callbacks.size).toBe(0)
    expect(compile).toHaveBeenCalledTimes(before)
    other.remove()
  })

  it('tracks and stops ancestor transitions when getAnimations is unavailable', () => {
    const { outer, status } = fixture()
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    act(() => outer.dispatchEvent(new Event('transitionrun', { bubbles: true })))
    transform = 'matrix(1, 0, 0, 1, 10, 0)'
    tick()
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'fallback' }))
    expect(callbacks.size).toBeGreaterThan(0)
    transform = 'none'
    act(() => outer.dispatchEvent(new Event('transitioncancel', { bubbles: true })))
    tick()
    expect(status).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(callbacks.size).toBe(0)
  })

  it('removes ancestor event listeners under StrictMode and does not leave polling behind', () => {
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const { unmount } = fixture(true)
    tick()
    unmount()
    for (const name of [
      'animationstart',
      'animationend',
      'animationcancel',
      'transitionrun',
      'transitionend',
      'transitioncancel',
    ]) {
      const listeners = added.mock.calls.filter(
        ([type, , capture]) => type === name && capture === true
      )
      expect(listeners.length).toBeGreaterThan(0)
      for (const [, handler] of listeners) expect(removed).toHaveBeenCalledWith(name, handler, true)
    }
    expect(callbacks.size).toBe(0)
  })
})
