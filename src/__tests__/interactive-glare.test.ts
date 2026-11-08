import { interactiveGlareOffset, subscribeInteractiveGlare } from '../scene/interactive-glare'

describe('interactive glare', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let time: number
  let now: number
  let reduced: boolean
  let media: EventTarget

  function pointer(type: string, x = 900, y = 450, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      clientX: { value: x },
      clientY: { value: y },
      relatedTarget: { value: relatedTarget },
    })
    window.dispatchEvent(event)
    return event
  }

  function touch(type: string, x = 900, y = 450, identifier = 1, target: EventTarget = window) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'changedTouches', {
      value: [{ identifier, clientX: x, clientY: y }],
    })
    target.dispatchEvent(event)
    return event
  }

  function flush() {
    const pending = [...frames.values()]
    frames.clear()
    time += 34
    pending.forEach((callback) => callback(time))
  }

  function settle() {
    for (let i = 0; i < 100 && frames.size; i++) flush()
    expect(frames.size).toBe(0)
  }

  beforeEach(() => {
    frames = new Map()
    nextFrame = 0
    time = 0
    now = 1000
    reduced = false
    media = new EventTarget()
    Object.defineProperty(media, 'matches', { get: () => reduced })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('matchMedia', () => media)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 900)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('tracks mouse hover without a button and shares passive listeners', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const repaint = vi.fn()
    const first = subscribeInteractiveGlare(repaint)
    const second = subscribeInteractiveGlare(repaint)
    expect(add.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(1)
    expect(add.mock.calls.find(([name]) => name === 'pointermove')?.[2]).toEqual({ passive: true, capture: true })
    expect(add.mock.calls.find(([name]) => name === 'touchmove')?.[2]).toEqual({ passive: true, capture: true })
    expect(add.mock.calls.some(([name]) => name === 'scroll')).toBe(false)
    const move = pointer('pointermove')
    flush()
    expect(move.defaultPrevented).toBe(false)
    expect(interactiveGlareOffset.current).toBeGreaterThan(0)
    expect(repaint).toHaveBeenCalledTimes(1)
    pointer('pointermove', 100)
    settle()
    expect(interactiveGlareOffset.current).toBeLessThan(0)
    pointer('pointerout')
    settle()
    expect(interactiveGlareOffset.current).toBe(0)
    first()
    first()
    expect(remove.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(0)
    pointer('pointermove')
    flush()
    second()
    expect(remove.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(1)
    expect(interactiveGlareOffset.current).toBe(0)
    expect(frames.size).toBe(0)
  })

  it('keeps following the tracked finger during scrolling after pointercancel', () => {
    const off = subscribeInteractiveGlare(vi.fn())
    const nested = document.createElement('div')
    nested.addEventListener('touchmove', (event) => event.stopPropagation())
    document.body.appendChild(nested)
    const start = touch('touchstart', 900, 450, 1, nested)
    flush()
    expect(start.defaultPrevented).toBe(false)
    expect(interactiveGlareOffset.current).toBeGreaterThan(0)
    pointer('pointercancel', 900, 450, 'touch')
    nested.scrollTop = 200
    nested.dispatchEvent(new Event('scroll'))
    touch('touchmove', 100, 450, 2, nested)
    touch('touchmove', 100, 450, 1, nested)
    settle()
    expect(interactiveGlareOffset.current).toBeLessThan(0)
    touch('touchend', 100, 450, 2, nested)
    expect(interactiveGlareOffset.current).toBeLessThan(0)
    touch('touchend', 100, 450, 1, nested)
    settle()
    expect(interactiveGlareOffset.current).toBe(0)
    nested.remove()
    off()
  })

  it('ignores scrolling alone and handles touch cancellation', () => {
    const off = subscribeInteractiveGlare(vi.fn())
    window.dispatchEvent(new Event('scroll'))
    const nested = document.createElement('div')
    document.body.appendChild(nested)
    nested.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(0)
    expect(interactiveGlareOffset.current).toBe(0)
    touch('touchstart')
    flush()
    expect(interactiveGlareOffset.current).toBeGreaterThan(0)
    touch('touchcancel')
    settle()
    expect(interactiveGlareOffset.current).toBe(0)
    nested.remove()
    off()
  })

  it('ignores compatibility mouse events immediately after touch', () => {
    const off = subscribeInteractiveGlare(vi.fn())
    touch('touchstart')
    touch('touchend')
    settle()
    pointer('pointermove')
    expect(frames.size).toBe(0)
    now += 801
    pointer('pointermove')
    flush()
    expect(interactiveGlareOffset.current).toBeGreaterThan(0)
    off()
  })

  it('resets on blur or when the page becomes hidden', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const repaint = vi.fn()
    const off = subscribeInteractiveGlare(repaint)
    pointer('pointermove')
    flush()
    expect(interactiveGlareOffset.current).not.toBe(0)
    window.dispatchEvent(new Event('blur'))
    expect(interactiveGlareOffset.current).toBe(0)
    expect(frames.size).toBe(0)
    pointer('pointermove')
    flush()
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(interactiveGlareOffset.current).toBe(0)
    expect(frames.size).toBe(0)
    off()
  })

  it('disables motion while reduced motion is preferred and resumes when changed', () => {
    reduced = true
    const off = subscribeInteractiveGlare(vi.fn())
    pointer('pointermove')
    touch('touchstart')
    expect(frames.size).toBe(0)
    expect(interactiveGlareOffset.current).toBe(0)
    reduced = false
    media.dispatchEvent(new Event('change'))
    now += 801
    pointer('pointermove')
    flush()
    expect(interactiveGlareOffset.current).toBeGreaterThan(0)
    reduced = true
    media.dispatchEvent(new Event('change'))
    expect(interactiveGlareOffset.current).toBe(0)
    expect(frames.size).toBe(0)
    off()
  })
})
