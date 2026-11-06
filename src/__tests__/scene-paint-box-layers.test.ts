import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintBox } from '../scene/paint-box'

function fixture() {
  const context = {
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    ellipse: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    lineWidth: 0,
    strokeStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  const element = document.createElement('div')
  element.style.cssText =
    'background: rgba(40, 80, 120, .5); border: 3px solid rgba(255, 50, 20, .6); border-radius: 12px'
  element.style.borderTopLeftRadius = '12px'
  const issues = new Set<string>()
  return { style: element.style, issues, context }
}

afterEach(() => vi.restoreAllMocks())

describe('box paint layers', () => {
  it('keeps default callers painting background and border into one bitmap', () => {
    const { style, issues, context } = fixture()
    const canvas = paintBox(style, 100, 50, 2, issues)
    expect(canvas).toMatchObject({ width: 200, height: 100 })
    expect(context.fillRect).toHaveBeenCalledOnce()
    expect(context.stroke).toHaveBeenCalledOnce()
    expect(context.quadraticCurveTo).toHaveBeenCalled()
    expect(context.ellipse).not.toHaveBeenCalled()
    expect(issues.size).toBe(0)
  })

  it('paints the background without the border for insertion before inset shadow', () => {
    const { style, issues, context } = fixture()
    paintBox(style, 100, 50, 1, issues, new Map(), 'background')
    expect(context.fillRect).toHaveBeenCalledOnce()
    expect(context.stroke).not.toHaveBeenCalled()
    expect(context.ellipse).toHaveBeenCalled()
    expect(context.quadraticCurveTo).not.toHaveBeenCalled()
    expect(issues.size).toBe(0)
  })

  it('paints only the border for insertion after inset shadow', () => {
    const { style, issues, context } = fixture()
    paintBox(style, 100, 50, 1, issues, new Map(), 'border')
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalledOnce()
    expect(issues.size).toBe(0)
  })

  it('retains fallback diagnostics for unequal rounded borders in the border layer', () => {
    const { style, issues } = fixture()
    style.borderLeftWidth = '5px'
    paintBox(style, 100, 50, 1, issues, new Map(), 'border')
    expect(issues).toContain('Unequal rounded borders require native HTML rendering')
  })

  it('fails closed if a rounded split layer requires unavailable Canvas ellipse', () => {
    const { style, issues, context } = fixture()
    Object.defineProperty(context, 'ellipse', { value: undefined })
    paintBox(style, 100, 50, 1, issues, new Map(), 'background')
    expect(issues).toContain('Split rounded box layers require Canvas ellipse')
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('does not require ellipse for a square split layer', () => {
    const { style, issues, context } = fixture()
    Object.defineProperty(context, 'ellipse', { value: undefined })
    style.borderTopLeftRadius = '0px'
    paintBox(style, 100, 50, 1, issues, new Map(), 'background')
    expect(issues.size).toBe(0)
    expect(context.fillRect).toHaveBeenCalledOnce()
  })
})
