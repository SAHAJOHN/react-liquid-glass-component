import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPerformanceDiagnostics } from '../scene/performance-diagnostics'

type Report = Record<string, unknown>

function fixture() {
  vi.useFakeTimers()
  let now = 10
  let scrollX = 0
  let scrollY = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => scrollX)
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
  window.history.replaceState(null, '', '/?glassPerf=1')
  const diagnostics = createPerformanceDiagnostics()
  if (!diagnostics) throw new Error('Diagnostics should be enabled')
  const reports: Report[] = []
  const onReport = (event: Event) => reports.push((event as CustomEvent<Report>).detail)
  window.addEventListener('liquid-glass:performance', onReport)
  return {
    diagnostics,
    reports,
    setTime(value: number) {
      now = value
    },
    setScroll(x: number, y: number) {
      scrollX = x
      scrollY = y
    },
    finish() {
      vi.advanceTimersByTime(400)
    },
    dispose() {
      diagnostics.dispose()
      window.removeEventListener('liquid-glass:performance', onReport)
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('scene performance diagnostics', () => {
  it('only starts when explicitly enabled', () => {
    expect(createPerformanceDiagnostics()).toBeUndefined()
  })

  it('keeps bounded timing samples and reports their retained count', () => {
    const value = fixture()
    for (let index = 0; index < 350; index += 1) {
      const time = index < 50 ? 10 + index : 60 + (index - 50) * 50
      value.setTime(time)
      value.setScroll(0, index)
      value.diagnostics.onScroll(window)
      value.diagnostics.startFrame(time)
      value.diagnostics.endFrame(time, index % 2 === 0, index % 3 === 0)
    }
    value.finish()

    expect(value.reports).toHaveLength(1)
    expect(value.reports[0]).toMatchObject({ frames: 350, scrollEvents: 350 })
    expect(value.reports[0]?.frameIntervalMs).toMatchObject({
      count: 349,
      sampled: 300,
      p50: 50,
      p95: 50,
    })
    value.dispose()
  })

  it('retains a frame gap over 120ms within the same scroll session', () => {
    const value = fixture()
    for (const [time, y] of [
      [10, 10],
      [150, 20],
      [200, 30],
    ] as const) {
      value.setTime(time)
      value.setScroll(0, y)
      value.diagnostics.onScroll(window)
      value.diagnostics.startFrame(time)
      value.diagnostics.endFrame(time, true, false)
    }
    value.finish()

    expect(value.reports[0]?.frameIntervalMs).toMatchObject({
      count: 2,
      sampled: 2,
      p50: 50,
      p95: 140,
      max: 140,
    })
    value.dispose()
  })

  it('does not treat a zero timestamp as a missing scroll or frame', () => {
    const value = fixture()
    value.setTime(0)
    value.setScroll(0, 1)
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(0)
    value.diagnostics.endFrame(0, true, false)
    value.setTime(150)
    value.setScroll(0, 2)
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(150)
    value.diagnostics.endFrame(150, true, false)
    value.finish()

    expect(value.reports[0]).toMatchObject({ session: 1, frames: 2 })
    expect(value.reports[0]?.frameIntervalMs).toMatchObject({ count: 1, max: 150 })
    value.dispose()
  })

  it('splits a later gesture even when the previous settle timer was delayed', () => {
    const value = fixture()
    value.setTime(10)
    value.setScroll(0, 10)
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(10)
    value.diagnostics.endFrame(10, true, false)

    value.setTime(500)
    value.setScroll(0, 20)
    value.diagnostics.onScroll(window)
    // The prior report is buffered so an opt-in panel is not updated inside
    // the new scroll handler.
    expect(value.reports).toHaveLength(0)
    value.diagnostics.startFrame(500)
    value.diagnostics.endFrame(500, false, true)
    value.finish()

    expect(value.reports).toHaveLength(2)
    expect(value.reports[0]).toMatchObject({ session: 1, frames: 1, scrollEvents: 1 })
    expect(value.reports[1]).toMatchObject({ session: 2, frames: 1, scrollEvents: 1 })
    value.dispose()
  })

  it('captures the first position-matched frame even when it arrives after 120ms', () => {
    const value = fixture()
    value.setScroll(0, 80)
    value.diagnostics.onScroll(window)
    value.setTime(160)
    value.diagnostics.startFrame(160)
    value.setTime(170)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 80 })
    value.diagnostics.endFrame(160, false, true)

    // No pending observation remains, so trailing animation frames are omitted.
    value.setTime(200)
    value.diagnostics.startFrame(200)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 80 })
    value.diagnostics.endFrame(200, false, false)
    value.finish()

    expect(value.reports[0]).toMatchObject({
      frames: 1,
      matchedScrollEvents: 1,
      matchedScrollToSubmitMs: { count: 1, p50: 160, max: 160 },
    })
    value.dispose()
  })

  it('records the first submit matching the latest scroll position only once', () => {
    const value = fixture()
    value.setScroll(0, 10)
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(10)
    value.setTime(14)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 9 })
    value.diagnostics.endFrame(10, false, false)

    value.setTime(20)
    value.setScroll(0, 20)
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(20)
    value.setTime(25)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 20 })
    value.diagnostics.endFrame(20, false, false)

    value.setTime(35)
    value.diagnostics.startFrame(35)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 20 })
    value.diagnostics.endFrame(35, false, false)
    value.finish()

    expect(value.reports[0]).toMatchObject({
      scrollEvents: 2,
      matchedScrollEvents: 1,
      supersededScrollEvents: 1,
      matchedScrollToSubmitMs: { count: 1, sampled: 1, p50: 5, p95: 5 },
    })
    expect(value.reports[0]?.scrollToSubmitMs).toEqual(value.reports[0]?.matchedScrollToSubmitMs)
    value.dispose()
  })

  it('matches a nested scroller without mixing it with document coordinates', () => {
    const value = fixture()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    scroller.scrollTop = 40
    value.diagnostics.onScroll(scroller)
    value.diagnostics.startFrame(10)
    value.setTime(17)
    value.diagnostics.submitted({ scrollX: 0, scrollY: 500 })
    value.diagnostics.endFrame(10, false, true)
    value.finish()

    expect(value.reports[0]).toMatchObject({
      scrollEvents: 1,
      matchedScrollEvents: 1,
      matchedScrollToSubmitMs: { p50: 7 },
    })
    scroller.remove()
    value.dispose()
  })

  it('counts one fallback frame and one transition for repeated identical status', () => {
    const value = fixture()
    value.diagnostics.onScroll(window)
    value.diagnostics.startFrame(10)
    value.diagnostics.fallback()
    value.diagnostics.fallback()
    value.diagnostics.status({
      status: 'fallback',
      reasons: ['WebGL could not render this scene.'],
    })
    value.diagnostics.status({
      status: 'fallback',
      reasons: ['WebGL could not render this scene.'],
    })
    value.diagnostics.endFrame(10, false, false)
    value.finish()

    expect(value.reports[0]).toMatchObject({
      fallbacks: 1,
      fallbackFrames: 1,
      fallbackTransitions: 1,
      fallbackReasons: [{ reason: 'WebGL could not render this scene.', count: 1 }],
    })
    value.dispose()
  })
})
