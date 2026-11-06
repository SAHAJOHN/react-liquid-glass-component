import { describe, expect, it, vi } from 'vitest'
import { measurePseudoBox } from '../scene/paint-pseudo'
import { isSupportedIndividualTranslate } from '../scene/translate'

function fixture() {
  const ancestor = document.createElement('div')
  const element = document.createElement('div')
  ancestor.append(element)
  const ancestorStyle = document.createElement('div').style
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
  pseudoStyle.opacity = '1'
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 200, 100))
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 194 },
    clientHeight: { configurable: true, value: 96 },
  })
  const read = (target: Element, pseudo?: string | null) =>
    pseudo ? pseudoStyle : target === element ? parentStyle : ancestorStyle
  return { element, ancestorStyle, parentStyle, pseudoStyle, read }
}

describe('individual translate support', () => {
  it.each(['', 'none', '0', '-0', '1px', '-50% 0px', '+1.25px -30.5%', '.5px 0'])(
    'accepts bounded 2D CSSOM values %s',
    (value) => expect(isSupportedIndividualTranslate(value)).toBe(true)
  )

  it.each([
    'normal',
    '1',
    'NaNpx',
    'Infinitypx',
    '1e999px',
    '1px 2px 0px',
    'calc(50% + 1px)',
    'var(--x)',
    '1em 2px',
    '10px, 20px',
  ])('rejects unresolved, invalid, and 3D values %s', (value) => {
    expect(isSupportedIndividualTranslate(value)).toBe(false)
  })

  it('uses the already translated viewport bounds without applying either ancestor translate twice', () => {
    const { element, ancestorStyle, parentStyle, read } = fixture()
    Object.defineProperty(ancestorStyle, 'translate', { configurable: true, value: '-50% 12px' })
    Object.defineProperty(parentStyle, 'translate', { configurable: true, value: '10px -25%' })
    const result = measurePseudoBox(element, '::before', read)
    expect(result).toMatchObject({ status: 'ready', rect: { x: 52, y: 88, width: 80, height: 30 } })
  })

  it('retains the correct local size and offsets when translation is combined with axis scaling', () => {
    const { element, ancestorStyle, parentStyle, read } = fixture()
    Object.defineProperty(ancestorStyle, 'translate', { configurable: true, value: '-50% 0px' })
    parentStyle.transform = 'matrix(1.5, 0, 0, 0.5, 10, 20)'
    vi.mocked(element.getBoundingClientRect).mockReturnValue(new DOMRect(40, 80, 300, 50))
    const result = measurePseudoBox(element, '::before', read)
    expect(result).toMatchObject({
      status: 'ready',
      rect: { x: 58, y: 84, width: 120, height: 15 },
      localSize: { width: 80, height: 30 },
    })
  })

  it.each(['1px 2px 0px', 'calc(50% + 2px)', 'infinitypx'])(
    'keeps unsupported ancestor translation on the native path: %s',
    (value) => {
      const { element, ancestorStyle, read } = fixture()
      Object.defineProperty(ancestorStyle, 'translate', { configurable: true, value })
      expect(measurePseudoBox(element, '::before', read)).toMatchObject({ status: 'unsupported' })
    }
  )

  it('keeps pseudo-element individual translate and ancestor rotate/scale unsupported', () => {
    const { element, ancestorStyle, pseudoStyle, read } = fixture()
    Object.defineProperty(pseudoStyle, 'translate', { configurable: true, value: '1px' })
    expect(measurePseudoBox(element, '::before', read)).toMatchObject({
      status: 'unsupported',
      detail: 'PSEUDO_TRANSFORM',
    })
    Object.defineProperty(pseudoStyle, 'translate', { configurable: true, value: 'none' })
    Object.defineProperty(ancestorStyle, 'rotate', { configurable: true, value: '10deg' })
    expect(measurePseudoBox(element, '::before', read)).toMatchObject({ status: 'unsupported' })
    Object.defineProperty(ancestorStyle, 'rotate', { configurable: true, value: 'none' })
    Object.defineProperty(ancestorStyle, 'scale', { configurable: true, value: '2' })
    expect(measurePseudoBox(element, '::before', read)).toMatchObject({ status: 'unsupported' })
  })
})
