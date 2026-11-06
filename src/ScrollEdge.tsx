'use client'

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type PropsWithChildren,
  type UIEventHandler,
} from 'react'
import { ScrollEdgeStyles } from './styles'

export type ScrollEdgePosition = 'top' | 'bottom' | 'left' | 'right'

export type ScrollEdgeCurve = 'linear' | 'bezier' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type ScrollEdgePreset =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'subtle'
  | 'intense'
  | 'smooth'
  | 'sharp'
  | 'header'
  | 'footer'
  | 'sidebar'
  | 'page-header'
  | 'page-footer'

export interface ScrollEdgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render built-in styles. Disable when importing the package stylesheet separately. Default true. */
  includeStyles?: boolean
  edges?: ScrollEdgePosition[]
  shadow?: boolean
  blur?: boolean
  disabled?: boolean
  dependencies?: React.DependencyList
  onScroll?: UIEventHandler<HTMLDivElement>

  /** @deprecated Only used for target="page"; parent shadows use transparent masks. */
  shadowColor?: string
  shadowSize?: number | string

  blurStrength?: number
  edgeSize?: string
  divCount?: number
  exponential?: boolean
  zIndex?: number
  animated?: boolean | 'scroll'
  duration?: string
  easing?: string
  opacity?: number
  curve?: ScrollEdgeCurve
  responsive?: boolean
  mobileSize?: string
  tabletSize?: string
  desktopSize?: string
  preset?: ScrollEdgePreset
  hoverIntensity?: number
  target?: 'parent' | 'page'
  onAnimationComplete?: () => void
}

const DEFAULT_EDGES: ScrollEdgePosition[] = ['top', 'bottom']

const PRESETS: Record<ScrollEdgePreset, Partial<ScrollEdgeProps>> = {
  top: { edges: ['top'], edgeSize: '6rem' },
  bottom: { edges: ['bottom'], edgeSize: '6rem' },
  left: { edges: ['left'], edgeSize: '6rem' },
  right: { edges: ['right'], edgeSize: '6rem' },
  subtle: { edgeSize: '4rem', blurStrength: 1, opacity: 0.8, divCount: 3 },
  intense: { edgeSize: '10rem', blurStrength: 4, divCount: 8, exponential: true },
  smooth: { edgeSize: '8rem', curve: 'bezier', divCount: 10 },
  sharp: { edgeSize: '5rem', curve: 'linear', divCount: 4 },
  header: { edges: ['top'], edgeSize: '8rem', curve: 'ease-out' },
  footer: { edges: ['bottom'], edgeSize: '8rem', curve: 'ease-out' },
  sidebar: { edges: ['left'], edgeSize: '6rem', blurStrength: 2.5 },
  'page-header': { edges: ['top'], edgeSize: '10rem', target: 'page', blurStrength: 3 },
  'page-footer': { edges: ['bottom'], edgeSize: '10rem', target: 'page', blurStrength: 3 },
}

const CURVE_FUNCTIONS: Record<ScrollEdgeCurve, (p: number) => number> = {
  linear: (p) => p,
  bezier: (p) => p * p * (3 - 2 * p),
  'ease-in': (p) => p * p,
  'ease-out': (p) => 1 - Math.pow(1 - p, 2),
  'ease-in-out': (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
}

const GRADIENT_DIRECTIONS: Record<ScrollEdgePosition, string> = {
  top: 'to top',
  bottom: 'to bottom',
  left: 'to left',
  right: 'to right',
}

const debounce = <T extends (...args: unknown[]) => void>(fn: T, wait: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), wait)
  }
}

const useIntersectionObserver = (
  ref: React.RefObject<HTMLElement | null>,
  shouldObserve: boolean
) => {
  const [isVisible, setIsVisible] = useState(!shouldObserve)

  useEffect(() => {
    if (!shouldObserve || !ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsVisible(entry.isIntersecting)
      },
      { threshold: 0.1 }
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref, shouldObserve])

  return isVisible
}

