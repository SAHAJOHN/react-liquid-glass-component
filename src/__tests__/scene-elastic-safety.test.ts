import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canExpandElasticScene,
  externalSiblingsAvoidRegion,
  getOverscroll,
  glassSamplingRegion,
  hasFlatElasticBackground,
} from '../scene/continuity'
import { GLASS_STUDIO_DEFAULTS } from '../studio-props'
import type { ElasticGeometry } from '../scene/continuity'

const baseline: ElasticGeometry = {
  host: { x: 0, y: 0, width: 400, height: 1200 },
  pane: { x: 20, y: 700, width: 360, height: 70 },
  documentWidth: 400,
  documentHeight: 1200,
  viewportWidth: 400,
  viewportHeight: 800,
  pixelRatio: 2,
}

describe('elastic scene safety', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })
  it('allows a full-document scene with unchanged geometry and pane displacement within excursion', () => {
    expect(canExpandElasticScene(baseline, baseline, getOverscroll(0, 450, 0, 400))).toBe(true)
    const moved = { ...baseline, pane: { ...baseline.pane, y: 740 } }
    expect(canExpandElasticScene(baseline, moved, getOverscroll(0, 450, 0, 400))).toBe(true)
    expect(canExpandElasticScene(baseline, baseline, getOverscroll(0, -80, 0, 400))).toBe(true)
    expect(canExpandElasticScene(baseline, baseline, getOverscroll(-20, 0, 0, 400))).toBe(true)
  })

  it('rejects partial hosts, changed layout, unrelated pane movement and missing baselines', () => {
    const bounce = getOverscroll(0, -80, 0, 400)
    const partial = { ...baseline, host: { ...baseline.host, y: 100, height: 1100 } }
    expect(canExpandElasticScene(undefined, baseline, bounce)).toBe(false)
    expect(canExpandElasticScene(partial, partial, bounce)).toBe(false)
    expect(canExpandElasticScene(baseline, { ...baseline, documentHeight: 1300 }, bounce)).toBe(
      false
    )
    expect(canExpandElasticScene(baseline, { ...baseline, viewportHeight: 780 }, bounce)).toBe(
      false
    )
    expect(
      canExpandElasticScene(baseline, { ...baseline, host: { ...baseline.host, y: -1 } }, bounce)
    ).toBe(false)
    expect(
      canExpandElasticScene(baseline, { ...baseline, pane: { ...baseline.pane, y: 10 } }, bounce)
    ).toBe(false)
    expect(
      canExpandElasticScene(
        baseline,
        { ...baseline, pane: { ...baseline.pane, width: 350 } },
        bounce
      )
    ).toBe(false)
  })

  it('accepts a transparent scene over a flat opaque document background only', () => {
    const transparent = { color: 'rgba(0, 0, 0, 0)', image: 'none' }
    const solid = { color: 'rgb(246, 248, 245)', image: 'none' }
    expect(hasFlatElasticBackground(transparent, solid, transparent)).toBe(true)
    expect(hasFlatElasticBackground(transparent, transparent, solid)).toBe(true)
    expect(hasFlatElasticBackground(transparent, solid, solid)).toBe(true)
    expect(
      hasFlatElasticBackground(
        transparent,
        { ...solid, image: 'linear-gradient(red, blue)' },
        transparent
      )
    ).toBe(false)
    expect(hasFlatElasticBackground({ ...solid }, solid, transparent)).toBe(false)
    expect(
      hasFlatElasticBackground(
        transparent,
        { color: 'rgba(0, 0, 0, 0.5)', image: 'none' },
        transparent
      )
    ).toBe(false)
    expect(
      hasFlatElasticBackground(transparent, solid, { color: 'rgb(0, 0, 0)', image: 'none' })
    ).toBe(false)
  })

  it('includes both surfaces and all nested refraction aprons in the sampling region', () => {
    const pane = { rect: baseline.pane, studio: GLASS_STUDIO_DEFAULTS }
    const viewport = { width: 400, height: 800, pixelRatio: 2 }
    const single = glassSamplingRegion([pane], viewport)
    const nested = glassSamplingRegion([pane, pane], viewport)
    expect(single).toBeDefined()
    expect(nested).toBeDefined()
    if (!single || !nested) throw new Error('Missing sampling region')
    expect(single.y).toBeLessThan(baseline.pane.y - 80)
    expect(nested.y).toBeLessThan(single.y - 80)
    expect(glassSamplingRegion([pane], { ...viewport, pixelRatio: 0 })).toBeUndefined()
  })

  it('allows a distant fixed gradient sibling and rejects overlapping or unknown effects', () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (!pseudo) return nativeGetComputedStyle(element)
      const style = document.createElement('div').style
      style.content = 'none'
      return style
    })
    const host = document.createElement('div')
    const sibling = document.createElement('div')
    sibling.style.position = 'fixed'
    sibling.style.backgroundImage = 'linear-gradient(red, transparent)'
    document.body.replaceChildren(host, sibling)
    const rect = vi
      .spyOn(sibling, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 400, 44))
    const region = { x: -140, y: 520, width: 680, height: 350 }
    expect(externalSiblingsAvoidRegion(host, region)).toBe(true)
    rect.mockReturnValue(new DOMRect(0, 530, 400, 44))
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
    rect.mockReturnValue(new DOMRect(0, 0, 400, 44))
    sibling.style.boxShadow = '0px 500px 1px red'
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
  })

  it('rejects descendants, generated content and inaccessible shadow trees that cannot be bounded', () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (!pseudo) return nativeGetComputedStyle(element)
      const style = document.createElement('div').style
      style.content = 'none'
      if (element.hasAttribute('data-generated')) style.content = '""'
      return style
    })
    const host = document.createElement('div')
    const sibling = document.createElement('div')
    const descendant = document.createElement('div')
    sibling.append(descendant)
    document.body.replaceChildren(host, sibling)
    vi.spyOn(sibling, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 44))
    vi.spyOn(descendant, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 550, 30, 20))
    const region = { x: -140, y: 520, width: 680, height: 350 }
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
    descendant.remove()
    sibling.setAttribute('data-generated', '')
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
    sibling.removeAttribute('data-generated')
    const closed = document.createElement('x-closed-panel')
    closed.attachShadow({ mode: 'closed' })
    document.body.append(closed)
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
  })

  it('ignores a fully clipped open-shadow announcer but rejects visible shadow content', () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (!pseudo) return nativeGetComputedStyle(element)
      const style = document.createElement('div').style
      style.content = 'none'
      return style
    })
    const host = document.createElement('div')
    const announcer = document.createElement('x-route-announcer')
    const shadow = announcer.attachShadow({ mode: 'open' })
    const content = document.createElement('div')
    content.style.position = 'absolute'
    content.style.clip = 'rect(0px, 0px, 0px, 0px)'
    content.textContent = 'Screen reader announcement'
    shadow.append(content)
    document.body.replaceChildren(host, announcer)
    const region = { x: -140, y: 520, width: 680, height: 350 }
    expect(externalSiblingsAvoidRegion(host, region)).toBe(true)
    const visibleContent = document.createElement('div')
    visibleContent.textContent = 'Screen reader announcement'
    shadow.replaceChildren(visibleContent)
    vi.spyOn(visibleContent, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 550, 30, 20))
    expect(externalSiblingsAvoidRegion(host, region)).toBe(false)
  })
})
