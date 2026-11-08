import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  type ElementType,
  type HTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { SceneStyles } from './styles'
import { LiquidGlassSceneContext, type SceneController } from './scene/context'
import type { GlassOptions } from './scene/types'
import { useScene } from './scene/use-scene'

export type LiquidGlassSceneStatus =
  | { status: 'ready' }
  | { status: 'pending'; reasons: readonly string[] }
  | { status: 'fallback'; reasons: readonly string[] }

export interface LiquidGlassSceneProps extends HTMLAttributes<HTMLDivElement> {
  /** Render built-in styles. Disable when importing the package stylesheet separately. Default true. */
  includeStyles?: boolean
  /** Opaque base behind the scene. Defaults to the wrapper or page background. */
  background?: string
  /** Maximum backing resolution; also limited by maxCanvasPixels and the 4096px side limit. Default 2. */
  maxPixelRatio?: number
  /** Maximum canvas backing pixels. Defaults to 2,000,000; values above 4096² are capped. */
  maxCanvasPixels?: number
  /** Present managed panes only; native page content stays visible elsewhere. */
  presentation?: 'scene' | 'glass-only'
  /** Fixed container enclosing every pane, used to keep the canvas with native controls. */
  canvasContainer?: HTMLElement | null
  /** Keep marked controls native, or opt into per-pane layered content. */
  foreground?: 'canvas' | 'native' | 'layered'
  /** Reports unsupported content or GPU failure without hiding the original HTML. */
  onStatusChange?: (state: LiquidGlassSceneStatus) => void
}

/** Owns the canvas and automatically composes supported HTML behind LiquidGlass. */
export const LiquidGlassScene = forwardRef<HTMLDivElement, LiquidGlassSceneProps>(
  (rawProps, forwardedRef) => {
    const {
      as: Root = 'div',
      includeStyles = true,
      className = '',
      children,
      background,
      maxPixelRatio = 2,
      maxCanvasPixels = 2_000_000,
      presentation = 'scene',
      canvasContainer,
      foreground = 'canvas',
      onStatusChange,
      ...props
    } = rawProps as LiquidGlassSceneProps & { as?: ElementType }
    const root = useRef<HTMLDivElement | null>(null)
    const content = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)
    const glasses = useRef(new Map<HTMLElement, GlassOptions>())
    const invalidate = useRef<() => void>(() => {})
    const repaint = useRef<() => void>(() => {})
    const layered = foreground === 'layered' && presentation === 'scene' && canvasContainer === undefined
    const controller = useMemo<SceneController>(
      () => ({
        layered,
        register(element, options) {
          glasses.current.set(element, options)
          invalidate.current()
          return () => {
            glasses.current.delete(element)
            invalidate.current()
          }
        },
        update(element, options) {
          glasses.current.set(element, options)
          invalidate.current()
        },
        repaint() {
          repaint.current()
        },
      }),
      [layered]
    )
    const setRoot = useCallback(
      (element: HTMLDivElement | null) => {
        root.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      },
      [forwardedRef]
    )

    useScene({
      root,
      content,
      canvas,
      glasses,
      invalidate,
      repaint,
      background,
      maxPixelRatio,
      maxCanvasPixels,
      presentation,
      canvasContainer: canvasContainer ?? null,
      foreground,
      onStatusChange,
    })

    const nativeForeground =
      foreground === 'native' && presentation === 'glass-only' && !!canvasContainer
    const output = (
      <canvas
        ref={canvas}
        className="liquid-glass-scene__canvas"
        data-liquid-glass-scene-canvas=""
        width={0}
        height={0}
        aria-hidden="true"
        style={
          canvasContainer
            ? {
                position: 'absolute',
                zIndex: nativeForeground ? 0 : 2147483647,
                pointerEvents: 'none',
                opacity: 0,
              }
            : undefined
        }
      />
    )

    return (
      <LiquidGlassSceneContext.Provider value={controller}>
        <Root
          {...props}
          ref={setRoot}
          className={`liquid-glass-scene-root ${className}`.trim()}
          data-liquid-glass-scene=""
          data-liquid-glass-foreground-mode={nativeForeground ? 'native' : layered ? 'layered' : undefined}
        >
          <div ref={content} className="liquid-glass-scene__content">
            {children}
          </div>
          {canvasContainer === undefined
            ? output
            : canvasContainer
              ? createPortal(output, canvasContainer)
              : null}
          {includeStyles && <SceneStyles />}
        </Root>
      </LiquidGlassSceneContext.Provider>
    )
  }
)
LiquidGlassScene.displayName = 'LiquidGlassScene'
