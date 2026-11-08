import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useId,
  useCallback,
  useContext,
  useMemo,
  type CSSProperties,
  type HTMLAttributes,
  type ElementType,
} from 'react'
import { GlassStyles } from './styles'
import { useWebGLBackdrop } from './use-webgl-backdrop'
import { LiquidGlassSceneContext } from './scene/context'
import { interactiveGlareOffset, subscribeInteractiveGlare } from './scene/interactive-glare'
import { createDisplacementMapSvg } from './displacement-map'
import {
  GLASS_STUDIO_DEFAULTS,
  GLASS_STUDIO_PROP_KEYS,
  resolveStudioProps,
  type GlassStudioProps,
} from './studio-props'

export interface LiquidGlassProps
  extends HTMLAttributes<HTMLDivElement>, Partial<GlassStudioProps> {
  /** Keep the pane's children as native HTML in a layered scene. */
  nativeContent?: boolean
  /** Follow touch or mouse position inside a scene. Default 'manual'. */
  glareAngleMode?: 'manual' | 'interactive'
  /** Render built-in styles. Disable when importing the package stylesheet separately. Default true. */
  includeStyles?: boolean
  /** Optional Studio size aliases. Omit to keep CSS/width/height sizing. */
  shapeWidth?: number
  shapeHeight?: number
  width?: number | string
  height?: number | string
  borderRadius?: number
  borderWidth?: number
  brightness?: number
  opacity?: number
  blur?: number
  displace?: number
  backgroundOpacity?: number
  glassColor?: string
  saturation?: number
  distortionScale?: number
  /** Refracting edge thickness in CSS pixels inside LiquidGlassScene. Default 20. */
  thickness?: number
  /** Body convexity inside LiquidGlassScene, from 0 (flat, default) to 1. */
  convexity?: number
  /** Advanced body magnification. Default 1; an explicit convexity takes precedence. */
  magnification?: number
  redOffset?: number
  greenOffset?: number
  blueOffset?: number
  xChannel?: 'R' | 'G' | 'B'
  yChannel?: 'R' | 'G' | 'B'
  mixBlendMode?:
    | 'normal'
    | 'multiply'
    | 'screen'
    | 'overlay'
    | 'darken'
    | 'lighten'
    | 'color-dodge'
    | 'color-burn'
    | 'hard-light'
    | 'soft-light'
    | 'difference'
    | 'exclusion'
    | 'hue'
    | 'saturation'
    | 'color'
    | 'luminosity'
    | 'plus-darker'
    | 'plus-lighter'
}

