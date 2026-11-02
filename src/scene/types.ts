import type { DisplacementMapOptions } from '../displacement-map'
import type { GlassStudioProps } from '../studio-props'

export interface SceneRect {
  x: number
  y: number
  width: number
  height: number
}
export type SceneColor = readonly [number, number, number, number]

export interface GlassOptions {
  radius: number
  displacement: readonly [number, number, number]
  blur: number
  saturation: number
  color: string
  opacity: number
  thickness?: number
  magnification?: number
  studio?: GlassStudioProps
  legacyTint?: boolean
  legacyRadius?: boolean
  map?: DisplacementMapOptions & { xChannel: 'R' | 'G' | 'B'; yChannel: 'R' | 'G' | 'B' }
}

interface SceneBase {
  rect: SceneRect
  space: 'document' | 'viewport'
  opacity: number
  clip?: { rect: SceneRect; space: 'document' | 'viewport'; radius: number; roundness?: number }
}

export type SceneItem =
  | (SceneBase & { kind: 'sprite'; bitmap: HTMLCanvasElement })
  | (SceneBase & {
      kind: 'media'
      source: HTMLVideoElement | HTMLCanvasElement
      fit: 'cover' | 'contain' | 'fill'
      position: readonly [number, number]
      radius: number
    })
  | (SceneBase & { kind: 'solid'; radius: number; color: SceneColor })
  | (SceneBase & {
      kind: 'glass'
      radius: number
      displacement: readonly [number, number, number]
      blur: number
      saturation: number
      tint: SceneColor
      thickness?: number
      magnification?: number
      studio?: GlassStudioProps
      map?: { bitmap: HTMLCanvasElement; xChannel: 0 | 1 | 2; yChannel: 0 | 1 | 2 }
    })

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
}
export interface CompiledScene {
  scene: GlassScene
  targets: SceneTarget[]
  issues: string[]
  /** Sticky positions need fresh geometry during window scroll. Nested scroll invalidates separately. */
  liveGeometry: boolean
  media: (HTMLVideoElement | HTMLCanvasElement)[]
}
export interface SceneCompiler {
  compile(
    root: HTMLElement,
    glasses: ReadonlyMap<HTMLElement, GlassOptions>,
    frame: SceneFrame,
    background: string
  ): CompiledScene
  dispose(): void
}
