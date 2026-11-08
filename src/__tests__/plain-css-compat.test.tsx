import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidGlass } from '../LiquidGlass'
import { LiquidGlassScene } from '../LiquidGlassScene'
import { ScrollEdge } from '../ScrollEdge'

describe('plain CSS component compatibility', () => {
  beforeEach(() => {
    // Scene effects may schedule rendering, but markup and CSS do not require a WebGL frame.
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders one real scene stylesheet in server HTML for multiple managed panes', () => {
    const html = renderToString(
      <LiquidGlassScene className="consumer-scene">
        <LiquidGlass>First</LiquidGlass>
        <LiquidGlass>Second</LiquidGlass>
      </LiquidGlassScene>
    )
    const host = document.createElement('div')
    host.innerHTML = html
    const root = host.firstElementChild
    expect(root).toHaveClass('liquid-glass-scene-root', 'consumer-scene')
    expect(root).toHaveAttribute('data-liquid-glass-scene')
    expect(root?.querySelectorAll('.liquid-glass')).toHaveLength(2)
    expect(root?.querySelectorAll('style[data-liquid-glass-styles="scene"]')).toHaveLength(1)
    expect(root?.querySelectorAll('style[data-liquid-glass-styles="glass"]')).toHaveLength(0)
    const css = root?.querySelector('style[data-liquid-glass-styles="scene"]')?.textContent
    expect(css).toContain('.liquid-glass__content')
    expect(css).toContain('.liquid-glass-scene__canvas')
    expect(css).toContain("[data-liquid-glass-scene-ready='true']")
    expect(css).not.toContain('&#x27;')
  })

  it('only releases the pane clip while a layered scene is ready', () => {
    const { container } = render(
      <LiquidGlassScene foreground="layered">
        <LiquidGlass nativeContent>Content</LiquidGlass>
      </LiquidGlassScene>
    )
    const scene = container.querySelector<HTMLElement>('[data-liquid-glass-scene]')!
    const pane = container.querySelector<HTMLElement>('.liquid-glass--layered')!
    const content = pane.querySelector<HTMLElement>('.liquid-glass__content')!
    expect(getComputedStyle(pane).overflow).toBe('hidden')
    scene.setAttribute('data-liquid-glass-scene-ready', 'true')
    expect(getComputedStyle(pane).overflow).toBe('visible')
    expect(getComputedStyle(content).overflow).toBe('hidden')
    scene.removeAttribute('data-liquid-glass-scene-ready')
    expect(getComputedStyle(pane).overflow).toBe('hidden')
  })

  it('hides the sampling canvas only for ready layered scenes with a native pane', () => {
    const { container, rerender } = render(
      <LiquidGlassScene foreground="layered">
        <LiquidGlass nativeContent>Content</LiquidGlass>
      </LiquidGlassScene>
    )
    const scene = container.querySelector<HTMLElement>('[data-liquid-glass-scene]')!
    const canvas = scene.querySelector<HTMLElement>('.liquid-glass-scene__canvas')!
    scene.setAttribute('data-liquid-glass-scene-pending', 'true')
    expect(getComputedStyle(canvas).opacity).toBe('1')
    scene.removeAttribute('data-liquid-glass-scene-pending')
    scene.setAttribute('data-liquid-glass-scene-ready', 'true')
    scene.setAttribute('data-liquid-glass-layered-visible', '')
    expect(getComputedStyle(canvas).opacity).toBe('0')
    scene.removeAttribute('data-liquid-glass-scene-ready')
    expect(getComputedStyle(canvas).opacity).toBe('0')

    rerender(<LiquidGlassScene foreground="layered"><div>Empty scene</div></LiquidGlassScene>)
    scene.setAttribute('data-liquid-glass-scene-ready', 'true')
    scene.removeAttribute('data-liquid-glass-layered-visible')
    expect(getComputedStyle(canvas).opacity).toBe('1')
    rerender(<LiquidGlassScene><LiquidGlass>Canvas pane</LiquidGlass></LiquidGlassScene>)
    scene.setAttribute('data-liquid-glass-scene-ready', 'true')
    expect(getComputedStyle(canvas).opacity).toBe('1')
  })

  it('hydrates server markup without replacing the root and forwards className and ref', async () => {
    const ref = createRef<HTMLDivElement>()
    const content = (
      <LiquidGlassScene className="consumer-scene" ref={ref}>
        <LiquidGlass className="consumer-pane">Content</LiquidGlass>
      </LiquidGlassScene>
    )
    const host = document.createElement('div')
    host.innerHTML = renderToString(content)
    document.body.append(host)
    const originalRoot = host.firstElementChild
    const errors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(host, content, { onRecoverableError: (error) => errors.push(error) })
    })
    expect(errors).toEqual([])
    expect(host.firstElementChild).toBe(originalRoot)
    expect(ref.current).toBe(originalRoot)
    expect(ref.current).toHaveClass('liquid-glass-scene-root', 'consumer-scene')
    expect(host.querySelector('.liquid-glass')).toHaveClass('consumer-pane')
    expect(host.querySelectorAll('style[data-liquid-glass-styles="scene"]')).toHaveLength(1)
    await act(async () => root?.unmount())
    host.remove()
  })

  it('keeps independently rendered glass and scroll-edge styles on the server', () => {
    const html = renderToString(
      <>
        <LiquidGlass className="custom-glass">Pane</LiquidGlass>
        <ScrollEdge className="custom-scroll">Content</ScrollEdge>
      </>
    )
    const host = document.createElement('div')
    host.innerHTML = html
    const glass = host.querySelector('.custom-glass')
    const scroll = host.querySelector('.custom-scroll')
    expect(glass).toHaveClass('liquid-glass-root')
    expect(glass?.querySelector('style[data-liquid-glass-styles="glass"]')?.textContent).toContain(
      '.liquid-glass__content'
    )
    expect(
      scroll?.querySelector('style[data-liquid-glass-styles="scroll-edge"]')?.textContent
    ).toContain('.scroll-edge__scrollable')
  })

  it('can omit automatic styles for external CSS without forwarding the option or breaking hydration', async () => {
    const sceneRef = createRef<HTMLDivElement>()
    const content = (
      <div>
        <LiquidGlass includeStyles={false} className="standalone">
          Pane
        </LiquidGlass>
        <LiquidGlassScene includeStyles={false} className="scene" ref={sceneRef}>
          <LiquidGlass includeStyles>Managed pane</LiquidGlass>
        </LiquidGlassScene>
        <ScrollEdge includeStyles={false} className="edge">
          Content
        </ScrollEdge>
      </div>
    )
    const host = document.createElement('div')
    host.innerHTML = renderToString(content)
    document.body.append(host)
    expect(host.querySelectorAll('style[data-liquid-glass-styles]')).toHaveLength(0)
    expect(host.querySelector('[includestyles]')).toBeNull()
    const originalRoot = host.firstElementChild
    const errors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(host, content, { onRecoverableError: (error) => errors.push(error) })
    })
    expect(errors).toEqual([])
    expect(host.firstElementChild).toBe(originalRoot)
    expect(sceneRef.current).toHaveClass('scene', 'liquid-glass-scene-root')
    expect(host.querySelectorAll('style[data-liquid-glass-styles]')).toHaveLength(0)
    expect(host.querySelector('[includestyles]')).toBeNull()
    await act(async () => root?.unmount())
    host.remove()
  })

  it('retains the previous JavaScript as behavior and forwards refs to each actual root', () => {
    const glassRef = createRef<HTMLDivElement>()
    const sceneRef = createRef<HTMLDivElement>()
    const scrollRef = createRef<HTMLDivElement>()
    // `as` was accepted at runtime by the previous wrappers, though it was not in their public types.
    const asSection = { as: 'section' }
    const asArticle = { as: 'article' }
    const asAside = { as: 'aside' }
    const { container } = render(
      <>
        <LiquidGlass {...asSection} ref={glassRef} className="pane">
          Pane
        </LiquidGlass>
        <LiquidGlassScene {...asArticle} ref={sceneRef} className="scene">
          Scene
        </LiquidGlassScene>
        <ScrollEdge {...asAside} ref={scrollRef} className="edge">
          Edge
        </ScrollEdge>
      </>
    )
    expect(glassRef.current?.tagName).toBe('SECTION')
    expect(sceneRef.current?.tagName).toBe('ARTICLE')
    expect(scrollRef.current?.tagName).toBe('ASIDE')
    expect(glassRef.current).toHaveClass('pane', 'liquid-glass', 'liquid-glass-root')
    expect(sceneRef.current).toHaveClass('scene', 'liquid-glass-scene-root')
    expect(scrollRef.current).toHaveClass('edge', 'scroll-edge')
    expect(container.querySelector('[as]')).toBeNull()
  })
})