const LiquidGlass = forwardRef<HTMLDivElement, LiquidGlassProps>((props, forwardedRef) => {
  const {
    as: Root = 'div',
    includeStyles = true,
    children = null,
    className = '',
    style = {},
    shapeWidth,
    shapeHeight,
    width = shapeWidth ?? 'auto',
    height = shapeHeight ?? 'auto',
    borderRadius = 20,
    borderWidth = 0.07,
    brightness = 50,
    opacity = 0.93,
    blur = 11,
    displace = 0,
    backgroundOpacity = 0,
    glassColor,
    saturation = 1,
    distortionScale = -180,
    thickness = 20,
    convexity,
    magnification = 1,
    redOffset = 0,
    greenOffset = 0,
    blueOffset = 0,
    xChannel = 'R',
    yChannel = 'G',
    mixBlendMode = 'difference',
    glareAngleMode = 'manual',
    nativeContent = false,
    ...rest
  } = props as LiquidGlassProps & { as?: ElementType }
  const tintR = props.tint?.r
  const tintG = props.tint?.g
  const tintB = props.tint?.b
  const tintA = props.tint?.a
  const shadowX = props.shadowPosition?.x
  const shadowY = props.shadowPosition?.y
  const studio = useMemo(
    () =>
      resolveStudioProps({
        refThickness: props.refThickness ?? thickness,
        refDistance:
          props.refDistance ??
          (Number.isFinite(distortionScale)
            ? (Math.abs(distortionScale) / 180) * 0.05
            : GLASS_STUDIO_DEFAULTS.refDistance),
        refFactor: props.refFactor ?? GLASS_STUDIO_DEFAULTS.refFactor,
        refDispersion: props.refDispersion ?? GLASS_STUDIO_DEFAULTS.refDispersion,
        refFresnelRange: props.refFresnelRange ?? GLASS_STUDIO_DEFAULTS.refFresnelRange,
        refFresnelHardness: props.refFresnelHardness ?? GLASS_STUDIO_DEFAULTS.refFresnelHardness,
        refFresnelFactor: props.refFresnelFactor ?? GLASS_STUDIO_DEFAULTS.refFresnelFactor,
        glareRange: props.glareRange ?? GLASS_STUDIO_DEFAULTS.glareRange,
        glareHardness: props.glareHardness ?? GLASS_STUDIO_DEFAULTS.glareHardness,
        glareFactor: props.glareFactor ?? GLASS_STUDIO_DEFAULTS.glareFactor,
        glareConvergence: props.glareConvergence ?? GLASS_STUDIO_DEFAULTS.glareConvergence,
        glareOppositeFactor: props.glareOppositeFactor ?? GLASS_STUDIO_DEFAULTS.glareOppositeFactor,
        glareAngle: props.glareAngle ?? GLASS_STUDIO_DEFAULTS.glareAngle,
        blurRadius: props.blurRadius ?? displace,
        blurEdge: props.blurEdge ?? GLASS_STUDIO_DEFAULTS.blurEdge,
        tint: {
          r: tintR ?? GLASS_STUDIO_DEFAULTS.tint.r,
          g: tintG ?? GLASS_STUDIO_DEFAULTS.tint.g,
          b: tintB ?? GLASS_STUDIO_DEFAULTS.tint.b,
          a: tintA ?? GLASS_STUDIO_DEFAULTS.tint.a,
        },
        shadowExpand: props.shadowExpand ?? GLASS_STUDIO_DEFAULTS.shadowExpand,
        shadowFactor: props.shadowFactor ?? GLASS_STUDIO_DEFAULTS.shadowFactor,
        shadowPosition: {
          x: shadowX ?? GLASS_STUDIO_DEFAULTS.shadowPosition.x,
          y: shadowY ?? GLASS_STUDIO_DEFAULTS.shadowPosition.y,
        },
        shapeRadius: props.shapeRadius ?? GLASS_STUDIO_DEFAULTS.shapeRadius,
        shapeRoundness: props.shapeRoundness ?? GLASS_STUDIO_DEFAULTS.shapeRoundness,
        thickness,
        displace,
        distortionScale,
      }),
    [
      props.refThickness,
      props.refDistance,
      props.refFactor,
      props.refDispersion,
      props.refFresnelRange,
      props.refFresnelHardness,
      props.refFresnelFactor,
      props.glareRange,
      props.glareHardness,
      props.glareFactor,
      props.glareConvergence,
      props.glareOppositeFactor,
      props.glareAngle,
      props.blurRadius,
      props.blurEdge,
      props.shadowExpand,
      props.shadowFactor,
      props.shapeRadius,
      props.shapeRoundness,
      tintR,
      tintG,
      tintB,
      tintA,
      shadowX,
      shadowY,
      thickness,
      displace,
      distortionScale,
    ]
  )
  const legacyTint =
    props.tint === undefined &&
    (props.glassColor !== undefined || props.backgroundOpacity !== undefined)
  const legacyRadius = props.shapeRadius === undefined && props.borderRadius !== undefined
  for (const key of GLASS_STUDIO_PROP_KEYS) delete rest[key]
  const internalRef = useRef<HTMLDivElement | null>(null)
  const scene = useContext(LiquidGlassSceneContext)
  const layered = !!scene?.layered && nativeContent
  const nativeLayer = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!scene || glareAngleMode !== 'interactive') return
    return subscribeInteractiveGlare(scene.repaint)
  }, [scene, glareAngleMode])
  const bodyMagnification =
    convexity === undefined
      ? magnification
      : 1 + Math.max(0, Math.min(1, Number.isFinite(convexity) ? convexity : 0)) * 0.5
  const uniqueId = useId().replace(/:/g, '-')
  const filterId = `glass-filter-${uniqueId}`

  const [svgSupported, setSvgSupported] = useState<boolean>(false)
  const [webglEnabled, setWebglEnabled] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const webglReady = useWebGLBackdrop({
    enabled: webglEnabled && !scene,
    root: internalRef,
    canvas: canvasRef,
    borderRadius,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
  })

  const feImageRef = useRef<SVGFEImageElement>(null)
  const redChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null)
  const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null)

  useEffect(() => {
    const element = internalRef.current
    if (!scene || !element) return
    return scene.register(element, {
      radius: borderRadius,
      displacement: [
        distortionScale + redOffset,
        distortionScale + greenOffset,
        distortionScale + blueOffset,
      ],
      blur: Math.max(0, displace),
      saturation,
      color: glassColor ?? '#fff',
      opacity: backgroundOpacity,
      thickness,
      magnification: bodyMagnification,
      studio,
      ...(layered && nativeLayer.current ? { nativeLayer: nativeLayer.current } : {}),
      ...(glareAngleMode === 'interactive' ? { glareOffset: interactiveGlareOffset } : {}),
      legacyTint,
      legacyRadius,
      map: {
        borderRadius,
        borderWidth,
        brightness,
        opacity,
        blur,
        mixBlendMode,
        xChannel,
        yChannel,
      },
    })
  }, [
    scene,
    layered,
    borderRadius,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
    displace,
    saturation,
    glassColor,
    backgroundOpacity,
    thickness,
    bodyMagnification,
    borderWidth,
    brightness,
    opacity,
    blur,
    mixBlendMode,
    xChannel,
    yChannel,
    studio,
    glareAngleMode,
    legacyTint,
    legacyRadius,
  ])

  /** Merge internal ref + forwarded ref */
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      internalRef.current = el
      if (typeof forwardedRef === 'function') {
        forwardedRef(el)
      } else if (forwardedRef) {
        forwardedRef.current = el
      }
    },
    [forwardedRef]
  )

  const generateDisplacementMap = useCallback(() => {
    const rect = internalRef.current?.getBoundingClientRect()
    const actualWidth = rect?.width ?? 400
    const actualHeight = rect?.height ?? 200
    const svgContent = createDisplacementMapSvg(actualWidth, actualHeight, {
      borderRadius,
      borderWidth,
      brightness,
      opacity,
      blur,
      mixBlendMode,
    })

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`
  }, [borderRadius, borderWidth, brightness, opacity, blur, mixBlendMode])

  const updateDisplacementMap = useCallback(() => {
    feImageRef.current?.setAttribute('href', generateDisplacementMap())
  }, [generateDisplacementMap])

  useEffect(() => {
    if (scene) return
    updateDisplacementMap()

    const channels = [
      { ref: redChannelRef, offset: redOffset },
      { ref: greenChannelRef, offset: greenOffset },
      { ref: blueChannelRef, offset: blueOffset },
    ] as const

    for (const { ref, offset } of channels) {
      if (ref.current) {
        ref.current.setAttribute('scale', (distortionScale + offset).toString())
        ref.current.setAttribute('xChannelSelector', xChannel)
        ref.current.setAttribute('yChannelSelector', yChannel)
      }
    }

    gaussianBlurRef.current?.setAttribute('stdDeviation', displace.toString())
  }, [
    updateDisplacementMap,
    redOffset,
    greenOffset,
    blueOffset,
    distortionScale,
    xChannel,
    yChannel,
    displace,
    scene,
  ])

  useEffect(() => {
    const container = internalRef.current
    if (!container || scene) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      timeoutId = setTimeout(updateDisplacementMap, 0)
    })

    resizeObserver.observe(container)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [updateDisplacementMap, scene])

  useEffect(() => {
    if (scene) {
      setSvgSupported(false)
      setWebglEnabled(false)
      return
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      setSvgSupported(false)
      return
    }

    // WebKit accepts the URL syntax but does not apply SVG backdrop filters.
    // This also covers third-party browsers on iOS, which use WebKit.
    if (window.CSS?.supports?.('-webkit-touch-callout', 'none')) {
      setSvgSupported(false)
      setWebglEnabled(true)
      return
    }

    const div = document.createElement('div')
    div.style.backdropFilter = `url(#${filterId})`
    setSvgSupported(div.style.backdropFilter !== '')
  }, [filterId, scene])

  const studioTint = `rgba(${studio.tint.r}, ${studio.tint.g}, ${studio.tint.b}, ${Math.round(studio.tint.a * 8000) / 10000})`
  const containerStyle: CSSProperties = {
    ...style,
    ...(width !== 'auto' ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    ...(height !== 'auto' ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
    borderRadius:
      scene && studio.shapeRadius === 100 && !legacyRadius
        ? 'var(--glass-managed-radius, var(--glass-base-radius))'
        : `${borderRadius}px`,
    '--glass-base-radius': `${borderRadius}px`,
    ...(!legacyTint ? { '--glass-managed-simple-background': studioTint } : {}),
    '--glass-managed-background': legacyTint
      ? 'color-mix(in oklch, var(--glass-color) calc(var(--glass-frost) * 100%), transparent)'
      : studioTint,
    '--glass-managed-blur': `${studio.blurRadius}px`,
    '--glass-color': glassColor ?? 'light-dark(white, black)',
    '--glass-frost': backgroundOpacity,
    '--glass-saturation': saturation,
    '--glass-webgl-blur': `${Math.max(0, displace)}px`,
    '--filter-id': `url(#${filterId})`,
  } as CSSProperties

  return (
    <Root
      ref={setRef}
      className={`liquid-glass-root liquid-glass ${svgSupported ? 'liquid-glass--svg' : 'liquid-glass--fallback'} ${webglReady ? 'liquid-glass--webgl' : ''} ${scene ? 'liquid-glass--managed' : ''} ${layered ? 'liquid-glass--layered' : ''} ${className}`}
      style={containerStyle}
      {...rest}
    >
      {!scene && (
        <>
          <svg className="liquid-glass__filter" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter
                id={filterId}
                colorInterpolationFilters="sRGB"
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feImage
                  ref={feImageRef}
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  result="map"
                />

                <feDisplacementMap
                  ref={redChannelRef}
                  in="SourceGraphic"
                  in2="map"
                  id="redchannel"
                  result="dispRed"
                />
                <feColorMatrix
                  in="dispRed"
                  type="matrix"
                  values="1 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"
                  result="red"
                />

                <feDisplacementMap
                  ref={greenChannelRef}
                  in="SourceGraphic"
                  in2="map"
                  id="greenchannel"
                  result="dispGreen"
                />
                <feColorMatrix
                  in="dispGreen"
                  type="matrix"
                  values="0 0 0 0 0
                        0 1 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"
                  result="green"
                />

                <feDisplacementMap
                  ref={blueChannelRef}
                  in="SourceGraphic"
                  in2="map"
                  id="bluechannel"
                  result="dispBlue"
                />
                <feColorMatrix
                  in="dispBlue"
                  type="matrix"
                  values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 1 0 0
                        0 0 0 1 0"
                  result="blue"
                />

                <feBlend in="red" in2="green" mode="screen" result="rg" />
                <feBlend in="rg" in2="blue" mode="screen" result="output" />
                <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0.7" />
              </filter>
            </defs>
          </svg>

          <canvas ref={canvasRef} className="liquid-glass__webgl" aria-hidden="true" />
        </>
      )}
      {layered && (
        <canvas
          ref={nativeLayer}
          className="liquid-glass__native-layer"
          data-liquid-glass-scene-canvas=""
          aria-hidden="true"
          width={0}
          height={0}
        />
      )}
      <div className="liquid-glass__content">{children}</div>
      {!scene && includeStyles && <GlassStyles />}
    </Root>
  )
})
LiquidGlass.displayName = 'LiquidGlass'

export { LiquidGlass }
