import { proveBackdropSampling } from './backdrop-sampling'
import { samplingRelationToRegions, validSamplingRegion } from './sampling-boundary'
import type { CompiledScene, GlassScene, SceneFrame, SceneItem, SceneRect } from './types'

export interface ScrollGeometry {
  host: SceneRect
  container: SceneRect
  panes: readonly { element: HTMLElement; rect: SceneRect }[]
  documentWidth: number
  documentHeight: number
}

export interface ScrollCapture {
  compiled: CompiledScene
  frame: SceneFrame
  regions: readonly SceneRect[]
  geometry: ScrollGeometry
  styles: string
}

const effectIds = new WeakMap<object, number>()
let nextEffectId = 0
function effectId(value: object): number {
  let id = effectIds.get(value)
  if (id === undefined) {
    id = ++nextEffectId
    effectIds.set(value, id)
  }
  return id
}

/** Paused and finished effects can be retained until their sampled state changes. */
export function readStationaryAnimationEpoch(animations: readonly Animation[]): string | null {
  try {
    const values: unknown[] = []
    for (const animation of animations) {
      if (animation.pending) return null
      const state = animation.playState
      if (state !== 'paused' && state !== 'finished') continue
      const time = animation.currentTime
      const effect = animation.effect
      if (
        animation.pending !== false ||
        !animation.timeline ||
        animation.timeline !== document.timeline ||
        typeof time !== 'number' ||
        !Number.isFinite(time) ||
        !Number.isFinite(animation.playbackRate) ||
        !effect ||
        !('getKeyframes' in effect) ||
        typeof effect.getKeyframes !== 'function' ||
        !('target' in effect) ||
        !(effect.target instanceof Element)
      )
        return null
      const frames = effect.getKeyframes()
      const timing = effect.getTiming()
      if (!Array.isArray(frames) || !frames.length || !timing || typeof timing !== 'object')
        return null
      values.push([
        state,
        effectId(animation),
        effectId(effect),
        effectId(effect.target),
        time,
        animation.playbackRate,
        frames,
        timing,
        'composite' in effect ? effect.composite : null,
        'iterationComposite' in effect ? effect.iterationComposite : null,
        'pseudoElement' in effect ? effect.pseudoElement : null,
      ])
    }
    return JSON.stringify(values)
  } catch {
    return null
  }
}

export const scrollCaptureMargin = (height: number) => Math.min(160, Math.max(64, height * 0.2))

export function scrollCaptureRegions(
  regions: readonly SceneRect[],
  height: number,
  direction = 0
): SceneRect[] {
  const margin = scrollCaptureMargin(height)
  const ahead = Math.max(margin, Math.min(960, height))
  const top = direction < 0 ? ahead : margin
  const bottom = direction > 0 ? ahead : margin
  return regions.map((rect) => ({ ...rect, y: rect.y - top, height: rect.height + top + bottom }))
}

export function enclosingRegion(regions: readonly SceneRect[]): SceneRect | undefined {
  if (!regions.length || !regions.every(validSamplingRegion)) return undefined
  const x = Math.min(...regions.map((rect) => rect.x))
  const y = Math.min(...regions.map((rect) => rect.y))
  return {
    x,
    y,
    width: Math.max(...regions.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...regions.map((rect) => rect.y + rect.height)) - y,
  }
}

export function shiftedCaptureRegions(capture: ScrollCapture, frame: SceneFrame): SceneRect[] {
  return (capture.compiled.scene.renderRegions ?? []).map((rect) => ({
    ...rect,
    x: rect.x + capture.frame.scrollX - frame.scrollX,
    y: rect.y + capture.frame.scrollY - frame.scrollY,
  }))
}

