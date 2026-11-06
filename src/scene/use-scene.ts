import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { LiquidGlassSceneStatus } from '../LiquidGlassScene'
import { createSceneCompiler } from './dom-scene'
import {
  canExpandElasticScene,
  externalSiblingsAvoidRegion,
  glassSamplingRegion,
  glassSamplingRegions,
  getOverscroll,
  hasFlatElasticBackground,
  isPendingAssets,
  PENDING_FRAME_MS,
  type ElasticGeometry,
  type Overscroll,
  type SamplingPane,
} from './continuity'
import {
  getGlassOnlyClip,
  glassOnlyClipPath,
  type GlassOnlyClip,
  type GlassOnlyPane,
} from './glass-only-clip'
import { createSceneRenderer } from './renderer'
import { samplingBoundaryChanged, validSamplingRegion } from './sampling-boundary'
import { isSupportedIndividualTranslate } from './translate'
import { hasRelevantAnimations } from './animation-relevance'
import { createPerformanceDiagnostics } from './performance-diagnostics'
import {
  enclosingRegion,
  hasPlayingSceneMedia,
  projectScrollCapture,
  readScrollGeometry,
  readStationaryAnimationEpoch,
  readScrollStyleEpoch,
  scrollCaptureMargin,
  scrollCaptureRegions,
  shiftedCaptureRegions,
  type ScrollCapture,
} from './scroll-reuse'
import type { CompiledScene, GlassOptions, SceneFrame, SceneRect } from './types'

interface Options {
  root: RefObject<HTMLDivElement>
  content: RefObject<HTMLDivElement>
  canvas: RefObject<HTMLCanvasElement>
  glasses: MutableRefObject<Map<HTMLElement, GlassOptions>>
  invalidate: MutableRefObject<() => void>
  background: string | undefined
  maxPixelRatio: number
  presentation: 'scene' | 'glass-only'
  canvasContainer: HTMLElement | null
  onStatusChange: ((state: LiquidGlassSceneStatus) => void) | undefined
}

/** Read every visible pane so elastic movement can be validated as a group. */
function visibleElasticPanes(
  host: HTMLElement,
  glasses: ReadonlyMap<HTMLElement, GlassOptions>
): Array<{ element: HTMLElement; rect: SceneRect }> {
  const panes: Array<{ element: HTMLElement; rect: SceneRect }> = []
  for (const element of glasses.keys()) {
    if (!element.isConnected || !host.contains(element)) continue
    let visible = true
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (style.opacity !== '' && Number.parseFloat(style.opacity) <= 0)
      ) {
        visible = false
        break
      }
      if (ancestor === host) break
    }
    if (!visible) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    panes.push({
      element,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    })
  }
  return panes
}

function measureGlassOnlyClip(
  host: HTMLElement,
  glasses: ReadonlyMap<HTMLElement, GlassOptions>,
  viewport: { width: number; height: number },
  overscroll?: Overscroll
): GlassOnlyClip {
  const panes: GlassOnlyPane[] = []
  for (const [element, options] of glasses) {
    if (!element.isConnected) continue
    if (!host.contains(element)) {
      return { status: 'fallback', reason: 'Glass-only panes must be inside their scene.' }
    }
    let visible = true
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (style.opacity !== '' && Number.parseFloat(style.opacity) <= 0)
      ) {
        visible = false
        break
      }
      if (style.transform && style.transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(style.transform)
        if (
          !matrix.is2D ||
          matrix.a <= 0 ||
          matrix.d <= 0 ||
          Math.abs(matrix.b) > 0.00001 ||
          Math.abs(matrix.c) > 0.00001 ||
          ((!options.studio || options.legacyRadius) &&
            (Math.abs(matrix.a - 1) > 0.00001 || Math.abs(matrix.d - 1) > 0.00001))
        ) {
          return {
            status: 'fallback',
            reason: 'Glass-only panes require supported axis-aligned transforms.',
          }
        }
      }
      if (
        !isSupportedIndividualTranslate(style.translate) ||
        (style.rotate && style.rotate !== 'none') ||
        (style.scale && style.scale !== 'none')
      ) {
        return {
          status: 'fallback',
          reason: 'Glass-only panes require supported axis-aligned transforms.',
        }
      }
      if (ancestor === host) break
    }
    if (!visible) continue
    const rect = element.getBoundingClientRect()
    const half = Math.min(rect.width, rect.height) / 2
    const radius = options.studio
      ? options.legacyRadius
        ? Math.max(0, Math.min(half, options.radius))
        : (half * options.studio.shapeRadius) / 100
      : Math.max(0, Math.min(half, options.radius))
    panes.push({
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      radius,
      roundness: options.studio?.shapeRoundness ?? 2,
      shadowFactor: options.studio?.shadowFactor ?? 0,
    })
  }
  const bounds = host.getBoundingClientRect()
  const hostRect = {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }
  if (!overscroll || !(overscroll.left || overscroll.right || overscroll.top || overscroll.bottom))
    return getGlassOnlyClip(panes, viewport, hostRect)

  // Only extend by the measured elastic excursion; pane positions and the
  // renderer's scroll coordinates stay in their real viewport positions.
  const { left, right, top, bottom } = overscroll
  if (!panes.length) return getGlassOnlyClip(panes, viewport, hostRect)
  const expandedHost = {
    x: hostRect.x,
    y: hostRect.y,
    width: hostRect.width + left + right,
    height: hostRect.height + top + bottom,
  }
  // A fixed pane can be partially outside the physical viewport while Safari
  // bounces. Only enlarge validation for the already-invisible portion.
  const invisibleLeft = Math.max(0, ...panes.map((pane) => -pane.rect.x))
  const invisibleRight = Math.max(
    0,
    ...panes.map((pane) => pane.rect.x + pane.rect.width - viewport.width)
  )
  const invisibleTop = Math.max(0, ...panes.map((pane) => -pane.rect.y))
  const invisibleBottom = Math.max(
    0,
    ...panes.map((pane) => pane.rect.y + pane.rect.height - viewport.height)
  )
  expandedHost.width += invisibleLeft + invisibleRight
  expandedHost.height += invisibleTop + invisibleBottom
  const shifted = panes.map((pane) => ({
    ...pane,
    rect: {
      ...pane.rect,
      x: pane.rect.x + left + invisibleLeft,
      y: pane.rect.y + top + invisibleTop,
    },
  }))
  const validated = getGlassOnlyClip(
    shifted,
    {
      width: viewport.width + left + right + invisibleLeft + invisibleRight,
      height: viewport.height + top + bottom + invisibleTop + invisibleBottom,
    },
    expandedHost
  )
  if (validated.status !== 'ready') return validated
  return { status: 'ready', clipPath: glassOnlyClipPath(panes, viewport) }
}

