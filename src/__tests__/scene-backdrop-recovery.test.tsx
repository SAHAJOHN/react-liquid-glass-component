import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import type { CompiledScene, SceneRect } from '../scene/types'

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

describe('backdrop fallback recovery', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let result: CompiledScene
  const onStatusChange = vi.fn()
  const compile = vi.fn(() => result)
  const tick = () =>
    act(() => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(100))
    })

  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    result = {
      scene: { background: [0, 0, 0, 1], items: [] },
      targets: [],
      issues: ['CSS filters outside LiquidGlass require native HTML rendering'],
      liveGeometry: true,
      media: [],
    }
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('scrollY', 0)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: vi.fn(() => true),
      setScene: vi.fn(),
      dispose: vi.fn(),
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({
      compile,
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function fixture() {
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Navigation
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const source = container.querySelector('.liquid-glass-scene__content')
    if (!host || !pane || !source) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 20, width: 360, height: 70 })
    return { host, source }
  }

  it('recompiles after scrolling moves a live unsupported backdrop away', () => {
    const { host } = fixture()
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['CSS filters outside LiquidGlass require native HTML rendering'],
    })
    result = { ...result, issues: [] }
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('recompiles during an ongoing animation even while the previous frame fell back', () => {
    const { host, source } = fixture()
    Object.defineProperty(source, 'getAnimations', {
      configurable: true,
      value: () => [{ playState: 'running' }],
    })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['CSS filters outside LiquidGlass require native HTML rendering'],
    })
    result = { ...result, issues: [] }
    tick()
    expect(compile).toHaveBeenCalledTimes(2)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('does not poll a paused animation but recovers when scrolling resumes', () => {
    const { host, source } = fixture()
    Object.defineProperty(source, 'getAnimations', {
      configurable: true,
      value: () => [{ playState: 'paused' }],
    })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['CSS filters outside LiquidGlass require native HTML rendering'],
    })
    result = { ...result, issues: [] }
    tick()
    expect(compile).toHaveBeenCalledTimes(1)
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
  })
})
