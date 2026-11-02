import { describe, expect, it, vi } from 'vitest'
import { measurePseudoBox } from '../scene/paint-pseudo'

function fixture() {
  const element = document.createElement('div')
  const parentStyle = document.createElement('div').style
  const pseudoStyle = document.createElement('div').style
  parentStyle.position = 'relative'
  parentStyle.borderLeftWidth = '2px'
  parentStyle.borderRightWidth = '4px'
  parentStyle.borderTopWidth = '3px'
  parentStyle.borderBottomWidth = '1px'
  pseudoStyle.content = '""'
  pseudoStyle.position = 'absolute'
  pseudoStyle.display = 'block'
  pseudoStyle.visibility = 'visible'
  pseudoStyle.width = '80px'
  pseudoStyle.height = '30px'
  pseudoStyle.boxSizing = 'border-box'
  pseudoStyle.left = '10px'
  pseudoStyle.top = '5px'
  pseudoStyle.right = 'auto'
  pseudoStyle.bottom = 'auto'
  pseudoStyle.opacity = '0.75'
  pseudoStyle.zIndex = '-1'
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 200, 100))
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 194 },
    clientHeight: { configurable: true, value: 96 },
  })
  const read = (_element: Element, pseudo?: string | null) => (pseudo ? pseudoStyle : parentStyle)
  return { element, parentStyle, pseudoStyle, read }
}