const sameRect = (a: SceneRect, b: SceneRect) =>
  [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(Number.isFinite) &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height

export function readScrollGeometry(
  host: HTMLElement,
  container: HTMLElement,
  panes: Iterable<HTMLElement>,
  frame: SceneFrame
): ScrollGeometry {
  const rect = (element: Element): SceneRect => {
    const value = element.getBoundingClientRect()
    return { x: value.left, y: value.top, width: value.width, height: value.height }
  }
  const hostRect = rect(host)
  const scrolling = document.scrollingElement ?? document.documentElement
  return {
    host: { ...hostRect, x: hostRect.x + frame.scrollX, y: hostRect.y + frame.scrollY },
    container: rect(container),
    panes: Array.from(panes, (element) => ({ element, rect: rect(element) })),
    documentWidth: scrolling.scrollWidth,
    documentHeight: scrolling.scrollHeight,
  }
}

/** CSSOM edits need not produce DOM mutations. Unreadable sheets disable reuse. */
export function readScrollStyleEpoch(): string | null {
  try {
    const parts: string[] = []
    let count = 0
    let size = 0
    const seen = new Set<CSSStyleSheet>()
    const media = (query: string) => {
      if (query) parts.push(query, String(matchMedia(query).matches))
    }
    const rules = (list: CSSRuleList): boolean => {
      for (const rule of Array.from(list)) {
        const text = rule.cssText
        if (++count > 4096 || (size += text.length) > 1_000_000) return false
        parts.push(text)
        if (rule instanceof CSSMediaRule) media(rule.conditionText)
        if (rule instanceof CSSImportRule) {
          media(rule.media.mediaText)
          if (!rule.styleSheet || !sheet(rule.styleSheet)) return false
        } else if ('cssRules' in rule) {
          const children = rule.cssRules
          if (!(children instanceof CSSRuleList) || !rules(children)) return false
        }
      }
      return true
    }
    const sheet = (value: CSSStyleSheet): boolean => {
      if (seen.has(value)) return true
      seen.add(value)
      parts.push(String(value.disabled))
      media(value.media?.mediaText ?? '')
      return rules(value.cssRules)
    }
    for (const value of [
      ...Array.from(document.styleSheets),
      ...(document.adoptedStyleSheets ?? []),
    ])
      if (!sheet(value)) return null
    // Imperative form properties can change CSS pseudo-classes without a DOM mutation.
    for (const control of document.querySelectorAll('input, textarea, select')) {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement
        )
      )
        return null
      parts.push(
        String(control.validity.valid),
        String(control.validity.rangeOverflow),
        String(control.validity.rangeUnderflow),
        String(control.matches(':placeholder-shown'))
      )
      if (control instanceof HTMLInputElement)
        parts.push(String(control.checked), String(control.indeterminate))
      if (control instanceof HTMLSelectElement)
        parts.push(Array.from(control.options, (option) => (option.selected ? '1' : '0')).join(''))
    }
    return JSON.stringify(parts)
  } catch {
    return null
  }
}