export function useScene(options: Options): void {
  const {
    root,
    content,
    canvas,
    glasses,
    invalidate,
    background,
    maxPixelRatio,
    presentation,
    canvasContainer,
  } = options
  const callback = useRef(options.onStatusChange)
  useEffect(() => {
    callback.current = options.onStatusChange
  }, [options.onStatusChange])

  useEffect(() => {
    const host = root.current
    const source = content.current
    const output = canvas.current
    if (!host || !source || !output) return
    const diagnostics = createPerformanceDiagnostics()
    let disposed = false
    let dirty = true
    let frameRequest: number | undefined
    let compiled: CompiledScene | undefined
    let scrollCapture: ScrollCapture | undefined
    let blockedCapture: SceneFrame | undefined
    let capturedEffects: string | null = null
    let deniedCertificate: { styles: string | null } | undefined
    let samplingWasUnavailable = false
    let previous: SceneFrame | undefined
    let previousTime = 0
    let bounds: SceneRect | undefined
    let hostFixed = false
    let generation = 0
    let formValues = new Map<HTMLInputElement | HTMLTextAreaElement, string>()
    let statusKey = ''
    let redirected = false
    let wasAnimating = false
    let lost = false
    let scrollingUntil = 0
    let appliedGlassClip = ''
    let hasCompleteFrame = false
    let elasticBaseline: ElasticGeometry | undefined
    let pendingSince: number | undefined
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    const ancestorMotionCounts = new Map<Element, number>()
    let renderer = createSceneRenderer(output)
    const markDirty = () => {
      dirty = true
      deniedCertificate = undefined
      start()
    }
    const compiler = createSceneCompiler(markDirty)
    const viewportCompiler = canvasContainer ? createSceneCompiler(markDirty) : undefined
    const paneResize = presentation === 'glass-only' ? new ResizeObserver(markDirty) : undefined
    const observedPanes = new Set<HTMLElement>()
    const syncPaneObservers = () => {
      if (!paneResize) return
      for (const element of observedPanes) {
        if (glasses.current.has(element)) continue
        paneResize.unobserve(element)
        observedPanes.delete(element)
      }
      for (const element of glasses.current.keys()) {
        if (observedPanes.has(element)) continue
        observedPanes.add(element)
        paneResize.observe(element)
      }
    }
    invalidate.current = markDirty

    const report = (state: LiquidGlassSceneStatus) => {
      const key = JSON.stringify(state)
      if (key === statusKey) return
      statusKey = key
      diagnostics?.status(state)
      host.toggleAttribute('data-liquid-glass-scene-ready', state.status === 'ready')
      if (state.status === 'ready') host.setAttribute('data-liquid-glass-scene-ready', 'true')
      if (state.status === 'pending') host.setAttribute('data-liquid-glass-scene-pending', 'true')
      else host.removeAttribute('data-liquid-glass-scene-pending')
      if (canvasContainer) output.style.opacity = state.status === 'fallback' ? '0' : '1'
      host.dispatchEvent(new CustomEvent('liquid-glass:scene-status', { detail: state }))
      callback.current?.(state)
    }
    const clearPending = () => {
      pendingSince = undefined
      if (pendingTimer !== undefined) clearTimeout(pendingTimer)
      pendingTimer = undefined
    }
    const fallback = (reasons: readonly string[], preserveElasticBaseline = false) => {
      diagnostics?.fallback()
      scrollCapture = undefined
      clearPending()
      if (!preserveElasticBaseline) {
        hasCompleteFrame = false
        elasticBaseline = undefined
      }
      report({ status: 'fallback', reasons })
    }
    const cancel = () => {
      if (frameRequest !== undefined) cancelAnimationFrame(frameRequest)
      frameRequest = undefined
    }
    const baseColor = () => {
      if (background) return background
      for (const element of [host, document.body, document.documentElement]) {
        const color = getComputedStyle(element).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
      return '#fff'
    }
    const frame = () => {
      const now = performance.now()
      frameRequest = undefined
      if (disposed || document.hidden || lost) return
      diagnostics?.startFrame(now)
      const width = window.innerWidth
      const height = window.innerHeight
      if (canvasContainer) {
        const rect = canvasContainer.getBoundingClientRect()
        const styles = {
          left: `${-rect.left - canvasContainer.clientLeft}px`,
          top: `${-rect.top - canvasContainer.clientTop}px`,
          width: `${width}px`,
          height: `${height}px`,
        }
        for (const [key, value] of Object.entries(styles)) {
          if (output.style.getPropertyValue(key) !== value) output.style.setProperty(key, value)
        }
      }
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        Number.isFinite(maxPixelRatio) && maxPixelRatio > 0 ? maxPixelRatio : 2,
        Math.sqrt(2_000_000 / Math.max(1, width * height)),
        4096 / Math.max(1, width),
        4096 / Math.max(1, height)
      )
      syncPaneObservers()
      const current: SceneFrame = {
        width,
        height,
        pixelRatio,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }
      const scrolling = document.scrollingElement ?? document.documentElement
      const scrollX = getComputedStyle(scrolling).direction === 'rtl' ? 0 : current.scrollX
      const overscroll = getOverscroll(
        scrollX,
        current.scrollY,
        scrolling.scrollWidth - scrolling.clientWidth,
        scrolling.scrollHeight - scrolling.clientHeight
      )
      const bouncing = !!(
        overscroll.left ||
        overscroll.right ||
        overscroll.top ||
        overscroll.bottom
      )
      const elasticGeometry = (): ElasticGeometry | undefined => {
        const panes = visibleElasticPanes(host, glasses.current)
        if (!panes.length) return undefined
        const pane = panes.reduce((largest, current) =>
          current.rect.width * current.rect.height > largest.rect.width * largest.rect.height
            ? current
            : largest
        ).rect
        const rect = host.getBoundingClientRect()
        return {
          host: {
            x: rect.left + current.scrollX,
            y: rect.top + current.scrollY,
            width: rect.width,
            height: rect.height,
          },
          pane,
          panes,
          documentWidth: scrolling.scrollWidth,
          documentHeight: scrolling.scrollHeight,
          viewportWidth: width,
          viewportHeight: height,
          pixelRatio,
        }
      }
      const samplingAreas = () => {
        const panes: SamplingPane[] = []
        for (const [element, options] of glasses.current) {
          if (!element.isConnected || !host.contains(element)) continue
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          if (!options.studio) return { region: undefined, regions: undefined }
          panes.push({
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            studio: options.studio,
          })
        }
        const viewport = { width, height, pixelRatio }
        return {
          region: glassSamplingRegion(panes, viewport),
          regions: glassSamplingRegions(panes, viewport),
        }
      }
      // Controlled React fields can change their value property without a DOM mutation.
      for (const [field, value] of formValues) {
        if (field.value !== value) {
          formValues.set(field, field.value)
          dirty = true
        }
      }
      const resized =
        !previous ||
        width !== previous.width ||
        height !== previous.height ||
        pixelRatio !== previous.pixelRatio
      const scrolled =
        !previous || current.scrollX !== previous.scrollX || current.scrollY !== previous.scrollY
      let ancestorAnimating = false
      let ancestorHasEffects = false
      const ancestorEffects: Animation[] = []
      for (let ancestor: Element | null = host; ancestor; ancestor = ancestor.parentElement) {
        if (typeof ancestor.getAnimations === 'function') {
          try {
            const effects = ancestor.getAnimations()
            ancestorEffects.push(...effects)
            if (
              effects.some(
                (animation) =>
                  animation.playState === 'running' || animation.timeline !== document.timeline
              )
            )
              ancestorHasEffects = true
            if (effects.some((animation) => animation.playState === 'running')) {
              ancestorAnimating = true
              break
            }
          } catch {
            // An unreadable ancestor animation cannot be assumed to be idle.
            ancestorAnimating = true
            ancestorHasEffects = true
            break
          }
        } else if ((ancestorMotionCounts.get(ancestor) ?? 0) > 0) {
          ancestorAnimating = true
          ancestorHasEffects = true
          break
        }
      }
      const animations =
        typeof source.getAnimations === 'function' ? source.getAnimations({ subtree: true }) : []
      const sourceRunning = animations.some((animation) => animation.playState === 'running')
      const anyRunning = ancestorAnimating || sourceRunning
      const animating =
        ancestorAnimating ||
        (sourceRunning &&
          hasRelevantAnimations({
            source,
            animations,
            regions: compiled?.scene.renderRegions,
            panes: glasses.current.keys(),
          }))
      let sampledRegion: SceneRect | undefined
      let sampledRegions: readonly SceneRect[] | undefined
      let sampledRegionRead = false
      const currentSamplingRegion = () => {
        if (!sampledRegionRead) {
          const areas = samplingAreas()
          sampledRegion = areas.region
          sampledRegions = areas.regions
          sampledRegionRead = true
        }
        return sampledRegion
      }
      const currentSamplingRegions = () => {
        currentSamplingRegion()
        return sampledRegions
      }
      const viewportAnimations = animations.filter((animation) => {
        const effect = animation.effect
        return (
          canvasContainer &&
          effect &&
          'target' in effect &&
          effect.target instanceof Element &&
          canvasContainer.contains(effect.target)
        )
      })
      const documentAnimations = animations.filter(
        (animation) => !viewportAnimations.includes(animation)
      )
      const reuseAnimations = (regions: readonly SceneRect[] | undefined) => {
        const check = () =>
          ancestorHasEffects ||
          documentAnimations.some((animation) => animation.timeline !== document.timeline) ||
          hasRelevantAnimations({
            source,
            animations: documentAnimations,
            regions,
            panes: glasses.current.keys(),
            allowMovingClip: true,
          })
        return diagnostics ? diagnostics.measure('animationCheckMs', check) : check()
      }
      const styleEpoch = () =>
        diagnostics
          ? diagnostics.measure('styleEpochMs', readScrollStyleEpoch)
          : readScrollStyleEpoch()
      let projected: CompiledScene | null = null
      let viewportChanged = false
      const unscaledViewport = !window.visualViewport || window.visualViewport.scale === 1
      const stationaryEffects =
        presentation === 'glass-only' &&
        canvasContainer &&
        unscaledViewport &&
        !bouncing &&
        !ancestorHasEffects
          ? readStationaryAnimationEpoch([...animations, ...ancestorEffects])
          : null
      if (
        scrollCapture &&
        !dirty &&
        !resized &&
        !bouncing &&
        unscaledViewport &&
        canvasContainer &&
        capturedEffects !== null &&
        capturedEffects === stationaryEffects &&
        !reuseAnimations(shiftedCaptureRegions(scrollCapture, current))
      ) {
        const regions = currentSamplingRegions()
        const geometry = readScrollGeometry(host, canvasContainer, glasses.current.keys(), current)
        viewportChanged =
          viewportAnimations.some((animation) => animation.playState === 'running') ||
          geometry.panes.some((pane, index) => {
            const previousPane = scrollCapture?.geometry.panes[index]
            return (
              !previousPane ||
              ['x', 'y', 'width', 'height'].some(
                (key) =>
                  pane.rect[key as keyof SceneRect] !== previousPane.rect[key as keyof SceneRect]
              )
            )
          })
        if (regions) {
          const compileViewport = () =>
            viewportCompiler?.compile(
              canvasContainer,
              glasses.current,
              current,
              'transparent',
              currentSamplingRegion(),
              regions
            )
          const viewport = viewportChanged
            ? diagnostics
              ? diagnostics.measure('viewportCompileMs', compileViewport)
              : compileViewport()
            : undefined
          projected = projectScrollCapture(
            scrollCapture,
            current,
            geometry,
            regions,
            scrolled || viewportChanged ? styleEpoch() : scrollCapture.styles,
            viewport
          )
          if (projected && viewport) {
            generation += 1
            scrollCapture = {
              ...scrollCapture,
              geometry: { ...scrollCapture.geometry, panes: geometry.panes },
              compiled: {
                ...scrollCapture.compiled,
                scene: { ...scrollCapture.compiled.scene, items: projected.scene.items },
                targets: projected.targets,
                media: projected.media,
              },
            }
          }
        }
      }
      const captureInvalidated = !!scrollCapture && !projected
      if (captureInvalidated) scrollCapture = undefined
      const regularRemeasure =
        dirty ||
        captureInvalidated ||
        resized ||
        ancestorAnimating ||
        animating !== wasAnimating ||
        ((scrolled || animating) && Boolean(compiled?.liveGeometry)) ||
        (!compiled?.issues.length &&
          (animating || (scrolled && presentation === 'glass-only' && bouncing)))
      const watches = compiled?.samplingWatches ?? []
      const checkSampling =
        !regularRemeasure &&
        presentation === 'glass-only' &&
        (scrolled || animating) &&
        (samplingWasUnavailable || watches.length > 0)
      let samplingChanged = false
      if (checkSampling) {
        try {
          samplingChanged = samplingWasUnavailable
            ? validSamplingRegion(currentSamplingRegion())
            : samplingBoundaryChanged(
                host,
                watches,
                currentSamplingRegion(),
                currentSamplingRegions()
              )
        } catch {
          // Retry within the render error boundary rather than leaking an
          // exception from a detached or otherwise unmeasurable pane.
          samplingChanged = true
        }
      }
      const mayCapture =
        presentation === 'glass-only' &&
        !!canvasContainer &&
        !bouncing &&
        unscaledViewport &&
        !ancestorHasEffects &&
        compiled?.scrollTranslationSafe === true &&
        !compiled.issues.length &&
        (!blockedCapture ||
          dirty ||
          resized ||
          Math.abs(current.scrollY - blockedCapture.scrollY) > scrollCaptureMargin(height))
      const dy = previous ? current.scrollY - previous.scrollY : 0
      const captureDirection =
        previousTime &&
        Math.abs(dy) > Math.max(1, now - previousTime) &&
        !documentAnimations.some((effect) => effect.playState === 'running' || effect.pending)
          ? Math.sign(dy)
          : 0
      const warmCapture =
        !scrollCapture &&
        mayCapture &&
        stationaryEffects !== null &&
        !reuseAnimations(
          scrollCaptureRegions(currentSamplingRegions() ?? [], height, captureDirection)
        )
      const remeasure = !projected && (regularRemeasure || samplingChanged || warmCapture)
      const mediaPlaying =
        scrollCapture && compiled
          ? hasPlayingSceneMedia(compiled.scene, current)
          : (compiled?.media.some(
              (media) => media instanceof HTMLCanvasElement || (!media.paused && !media.ended)
            ) ?? false)
      if (remeasure || scrolled || viewportChanged || mediaPlaying || pendingSince !== undefined) {
        try {
          if (projected) {
            compiled = projected
            const setScene = () => renderer?.setScene(projected.scene)
            if (diagnostics) diagnostics.measure('setSceneMs', setScene)
            else setScene()
          }
          if (remeasure) {
            const rect = host.getBoundingClientRect()
            const style = getComputedStyle(host)
            hostFixed = style.position === 'fixed'
            bounds = {
              x: rect.left + (hostFixed ? 0 : current.scrollX),
              y: rect.top + (hostFixed ? 0 : current.scrollY),
              width: rect.width,
              height: rect.height,
            }
            const region = presentation === 'glass-only' ? currentSamplingRegion() : undefined
            samplingWasUnavailable = presentation === 'glass-only' && !validSamplingRegion(region)
            const regions = presentation === 'glass-only' ? currentSamplingRegions() : undefined
            let captured: CompiledScene | null = null
            if (warmCapture && canvasContainer && regions?.length) {
              const styles = styleEpoch()
              if (styles !== null) {
                const padded = scrollCaptureRegions(regions, height, captureDirection)
                const compileCandidate = () =>
                  compiler.compile(
                    host,
                    glasses.current,
                    current,
                    baseColor(),
                    enclosingRegion(padded),
                    padded,
                    canvasContainer
                  )
                const candidate = diagnostics
                  ? diagnostics.measure('compileMs', compileCandidate)
                  : compileCandidate()
                if (
                  candidate.scrollTranslationSafe &&
                  !candidate.issues.length &&
                  !reuseAnimations(candidate.scene.renderRegions)
                ) {
                  const geometry = readScrollGeometry(
                    host,
                    canvasContainer,
                    glasses.current.keys(),
                    current
                  )
                  const capture: ScrollCapture = {
                    compiled: candidate,
                    frame: current,
                    regions: padded,
                    geometry,
                    styles,
                  }
                  captured = projectScrollCapture(capture, current, geometry, regions, styles)
                  if (captured) {
                    scrollCapture = capture
                    capturedEffects = stationaryEffects
                    blockedCapture = undefined
                  }
                }
              }
              if (!captured) blockedCapture = current
            }
            if (captured) compiled = captured
            else {
              const certify =
                presentation === 'glass-only' &&
                canvasContainer &&
                !bouncing &&
                unscaledViewport &&
                stationaryEffects !== null &&
                !reuseAnimations(regions) &&
                (!deniedCertificate ||
                  resized ||
                  animating !== wasAnimating ||
                  styleEpoch() !== deniedCertificate.styles)
              const compileScene = () =>
                compiler.compile(
                  host,
                  glasses.current,
                  current,
                  baseColor(),
                  region,
                  regions,
                  certify ? canvasContainer : undefined
                )
              compiled = diagnostics
                ? diagnostics.measure('compileMs', compileScene)
                : compileScene()
              if (certify && !compiled.scrollTranslationSafe)
                deniedCertificate = { styles: styleEpoch() }
            }
            formValues = new Map()
            for (const { element } of compiled.targets) {
              if (
                (element instanceof HTMLInputElement && element.type !== 'password') ||
                element instanceof HTMLTextAreaElement
              )
                formValues.set(element, element.value)
            }
            // A transformed ancestor changes the fixed canvas's containing block.
            for (
              let ancestor: HTMLElement | null = host;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const ancestorStyle = getComputedStyle(ancestor)
              if (
                [
                  ancestorStyle.transform,
                  ancestorStyle.translate,
                  ancestorStyle.rotate,
                  ancestorStyle.scale,
                  ancestorStyle.perspective,
                  ancestorStyle.filter,
                ].some((value) => value && value !== 'none')
              ) {
                compiled.issues.push(
                  'LiquidGlassScene needs ancestors without transform, perspective or filter.'
                )
                break
              }
            }
            if (Number.parseFloat(style.opacity) < 1)
              compiled.issues.push(
                'Apply opacity to scene content rather than the LiquidGlassScene wrapper.'
              )
            if (canvasContainer) {
              const containerStyle = getComputedStyle(canvasContainer)
              const matrix =
                containerStyle.transform && containerStyle.transform !== 'none'
                  ? new DOMMatrixReadOnly(containerStyle.transform)
                  : undefined
              if (
                presentation !== 'glass-only' ||
                !source.contains(canvasContainer) ||
                containerStyle.position !== 'fixed' ||
                (matrix &&
                  (!matrix.is2D ||
                    matrix.a !== 1 ||
                    matrix.d !== 1 ||
                    matrix.b !== 0 ||
                    matrix.c !== 0)) ||
                !isSupportedIndividualTranslate(containerStyle.translate) ||
                Boolean(containerStyle.rotate && containerStyle.rotate !== 'none') ||
                Boolean(containerStyle.scale && containerStyle.scale !== 'none') ||
                [...glasses.current.keys()].some(
                  (pane) => pane.isConnected && !canvasContainer.contains(pane)
                )
              )
                compiled.issues.push(
                  'Canvas container must be an unscaled fixed ancestor of every glass-only pane inside the scene.'
                )
              for (
                let ancestor = canvasContainer.parentElement;
                ancestor && ancestor !== source;
                ancestor = ancestor.parentElement
              ) {
                const ancestorStyle = getComputedStyle(ancestor)
                if (
                  [
                    ancestorStyle.transform,
                    ancestorStyle.translate,
                    ancestorStyle.rotate,
                    ancestorStyle.scale,
                    ancestorStyle.perspective,
                    ancestorStyle.filter,
                  ].some((value) => value && value !== 'none')
                ) {
                  compiled.issues.push(
                    'Canvas container needs ancestors without transform, perspective or filter.'
                  )
                  break
                }
              }
            }
            dirty = false
            generation += 1
            if (!compiled.issues.length) {
              renderer ??= createSceneRenderer(output)
              const scene = compiled.scene
              const setScene = () => renderer?.setScene(scene)
              if (diagnostics) diagnostics.measure('setSceneMs', setScene)
              else setScene()
            }
          }
          const canExpand =
            presentation === 'glass-only' &&
            bouncing &&
            hasCompleteFrame &&
            canExpandElasticScene(elasticBaseline, elasticGeometry(), overscroll) &&
            (() => {
              const region = currentSamplingRegion()
              return !!region && externalSiblingsAvoidRegion(host, region)
            })() &&
            !!document.body &&
            (() => {
              const [hostStyle, bodyStyle, htmlStyle] = [
                host,
                document.body,
                document.documentElement,
              ].map((element) => getComputedStyle(element))
              if (!hostStyle || !bodyStyle || !htmlStyle) return false
              return hasFlatElasticBackground(
                { color: hostStyle.backgroundColor, image: hostStyle.backgroundImage },
                { color: bodyStyle.backgroundColor, image: bodyStyle.backgroundImage },
                { color: htmlStyle.backgroundColor, image: htmlStyle.backgroundImage }
              )
            })()
          const glassOnly =
            presentation === 'glass-only'
              ? measureGlassOnlyClip(
                  host,
                  glasses.current,
                  { width, height },
                  canExpand ? overscroll : undefined
                )
              : undefined
          let glassClipSupported = true
          if (
            !compiled?.issues.length &&
            glassOnly?.status === 'ready' &&
            glassOnly.clipPath !== appliedGlassClip
          ) {
            output.style.clipPath = ''
            output.style.clipPath = glassOnly.clipPath
            glassClipSupported = Boolean(output.style.clipPath)
            if (glassClipSupported) appliedGlassClip = glassOnly.clipPath
            else appliedGlassClip = ''
          }
          if (compiled?.issues.length) {
            const mayHold =
              presentation === 'glass-only' &&
              hasCompleteFrame &&
              !resized &&
              glassOnly?.status === 'ready' &&
              glassOnly.clipPath === appliedGlassClip &&
              isPendingAssets(compiled.issues)
            if (mayHold) {
              const now = performance.now()
              pendingSince ??= now
              const remaining = PENDING_FRAME_MS - (now - pendingSince)
              if (remaining > 0) {
                if (pendingTimer === undefined)
                  pendingTimer = setTimeout(() => {
                    pendingTimer = undefined
                    start()
                  }, remaining)
                report({ status: 'pending', reasons: compiled.issues })
              } else fallback(compiled.issues)
            } else fallback(compiled.issues)
          } else if (glassOnly?.status === 'fallback') {
            // Keep the last baseline only for transient bounds failures while
            // bouncing. A later frame must pass every elastic safety check again.
            fallback(
              [glassOnly.reason],
              bouncing &&
                hasCompleteFrame &&
                glassOnly.reason ===
                  'Glass-only presentation requires the enclosing pane inside the scene and viewport.'
            )
          } else if (!glassClipSupported) {
            fallback(['Glass-only presentation needs CSS clip-path support.'])
          } else if (
            !renderer ||
            !(diagnostics
              ? diagnostics.measure('renderSubmitMs', () => renderer?.render(current) ?? false)
              : renderer.render(current))
          ) {
            fallback(['WebGL could not render this scene. Check media CORS and device support.'])
            renderer?.dispose()
            renderer = null
          } else {
            diagnostics?.submitted(current)
            clearPending()
            hasCompleteFrame = true
            if (presentation === 'glass-only' && !bouncing) elasticBaseline = elasticGeometry()
            if (bounds && presentation === 'scene') {
              const x = bounds.x - (hostFixed ? 0 : current.scrollX)
              const y = bounds.y - (hostFixed ? 0 : current.scrollY)
              const clip = `inset(${Math.min(height, Math.max(0, y))}px ${Math.min(width, Math.max(0, width - x - bounds.width))}px ${Math.min(height, Math.max(0, height - y - bounds.height))}px ${Math.min(width, Math.max(0, x))}px)`
              if (output.style.clipPath !== clip) output.style.clipPath = clip
            }
            report({ status: 'ready' })
            output.dispatchEvent(
              new CustomEvent('liquid-glass:scene-frame', {
                detail: { scrollX: current.scrollX, scrollY: current.scrollY, generation },
              })
            )
          }
        } catch (error) {
          fallback([error instanceof Error ? error.message : 'Scene rendering failed.'])
          renderer?.dispose()
          renderer = null
        }
      }
      previous = current
      previousTime = now
      wasAnimating = animating
      // Keep sampling during motion; an idle page schedules no animation frames.
      const hasLiveMedia =
        scrollCapture && compiled
          ? hasPlayingSceneMedia(compiled.scene, current)
          : (compiled?.media.some(
              (media) => media instanceof HTMLCanvasElement || (!media.paused && !media.ended)
            ) ?? false)
      // Even unrelated animations are rechecked each frame: a clipped subtree
      // can move into the sampled area without a DOM mutation.
      if (
        dirty ||
        anyRunning ||
        hasLiveMedia ||
        performance.now() < scrollingUntil ||
        (remeasure &&
          compiled?.scrollTranslationSafe &&
          !compiled.issues.length &&
          !scrollCapture &&
          !blockedCapture)
      )
        start()
      diagnostics?.endFrame(now, Boolean(projected), remeasure)
    }
    function start() {
      if (!disposed && !document.hidden && !lost && frameRequest === undefined)
        frameRequest = requestAnimationFrame(frame)
    }
    const onWindowScroll = () => {
      diagnostics?.onScroll(window)
      scrollingUntil = performance.now() + 120
      start()
    }
    const viewportGeometry = () => {
      const viewport = window.visualViewport
      if (!viewport) return ''
      const values = [
        viewport.width,
        viewport.height,
        viewport.offsetLeft,
        viewport.offsetTop,
        viewport.scale,
      ]
      return values.every(Number.isFinite) ? values.join('|') : null
    }
    let lastViewportGeometry = viewportGeometry()
    const onVisualViewportChange = () => {
      const geometry = viewportGeometry()
      if (presentation === 'glass-only' && (geometry === null || geometry !== lastViewportGeometry))
        markDirty()
      else start()
      lastViewportGeometry = geometry
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancel()
        if (pendingSince !== undefined) fallback(['Scene paused while the document is hidden.'])
      } else {
        markDirty()
        start()
      }
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancel()
      fallback(['WebGL context lost.'])
      renderer?.dispose()
      renderer = null
    }
    const onRestored = () => {
      lost = false
      markDirty()
      start()
    }
    const onNestedScroll = (event: Event) => {
      if (event.target !== document) {
        if (event.target instanceof Element) diagnostics?.onScroll(event.target)
        markDirty()
      }
    }
    const onAncestorMotion = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element) || !target.contains(host)) return
      const starts = event.type === 'animationstart' || event.type === 'transitionrun'
      const count = ancestorMotionCounts.get(target) ?? 0
      if (starts) ancestorMotionCounts.set(target, count + 1)
      else if (count > 1) ancestorMotionCounts.set(target, count - 1)
      else ancestorMotionCounts.delete(target)
      markDirty()
    }
    const onClick = (event: MouseEvent) => {
      if (
        presentation === 'glass-only' ||
        redirected ||
        event.detail === 0 ||
        !compiled ||
        !previous ||
        host.dataset.liquidGlassSceneReady !== 'true' ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const shown = previous
      const inFixedLayer =
        event.target instanceof Element &&
        (() => {
          for (
            let element: Element | null = event.target;
            element && element !== source;
            element = element.parentElement
          ) {
            if (getComputedStyle(element).position === 'fixed') return true
          }
          return false
        })()
      let target: HTMLElement | undefined
      for (let index = compiled.targets.length - 1; index >= 0; index -= 1) {
        const candidate = compiled.targets[index]
        if (!candidate || (inFixedLayer && candidate.space === 'document')) continue
        const { rect, space } = candidate
        const x = rect.x - (space === 'document' ? shown.scrollX : 0)
        const y = rect.y - (space === 'document' ? shown.scrollY : 0)
        if (
          event.clientX >= x &&
          event.clientX <= x + rect.width &&
          event.clientY >= y &&
          event.clientY <= y + rect.height
        ) {
          target = candidate.element
          break
        }
      }
      const nativeTarget =
        event.target instanceof Element
          ? event.target.closest('a, button, input, select, textarea, [tabindex]')
          : null
      if (nativeTarget === target || (!nativeTarget && !target)) return
      event.preventDefault()
      event.stopPropagation()
      if (target?.isConnected) {
        redirected = true
        try {
          target.focus({ preventScroll: true })
          target.click()
        } finally {
          redirected = false
        }
      }
    }

    const mutation = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.target !== output &&
            !output.contains(record.target) &&
            !(
              record.target === host &&
              record.type === 'attributes' &&
              ['data-liquid-glass-scene-ready', 'data-liquid-glass-scene-pending'].includes(
                record.attributeName ?? ''
              )
            )
        )
      )
        markDirty()
    })
    mutation.observe(
      presentation === 'glass-only' && canvasContainer ? document.documentElement : source,
      {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      }
    )
    const outsideStyles = new MutationObserver(markDirty)
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      outsideStyles.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style'] })
    }
    outsideStyles.observe(document.head, { subtree: true, childList: true, characterData: true })
    const resize = new ResizeObserver(markDirty)
    resize.observe(host)
    resize.observe(source)
    const events = [
      'focusin',
      'focusout',
      'input',
      'change',
      'load',
      'error',
      'loadeddata',
      'seeked',
      'play',
      'pause',
      'animationstart',
      'animationend',
      'transitionrun',
      'transitionend',
      'pointerover',
      'pointerout',
      'pointerdown',
      'pointerup',
    ]
    for (const name of events) source.addEventListener(name, markDirty, true)
    const documentStateEvents = [
      'pointerover',
      'pointerout',
      'pointerdown',
      'pointerup',
      'focusin',
      'focusout',
      'input',
      'change',
      'fullscreenchange',
      'toggle',
      'invalid',
    ]
    for (const name of documentStateEvents) document.addEventListener(name, markDirty, true)
    window.addEventListener('hashchange', markDirty)
    const ancestorEvents = [
      'animationstart',
      'animationend',
      'animationcancel',
      'transitionrun',
      'transitionend',
      'transitioncancel',
    ]
    for (const name of ancestorEvents) document.addEventListener(name, onAncestorMotion, true)
    source.addEventListener('scroll', onNestedScroll, true)
    source.addEventListener('click', onClick, true)
    // Visual viewport events also fire for browser chrome and pinch movement.
    // Let the frame compare actual layout dimensions before rebuilding the DOM.
    window.addEventListener('resize', start)
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    window.visualViewport?.addEventListener('resize', onVisualViewportChange)
    window.visualViewport?.addEventListener('scroll', onVisualViewportChange)
    document.addEventListener('visibilitychange', onVisibility)
    document.fonts?.addEventListener('loadingdone', markDirty)
    const colorScheme =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
    colorScheme?.addEventListener('change', markDirty)
    void document.fonts?.ready.then(() => {
      if (!disposed) markDirty()
    })
    output.addEventListener('webglcontextlost', onLost)
    output.addEventListener('webglcontextrestored', onRestored)
    start()

    return () => {
      disposed = true
      diagnostics?.dispose()
      cancel()
      clearPending()
      mutation.disconnect()
      outsideStyles.disconnect()
      resize.disconnect()
      paneResize?.disconnect()
      for (const name of events) source.removeEventListener(name, markDirty, true)
      for (const name of documentStateEvents) document.removeEventListener(name, markDirty, true)
      window.removeEventListener('hashchange', markDirty)
      for (const name of ancestorEvents) document.removeEventListener(name, onAncestorMotion, true)
      ancestorMotionCounts.clear()
      source.removeEventListener('scroll', onNestedScroll, true)
      source.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', start)
      window.removeEventListener('scroll', onWindowScroll)
      window.visualViewport?.removeEventListener('resize', onVisualViewportChange)
      window.visualViewport?.removeEventListener('scroll', onVisualViewportChange)
      document.removeEventListener('visibilitychange', onVisibility)
      document.fonts?.removeEventListener('loadingdone', markDirty)
      colorScheme?.removeEventListener('change', markDirty)
      output.removeEventListener('webglcontextlost', onLost)
      output.removeEventListener('webglcontextrestored', onRestored)
      renderer?.dispose()
      compiler.dispose()
      viewportCompiler?.dispose()
      invalidate.current = () => {}
      host.removeAttribute('data-liquid-glass-scene-ready')
      host.removeAttribute('data-liquid-glass-scene-pending')
    }
  }, [
    root,
    content,
    canvas,
    glasses,
    invalidate,
    background,
    maxPixelRatio,
    presentation,
    canvasContainer,
  ])
}
