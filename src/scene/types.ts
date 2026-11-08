import type { DisplacementMapOptions } from '../displacement-map'
import type { GlassStudioProps } from '../studio-props'

export interface SceneRect {
  x: number
  y: number
  width: number
  height: number
}
export type SceneColor = readonly [number, number, number, number]
export interface SceneClip {
  rect: SceneRect
  space: 'document' | 'viewport'
  radius: number
  roundness?: number
  /** DOM element establishing this clip, when known to the compiler. */
  owner?: Element
}

export interface GlassOptions {
  /** Destination for the pane's pre-content snapshot in layered presentation. */
  nativeLayer?: HTMLCanvasElement
  radius: number
  displacement: readonly [number, number, number]
  blur: number
  saturation: number
  color: string
  opacity: number
  thickness?: number
  magnification?: number
  studio?: GlassStudioProps
  glareOffset?: { current: number }
  legacyTint?: boolean
  legacyRadius?: boolean
  map?: DisplacementMapOptions & { xChannel: 'R' | 'G' | 'B'; yChannel: 'R' | 'G' | 'B' }
}

interface SceneBase {
  rect: SceneRect
  space: 'document' | 'viewport'
  opacity: number
  /** Multiplicative darkening for a supported CSS brightness filter. */
  brightness?: number
  clip?: SceneClip
  /** Full ancestor clip stack; when present this replaces the legacy single clip. */
  clips?: readonly SceneClip[]
}

export type SceneOpacityPaint =
  | (SceneBase & { kind: 'sprite'; bitmap: HTMLCanvasElement })
  | (SceneBase & {
      kind: 'media'
      source: HTMLVideoElement | HTMLCanvasElement
      fit: 'cover' | 'contain' | 'fill'
      position: readonly [number, number]
      radius: number
    })
  | (SceneBase & { kind: 'solid'; radius: number; color: SceneColor })
export type SceneGlass = SceneBase & {
  kind: 'glass'
  nativeLayer?: HTMLCanvasElement
  radius: number
  displacement: readonly [number, number, number]
  blur: number
  saturation: number
  tint: SceneColor
  thickness?: number
  magnification?: number
  studio?: GlassStudioProps
  glareOffset?: { current: number }
  map?: { bitmap: HTMLCanvasElement; xChannel: 0 | 1 | 2; yChannel: 0 | 1 | 2 }
}
export type SceneBackdrop = SceneBase & {
  kind: 'backdrop'
  bitmap: HTMLCanvasElement
  sigma: number
  radius: number
  filterSaturation?: number
  filterBrightness?: number
}
export type SceneOpacityGroupPaint = SceneOpacityPaint | SceneGlass | SceneBackdrop
export type SceneItem =
  | SceneOpacityPaint
  | (SceneBase & {
      kind: 'opacity-group'
      items: readonly SceneOpacityGroupPaint[]
      /** Alpha mask applied once after the children have been composed. */
      mask?: { bitmap: HTMLCanvasElement; rect: SceneRect; space: 'document' | 'viewport' }
    })
  | SceneBackdrop
  | SceneGlass

export interface SceneFrame {
  scrollX: number
  scrollY: number
  width: number
  height: number
  pixelRatio: number
  devicePixelRatio?: number
}
export interface GlassScene {
  background: SceneColor
  items: readonly SceneItem[]
  /** Conservative viewport-space sampling bounds for glass-only presentation. */
  samplingRegion?: SceneRect
  /** Disjoint optical regions; the enclosing rectangle remains available for compatibility. */
  samplingRegions?: readonly SceneRect[]
  /** Conservative source regions after propagating backdrop dependencies. */
  renderRegions?: readonly SceneRect[]
}
export interface SceneRenderer {
  setScene(scene: GlassScene): void
  render(frame: SceneFrame): boolean
  dispose(): void
}
export interface SceneTarget {
  element: HTMLElement
  rect: SceneRect
  space: 'document' | 'viewport'
  brightness?: number
}
export interface SamplingWatch {
  element: Element
  relation: 'inside' | 'outside' | 'invalid'
}
export interface CompiledScene {
  scene: GlassScene
  targets: SceneTarget[]
  issues: string[]
  /** Sticky positions need fresh geometry during window scroll. Nested scroll invalidates separately. */
  liveGeometry: boolean
  /** Pure window scrolling preserves the captured paint geometry. The caller must still
   * validate capture coverage, animations, layout and the fixed container's bounds.
   */
  scrollTranslationSafe?: boolean
  /** Bounded off-region content to remeasure without recompiling the full DOM. */
  samplingWatches?: readonly SamplingWatch[]
  media: (HTMLVideoElement | HTMLCanvasElement)[]
}
export interface SceneCompiler {
  compile(
    root: HTMLElement,
    glasses: ReadonlyMap<HTMLElement, GlassOptions>,
    frame: SceneFrame,
    background: string,
    /** Conservative glass sampling area in viewport CSS pixels, if one is known. */
    samplingRegion?: SceneRect,
    /** Optional disjoint optical regions, each including the total glass apron. */
    samplingRegions?: readonly SceneRect[],
    /** Request a scroll-translation proof for one fixed navigation branch. */
    fixedContainer?: HTMLElement
  ): CompiledScene
  dispose(): void
}
