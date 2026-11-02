import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintBox } from '../scene/paint-box'
import { paintPseudoBox } from '../scene/paint-pseudo'
import type * as PaintBoxModule from '../scene/paint-box'

vi.mock('../scene/paint-box', async (importOriginal) => ({
  ...(await importOriginal<typeof PaintBoxModule>()),
  paintBox: vi.fn(),
}))

function maskedRing() {
  const element = document.createElement('div')
  const parentStyle = document.createElement('div').style
  const pseudoStyle = document.createElement('div').style
  parentStyle.position = 'relative'
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
  pseudoStyle.padding = '2px'
  pseudoStyle.borderTopLeftRadius = '15px'
  pseudoStyle.borderTopRightRadius = '15px'
  pseudoStyle.borderBottomRightRadius = '15px'
  pseudoStyle.borderBottomLeftRadius = '15px'
  const black = 'linear-gradient(rgb(0, 0, 0) 0px, rgb(0, 0, 0) 0px)'
  const properties: Record<string, string> = {
    '-webkit-mask-image': `${black}, ${black}`,
    '-webkit-mask-clip': 'content-box, border-box',
    '-webkit-mask-origin': 'content-box, border-box',
    '-webkit-mask-composite': 'xor, xor',
    '-webkit-mask-size': 'auto, auto',
    '-webkit-mask-repeat': 'repeat, repeat',
    '-webkit-mask-position': '0px 0px, 0px 0px',
  }
  Object.defineProperty(pseudoStyle, 'maskImage', { value: properties['-webkit-mask-image'] })
  const originalProperty = pseudoStyle.getPropertyValue.bind(pseudoStyle)
  vi.spyOn(pseudoStyle, 'getPropertyValue').mockImplementation(
    (name) => properties[name] ?? originalProperty(name)
  )
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
  Object.defineProperties(element, { clientWidth: { value: 200 }, clientHeight: { value: 100 } })
  const read = (_element: Element, pseudo?: string | null) => (pseudo ? pseudoStyle : parentStyle)
  const bitmap = document.createElement('canvas')
  const context = {
    resetTransform: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    ellipse: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    roundRect: undefined as undefined | (() => void),
    fillStyle: '',
    globalCompositeOperation: '',
  }
  vi.spyOn(bitmap, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.mocked(paintBox).mockReturnValue(bitmap)
  return { element, read, context }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('pseudo-element ring compatibility', () => {
  it('renders the masked ring when roundRect is unavailable but ellipse is supported', () => {
    const { element, read, context } = maskedRing()
    expect(paintPseudoBox(element, '::before', 2, read).status).toBe('ready')
    expect(context.ellipse).toHaveBeenCalledTimes(8)
    expect(context.fill).toHaveBeenCalledTimes(2)
  })

  it('continues to use native roundRect where it exists', () => {
    const { element, read, context } = maskedRing()
    const roundRect = vi.fn()
    context.roundRect = roundRect
    expect(paintPseudoBox(element, '::before', 2, read).status).toBe('ready')
    expect(roundRect).toHaveBeenCalledTimes(2)
    expect(context.ellipse).not.toHaveBeenCalled()
  })

  it('fails closed when neither rounded-rectangle API is available', () => {
    const { element, read, context } = maskedRing()
    Object.defineProperty(context, 'ellipse', { value: undefined })
    expect(paintPseudoBox(element, '::before', 2, read)).toEqual({
      status: 'unsupported',
      reason: 'Pseudo-element rasterization failed',
    })
  })
})
