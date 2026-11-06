import { samplingRelationToRegions, validSamplingRegion } from './sampling-boundary'
import { getBoundedRelativePaintRect } from './stacking-bounds'
import { isSupportedIndividualTranslate } from './translate'
import type { SceneRect } from './types'

interface AnimationRelevanceInput {
  source: HTMLElement
  animations: readonly Animation[]
  /** Conservative viewport-space source regions from the last successful compile. */
  regions: readonly SceneRect[] | undefined
  panes: Iterable<HTMLElement>
  /** Captures validate this same world-space coverage both when built and reused. */
  allowMovingClip?: boolean
}

const metadata = new Set(['offset', 'computedOffset', 'easing', 'composite'])
const number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)'
const length = `(?:[+-]?0(?:\\.0+)?|${number}(?:px|%))`
const translate = new RegExp(`^translate(?:X|Y)\\(\\s*${length}\\s*\\)$`, 'i')
const translate2d = new RegExp(`^translate\\(\\s*${length}(?:\\s*,\\s*${length})?\\s*\\)$`, 'i')
const matrix = /^matrix\(([^()]*)\)$/i

/** Only visual changes that cannot alter normal-flow layout are candidates. */
function safeTransform(value: string): boolean {
  const text = value.trim()
  if (text === 'none') return true
  if (translate.test(text) || translate2d.test(text)) return true
  const match = matrix.exec(text)
  if (!match?.[1]) return false
  const parts = match[1].split(',').map((part) => part.trim())
  if (parts.some((part) => !part)) return false
  const values = parts.map(Number)
  return (
    values.length === 6 &&
    values.every(Number.isFinite) &&
    values[0] === 1 &&
    values[1] === 0 &&
    values[2] === 0 &&
    values[3] === 1
  )
}

function safeKeyframes(effect: KeyframeEffect): boolean {
  if (effect.pseudoElement) return false
  const frames = effect.getKeyframes()
  if (!frames.length) return false
  let sawProperty = false
  for (const frame of frames) {
    for (const [name, value] of Object.entries(frame)) {
      if (metadata.has(name)) continue
      sawProperty = true
      if (typeof value !== 'string' && typeof value !== 'number') return false
      if (name === 'transform') {
        if (typeof value !== 'string' || !safeTransform(value)) return false
      } else if (name === 'translate') {
        if (typeof value !== 'string' || !isSupportedIndividualTranslate(value)) return false
      } else if (name === 'opacity') {
        if (typeof value === 'string' && !value.trim()) return false
        const opacity = Number(value)
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return false
      } else return false
    }
  }
  return sawProperty
}

function keyframeEffect(effect: AnimationEffect | null): effect is KeyframeEffect {
  return (
    !!effect &&
    'target' in effect &&
    'getKeyframes' in effect &&
    typeof effect.getKeyframes === 'function'
  )
}

/**
 * Decide whether currently running animations can change pixels needed by the
 * glass. The caller must keep requesting frames for *all* running animations,
 * even when this function returns false, so a moving clip is rechecked.
 *
 * An animation is ignored only when it changes a supported non-layout
 * property and a stable, independently clipped relative ancestor bounds its
 * whole subtree outside every backdrop-expanded source region. Any uncertainty
 * keeps the animation relevant.
 */
export function hasRelevantAnimations({
  source,
  animations,
  regions,
  panes,
  allowMovingClip = false,
}: AnimationRelevanceInput): boolean {
  const running = animations.filter((animation) => animation.playState === 'running')
  if (!running.length) return false
  if (!regions?.length || regions.some((region) => !validSamplingRegion(region))) return true
  try {
    const targets: Element[] = []
    for (const animation of running) {
      const effect = animation.effect
      if (!keyframeEffect(effect) || !effect.target || !safeKeyframes(effect)) return true
      const target = effect.target
      if (!(target instanceof Element) || !source.contains(target)) return true
      targets.push(target)
    }
    const glass = Array.from(panes).filter((pane) => pane.isConnected && source.contains(pane))
    const styleCache = new WeakMap<Element, Map<string, CSSStyleDeclaration>>()
    const readStyle: typeof getComputedStyle = (element, pseudo) => {
      let entry = styleCache.get(element)
      if (!entry) {
        entry = new Map()
        styleCache.set(element, entry)
      }
      const key = pseudo ?? ''
      const cached = entry.get(key)
      if (cached) return cached
      const style = getComputedStyle(element, pseudo)
      entry.set(key, style)
      return style
    }
    const boundsCache = new WeakMap<Element, SceneRect | null>()
    const stableCache = new WeakMap<Element, boolean>()
    const clipIsStable = (clip: Element) => {
      const cached = stableCache.get(clip)
      if (cached !== undefined) return cached
      if (targets.some((target) => target === clip || target.contains(clip))) return false
      for (let node: Element | null = clip; node; node = node.parentElement) {
        if (typeof node.getAnimations !== 'function') {
          stableCache.set(clip, false)
          return false
        }
        if (
          node
            .getAnimations()
            .some(
              (animation) => animation.playState !== 'idle' && animation.playState !== 'finished'
            )
        ) {
          stableCache.set(clip, false)
          return false
        }
      }
      stableCache.set(clip, true)
      return true
    }
    for (const target of targets) {
      if (glass.some((pane) => pane.contains(target) || target.contains(pane))) return true
      if (allowMovingClip) {
        const bounds = getBoundedRelativePaintRect(target, source, readStyle)
        if (bounds && samplingRelationToRegions(bounds, regions) === 'outside') continue
      }
      let irrelevant = false
      for (let clip = target.parentElement; clip && clip !== source; clip = clip.parentElement) {
        if (glass.some((pane) => clip.contains(pane) || pane.contains(clip))) continue
        const style = readStyle(clip)
        if (
          style.position !== 'relative' ||
          !['hidden', 'clip'].includes(style.overflowX) ||
          !['hidden', 'clip'].includes(style.overflowY) ||
          !clipIsStable(clip)
        )
          continue
        let bounds = boundsCache.get(clip)
        if (bounds === undefined) {
          bounds = getBoundedRelativePaintRect(clip, source, readStyle)
          boundsCache.set(clip, bounds)
        }
        if (bounds && samplingRelationToRegions(bounds, regions) === 'outside') {
          irrelevant = true
          break
        }
      }
      if (!irrelevant) return true
    }
    return false
  } catch {
    // Unavailable CSSOM, keyframes, geometry, or animation state stays live.
    return true
  }
}
