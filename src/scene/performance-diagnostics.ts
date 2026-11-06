import type { SceneFrame } from './types'

const MAX_SAMPLES = 300
const MAX_SCROLL_SOURCES = 32
const MAX_FALLBACK_REASONS = 16
const MAX_DEFERRED_REPORTS = 4
const SETTLE_MS = 400
const FRAME_PROXIMITY_MS = 120
const POSITION_EPSILON = 0.01

type TimingName =
  | 'frameIntervalMs'
  | 'frameWorkMs'
  | 'latestScrollEventToFrameMs'
  | 'matchedScrollToSubmitMs'
  | 'compileMs'
  | 'viewportCompileMs'
  | 'animationCheckMs'
  | 'styleEpochMs'
  | 'setSceneMs'
  | 'renderSubmitMs'

interface TimingSamples {
  values: number[]
  count: number
}

type ScrollSource = Window | Element

interface ScrollObservation {
  source: ScrollSource
  x: number
  y: number
  at: number
  attempted: boolean
}

interface DiagnosticStatus {
  status: 'ready' | 'pending' | 'fallback'
  reasons?: readonly string[]
}

function summarize({ values, count }: TimingSamples) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (percent: number) =>
    Math.round((sorted[Math.ceil(percent * sorted.length) - 1] ?? 0) * 10) / 10
  return {
    count,
    sampled: values.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  }
}

function readScrollPosition(source: ScrollSource) {
  if (source instanceof Element) return { x: source.scrollLeft, y: source.scrollTop }
  return { x: window.scrollX, y: window.scrollY }
}

function near(a: number, b: number) {
  return Math.abs(a - b) <= POSITION_EPSILON
}