describe('pseudo-element measurement', () => {
  it('measures an absolute empty pseudo box relative to its parent padding edge', () => {
    const { element, pseudoStyle, read } = fixture()
    const result = measurePseudoBox(element, '::before', read)
    expect(result).toEqual({
      status: 'ready',
      pseudo: '::before',
      rect: { x: 52, y: 88, width: 80, height: 30 },
      localSize: { width: 80, height: 30 },
      scale: { x: 1, y: 1 },
      style: pseudoStyle,
      opacity: 0.75,
      zIndex: -1,
    })
  })

  it('supports right and bottom offsets and content-box dimensions', () => {
    const { element, pseudoStyle, read } = fixture()
    pseudoStyle.left = 'auto'
    pseudoStyle.top = 'auto'
    pseudoStyle.right = '10px'
    pseudoStyle.bottom = '5px'
    pseudoStyle.boxSizing = 'content-box'
    pseudoStyle.paddingLeft = '4px'
    pseudoStyle.paddingRight = '6px'
    pseudoStyle.borderLeftWidth = '1px'
    pseudoStyle.borderRightWidth = '1px'
    const result = measurePseudoBox(element, '::after', read)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.rect).toEqual({ x: 134, y: 144, width: 92, height: 30 })
      expect(result.pseudo).toBe('::after')
    }
  })

  it('measures nonuniform ancestor scaling in viewport coordinates and preserves local size', () => {
    const { element, parentStyle, read } = fixture()
    parentStyle.transform = 'matrix(1.5, 0, 0, 0.5, 10, 20)'
    vi.mocked(element.getBoundingClientRect).mockReturnValue(new DOMRect(40, 80, 300, 50))
    const result = measurePseudoBox(element, '::after', read)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.rect).toEqual({ x: 58, y: 84, width: 120, height: 15 })
      expect(result.localSize).toEqual({ width: 80, height: 30 })
      expect(result.scale).toEqual({ x: 1.5, y: 0.5 })
    }
    parentStyle.transform = 'matrix(1, 0.1, 0, 1, 0, 0)'
    expect(measurePseudoBox(element, '::after', read).status).toBe('unsupported')
    parentStyle.transform = 'matrix(-1, 0, 0, 1, 0, 0)'
    expect(measurePseudoBox(element, '::after', read).status).toBe('unsupported')
  })

  it('multiplies nested ancestor scales and handles right and bottom positioning', () => {
    const { element, pseudoStyle, parentStyle } = fixture()
    const wrapper = document.createElement('div')
    wrapper.appendChild(element)
    const wrapperStyle = document.createElement('div').style
    wrapperStyle.transform = 'matrix(2, 0, 0, 0.5, 10, 20)'
    parentStyle.transform = 'matrix(0.5, 0, 0, 2, 5, 6)'
    pseudoStyle.left = 'auto'
    pseudoStyle.top = 'auto'
    pseudoStyle.right = '10px'
    pseudoStyle.bottom = '5px'
    const read = (target: Element, pseudo?: string | null) =>
      pseudo ? pseudoStyle : target === element ? parentStyle : wrapperStyle
    const result = measurePseudoBox(element, '::after', read)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.rect).toEqual({ x: 146, y: 144, width: 80, height: 30 })
      expect(result.scale).toEqual({ x: 1, y: 1 })
    }
  })

  it('ignores absent, hidden and fully transparent pseudo-elements', () => {
    const { element, pseudoStyle, read } = fixture()
    pseudoStyle.content = 'none'
    expect(measurePseudoBox(element, '::before', read)).toEqual({ status: 'none' })
    pseudoStyle.content = '""'
    pseudoStyle.display = 'none'
    expect(measurePseudoBox(element, '::before', read)).toEqual({ status: 'none' })
    pseudoStyle.display = 'block'
    pseudoStyle.opacity = '0'
    expect(measurePseudoBox(element, '::before', read)).toEqual({ status: 'none' })
  })

  it('fails closed for generated text, non-absolute layout and unresolved offsets', () => {
    const { element, pseudoStyle, read } = fixture()
    pseudoStyle.content = '"visible text"'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    pseudoStyle.content = '""'
    pseudoStyle.position = 'static'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    pseudoStyle.position = 'absolute'
    pseudoStyle.left = 'auto'
    pseudoStyle.right = 'auto'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
  })

  it('fails closed for effects, transformed containing blocks, margins and image assets', () => {
    const { element, pseudoStyle, parentStyle, read } = fixture()
    pseudoStyle.boxShadow = '0px 1px 2px red'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    pseudoStyle.boxShadow = 'none'
    parentStyle.transform = 'translateX(2px)'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    parentStyle.transform = 'none'
    pseudoStyle.marginLeft = '3px'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    pseudoStyle.marginLeft = '0px'
    pseudoStyle.backgroundImage = 'url("/image.png")'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
  })

  it('accepts only the opaque two-layer XOR padding ring mask', () => {
    const { element, pseudoStyle, read } = fixture()
    const black = 'linear-gradient(rgb(0, 0, 0) 0px, rgb(0, 0, 0) 0px)'
    const properties: Record<string, string> = {
      '-webkit-mask-image': `${black}, ${black}`,
      '-webkit-mask-clip': 'content-box, border-box',
      '-webkit-mask-origin': 'content-box, border-box',
      '-webkit-mask-composite': 'xor, xor',
      '-webkit-mask-size': 'auto, auto',
      '-webkit-mask-repeat': 'repeat, repeat',
      '-webkit-mask-position': '0% 0%, 0% 0%',
    }
    Object.defineProperty(pseudoStyle, 'maskImage', { value: properties['-webkit-mask-image'] })
    const originalProperty = pseudoStyle.getPropertyValue.bind(pseudoStyle)
    vi.spyOn(pseudoStyle, 'getPropertyValue').mockImplementation(
      (name) => properties[name] ?? originalProperty(name)
    )
    pseudoStyle.padding = '2px'
    expect(measurePseudoBox(element, '::before', read).status).toBe('ready')
    properties['-webkit-mask-position'] = '0px 0px, 0% 0px'
    expect(measurePseudoBox(element, '::before', read).status).toBe('ready')
    properties['-webkit-mask-position'] = '1px 0px, 0px 0px'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-position'] = '0px 0px, 0px 0px'
    properties['-webkit-mask-clip'] = 'border-box, border-box'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-clip'] = 'content-box, border-box'
    properties['-webkit-mask-composite'] = 'source-over, source-over'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-composite'] = 'xor, xor'
    pseudoStyle.borderLeftWidth = '1px'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
  })
})
