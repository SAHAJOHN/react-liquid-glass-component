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

function ringFixture() {
  const result = fixture()
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
  Object.defineProperty(result.pseudoStyle, 'maskImage', {
    configurable: true,
    value: properties['-webkit-mask-image'],
  })
  Object.defineProperty(result.pseudoStyle, 'maskComposite', {
    configurable: true,
    value: '',
    writable: true,
  })
  Object.defineProperty(result.pseudoStyle, 'maskMode', { value: '', writable: true })
  const originalProperty = result.pseudoStyle.getPropertyValue.bind(result.pseudoStyle)
  vi.spyOn(result.pseudoStyle, 'getPropertyValue').mockImplementation(
    (name) => properties[name] ?? originalProperty(name)
  )
  result.pseudoStyle.padding = '2px'
  return { ...result, properties }
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

  it('accepts equivalent prefixed and standard composite serializations', () => {
    const { element, pseudoStyle, properties, read } = ringFixture()
    for (const composite of ['xor', 'xor, xor', 'xor, source-over']) {
      properties['-webkit-mask-composite'] = composite
      expect(measurePseudoBox(element, '::before', read).status, composite).toBe('ready')
    }
    properties['-webkit-mask-composite'] = ''
    for (const composite of ['exclude', 'exclude, exclude', 'exclude, add']) {
      pseudoStyle.maskComposite = composite
      expect(measurePseudoBox(element, '::before', read).status, composite).toBe('ready')
    }
  })

  it('accepts one repeated size, repeat, position and mode value for the two layers', () => {
    const { element, pseudoStyle, properties, read } = ringFixture()
    properties['-webkit-mask-size'] = 'auto'
    properties['-webkit-mask-repeat'] = 'repeat'
    properties['-webkit-mask-position'] = '0px 0%'
    pseudoStyle.maskMode = 'match-source'
    expect(measurePseudoBox(element, '::before', read).status).toBe('ready')
  })

  it('rejects contradictory standard and prefixed mask values', () => {
    const cases: [string, string, string, string][] = [
      ['maskImage', '-webkit-mask-image', 'none', 'PSEUDO_MASK_IMAGE'],
      ['maskClip', '-webkit-mask-clip', 'border-box, border-box', 'PSEUDO_MASK_CLIP'],
      ['maskOrigin', '-webkit-mask-origin', 'border-box, border-box', 'PSEUDO_MASK_ORIGIN'],
      ['maskComposite', '-webkit-mask-composite', 'add, add', 'PSEUDO_MASK_COMPOSITE'],
      ['maskSize', '-webkit-mask-size', '50%', 'PSEUDO_MASK_SIZE'],
      ['maskRepeat', '-webkit-mask-repeat', 'no-repeat', 'PSEUDO_MASK_REPEAT'],
      ['maskPosition', '-webkit-mask-position', '50% 0%', 'PSEUDO_MASK_POSITION'],
    ]
    for (const [standard, prefixed, invalid, detail] of cases) {
      const first = ringFixture()
      Object.defineProperty(first.pseudoStyle, standard, { configurable: true, value: invalid })
      expect(measurePseudoBox(first.element, '::before', first.read), standard).toMatchObject({
        status: 'unsupported',
        detail,
      })

      const second = ringFixture()
      const valid = second.properties[prefixed]
      const standardValid = standard === 'maskComposite' ? 'exclude, add' : valid
      Object.defineProperty(second.pseudoStyle, standard, {
        configurable: true,
        value: standardValid,
      })
      second.properties[prefixed] = invalid === 'add, add' ? 'source-over, source-over' : invalid
      expect(measurePseudoBox(second.element, '::before', second.read), prefixed).toMatchObject({
        status: 'unsupported',
        detail,
      })
    }
  })

  it('accepts equivalent values from both mask property families', () => {
    const { element, pseudoStyle, properties, read } = ringFixture()
    properties['-webkit-mask-composite'] = 'xor, source-over'
    properties['-webkit-mask-size'] = 'auto'
    properties['-webkit-mask-repeat'] = 'repeat'
    properties['-webkit-mask-position'] = '0px 0%'
    Object.defineProperties(pseudoStyle, {
      maskClip: { value: 'content-box, border-box' },
      maskOrigin: { value: 'content-box, border-box' },
      maskComposite: { value: 'exclude, add' },
      maskSize: { value: 'auto, auto' },
      maskRepeat: { value: 'repeat, repeat' },
      maskPosition: { value: '0% 0%, 0px 0px' },
    })
    expect(measurePseudoBox(element, '::before', read).status).toBe('ready')
  })

  it('continues to reject non-equivalent composite and layer values', () => {
    const { element, pseudoStyle, properties, read } = ringFixture()
    for (const composite of [
      'source-over, xor',
      'xor, source-in',
      'xor, xor, xor',
      'source-over',
    ]) {
      properties['-webkit-mask-composite'] = composite
      expect(measurePseudoBox(element, '::before', read).status, composite).toBe('unsupported')
    }
    properties['-webkit-mask-composite'] = ''
    pseudoStyle.maskComposite = 'add, exclude'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    pseudoStyle.maskComposite = 'exclude'
    properties['-webkit-mask-size'] = '50%'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-size'] = 'auto'
    properties['-webkit-mask-repeat'] = 'no-repeat'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-repeat'] = 'repeat'
    properties['-webkit-mask-position'] = '0% 50%'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
    properties['-webkit-mask-position'] = '0% 0%'
    pseudoStyle.maskMode = 'luminance'
    expect(measurePseudoBox(element, '::before', read).status).toBe('unsupported')
  })

  it('reports a fixed mask detail without exposing raw CSS or changing the existing reason', () => {
    const cases: [string, (item: ReturnType<typeof ringFixture>) => void][] = [
      [
        'PSEUDO_MASK_IMAGE',
        ({ pseudoStyle }) => {
          Object.defineProperty(pseudoStyle, 'maskImage', {
            configurable: true,
            value: 'url(https://example.invalid/private-image)',
          })
        },
      ],
      [
        'PSEUDO_MASK_CLIP',
        ({ properties }) => {
          properties['-webkit-mask-clip'] = 'border-box'
        },
      ],
      [
        'PSEUDO_MASK_ORIGIN',
        ({ properties }) => {
          properties['-webkit-mask-origin'] = 'border-box'
        },
      ],
      [
        'PSEUDO_MASK_COMPOSITE',
        ({ properties }) => {
          properties['-webkit-mask-composite'] = 'source-over'
        },
      ],
      [
        'PSEUDO_MASK_SIZE',
        ({ properties }) => {
          properties['-webkit-mask-size'] = '42px'
        },
      ],
      [
        'PSEUDO_MASK_REPEAT',
        ({ properties }) => {
          properties['-webkit-mask-repeat'] = 'no-repeat'
        },
      ],
      [
        'PSEUDO_MASK_POSITION',
        ({ properties }) => {
          properties['-webkit-mask-position'] = '0% 50%'
        },
      ],
      [
        'PSEUDO_MASK_MODE',
        ({ pseudoStyle }) => {
          pseudoStyle.maskMode = 'luminance'
        },
      ],
      [
        'PSEUDO_MASK_BORDER',
        ({ pseudoStyle }) => {
          pseudoStyle.borderLeftWidth = '1px'
        },
      ],
      [
        'PSEUDO_MASK_PADDING',
        ({ pseudoStyle }) => {
          pseudoStyle.padding = '1px 2px'
        },
      ],
      [
        'PSEUDO_MASK_RADIUS',
        ({ pseudoStyle }) => {
          pseudoStyle.borderTopLeftRadius = '10px'
        },
      ],
    ]
    for (const [detail, alter] of cases) {
      const item = ringFixture()
      alter(item)
      expect(measurePseudoBox(item.element, '::before', item.read)).toEqual({
        status: 'unsupported',
        reason: 'Pseudo-element effects require native HTML rendering',
        detail,
      })
    }
  })

  it('reports fixed effect details without revealing CSS values', () => {
    const cases: [string, string, string][] = [
      ['transform', 'translateX(1px)', 'PSEUDO_TRANSFORM'],
      ['filter', 'url(https://example.invalid/private-filter)', 'PSEUDO_FILTER'],
      ['backdropFilter', 'blur(2px)', 'PSEUDO_BACKDROP'],
      ['boxShadow', '0px 1px 2px red', 'PSEUDO_SHADOW'],
      ['textShadow', '0px 1px 2px red', 'PSEUDO_SHADOW'],
      ['clipPath', 'circle(20%)', 'PSEUDO_CLIP'],
      ['borderImageSource', 'url(https://example.invalid/private-border)', 'PSEUDO_BORDER_IMAGE'],
      ['mixBlendMode', 'multiply', 'PSEUDO_BLEND'],
      ['backgroundBlendMode', 'multiply', 'PSEUDO_BACKGROUND_BLEND'],
      ['backgroundAttachment', 'fixed', 'PSEUDO_ATTACHMENT'],
    ]
    for (const [property, value, detail] of cases) {
      const item = ringFixture()
      Object.defineProperty(item.pseudoStyle, property, { configurable: true, value })
      expect(measurePseudoBox(item.element, '::before', item.read)).toEqual({
        status: 'unsupported',
        reason: 'Pseudo-element effects require native HTML rendering',
        detail,
      })
    }
  })

  it('fails closed with fixed details when newer standard mask properties are unavailable', () => {
    const cases: [string, string, string][] = [
      ['-webkit-mask-clip', 'maskClip', 'PSEUDO_MASK_CLIP'],
      ['-webkit-mask-origin', 'maskOrigin', 'PSEUDO_MASK_ORIGIN'],
      ['-webkit-mask-composite', 'maskComposite', 'PSEUDO_MASK_COMPOSITE'],
      ['-webkit-mask-size', 'maskSize', 'PSEUDO_MASK_SIZE'],
      ['-webkit-mask-repeat', 'maskRepeat', 'PSEUDO_MASK_REPEAT'],
      ['-webkit-mask-position', 'maskPosition', 'PSEUDO_MASK_POSITION'],
    ]
    for (const [prefixed, standard, detail] of cases) {
      const item = ringFixture()
      item.properties[prefixed] = ''
      Reflect.set(item.pseudoStyle, standard, undefined)
      expect(measurePseudoBox(item.element, '::before', item.read)).toEqual({
        status: 'unsupported',
        reason: 'Pseudo-element effects require native HTML rendering',
        detail,
      })
    }
  })
})
