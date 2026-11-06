import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass, LiquidGlassScene } from '../index'
import * as compilerModule from '../scene/dom-scene'
import * as rendererModule from '../scene/renderer'
import * as continuityModule from '../scene/continuity'
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

describe('glass-only scene presentation', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number
  let result: CompiledScene
  const renderFrame = vi.fn(() => true)
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
      issues: [],
      liveGeometry: false,
      media: [],
    }
    vi.stubGlobal('innerWidth', 400)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    vi.spyOn(rendererModule, 'createSceneRenderer').mockReturnValue({
      render: renderFrame,
      setScene: vi.fn(),
      dispose: vi.fn(),
    })
    vi.spyOn(compilerModule, 'createSceneCompiler').mockReturnValue({
      compile: () => result,
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    document.body.style.removeProperty('background-color')
    document.documentElement.style.removeProperty('direction')
    for (const key of ['scrollHeight', 'clientHeight', 'scrollWidth', 'clientWidth'])
      Reflect.deleteProperty(document.documentElement, key)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('presents only the enclosing pane and keeps native clicks in their original targets', () => {
    const onNative = vi.fn()
    const onOther = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <button onClick={onNative}>Native button</button>
        <button onClick={onOther}>Other button</button>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Outer
        </LiquidGlass>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Inner
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const panes = container.querySelectorAll('.liquid-glass')
    if (!host || !panes[0] || !panes[1]) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(panes[0], { x: 20, y: 700, width: 360, height: 70 })
    mockRect(panes[1], { x: 24, y: 704, width: 114, height: 62 })
    result.targets = [
      {
        element: screen.getByText('Other button'),
        rect: { x: 0, y: 0, width: 100, height: 100 },
        space: 'viewport',
      },
    ]
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(container.querySelector('canvas')?.style.clipPath).toBe(
      'inset(700px 20px 30px 20px round 35px)'
    )
    fireEvent.click(screen.getByText('Native button'), { detail: 1, clientX: 20, clientY: 20 })
    expect(onNative).toHaveBeenCalledOnce()
    expect(onOther).not.toHaveBeenCalled()

    mockRect(panes[0], { x: 30, y: 680, width: 340, height: 80 })
    mockRect(panes[1], { x: 34, y: 684, width: 110, height: 72 })
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(container.querySelector('canvas')?.style.clipPath).toBe(
      'inset(680px 30px 40px 30px round 40px)'
    )
  })

  it('keeps an anchored canvas and native controls together during elastic movement', () => {
    vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    const onClick = vi.fn()
    function AnchoredFixture() {
      const [nav, setNav] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene presentation="glass-only" canvasContainer={nav}>
          <nav ref={setNav} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
            <button onClick={onClick}>Nav button</button>
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container, unmount } = render(
      <StrictMode>
        <AnchoredFixture />
      </StrictMode>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const nav = container.querySelector('nav')
    const canvas = nav?.querySelector('canvas')
    if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.opacity).toBe('1')
    expect(canvas.style.pointerEvents).toBe('none')
    expect(canvas.style.left).toBe('-20px')
    expect(canvas.style.top).toBe('-700px')
    expect(canvas.style.clipPath).toBe('inset(700px 20px 30px 20px round 35px)')
    fireEvent.click(screen.getByRole('button', { name: 'Nav button' }))
    expect(onClick).toHaveBeenCalledOnce()

    vi.stubGlobal('scrollY', -80)
    mockRect(host, { x: 0, y: 80, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 720, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 720, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.top).toBe('-720px')
    expect(canvas.style.clipPath).toBe('inset(720px 20px 10px 20px round 35px)')

    vi.stubGlobal('scrollY', 400)
    mockRect(host, { x: 0, y: -400, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    vi.stubGlobal('scrollY', 480)
    mockRect(host, { x: 0, y: -480, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 650, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 650, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(canvas.style.top).toBe('-650px')
    expect(canvas.style.clipPath).toBe('inset(650px 20px 80px 20px round 35px)')
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 480 }))
    unmount()
    expect(nav.querySelector('canvas')).toBeNull()
  })

  it.each([
    { edge: 'top', initialScroll: 0, bouncedScroll: -80, initialTop: 700, bouncedTop: 780 },
    { edge: 'bottom', initialScroll: 400, bouncedScroll: 480, initialTop: 10, bouncedTop: -60 },
  ])(
    'keeps the anchored pane visible when $edge overscroll moves it partly outside the viewport',
    ({ initialScroll, bouncedScroll, initialTop, bouncedTop }) => {
      vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
      document.body.style.backgroundColor = 'rgb(255, 255, 255)'
      for (const [key, value] of Object.entries({
        scrollHeight: 1200,
        clientHeight: 800,
        scrollWidth: 400,
        clientWidth: 400,
      }))
        Object.defineProperty(document.documentElement, key, { configurable: true, value })
      vi.stubGlobal('scrollY', initialScroll)
      const onStatusChange = vi.fn()
      function Fixture() {
        const [nav, setNav] = useState<HTMLElement | null>(null)
        return (
          <LiquidGlassScene
            presentation="glass-only"
            canvasContainer={nav}
            onStatusChange={onStatusChange}
          >
            <nav ref={setNav} style={{ position: 'fixed' }}>
              <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
            </nav>
          </LiquidGlassScene>
        )
      }
      const { container } = render(<Fixture />)
      const host = container.querySelector('[data-liquid-glass-scene]')
      const pane = container.querySelector('.liquid-glass')
      const nav = container.querySelector('nav')
      const canvas = nav?.querySelector('canvas')
      if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
      mockRect(host, { x: 0, y: -initialScroll, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: initialTop, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: initialTop, width: 360, height: 70 })
      tick()
      expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
      expect(canvas.style.opacity).toBe('1')

      vi.stubGlobal('scrollY', bouncedScroll)
      mockRect(host, { x: 0, y: -bouncedScroll, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: bouncedTop, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: bouncedTop, width: 360, height: 70 })
      act(() => window.dispatchEvent(new Event('scroll')))
      tick()
      expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
      expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
      expect(canvas.style.opacity).toBe('1')
      expect(canvas.parentElement).toBe(nav)
      expect(canvas.style.top).toBe(`${-bouncedTop}px`)
      expect(canvas.style.clipPath).toBe(
        `inset(${bouncedTop}px 20px ${800 - bouncedTop - 70}px 20px round 35px)`
      )
      expect(renderFrame).toHaveBeenLastCalledWith(
        expect.objectContaining({ scrollY: bouncedScroll })
      )

      vi.stubGlobal('scrollY', initialScroll)
      mockRect(host, { x: 0, y: -initialScroll, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: initialTop, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: initialTop, width: 360, height: 70 })
      act(() => window.dispatchEvent(new Event('scroll')))
      tick()
      expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
      expect(canvas.style.opacity).toBe('1')
      expect(renderFrame).toHaveBeenLastCalledWith(
        expect.objectContaining({ scrollY: initialScroll })
      )
    }
  )

  it('keeps separate anchored panes together during elastic overscroll', () => {
    vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    vi.stubGlobal('scrollY', 0)
    const onStatusChange = vi.fn()
    function Fixture() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene
          presentation="glass-only"
          canvasContainer={anchor}
          onStatusChange={onStatusChange}
        >
          <div ref={setAnchor} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
              First
            </LiquidGlass>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
              Second
            </LiquidGlass>
          </div>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const panes = container.querySelectorAll('.liquid-glass')
    const anchor = container.querySelector('div[style*="fixed"]')
    const canvas = anchor?.querySelector('canvas')
    if (!host || !panes[0] || !panes[1] || !anchor || !canvas)
      throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(anchor, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(panes[0], { x: 20, y: 10, width: 360, height: 70 })
    mockRect(panes[1], { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })

    vi.stubGlobal('scrollY', -80)
    mockRect(host, { x: 0, y: 80, width: 400, height: 1200 })
    mockRect(anchor, { x: 0, y: 80, width: 400, height: 800 })
    mockRect(panes[0], { x: 20, y: 90, width: 360, height: 70 })
    mockRect(panes[1], { x: 20, y: 780, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(canvas.style.opacity).toBe('1')
    expect(canvas.style.clipPath).toMatch(/^path\(/)
    expect(canvas.style.top).toBe('-80px')

    vi.stubGlobal('scrollY', -79)
    mockRect(host, { x: 0, y: 79, width: 400, height: 1200 })
    mockRect(anchor, { x: 0, y: 79, width: 400, height: 800 })
    mockRect(panes[0], { x: 20, y: 89, width: 360, height: 70 })
    mockRect(panes[1], { x: 20, y: 795, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'fallback' }))
    expect(canvas.style.opacity).toBe('0')
  })

  it.each([
    { initialScroll: 0, bouncedScroll: -80, initialTop: 700, bouncedTop: 801 },
    { initialScroll: 400, bouncedScroll: 480, initialTop: 10, bouncedTop: -71 },
  ])(
    'rejects anchored pane movement beyond the measured elastic excursion',
    ({ initialScroll, bouncedScroll, initialTop, bouncedTop }) => {
      vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
      document.body.style.backgroundColor = 'rgb(255, 255, 255)'
      for (const [key, value] of Object.entries({
        scrollHeight: 1200,
        clientHeight: 800,
        scrollWidth: 400,
        clientWidth: 400,
      }))
        Object.defineProperty(document.documentElement, key, { configurable: true, value })
      vi.stubGlobal('scrollY', initialScroll)
      const onStatusChange = vi.fn()
      function Fixture() {
        const [nav, setNav] = useState<HTMLElement | null>(null)
        return (
          <LiquidGlassScene
            presentation="glass-only"
            canvasContainer={nav}
            onStatusChange={onStatusChange}
          >
            <nav ref={setNav} style={{ position: 'fixed' }}>
              <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
            </nav>
          </LiquidGlassScene>
        )
      }
      const { container } = render(<Fixture />)
      const host = container.querySelector('[data-liquid-glass-scene]')
      const pane = container.querySelector('.liquid-glass')
      const nav = container.querySelector('nav')
      const canvas = nav?.querySelector('canvas')
      if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
      mockRect(host, { x: 0, y: -initialScroll, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: initialTop, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: initialTop, width: 360, height: 70 })
      tick()
      expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })

      vi.stubGlobal('scrollY', bouncedScroll)
      mockRect(host, { x: 0, y: -bouncedScroll, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: bouncedTop, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: bouncedTop, width: 360, height: 70 })
      act(() => window.dispatchEvent(new Event('scroll')))
      tick()
      expect(onStatusChange).toHaveBeenLastCalledWith({
        status: 'fallback',
        reasons: [
          'Glass-only presentation requires the enclosing pane inside the scene and viewport.',
        ],
      })
      expect(canvas.style.opacity).toBe('0')
    }
  )

  it('recovers during bounce after a temporary external sibling stops obstructing the backdrop', () => {
    const safeSiblings = vi
      .spyOn(continuityModule, 'externalSiblingsAvoidRegion')
      .mockReturnValue(true)
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    vi.stubGlobal('scrollY', 400)
    const onStatusChange = vi.fn()
    function Fixture() {
      const [nav, setNav] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene
          presentation="glass-only"
          canvasContainer={nav}
          onStatusChange={onStatusChange}
        >
          <nav ref={setNav} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const nav = container.querySelector('nav')
    const canvas = nav?.querySelector('canvas')
    if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: -400, width: 400, height: 1200 })
    mockRect(nav, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })

    safeSiblings.mockReturnValue(false)
    vi.stubGlobal('scrollY', 480)
    mockRect(host, { x: 0, y: -480, width: 400, height: 1200 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: [
        'Glass-only presentation requires the enclosing pane inside the scene and viewport.',
      ],
    })
    expect(canvas.style.opacity).toBe('0')

    safeSiblings.mockReturnValue(true)
    vi.stubGlobal('scrollY', 470)
    mockRect(host, { x: 0, y: -470, width: 400, height: 1200 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(canvas.style.opacity).toBe('1')
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 470 }))

    result.issues = ['Unsupported content']
    vi.stubGlobal('scrollY', 480)
    mockRect(host, { x: 0, y: -480, width: 400, height: 1200 })
    fireEvent.pointerDown(nav)
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['Unsupported content'],
    })
    result.issues = []
    vi.stubGlobal('scrollY', 470)
    mockRect(host, { x: 0, y: -470, width: 400, height: 1200 })
    fireEvent.pointerDown(nav)
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: [
        'Glass-only presentation requires the enclosing pane inside the scene and viewport.',
      ],
    })
    expect(canvas.style.opacity).toBe('0')
  })

  it.each([
    { height: 799, expected: 'ready' },
    { height: 600, expected: 'fallback' },
  ])(
    'handles a viewport height of $height during bounded bottom bounce',
    ({ height, expected }) => {
      vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
      document.body.style.backgroundColor = 'rgb(255, 255, 255)'
      for (const [key, value] of Object.entries({
        scrollHeight: 1200,
        clientHeight: 800,
        scrollWidth: 400,
        clientWidth: 400,
      }))
        Object.defineProperty(document.documentElement, key, { configurable: true, value })
      vi.stubGlobal('scrollY', 400)
      const onStatusChange = vi.fn()
      function Fixture() {
        const [nav, setNav] = useState<HTMLElement | null>(null)
        return (
          <LiquidGlassScene
            presentation="glass-only"
            canvasContainer={nav}
            onStatusChange={onStatusChange}
          >
            <nav ref={setNav} style={{ position: 'fixed' }}>
              <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
            </nav>
          </LiquidGlassScene>
        )
      }
      const { container } = render(<Fixture />)
      const host = container.querySelector('[data-liquid-glass-scene]')
      const pane = container.querySelector('.liquid-glass')
      const nav = container.querySelector('nav')
      const canvas = nav?.querySelector('canvas')
      if (!host || !pane || !nav || !canvas) throw new Error('Missing scene elements')
      mockRect(host, { x: 0, y: -400, width: 400, height: 1200 })
      mockRect(nav, { x: 20, y: 700, width: 360, height: 70 })
      mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
      tick()
      expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })

      vi.stubGlobal('innerHeight', height)
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: height,
      })
      vi.stubGlobal('scrollY', 480)
      mockRect(host, { x: 0, y: -480, width: 400, height: 1200 })
      act(() => window.dispatchEvent(new Event('scroll')))
      tick()
      expect(onStatusChange.mock.lastCall?.[0]?.status).toBe(expected)
      expect(canvas.style.opacity).toBe(expected === 'ready' ? '1' : '0')
    }
  )

  it('rejects a canvas container that is not fixed', () => {
    const onStatusChange = vi.fn()
    function Fixture() {
      const [target, setTarget] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene
          presentation="glass-only"
          canvasContainer={target}
          onStatusChange={onStatusChange}
        >
          <nav ref={setTarget} style={{ position: 'relative' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0} />
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: [
        'Canvas container must be an unscaled fixed ancestor of every glass-only pane inside the scene.',
      ],
    })
    expect(container.querySelector('canvas')?.style.opacity).toBe('0')
  })

  it('renders disjoint panes while leaving the gap and native controls visible', () => {
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          First
        </LiquidGlass>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Second
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const panes = container.querySelectorAll('.liquid-glass')
    if (!host || !panes[0] || !panes[1]) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(panes[0], { x: 20, y: 700, width: 120, height: 70 })
    mockRect(panes[1], { x: 220, y: 700, width: 120, height: 70 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(screen.getByText('First')).toBeVisible()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(container.querySelector('canvas')?.style.clipPath).toMatch(/^path\(/)
    expect(renderFrame).toHaveBeenCalled()
  })

  it('ignores a disconnected pane while its registration cleanup is pending', () => {
    const onStatusChange = vi.fn()
    function Fixture() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null)
      return (
        <LiquidGlassScene
          presentation="glass-only"
          canvasContainer={anchor}
          onStatusChange={onStatusChange}
        >
          <nav ref={setAnchor} style={{ position: 'fixed' }}>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
              First
            </LiquidGlass>
            <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
              Second
            </LiquidGlass>
          </nav>
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const nav = container.querySelector('nav')
    const panes = container.querySelectorAll('.liquid-glass')
    if (!host || !nav || !panes[0] || !panes[1]) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(nav, { x: 0, y: 0, width: 400, height: 800 })
    mockRect(panes[0], { x: 20, y: 20, width: 360, height: 70 })
    mockRect(panes[1], { x: 20, y: 120, width: 360, height: 70 })
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    const nextSibling = panes[1].nextSibling
    panes[1].remove()
    vi.stubGlobal('scrollY', 1)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(nav.querySelector('canvas')?.style.clipPath).toBe(
      'inset(20px 20px 710px 20px round 35px)'
    )
    nav.insertBefore(panes[1], nextSibling)
  })

  it('recompiles unresolved assets only when they cross the sampling region', () => {
    let invalidate = () => {}
    const compile = vi.fn<SceneCompiler['compile']>(() => result)
    vi.mocked(compilerModule.createSceneCompiler).mockImplementation((callback) => {
      invalidate = callback
      return { compile, dispose: vi.fn() }
    })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <img alt="" data-testid="unresolved" />
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const image = screen.getByTestId('unresolved')
    if (!host || !pane || !(image instanceof HTMLImageElement))
      throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(image, { x: 100, y: 0, width: 40, height: 40 })
    result.issues = ['Image is loading']
    result.samplingWatches = [{ element: image, relation: 'outside' }]
    tick()
    expect(compile).toHaveBeenCalledTimes(1)
    const region = compile.mock.calls[0]?.[4]
    if (!region) throw new Error('Missing sampling region')
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(1)

    mockRect(image, { x: 100, y: region.y + 20, width: 40, height: 40 })
    vi.stubGlobal('scrollY', 200)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)

    result.samplingWatches = [{ element: image, relation: 'inside' }]
    vi.stubGlobal('scrollY', 300)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)

    mockRect(image, { x: 100, y: 0, width: 40, height: 40 })
    vi.stubGlobal('scrollY', 400)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(3)

    result.issues = []
    result.samplingWatches = []
    act(() => invalidate())
    tick()
    expect(compile).toHaveBeenCalledTimes(4)
  })

  it('recompiles a generic watched element when nested layout enters and leaves the region', () => {
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    const compile = vi.fn<SceneCompiler['compile']>(() => result)
    vi.mocked(compilerModule.createSceneCompiler).mockReturnValue({ compile, dispose: vi.fn() })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <div data-testid="bounded-effect" style={{ overflow: 'auto' }} />
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const effect = screen.getByTestId('bounded-effect')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(effect, { x: 100, y: -10_000, width: 40, height: 40 })
    result.samplingWatches = [{ element: effect, relation: 'outside' }]
    tick()
    expect(compile).toHaveBeenCalledTimes(1)
    const region = compile.mock.calls[0]?.[4]
    if (!region) throw new Error('Missing sampling region')

    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(1)

    mockRect(effect, { x: 100, y: region.y + 20, width: 40, height: 40 })
    result.samplingWatches = [{ element: effect, relation: 'inside' }]
    fireEvent.scroll(effect)
    tick()
    expect(compile).toHaveBeenCalledTimes(2)

    mockRect(effect, { x: 100, y: -10_000, width: 40, height: 40 })
    vi.stubGlobal('scrollY', 200)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(3)
  })

  it('rechecks unresolved fixed assets when an animated pane moves or the source detaches', () => {
    const compile = vi.fn<SceneCompiler['compile']>(() => result)
    vi.mocked(compilerModule.createSceneCompiler).mockReturnValue({ compile, dispose: vi.fn() })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <img alt="" data-testid="unresolved-fixed" style={{ position: 'fixed' }} />
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const source = container.querySelector('.liquid-glass-scene__content')
    const pane = container.querySelector('.liquid-glass')
    const image = screen.getByTestId('unresolved-fixed')
    if (!host || !source || !pane || !(image instanceof HTMLImageElement))
      throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(image, { x: 100, y: 400, width: 40, height: 40 })
    let animating = false
    Object.defineProperty(source, 'getAnimations', {
      configurable: true,
      value: () => (animating ? [{ playState: 'running' }] : []),
    })
    result.issues = ['SVG is loading']
    result.samplingWatches = [{ element: image, relation: 'outside' }]
    tick()
    expect(compile).toHaveBeenCalledTimes(1)

    animating = true
    vi.stubGlobal('scrollY', 10)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)
    // The fixed asset does not move; the animated pane's sampling region does.
    mockRect(pane, { x: 20, y: 500, width: 360, height: 70 })
    tick()
    expect(compile).toHaveBeenCalledTimes(3)

    result.samplingWatches = [{ element: image, relation: 'inside' }]
    image.remove()
    tick()
    expect(compile).toHaveBeenCalledTimes(4)
  })

  it('falls back on an invalid region and retries once it becomes valid without compiling every frame', () => {
    const compile = vi.fn<SceneCompiler['compile']>(() => result)
    vi.mocked(compilerModule.createSceneCompiler).mockReturnValue({ compile, dispose: vi.fn() })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <img alt="" data-testid="unresolved-region" />
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const image = screen.getByTestId('unresolved-region')
    if (!host || !pane || !(image instanceof HTMLImageElement))
      throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    mockRect(image, { x: 100, y: 0, width: 40, height: 40 })
    result.issues = ['Image is loading']
    result.samplingWatches = [{ element: image, relation: 'outside' }]
    tick()
    expect(compile).toHaveBeenCalledTimes(1)

    mockRect(pane, { x: 20, y: 700, width: 0, height: 70 })
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)
    expect(compile.mock.calls[1]?.[4]).toBeUndefined()

    vi.stubGlobal('scrollY', 200)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(2)

    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    vi.stubGlobal('scrollY', 300)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(compile).toHaveBeenCalledTimes(3)
    expect(compile.mock.calls[2]?.[4]).toBeDefined()
  })

  it('keeps separate panes visible and falls back when one leaves the viewport', () => {
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Outer
        </LiquidGlass>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Inner
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const panes = container.querySelectorAll('.liquid-glass')
    if (!host || !panes[0] || !panes[1]) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(panes[0], { x: 20, y: 700, width: 360, height: 70 })
    mockRect(panes[1], { x: 24, y: 704, width: 114, height: 62 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')

    mockRect(panes[1], { x: 0, y: 600, width: 114, height: 62 })
    vi.stubGlobal('scrollY', 100)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(container.querySelector('canvas')?.style.clipPath).toMatch(/^path\(/)

    mockRect(panes[1], { x: -20, y: 600, width: 114, height: 62 })
    vi.stubGlobal('scrollY', 150)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: [
        'Glass-only presentation requires the enclosing pane inside the scene and viewport.',
      ],
    })

    mockRect(panes[1], { x: 24, y: 704, width: 114, height: 62 })
    vi.stubGlobal('scrollY', 200)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
  })

  it('keeps the last complete frame briefly while route assets load, then swaps it', () => {
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(renderFrame).toHaveBeenCalledTimes(1)

    result = { ...result, issues: ['SVG is loading', 'Background image is loading'] }
    fireEvent.input(pane)
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(host).toHaveAttribute('data-liquid-glass-scene-pending', 'true')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'pending',
      reasons: ['SVG is loading', 'Background image is loading'],
    })
    expect(renderFrame).toHaveBeenCalledTimes(1)

    result = { ...result, issues: [] }
    fireEvent.input(pane)
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready' })
    expect(renderFrame).toHaveBeenCalledTimes(2)
  })

  it('fails closed when pending expires or includes a hard error', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    result = { ...result, issues: ['Image is loading'] }
    fireEvent.input(pane)
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-pending', 'true')
    now += 351
    act(() => vi.advanceTimersByTime(351))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['Image is loading'],
    })

    result = { ...result, issues: [] }
    fireEvent.input(pane)
    tick()
    result = {
      ...result,
      issues: ['Image is loading', 'Cross-origin image requires CORS permission'],
    }
    fireEvent.input(pane)
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'fallback', reasons: result.issues })
  })

  it('hides the preserved frame immediately if WebGL context is lost', () => {
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    const canvas = container.querySelector('canvas')
    if (!host || !pane || !canvas) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    result = { ...result, issues: ['Image is loading'] }
    fireEvent.input(pane)
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-pending', 'true')
    fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }))
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['WebGL context lost.'],
    })
  })

  it('does not reveal stale pixels when a second pane appears during loading', () => {
    const onStatusChange = vi.fn()
    function Fixture() {
      const [open, setOpen] = useState(false)
      return (
        <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
          <button onClick={() => setOpen(true)}>Open menu</button>
          <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
            Navigation
          </LiquidGlass>
          {open && (
            <LiquidGlass shapeRadius={30} shapeRoundness={2} shadowFactor={0}>
              Menu
            </LiquidGlass>
          )}
        </LiquidGlassScene>
      )
    }
    const { container } = render(<Fixture />)
    const host = container.querySelector('[data-liquid-glass-scene]')
    const nav = container.querySelector('.liquid-glass')
    if (!host || !nav) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(nav, { x: 20, y: 20, width: 360, height: 70 })
    tick()
    const canvas = container.querySelector('canvas')
    if (!canvas) throw new Error('Missing canvas')
    const previousClip = canvas.style.clipPath
    result = { ...result, issues: ['Image is loading'] }
    fireEvent.click(screen.getByText('Open menu'))
    const menu = container.querySelectorAll('.liquid-glass')[1]
    if (!menu) throw new Error('Missing menu pane')
    mockRect(menu, { x: 20, y: 110, width: 360, height: 250 })
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(canvas.style.clipPath).toBe(previousClip)
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['Image is loading'],
    })
  })

  it('does not preserve a stale frame if the enclosing pane changes while loading', () => {
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    result = { ...result, issues: ['Image is loading'] }
    mockRect(pane, { x: 20, y: 650, width: 360, height: 70 })
    fireEvent.input(pane)
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['Image is loading'],
    })
  })

  it('does not present a pending frame before any complete frame exists', () => {
    result = { ...result, issues: ['SVG is loading'] }
    const onStatusChange = vi.fn()
    const { container } = render(
      <LiquidGlassScene presentation="glass-only" onStatusChange={onStatusChange}>
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1000 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'fallback',
      reasons: ['SVG is loading'],
    })
  })

  it('renders real pane geometry and raw scroll coordinates during top and bottom bounce', () => {
    vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 800,
    })
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      configurable: true,
      value: 400,
    })
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 400,
    })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    vi.stubGlobal('scrollY', 450)
    mockRect(host, { x: 0, y: -450, width: 400, height: 1200 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 450 }))
    expect(container.querySelector('canvas')?.style.clipPath).toBe(
      'inset(700px 20px 30px 20px round 35px)'
    )

    // Capture a normal frame with this pane near the top before testing top bounce.
    vi.stubGlobal('scrollY', 0)
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 10, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')

    vi.stubGlobal('scrollY', -80)
    mockRect(host, { x: 0, y: 80, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 10, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: -80 }))
    expect(container.querySelector('canvas')?.style.clipPath).toBe(
      'inset(10px 20px 720px 20px round 35px)'
    )

    // Elastic tolerance must not hide a real host/pane containment failure.
    mockRect(host, { x: 0, y: 300, width: 400, height: 1200 })
    vi.stubGlobal('scrollY', -81)
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
  })

  it('does not extend a partial-document host during overscroll', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 100, width: 400, height: 1100 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')

    vi.stubGlobal('scrollY', 450)
    mockRect(host, { x: 0, y: -350, width: 400, height: 1100 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-pending')
  })

  it('retains a viewport-clipped pane during a bounded bottom bounce', () => {
    vi.spyOn(continuityModule, 'externalSiblingsAvoidRegion').mockReturnValue(true)
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    for (const [key, value] of Object.entries({
      scrollHeight: 1200,
      clientHeight: 800,
      scrollWidth: 400,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 730, width: 360, height: 70 })
    tick()
    vi.stubGlobal('scrollY', 450)
    mockRect(host, { x: 0, y: -450, width: 400, height: 1200 })
    mockRect(pane, { x: 20, y: 750, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')
    expect(renderFrame).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 450 }))
    expect(container.querySelector('canvas')?.style.clipPath).toBe(
      'inset(750px 20px -20px 20px round 35px)'
    )
  })

  it('does not treat ordinary negative RTL horizontal scroll as elastic overscroll', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    document.documentElement.style.direction = 'rtl'
    for (const [key, value] of Object.entries({
      scrollHeight: 800,
      clientHeight: 800,
      scrollWidth: 800,
      clientWidth: 400,
    }))
      Object.defineProperty(document.documentElement, key, { configurable: true, value })
    const { container } = render(
      <LiquidGlassScene presentation="glass-only">
        <LiquidGlass shapeRadius={100} shapeRoundness={2} shadowFactor={0}>
          Pane
        </LiquidGlass>
      </LiquidGlassScene>
    )
    const host = container.querySelector('[data-liquid-glass-scene]')
    const pane = container.querySelector('.liquid-glass')
    if (!host || !pane) throw new Error('Missing scene elements')
    mockRect(host, { x: 0, y: 0, width: 800, height: 800 })
    mockRect(pane, { x: 20, y: 700, width: 360, height: 70 })
    tick()
    expect(host).toHaveAttribute('data-liquid-glass-scene-ready', 'true')

    vi.stubGlobal('scrollX', -80)
    mockRect(host, { x: 80, y: 0, width: 800, height: 800 })
    mockRect(pane, { x: 10, y: 700, width: 360, height: 70 })
    act(() => window.dispatchEvent(new Event('scroll')))
    tick()
    expect(host).not.toHaveAttribute('data-liquid-glass-scene-ready')
  })
})