export function projectScrollCapture(
  capture: ScrollCapture,
  frame: SceneFrame,
  geometry: ScrollGeometry,
  regions: readonly SceneRect[],
  styles: string | null,
  viewportScene?: CompiledScene
): CompiledScene | null {
  const previous = capture.frame
  if (
    !capture.compiled.scrollTranslationSafe ||
    capture.compiled.issues.length ||
    styles === null ||
    styles !== capture.styles ||
    frame.width !== previous.width ||
    frame.height !== previous.height ||
    frame.pixelRatio !== previous.pixelRatio ||
    frame.devicePixelRatio !== previous.devicePixelRatio ||
    frame.scrollX !== previous.scrollX ||
    !Number.isFinite(frame.scrollY) ||
    !sameRect(geometry.host, capture.geometry.host) ||
    !sameRect(geometry.container, capture.geometry.container) ||
    geometry.documentWidth !== capture.geometry.documentWidth ||
    geometry.documentHeight !== capture.geometry.documentHeight ||
    geometry.panes.length !== capture.geometry.panes.length ||
    geometry.panes.some((pane, index) => {
      const old = capture.geometry.panes[index]
      return (
        !pane.element.isConnected ||
        !old ||
        pane.element !== old.element ||
        (!viewportScene && !sameRect(pane.rect, old.rect))
      )
    })
  )
    return null
  const dy = frame.scrollY - previous.scrollY
  if (
    !regions.length ||
    !regions.every(validSamplingRegion) ||
    !regions.every((region) =>
      capture.regions.some(
        (captured) =>
          region.x >= captured.x &&
          region.x + region.width <= captured.x + captured.width &&
          region.y >= captured.y - dy &&
          region.y + region.height <= captured.y + captured.height - dy
      )
    )
  )
    return null
  const renderRegions = shiftedCaptureRegions(capture, frame)
  if (!renderRegions.length || !renderRegions.every(validSamplingRegion)) return null
  const samplingRegion = enclosingRegion(regions)
  if (!samplingRegion) return null
  let items = capture.compiled.scene.items
  let targets = capture.compiled.targets
  if (viewportScene) {
    if (viewportScene.issues.length) return null
    const inSpace = (item: SceneItem, space: 'document' | 'viewport'): boolean =>
      item.space === space &&
      (!item.clip || item.clip.space === space) &&
      (!item.clips || item.clips.every((clip) => clip.space === space)) &&
      (item.kind !== 'opacity-group' ||
        ((!item.mask || item.mask.space === space) &&
          item.items.every((child) => inSpace(child, space))))
    const split = items.findIndex((item) => item.space === 'viewport')
    const supportedViewportPaint = (item: SceneItem): boolean =>
      item.kind !== 'backdrop' &&
      (item.kind !== 'glass' || (!!item.studio && item.studio.shadowFactor === 0)) &&
      (item.kind !== 'opacity-group' || item.items.every(supportedViewportPaint))
    if (
      split < 0 ||
      !items.slice(0, split).every((item) => inSpace(item, 'document')) ||
      !items.slice(split).every((item) => inSpace(item, 'viewport')) ||
      !viewportScene.scene.items.every(
        (item) => inSpace(item, 'viewport') && supportedViewportPaint(item)
      )
    )
      return null
    items = [...items.slice(0, split), ...viewportScene.scene.items]
    targets = [...targets.filter((target) => target.space === 'document'), ...viewportScene.targets]
  }
  const scene: GlassScene = {
    ...capture.compiled.scene,
    items,
    samplingRegion,
    samplingRegions: regions,
    renderRegions,
  }
  const proof = proveBackdropSampling({
    items: scene.items,
    frame,
    samplingRegion: scene.samplingRegion,
    samplingRegions: regions,
    targetWidth: Math.max(1, Math.round(frame.width * frame.pixelRatio)),
    targetHeight: Math.max(1, Math.round(frame.height * frame.pixelRatio)),
  })
  if (proof) scene.renderRegions = proof.sourceRegions
  return {
    ...capture.compiled,
    scene,
    targets,
    media: [
      ...new Set(
        items.flatMap((item) =>
          (item.kind === 'opacity-group' ? item.items : [item]).flatMap((paint) =>
            paint.kind === 'media' ? [paint.source] : []
          )
        )
      ),
    ],
  }
}

/** Retained captures can contain media beyond the currently required source pixels. */
export function hasPlayingSceneMedia(scene: GlassScene, frame: SceneFrame): boolean {
  return scene.items.some((item) => {
    const paints = item.kind === 'opacity-group' ? item.items : [item]
    return paints.some((paint) => {
      if (paint.kind !== 'media') return false
      if (paint.source instanceof HTMLVideoElement && (paint.source.paused || paint.source.ended))
        return false
      const rect = {
        ...paint.rect,
        x: paint.rect.x - (paint.space === 'document' ? frame.scrollX : 0),
        y: paint.rect.y - (paint.space === 'document' ? frame.scrollY : 0),
      }
      return samplingRelationToRegions(rect, scene.renderRegions) !== 'outside'
    })
  })
}
