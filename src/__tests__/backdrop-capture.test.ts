import { afterEach, describe, expect, it, vi } from 'vitest'
import * as domCapture from '../dom-capture'
import * as videoCapture from '../video-backdrop'
import * as canvasCapture from '../canvas-backdrop'
import { subscribeBackdrop } from '../backdrop-capture'

describe('shared backdrop capture', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shares one capture and stops when the last pane unsubscribes', async () => {
    vi.useFakeTimers()
    let resolveCapture: ((canvas: HTMLCanvasElement) => void) | undefined
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockImplementation(
      () => new Promise((resolve) => { resolveCapture = resolve }),
    )
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeBackdrop(first)
    const unsubscribeSecond = subscribeBackdrop(second)
    expect(capture).toHaveBeenCalledOnce()
    const canvas = document.createElement('canvas')
    resolveCapture?.(canvas)
    await Promise.resolve()
    expect(first).toHaveBeenCalledWith(canvas, expect.any(Number))
    expect(second).toHaveBeenCalledWith(canvas, expect.any(Number))
    unsubscribeFirst()
    unsubscribeSecond()
    await vi.advanceTimersByTimeAsync(500)
    expect(capture).toHaveBeenCalledOnce()
  })

  it('reports capture failures and retries without overlapping captures', async () => {
    vi.useFakeTimers()
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockRejectedValue(new Error('capture failed'))
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith(null, expect.any(Number))
    expect(capture).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2000)
    expect(capture).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('refreshes video frames without recapturing the DOM', async () => {
    vi.useFakeTimers()
    const video = document.createElement('video')
    let nextFrame: ((time: number) => void) | undefined
    video.requestVideoFrameCallback = vi.fn((callback) => {
      nextFrame = (time) => callback(time, {
        presentationTime: time,
        expectedDisplayTime: time,
        width: 1,
        height: 1,
        mediaTime: 0,
        presentedFrames: 1,
      })
      return 7
    })
    video.cancelVideoFrameCallback = vi.fn()
    const overlay = document.createElement('canvas')
    const composed = document.createElement('canvas')
    const render = vi.fn().mockReturnValue(composed)
    vi.spyOn(videoCapture, 'findVideoBackdrop').mockReturnValue({ video, render })
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockResolvedValue(overlay)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    await Promise.resolve()
    expect(capture).toHaveBeenCalledWith(document.documentElement, { excludeVideo: video })
    expect(listener).toHaveBeenCalledWith(composed, expect.any(Number))
    nextFrame?.(100)
    nextFrame?.(110)
    expect(render).toHaveBeenCalledTimes(3)
    expect(capture).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    expect(video.cancelVideoFrameCallback).toHaveBeenCalled()
  })

  it('shares an explicitly provided canvas and only updates on new frames', async () => {
    vi.useFakeTimers()
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    document.body.append(source)
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValue(source)
    vi.spyOn(canvasCapture, 'isCanvasBackdrop').mockReturnValue(true)
    const capture = vi.spyOn(domCapture, 'captureBackdrop')
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeBackdrop(first)
    const unsubscribeSecond = subscribeBackdrop(second)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0]?.[1]).toEqual(second.mock.calls[0]?.[1])
    source.dispatchEvent(new Event('liquid-glass:frame'))
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)
    expect(first.mock.calls[1]?.[1]).toBeGreaterThan(first.mock.calls[0]?.[1])
    await vi.advanceTimersByTimeAsync(2000)
    expect(capture).not.toHaveBeenCalled()
    unsubscribeFirst()
    unsubscribeSecond()
    source.dispatchEvent(new Event('liquid-glass:frame'))
    expect(first).toHaveBeenCalledTimes(2)
    source.remove()
  })

  it('reuses the texture generation for unchanged canvas frames', () => {
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    document.body.append(source)
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValue(source)
    vi.spyOn(canvasCapture, 'isCanvasBackdrop').mockReturnValue(true)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    const initialId = listener.mock.calls[0]?.[1]

    source.dispatchEvent(new CustomEvent('liquid-glass:frame', { detail: { unchanged: true } }))
    expect(listener.mock.calls[1]?.[1]).toBe(initialId)
    source.dispatchEvent(new Event('liquid-glass:frame'))
    expect(listener.mock.calls[2]?.[1]).toBeGreaterThan(initialId)

    unsubscribe()
    source.remove()
  })

  it('switches to a canvas inserted during a capture without emitting the old snapshot', async () => {
    vi.useFakeTimers()
    let resolveCapture: ((canvas: HTMLCanvasElement) => void) | undefined
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockImplementation(
      () => new Promise((resolve) => { resolveCapture = resolve }),
    )
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValue(null)
    vi.spyOn(canvasCapture, 'isCanvasBackdrop').mockImplementation((canvas) => canvas === source)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    document.body.append(source)
    source.dispatchEvent(new Event('liquid-glass:frame'))
    expect(listener).toHaveBeenCalledWith(source, expect.any(Number))
    const oldSnapshot = document.createElement('canvas')
    resolveCapture?.(oldSnapshot)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalledWith(oldSnapshot, expect.any(Number))
    await vi.advanceTimersByTimeAsync(2000)
    expect(capture).toHaveBeenCalledOnce()
    unsubscribe()
    source.remove()
  })

  it('falls back to DOM capture when the canvas is removed', async () => {
    vi.useFakeTimers()
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    document.body.append(source)
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValueOnce(source).mockReturnValue(null)
    const fallback = document.createElement('canvas')
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockResolvedValue(fallback)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    source.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith(null, expect.any(Number))
    expect(capture).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(fallback, expect.any(Number))
    unsubscribe()
  })

  it.each([false, true])('falls back when the active canvas marker is removed (immediate frame: %s)', async (immediateFrame) => {
    vi.useFakeTimers()
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    document.body.append(source)
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValueOnce(source).mockReturnValue(null)
    const fallback = document.createElement('canvas')
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockResolvedValue(fallback)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)
    source.removeAttribute('data-liquid-glass-backdrop')
    // A frame can arrive before the mutation observer is dispatched.
    if (immediateFrame) source.dispatchEvent(new Event('liquid-glass:frame'))
    await Promise.resolve()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith(null, expect.any(Number))
    expect(capture).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(fallback, expect.any(Number))
    expect(listener.mock.calls.filter(([value]) => value === source)).toHaveLength(1)
    unsubscribe()
    source.remove()
  })

  it('revalidates the active canvas at most every 250ms and falls back when geometry changes', async () => {
    vi.useFakeTimers()
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const source = document.createElement('canvas')
    source.dataset.liquidGlassBackdrop = 'canvas'
    source.width = 100
    source.height = 100
    document.body.append(source)
    vi.spyOn(canvasCapture, 'findCanvasBackdrop').mockReturnValueOnce(source).mockReturnValue(null)
    const validate = vi.spyOn(canvasCapture, 'isCanvasBackdrop').mockReturnValue(false)
    const fallback = document.createElement('canvas')
    const capture = vi.spyOn(domCapture, 'captureBackdrop').mockResolvedValue(fallback)
    const listener = vi.fn()
    const unsubscribe = subscribeBackdrop(listener)

    now = 1249
    source.dispatchEvent(new Event('liquid-glass:frame'))
    expect(validate).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()

    now = 1250
    source.dispatchEvent(new Event('liquid-glass:frame'))
    await Promise.resolve()
    expect(validate).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(null, expect.any(Number))
    expect(capture).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(fallback, expect.any(Number))
    unsubscribe()
    source.remove()
  })
})