/** Optional short-lived scroll diagnostics. No DOM text, URLs, or network data are collected. */
export function createPerformanceDiagnostics() {
  if (new URLSearchParams(window.location.search).get('glassPerf') !== '1') return undefined

  let samples = new Map<TimingName, TimingSamples>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let session = 0
  let sessionActive = false
  let sessionStartedAt = 0
  let lastScroll: number | null = null
  let previousFrame: number | null = null
  let collectingFrame = false
  let fallbackThisFrame = false
  let frames = 0
  let reusedFrames = 0
  let remeasuredFrames = 0
  let fallbackFrames = 0
  let fallbackTransitions = 0
  let pendingTransitions = 0
  let readyTransitions = 0
  let statusKey = ''
  let scrollEvents = 0
  let matchedScrollEvents = 0
  let supersededScrollEvents = 0
  let droppedScrollSources = 0
  let pendingScrolls: ScrollObservation[] = []
  let fallbackReasons = new Map<string, number>()
  let deferredReports: ReturnType<typeof detail>[] = []

  function recordValue(name: TimingName, value: number) {
    if (!Number.isFinite(value)) return
    let sample = samples.get(name)
    if (!sample) {
      sample = { values: [], count: 0 }
      samples.set(name, sample)
    }
    sample.values[sample.count % MAX_SAMPLES] = value
    sample.count += 1
  }

  function record(name: TimingName, value: number) {
    if (collectingFrame) recordValue(name, value)
  }

  function summary(name: TimingName) {
    const sample = samples.get(name)
    return sample ? summarize(sample) : null
  }

  function reset(now: number) {
    session += 1
    sessionActive = true
    sessionStartedAt = now
    lastScroll = null
    previousFrame = null
    collectingFrame = false
    fallbackThisFrame = false
    frames = 0
    reusedFrames = 0
    remeasuredFrames = 0
    fallbackFrames = 0
    fallbackTransitions = 0
    pendingTransitions = 0
    readyTransitions = 0
    statusKey = ''
    scrollEvents = 0
    matchedScrollEvents = 0
    supersededScrollEvents = 0
    droppedScrollSources = 0
    pendingScrolls = []
    fallbackReasons = new Map()
    samples = new Map()
  }

  function detail(now: number) {
    const matchedScrollToSubmitMs = summary('matchedScrollToSubmitMs')
    const latestScrollEventToFrameMs = summary('latestScrollEventToFrameMs')
    return {
      session,
      durationMs: Math.max(0, now - sessionStartedAt),
      frames,
      reusedFrames,
      remeasuredFrames,
      // Compatibility alias for the existing preview panel.
      fallbacks: fallbackFrames,
      fallbackFrames,
      fallbackTransitions,
      pendingTransitions,
      readyTransitions,
      fallbackReasons: Array.from(fallbackReasons, ([reason, count]) => ({ reason, count })),
      scrollEvents,
      matchedScrollEvents,
      supersededScrollEvents,
      droppedScrollSources,
      frameIntervalMs: summary('frameIntervalMs'),
      frameWorkMs: summary('frameWorkMs'),
      latestScrollEventToFrameMs,
      // Compatibility alias. This is the age of the latest scroll event, not input latency.
      scrollToFrameMs: latestScrollEventToFrameMs,
      matchedScrollToSubmitMs,
      // Compatibility alias. This now contains position-matched first submits only.
      scrollToSubmitMs: matchedScrollToSubmitMs,
      compileMs: summary('compileMs'),
      viewportCompileMs: summary('viewportCompileMs'),
      animationCheckMs: summary('animationCheckMs'),
      styleEpochMs: summary('styleEpochMs'),
      setSceneMs: summary('setSceneMs'),
      renderSubmitMs: summary('renderSubmitMs'),
    }
  }

  function dispatch(report: ReturnType<typeof detail>) {
    window.dispatchEvent(new CustomEvent('liquid-glass:performance', { detail: report }))
  }

  function finish(now = performance.now(), defer = false) {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!sessionActive) return
    const report = detail(now)
    sessionActive = false
    pendingScrolls = []
    collectingFrame = false
    if (defer) {
      if (deferredReports.length >= MAX_DEFERRED_REPORTS) deferredReports.shift()
      deferredReports.push(report)
    } else {
      for (const previous of deferredReports) dispatch(previous)
      deferredReports = []
      dispatch(report)
    }
  }

  function scheduleFinish() {
    if (timer !== undefined) clearTimeout(timer)
    const currentSession = session
    timer = setTimeout(() => {
      if (currentSession === session) finish()
    }, SETTLE_MS)
  }

  return {
    onScroll(source: ScrollSource = window) {
      const now = performance.now()
      // A blocked main thread can delay the settle callback. Split by event time
      // so a later gesture cannot silently extend the previous session.
      if (sessionActive && lastScroll !== null && now - lastScroll >= SETTLE_MS) finish(now, true)
      if (!sessionActive) reset(now)
      lastScroll = now
      scrollEvents += 1
      const position = readScrollPosition(source)
      const existing = pendingScrolls.findIndex((entry) => entry.source === source)
      const observation = { source, ...position, at: now, attempted: false }
      if (existing >= 0) {
        pendingScrolls[existing] = observation
        supersededScrollEvents += 1
      } else {
        if (pendingScrolls.length >= MAX_SCROLL_SOURCES) {
          pendingScrolls.shift()
          droppedScrollSources += 1
        }
        pendingScrolls.push(observation)
      }
      scheduleFinish()
    },
    startFrame(now: number) {
      const delayedPending = pendingScrolls.some((entry) => !entry.attempted)
      const scrollAge = lastScroll === null ? Number.POSITIVE_INFINITY : now - lastScroll
      collectingFrame = timer !== undefined && (scrollAge <= FRAME_PROXIMITY_MS || delayedPending)
      fallbackThisFrame = false
      if (!collectingFrame) return
      if (scrollAge > FRAME_PROXIMITY_MS) {
        for (const entry of pendingScrolls) entry.attempted = true
      }
      frames += 1
      // Keep long gaps. previousFrame is reset only when a new session starts.
      if (previousFrame !== null) record('frameIntervalMs', now - previousFrame)
      previousFrame = now
      record('latestScrollEventToFrameMs', scrollAge)
    },
    endFrame(now: number, reused: boolean, remeasured: boolean) {
      if (!collectingFrame) return
      if (reused) reusedFrames += 1
      if (remeasured) remeasuredFrames += 1
      record('frameWorkMs', performance.now() - now)
      collectingFrame = false
      fallbackThisFrame = false
    },
    submitted(frame: Pick<SceneFrame, 'scrollX' | 'scrollY'>) {
      if (!sessionActive || !pendingScrolls.length) return
      const now = performance.now()
      pendingScrolls = pendingScrolls.filter((entry) => {
        let matches = false
        if (entry.source instanceof Element) {
          if (entry.source.isConnected)
            matches =
              near(entry.x, entry.source.scrollLeft) && near(entry.y, entry.source.scrollTop)
        } else matches = near(entry.x, frame.scrollX) && near(entry.y, frame.scrollY)
        if (!matches) return true
        recordValue('matchedScrollToSubmitMs', now - entry.at)
        matchedScrollEvents += 1
        return false
      })
    },
    fallback() {
      if (!collectingFrame || fallbackThisFrame) return
      fallbackThisFrame = true
      fallbackFrames += 1
    },
    status(state: DiagnosticStatus) {
      if (!sessionActive) return
      const key = JSON.stringify(state)
      if (key === statusKey) return
      statusKey = key
      if (state.status === 'fallback') {
        fallbackTransitions += 1
        for (const value of state.reasons ?? []) {
          const reason = value.slice(0, 160)
          if (fallbackReasons.size >= MAX_FALLBACK_REASONS && !fallbackReasons.has(reason)) continue
          // Reasons are already exposed by liquid-glass:scene-status. Bound retained text.
          fallbackReasons.set(reason, (fallbackReasons.get(reason) ?? 0) + 1)
        }
      } else if (state.status === 'pending') pendingTransitions += 1
      else readyTransitions += 1
    },
    measure<T>(name: TimingName, run: () => T): T {
      if (!collectingFrame) return run()
      const started = performance.now()
      try {
        return run()
      } finally {
        record(name, performance.now() - started)
      }
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      sessionActive = false
      pendingScrolls = []
      deferredReports = []
    },
  }
}
