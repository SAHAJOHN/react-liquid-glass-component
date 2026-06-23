import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useId,
  useCallback,
  type CSSProperties,
  type HTMLAttributes,
} from 'react'
import { LiquidGlassStyled } from './styles'

export interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
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

const LiquidGlass = forwardRef<HTMLDivElement, LiquidGlassProps>(
  (
    {
      children = null,
      className = '',
      style = {},
      width = 'auto',
      height = 'auto',
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
      redOffset = 0,
      greenOffset = 10,
      blueOffset = 20,
      xChannel = 'R',
      yChannel = 'G',
      mixBlendMode = 'difference',
      ...rest
    },
    forwardedRef,
  ) => {
    const internalRef = useRef<HTMLDivElement | null>(null)
    const uniqueId = useId().replace(/:/g, '-')
    const filterId = `glass-filter-${uniqueId}`
    const redGradId = `red-grad-${uniqueId}`
    const blueGradId = `blue-grad-${uniqueId}`

    const [svgSupported, setSvgSupported] = useState<boolean>(false)

    const feImageRef = useRef<SVGFEImageElement>(null)
    const redChannelRef = useRef<SVGFEDisplacementMapElement>(null)
    const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null)
    const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null)
    const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null)

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
      [forwardedRef],
    )

    const generateDisplacementMap = useCallback(() => {
      const rect = internalRef.current?.getBoundingClientRect()
      const actualWidth = rect?.width ?? 400
      const actualHeight = rect?.height ?? 200
      const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5)

      const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="rgba(255,0,0,0)"/>
            <stop offset="20%" stop-color="rgba(255,0,0,1)"/>
            <stop offset="80%" stop-color="rgba(255,0,0,1)"/>
            <stop offset="100%" stop-color="rgba(255,0,0,0)"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(0,0,255,0)"/>
            <stop offset="20%" stop-color="rgba(0,0,255,1)"/>
            <stop offset="80%" stop-color="rgba(0,0,255,1)"/>
            <stop offset="100%" stop-color="rgba(0,0,255,0)"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="rgb(128,128,128)"></rect>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${mixBlendMode}" />
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
      </svg>
    `

      return `data:image/svg+xml,${encodeURIComponent(svgContent)}`
    }, [
      borderRadius,
      borderWidth,
      brightness,
      opacity,
      blur,
      redGradId,
      blueGradId,
      mixBlendMode,
    ])

    const updateDisplacementMap = useCallback(() => {
      feImageRef.current?.setAttribute('href', generateDisplacementMap())
    }, [generateDisplacementMap])

    useEffect(() => {
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
    ])

    useEffect(() => {
      const container = internalRef.current
      if (!container) return

      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const resizeObserver = new ResizeObserver(() => {
        timeoutId = setTimeout(updateDisplacementMap, 0)
      })

      resizeObserver.observe(container)

      return () => {
        if (timeoutId) clearTimeout(timeoutId)
        resizeObserver.disconnect()
      }
    }, [updateDisplacementMap])

    useEffect(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        setSvgSupported(false)
        return
      }

      const div = document.createElement('div')
      div.style.backdropFilter = `url(#${filterId})`
      setSvgSupported(div.style.backdropFilter !== '')
    }, [filterId])

    const containerStyle: CSSProperties = {
      ...style,
      ...(width !== 'auto'
        ? { width: typeof width === 'number' ? `${width}px` : width }
        : {}),
      ...(height !== 'auto'
        ? { height: typeof height === 'number' ? `${height}px` : height }
        : {}),
      borderRadius: `${borderRadius}px`,
      '--glass-color': glassColor ?? 'light-dark(white, black)',
      '--glass-frost': backgroundOpacity,
      '--glass-saturation': saturation,
      '--filter-id': `url(#${filterId})`,
    } as CSSProperties

    return (
        <LiquidGlassStyled
          ref={setRef}
          className={`liquid-glass ${svgSupported ? 'liquid-glass--svg' : 'liquid-glass--fallback'} ${className}`}
          style={containerStyle}
          {...rest}
        >
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

        <div className="liquid-glass__content">{children}</div>
      </LiquidGlassStyled>
    )
  },
)
LiquidGlass.displayName = 'LiquidGlass'

export { LiquidGlass }
