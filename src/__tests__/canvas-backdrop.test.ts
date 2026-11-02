import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCanvasBackdrop } from '../canvas-backdrop'

describe('canvas backdrop geometry', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('accepts a painted fixed viewport canvas and rejects incomplete or displaced sources', () => {
    const canvas = document.createElement('canvas')
    canvas.dataset.liquidGlassBackdrop = 'canvas'
    canvas.style.cssText = 'position:fixed;transform:none;opacity:1;visibility:visible;display:block'
    canvas.width = window.innerWidth * 2
    canvas.height = window.innerHeight * 2
    document.body.append(canvas)
    const bounds = vi.spyOn(canvas, 'getBoundingClientRect')
    bounds.mockReturnValue(new DOMRect(0, 0, window.innerWidth, window.innerHeight))
    expect(isCanvasBackdrop(canvas)).toBe(true)
    canvas.width = 0
    expect(isCanvasBackdrop(canvas)).toBe(false)
    canvas.width = window.innerWidth
    bounds.mockReturnValue(new DOMRect(20, 0, window.innerWidth, window.innerHeight))
    expect(isCanvasBackdrop(canvas)).toBe(false)
  })
})
