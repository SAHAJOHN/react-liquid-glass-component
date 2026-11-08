/** A shared interaction offset for managed glass. No sensor access is needed. */
export const interactiveGlareOffset = { current: 0 }

const subscribers = new Map<() => void, number>()
const passiveCapture = { passive: true, capture: true }
// Touch browsers may dispatch compatibility mouse events after a gesture.
const mouseSuppressionMs = 800
let touchId: number | undefined
let lastTouchTime = -Infinity
let pointerOffset = 0
let frame: number | undefined
let lastUpdate = -Infinity
let reducedMotion: MediaQueryList | undefined

function notify() {
  for (const subscriber of subscribers.keys()) subscriber()
}

function schedule() {
  if (frame === undefined && !document.hidden && !reducedMotion?.matches) {
    frame = requestAnimationFrame(flush)
  }
}

function flush(time: number) {
  frame = undefined
  if (time - lastUpdate < 32) {
    schedule()
    return
  }
  lastUpdate = time
  const difference = pointerOffset - interactiveGlareOffset.current
  if (Math.abs(difference) < 0.15) {
    if (interactiveGlareOffset.current !== pointerOffset) {
      interactiveGlareOffset.current = pointerOffset
      notify()
    }
    return
  }
  interactiveGlareOffset.current += difference * 0.25
  notify()
  schedule()
}

function setPosition(clientX: number, clientY: number) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
  const width = Math.max(window.innerWidth, 1)
  const height = Math.max(window.innerHeight, 1)
  const x = Math.max(-1, Math.min(1, (clientX / width) * 2 - 1))
  const y = Math.max(-1, Math.min(1, (clientY / height) * 2 - 1))
  pointerOffset = x * 28 + y * 12
  schedule()
}

function findTouch(touches: TouchList, identifier: number): Touch | undefined {
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i]
    if (touch?.identifier === identifier) return touch
  }
  return undefined
}

function onTouchStart(event: TouchEvent) {
  lastTouchTime = performance.now()
  if (reducedMotion?.matches || touchId !== undefined) return
  const touch = event.changedTouches[0]
  if (!touch) return
  touchId = touch.identifier
  setPosition(touch.clientX, touch.clientY)
}

function onTouchMove(event: TouchEvent) {
  if (touchId === undefined || reducedMotion?.matches) return
  const touch = findTouch(event.changedTouches, touchId)
  if (touch) setPosition(touch.clientX, touch.clientY)
}

function onTouchEnd(event: TouchEvent) {
  lastTouchTime = performance.now()
  if (touchId === undefined || !findTouch(event.changedTouches, touchId)) return
  touchId = undefined
  pointerOffset = 0
  schedule()
}

function onMouseMove(event: PointerEvent) {
  if (
    event.pointerType !== 'mouse' ||
    touchId !== undefined ||
    performance.now() - lastTouchTime < mouseSuppressionMs ||
    reducedMotion?.matches
  ) return
  setPosition(event.clientX, event.clientY)
}

function onMouseOut(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || event.relatedTarget !== null || touchId !== undefined) return
  pointerOffset = 0
  schedule()
}

function reset() {
  touchId = undefined
  lastTouchTime = -Infinity
  pointerOffset = 0
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
  lastUpdate = -Infinity
  if (interactiveGlareOffset.current !== 0) {
    interactiveGlareOffset.current = 0
    notify()
  }
}

function onVisibility() {
  if (document.hidden) reset()
}

function onMotionPreference() {
  if (reducedMotion?.matches) reset()
}

export function subscribeInteractiveGlare(subscriber: () => void): () => void {
  if (subscribers.size === 0) {
    reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reducedMotion?.addEventListener?.('change', onMotionPreference)
    window.addEventListener('touchstart', onTouchStart, passiveCapture)
    window.addEventListener('touchmove', onTouchMove, passiveCapture)
    window.addEventListener('touchend', onTouchEnd, passiveCapture)
    window.addEventListener('touchcancel', onTouchEnd, passiveCapture)
    window.addEventListener('pointermove', onMouseMove, passiveCapture)
    window.addEventListener('pointerout', onMouseOut, passiveCapture)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', reset)
  }
  subscribers.set(subscriber, (subscribers.get(subscriber) ?? 0) + 1)
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    const count = subscribers.get(subscriber)
    if (count === undefined) return
    if (count > 1) subscribers.set(subscriber, count - 1)
    else subscribers.delete(subscriber)
    if (subscribers.size !== 0) return
    window.removeEventListener('touchstart', onTouchStart, true)
    window.removeEventListener('touchmove', onTouchMove, true)
    window.removeEventListener('touchend', onTouchEnd, true)
    window.removeEventListener('touchcancel', onTouchEnd, true)
    window.removeEventListener('pointermove', onMouseMove, true)
    window.removeEventListener('pointerout', onMouseOut, true)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('blur', reset)
    reducedMotion?.removeEventListener?.('change', onMotionPreference)
    reducedMotion = undefined
    reset()
  }
}
