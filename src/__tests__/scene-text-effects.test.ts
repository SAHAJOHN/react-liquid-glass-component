import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectTextEffect, textEffectGeometry, textEffectRasterRatio } from '../scene/text-effects'

const none = { content: 'none' } as CSSStyleDeclaration

function textStyle(input: Record<string, string> = {}): CSSStyleDeclaration {
  const values: Record<string, string> = {
    'background-clip': 'border-box',
    'background-image': 'none',
    'background-color': 'rgba(0, 0, 0, 0)',
    'background-size': 'auto',
    'background-position': '0% 0%',
    'background-repeat': 'repeat',
    'background-origin': 'padding-box',
    'background-attachment': 'scroll',
    'text-shadow': 'none',
    'text-decoration-line': 'none',
    '-webkit-text-stroke-width': '0px',
    '-webkit-text-stroke-color': 'rgb(0, 0, 0)',
    '-webkit-text-fill-color': 'rgb(0, 0, 0)',
    color: 'rgb(0, 0, 0)',
    'font-size': '16px',
    'padding-top': '0px',
    'padding-right': '0px',
    'padding-bottom': '0px',
    'padding-left': '0px',
    'border-top-width': '0px',
    'border-right-width': '0px',
    'border-bottom-width': '0px',
    'border-left-width': '0px',
    ...input,
  }
  return new Proxy(document.createElement('div').style, {
    get(target, name) {
      if (name === 'getPropertyValue') return (key: string) => values[key] ?? ''
      if (typeof name === 'string') {
        const key = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
        if (key in values) return values[key]
      }
      return Reflect.get(target, name)
    },
  })
}
function element(text = 'A clear heading') {
  const e = document.createElement('h2')
  e.append(document.createTextNode(text))
  return e
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('text effects preflight', () => {
  it('recognizes a single direct gradient text node and leaves plain text alone', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    const gradient = textStyle({
      'background-clip': 'text',
      'background-image': 'linear-gradient(270deg, rgb(0, 0, 0), rgb(255, 255, 255))',
      '-webkit-text-fill-color': 'rgba(0, 0, 0, 0)',
    })
    expect(inspectTextEffect(element(), gradient)).toMatchObject({ kind: 'gradient' })
    expect(inspectTextEffect(element(), textStyle())).toEqual({ kind: 'none' })
  })
  it('fails closed for nested content, generated text, repeating gradient, and shadow combinations', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    const gradient = textStyle({
      'background-clip': 'text',
      'background-image': 'linear-gradient(90deg, red, blue)',
      '-webkit-text-fill-color': 'rgba(0, 0, 0, 0)',
    })
    const nested = element()
    nested.append(document.createElement('em'))
    expect(inspectTextEffect(nested, gradient)).toEqual({ kind: 'unsupported' })
    expect(
      inspectTextEffect(
        element(),
        textStyle({
          'background-clip': 'text',
          'background-image': 'repeating-linear-gradient(red, blue)',
        })
      )
    ).toEqual({ kind: 'unsupported' })
    expect(
      inspectTextEffect(
        element(),
        textStyle({ 'text-shadow': 'red 1px 1px 3px, blue 2px 2px 3px' })
      )
    ).toEqual({ kind: 'unsupported' })
  })
  it('recognizes one CSS text shadow and preserves its full offset and blur', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    vi.stubGlobal('CSS', {
      supports: (property: string, input: string) => property === 'color' && !!input,
    })
    const result = inspectTextEffect(
      element(),
      textStyle({
        'text-shadow': 'rgb(22, 71, 142) 4px 4px 10px',
        '-webkit-text-fill-color': 'rgb(255, 255, 255)',
      })
    )
    expect(result).toMatchObject({
      kind: 'shadow',
      shadow: { color: 'rgb(22, 71, 142)', x: 4, y: 4, blur: 10 },
      insets: { left: 34, top: 34, right: 42, bottom: 42 },
    })
  })
  it('recognizes transparent text with an outline and fails closed for combined effects', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    vi.stubGlobal('CSS', {
      supports: (property: string, input: string) => property === 'color' && !!input,
    })
    const result = inspectTextEffect(
      element(),
      textStyle({
        '-webkit-text-stroke-width': '1px',
        '-webkit-text-stroke-color': 'rgb(255, 255, 255)',
        '-webkit-text-fill-color': 'rgba(0, 0, 0, 0)',
      })
    )
    expect(result).toMatchObject({
      kind: 'stroke',
      stroke: { width: 1, color: 'rgb(255, 255, 255)' },
    })
    expect(
      inspectTextEffect(
        element(),
        textStyle({
          '-webkit-text-stroke-width': '1px',
          'text-shadow': 'black 1px 1px 2px',
        })
      )
    ).toEqual({ kind: 'unsupported' })
  })
  it('rejects generated content and gradient positioning it cannot reproduce', () => {
    const gradient = textStyle({
      'background-clip': 'text',
      'background-image': 'linear-gradient(90deg, red, blue)',
      '-webkit-text-fill-color': 'transparent',
    })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      content: '"Hello"',
    } as CSSStyleDeclaration)
    expect(inspectTextEffect(element(), gradient)).toEqual({ kind: 'unsupported' })
    vi.mocked(window.getComputedStyle).mockReturnValue(none)
    expect(
      inspectTextEffect(
        element(),
        textStyle({
          'background-clip': 'text',
          'background-image': 'linear-gradient(90deg, red, blue)',
          '-webkit-text-fill-color': 'transparent',
          'background-size': '50% 50%',
        })
      )
    ).toEqual({ kind: 'unsupported' })
  })
  it('bounds large outlined text and fits the padded bitmap within GPU limits', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    vi.stubGlobal('CSS', {
      supports: (property: string, input: string) => property === 'color' && !!input,
    })
    const e = element()
    const effect = inspectTextEffect(
      e,
      textStyle({
        'font-size': '130px',
        '-webkit-text-stroke-width': '1px',
        '-webkit-text-stroke-color': 'white',
        '-webkit-text-fill-color': 'transparent',
      })
    )
    if (effect.kind !== 'stroke') throw new Error('Expected supported stroke')
    const bounds = new DOMRect(100, 20, 8000, 130)
    const ratio = textEffectRasterRatio(bounds, 1, 1, 2, effect)
    expect(ratio).not.toBeNull()
    if (ratio === null) throw new Error('Expected bounded ratio')
    expect((bounds.width + effect.insets.left + effect.insets.right) * ratio).toBeLessThanOrEqual(
      4095
    )
    expect(textEffectGeometry(bounds, e, ratio, 1, 1, effect)?.rect).toEqual({
      x: 100 - effect.insets.left,
      y: 20 - effect.insets.top,
      width: 8000 + effect.insets.left + effect.insets.right,
      height: 130 + effect.insets.top + effect.insets.bottom,
    })
    expect(textEffectGeometry(bounds, e, 2, 1, 1, effect)).toBeNull()
  })
  it('keeps the gradient bitmap cache key stable when the whole owner scrolls', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(none)
    const e = element()
    const rect = vi.spyOn(e, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 100))
    const effect = inspectTextEffect(
      e,
      textStyle({
        'background-clip': 'text',
        'background-image': 'linear-gradient(90deg, red, blue)',
        '-webkit-text-fill-color': 'transparent',
      })
    )
    if (effect.kind !== 'gradient') throw new Error('Expected gradient')
    const before = textEffectGeometry(new DOMRect(30, 120, 200, 30), e, 1, 1, 1, effect)
    rect.mockReturnValue(new DOMRect(0, 50, 300, 100))
    const after = textEffectGeometry(new DOMRect(30, 70, 200, 30), e, 1, 1, 1, effect)
    expect(before?.cacheKey).toEqual(after?.cacheKey)
    expect(before?.rect.y).toBe((after?.rect.y ?? 0) + 50)
  })
})