const useResponsiveSize = (
  responsive: boolean,
  size: string,
  mobileSize: string | undefined,
  tabletSize: string | undefined,
  desktopSize: string | undefined
): string | undefined => {
  const [val, setVal] = useState<string | undefined>()

  useEffect(() => {
    if (!responsive) return
    const calc = () => {
      const w = window.innerWidth
      let picked: string | undefined
      if (w <= 480 && mobileSize) picked = mobileSize
      else if (w <= 768 && tabletSize) picked = tabletSize
      else if (w <= 1024 && desktopSize) picked = desktopSize
      setVal(picked ?? size)
    }
    const debounced = debounce(calc, 100)
    calc()
    window.addEventListener('resize', debounced)
    return () => window.removeEventListener('resize', debounced)
  }, [responsive, size, mobileSize, tabletSize, desktopSize])

  return responsive ? val : size
}

const ScrollEdge = forwardRef<HTMLDivElement, PropsWithChildren<ScrollEdgeProps>>(
  (rawProps, forwardedRef) => {
    const {
      as: Root = 'div',
      includeStyles = true,
      children,
      className = '',
      style,
      edges,
      shadow,
      blur,
      disabled,
      dependencies,
      onScroll,
      shadowColor,
      shadowSize,
      blurStrength,
      edgeSize,
      divCount,
      exponential,
      zIndex,
      animated,
      duration,
      easing,
      opacity,
      curve,
      responsive,
      mobileSize,
      tabletSize,
      desktopSize,
      preset,
      hoverIntensity,
      target,
      onAnimationComplete,
      ...rest
    } = rawProps as PropsWithChildren<ScrollEdgeProps> & { as?: ElementType }
    const internalRef = useRef<HTMLDivElement | null>(null)
    const scrollableRef = useRef<HTMLDivElement | null>(null)
    const [isHovered, setIsHovered] = useState(false)
    const [hasTop, setHasTop] = useState(false)
    const [hasBottom, setHasBottom] = useState(false)
    const [hasLeft, setHasLeft] = useState(false)
    const [hasRight, setHasRight] = useState(false)

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        internalRef.current = el
        if (el) {
          scrollableRef.current = el.querySelector('.scroll-edge__scrollable')
        } else {
          scrollableRef.current = null
        }
        if (typeof forwardedRef === 'function') {
          forwardedRef(el)
        } else if (forwardedRef) {
          forwardedRef.current = el
        }
      },
      [forwardedRef]
    )

    const presetConfig = useMemo(
      () => (preset && preset in PRESETS ? PRESETS[preset] : {}),
      [preset]
    )

    const finalEdges = useMemo(
      () => edges ?? presetConfig.edges ?? DEFAULT_EDGES,
      [edges, presetConfig.edges]
    )
    const finalShadow = shadow ?? presetConfig.shadow ?? true
    const finalBlur = blur ?? presetConfig.blur ?? false
    const finalDisabled = disabled ?? presetConfig.disabled ?? false
    const finalDependencies = dependencies ?? presetConfig.dependencies ?? []
    const finalShadowColor = shadowColor ?? presetConfig.shadowColor ?? 'rgba(0, 0, 0, 0.55)'
    const finalShadowSize = shadowSize ?? presetConfig.shadowSize ?? 24
    const finalBlurStrength = blurStrength ?? presetConfig.blurStrength ?? 1
    const finalEdgeSize = edgeSize ?? presetConfig.edgeSize ?? '24px'
    const finalDivCount = divCount ?? presetConfig.divCount ?? 8
    const finalExponential = exponential ?? presetConfig.exponential ?? true
    const finalZIndex = zIndex ?? presetConfig.zIndex ?? 1000
    const finalAnimated = animated ?? presetConfig.animated ?? false
    const finalDuration = duration ?? presetConfig.duration ?? '0.3s'
    const finalEasing = easing ?? presetConfig.easing ?? 'ease-out'
    const finalOpacity = opacity ?? presetConfig.opacity ?? 1
    const finalCurve = curve ?? presetConfig.curve ?? 'bezier'
    const finalResponsive = responsive ?? presetConfig.responsive ?? false
    const finalMobileSize = mobileSize ?? presetConfig.mobileSize
    const finalTabletSize = tabletSize ?? presetConfig.tabletSize
    const finalDesktopSize = desktopSize ?? presetConfig.desktopSize
    const finalHoverIntensity = hoverIntensity ?? presetConfig.hoverIntensity
    const finalTarget = target ?? presetConfig.target ?? 'parent'
    const finalOnAnimationComplete = onAnimationComplete ?? presetConfig.onAnimationComplete

    const responsiveSize = useResponsiveSize(
      finalResponsive,
      finalEdgeSize,
      finalMobileSize,
      finalTabletSize,
      finalDesktopSize
    )

    const resolvedSize = responsiveSize ?? finalEdgeSize
    const resolvedShadowSize =
      typeof finalShadowSize === 'number' ? `${finalShadowSize}px` : finalShadowSize

    const isVisible = useIntersectionObserver(internalRef, finalAnimated === 'scroll')

    const checkEdges = useCallback(() => {
      const el = scrollableRef.current
      if (!el) return
      setHasTop(el.scrollTop > 4)
      setHasBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
      setHasLeft(el.scrollLeft > 4)
      setHasRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }, [])

    const handleScroll = useCallback(
      (event: React.UIEvent<HTMLDivElement>) => {
        onScroll?.(event)
        checkEdges()
      },
      [onScroll, checkEdges]
    )

    useEffect(() => {
      if (finalDisabled || finalTarget === 'page') return
      const el = scrollableRef.current
      if (!el) return
      checkEdges()
      el.addEventListener('scroll', checkEdges)
      const ro = new ResizeObserver(checkEdges)
      ro.observe(el)
      return () => {
        el.removeEventListener('scroll', checkEdges)
        ro.disconnect()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finalDisabled, finalTarget, checkEdges, ...finalDependencies])

    useEffect(() => {
      if (isVisible && finalAnimated === 'scroll' && finalOnAnimationComplete) {
        const ms = parseFloat(finalDuration) * 1000
        const id = setTimeout(() => finalOnAnimationComplete(), ms)
        return () => clearTimeout(id)
      }
    }, [isVisible, finalAnimated, finalDuration, finalOnAnimationComplete])

    const curveFunc = CURVE_FUNCTIONS[finalCurve]

    const renderPageShadow = (edge: ScrollEdgePosition): React.ReactNode => {
      const gradients: Record<ScrollEdgePosition, string> = {
        top: `linear-gradient(to top, transparent, ${finalShadowColor})`,
        bottom: `linear-gradient(to bottom, transparent, ${finalShadowColor})`,
        left: `linear-gradient(to left, transparent, ${finalShadowColor})`,
        right: `linear-gradient(to right, transparent, ${finalShadowColor})`,
      }

      const style: CSSProperties = {
        background: gradients[edge],
      }

      return <div className="scroll-edge__shadow" style={style} />
    }

    // Separate masks intersect via nesting instead of mask-composite, which has
    // inconsistent source-in behavior in older WebKit versions.
    const createMask = (
      direction: 'bottom' | 'right',
      showStart: boolean,
      showEnd: boolean
    ): string | undefined => {
      if (finalDisabled || !finalShadow || finalTarget === 'page' || (!showStart && !showEnd)) {
        return undefined
      }
      const size = `max(0px, min(${resolvedShadowSize}, 50%))`
      const start = showStart ? `transparent 0px, black ${size}` : 'black 0px'
      const end = showEnd ? `black calc(100% - ${size}), transparent 100%` : 'black 100%'
      return `linear-gradient(to ${direction}, ${start}, ${end})`
    }

    const verticalMask = createMask(
      'bottom',
      finalEdges.includes('top') && hasTop,
      finalEdges.includes('bottom') && hasBottom
    )
    const horizontalMask = createMask(
      'right',
      finalEdges.includes('left') && hasLeft,
      finalEdges.includes('right') && hasRight
    )

    const renderBlurLayers = (edge: ScrollEdgePosition): React.ReactNode[] => {
      const layers: React.ReactNode[] = []
      const increment = 100 / finalDivCount
      const currentStrength =
        isHovered && finalHoverIntensity
          ? finalBlurStrength * finalHoverIntensity
          : finalBlurStrength
      const direction = GRADIENT_DIRECTIONS[edge]

      for (let i = 1; i <= finalDivCount; i++) {
        let progress = i / finalDivCount
        progress = curveFunc(progress)

        let blurValue: number
        if (finalExponential) {
          blurValue = Number(Math.pow(2, progress * 4)) * 0.0625 * currentStrength
        } else {
          blurValue = 0.0625 * (progress * finalDivCount + 1) * currentStrength
        }

        const p1 = Math.round((increment * i - increment) * 10) / 10
        const p2 = Math.round(increment * i * 10) / 10
        const p3 = Math.round((increment * i + increment) * 10) / 10
        const p4 = Math.round((increment * i + increment * 2) * 10) / 10

        let gradient = `transparent ${p1}%, black ${p2}%`
        if (p3 <= 100) gradient += `, black ${p3}%`
        if (p4 <= 100) gradient += `, transparent ${p4}%`

        const style: CSSProperties = {
          maskImage: `linear-gradient(${direction}, ${gradient})`,
          WebkitMaskImage: `linear-gradient(${direction}, ${gradient})`,
          backdropFilter: `blur(${blurValue.toFixed(3)}rem)`,
          WebkitBackdropFilter: `blur(${blurValue.toFixed(3)}rem)`,
          opacity: finalOpacity,
          transition:
            finalAnimated && finalAnimated !== 'scroll'
              ? `backdrop-filter ${finalDuration} ${finalEasing}`
              : undefined,
        }

        layers.push(<div key={i} className="scroll-edge__blur-layer" style={style} />)
      }

      return layers
    }

    const overlayStyle = (
      edge: ScrollEdgePosition,
      visible: boolean,
      type: 'blur' | 'shadow'
    ): CSSProperties => {
      const effectiveSize = type === 'blur' ? resolvedSize : resolvedShadowSize

      const base: CSSProperties = {
        position: finalTarget === 'page' ? 'fixed' : 'absolute',
        zIndex: finalZIndex,
        opacity: visible ? 1 : 0,
        transition: finalAnimated ? `opacity ${finalDuration} ${finalEasing}` : undefined,
      }

      const edgeStyles: Record<ScrollEdgePosition, CSSProperties> = {
        top: {
          top: 0,
          left: 0,
          right: 0,
          height: effectiveSize,
        },
        bottom: {
          bottom: 0,
          left: 0,
          right: 0,
          height: effectiveSize,
        },
        left: {
          top: 0,
          left: 0,
          bottom: 0,
          width: effectiveSize,
        },
        right: {
          top: 0,
          right: 0,
          bottom: 0,
          width: effectiveSize,
        },
      }

      return { ...base, ...edgeStyles[edge] }
    }

    return (
      <Root ref={setRefs} className={`scroll-edge ${className}`} style={style} {...rest}>
        <div
          className="scroll-edge__mask-vertical"
          style={{ maskImage: verticalMask, WebkitMaskImage: verticalMask }}
        >
          <div
            className="scroll-edge__mask-horizontal"
            style={{ maskImage: horizontalMask, WebkitMaskImage: horizontalMask }}
          >
            <div className="scroll-edge__scrollable" onScroll={onScroll ? handleScroll : undefined}>
              {children}
            </div>
          </div>
        </div>
        {!finalDisabled &&
          finalEdges.map((edge) => {
            const shadowVisible =
              finalTarget === 'page'
                ? isVisible
                : edge === 'top'
                  ? hasTop
                  : edge === 'bottom'
                    ? hasBottom
                    : edge === 'left'
                      ? hasLeft
                      : hasRight
            const blurVisible = finalTarget === 'page' ? isVisible : true

            const edgeName = edge

            return (
              <React.Fragment key={edgeName}>
                {finalBlur && (
                  <div
                    className={`scroll-edge__overlay scroll-edge__overlay--blur ${finalHoverIntensity ? 'scroll-edge__overlay--hoverable' : ''}`}
                    style={overlayStyle(edge, blurVisible, 'blur')}
                    onMouseEnter={finalHoverIntensity ? () => setIsHovered(true) : undefined}
                    onMouseLeave={finalHoverIntensity ? () => setIsHovered(false) : undefined}
                  >
                    {renderBlurLayers(edge)}
                  </div>
                )}
                {finalShadow && finalTarget === 'page' && (
                  <div
                    className={`scroll-edge__overlay scroll-edge__overlay--shadow ${finalHoverIntensity ? 'scroll-edge__overlay--hoverable' : ''}`}
                    style={overlayStyle(edge, shadowVisible, 'shadow')}
                    onMouseEnter={finalHoverIntensity ? () => setIsHovered(true) : undefined}
                    onMouseLeave={finalHoverIntensity ? () => setIsHovered(false) : undefined}
                  >
                    {renderPageShadow(edge)}
                  </div>
                )}
              </React.Fragment>
            )
          })}
        {includeStyles && <ScrollEdgeStyles />}
      </Root>
    )
  }
)

ScrollEdge.displayName = 'ScrollEdge'

export { ScrollEdge }
