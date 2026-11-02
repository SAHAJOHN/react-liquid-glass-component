import { describe, expect, it } from 'vitest'
import { paintBoxShadows, parseBoxShadows } from '../scene/paint-shadow'

describe('computed box shadows', () => {
  it('parses multiple ordered layers, including inset and signed offsets', () => {
    expect(
      parseBoxShadows(
        'rgba(10, 20, 30, 0.4) 0px 4px 5px 0px, inset rgb(255, 255, 255) -1px 2px 3px 0px',
        'rgb(1, 2, 3)'
      )
    ).toEqual({
      status: 'ready',
      layers: [
        {
          inset: false,
          offsetX: 0,
          offsetY: 4,
          blur: 5,
          spread: 0,
          color: 'rgba(10, 20, 30, 0.4)',
        },
        { inset: true, offsetX: -1, offsetY: 2, blur: 3, spread: 0, color: 'rgb(255, 255, 255)' },
      ],
    })
  })

  it('uses currentColor when the color is omitted', () => {
    const result = parseBoxShadows('2px -3px 4px', 'rgb(12, 34, 56)')
    expect(result).toEqual({
      status: 'ready',
      layers: [
        { inset: false, offsetX: 2, offsetY: -3, blur: 4, spread: 0, color: 'rgb(12, 34, 56)' },
      ],
    })
  })

  it('rejects unresolved, invalid, and unsafe geometry rather than dropping it', () => {
    expect(parseBoxShadows('none', 'black')).toEqual({ status: 'none' })
    for (const shadow of ['1em 2px red', '0px 2px -1px red', '0px red', '0px 0px red blue']) {
      expect(parseBoxShadows(shadow, 'black').status).toBe('unsupported')
    }
    const element = document.createElement('div')
    element.style.color = 'black'
    element.style.boxShadow = '0px 2px 4px black'
    expect(paintBoxShadows(element.style, 100, 50, 0).status).toBe('unsupported')
    expect(paintBoxShadows(element.style, 5000, 50, 1).status).toBe('unsupported')
    element.style.boxShadow = '5000px 0 0 black inset'
    expect(paintBoxShadows(element.style, 100, 50, 1).status).toBe('unsupported')
    expect(parseBoxShadows(Array(33).fill('0 0 black').join(', '), 'black').status).toBe(
      'unsupported'
    )
  })
})
