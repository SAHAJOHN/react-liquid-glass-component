/** Material controls from iyinchao/liquid-glass-studio, Controls.tsx at f7b28c3. */
export interface GlassStudioTint {
  r: number
  g: number
  b: number
  a: number
}
export interface GlassStudioPosition {
  x: number
  y: number
}

export interface GlassStudioProps {
  refThickness: number
  refDistance: number
  refFactor: number
  refDispersion: number
  refFresnelRange: number
  refFresnelHardness: number
  refFresnelFactor: number
  glareRange: number
  glareHardness: number
  glareFactor: number
  glareConvergence: number
  glareOppositeFactor: number
  glareAngle: number
  blurRadius: number
  blurEdge: boolean
  tint: GlassStudioTint
  shadowExpand: number
  shadowFactor: number
  shadowPosition: GlassStudioPosition
  shapeRadius: number
  shapeRoundness: number
}

export const GLASS_STUDIO_DEFAULTS: Readonly<GlassStudioProps> = Object.freeze({
  refThickness: 20,
  refDistance: 0.05,
  refFactor: 1.4,
  refDispersion: 7,
  refFresnelRange: 30,
  refFresnelHardness: 20,
  refFresnelFactor: 20,
  glareRange: 30,
  glareHardness: 20,
  glareFactor: 90,
  glareConvergence: 50,
  glareOppositeFactor: 80,
  glareAngle: -45,
  blurRadius: 1,
  blurEdge: true,
  tint: Object.freeze({ r: 255, g: 255, b: 255, a: 0 }),
  shadowExpand: 25,
  shadowFactor: 15,
  shadowPosition: Object.freeze({ x: 0, y: -10 }),
  shapeRadius: 80,
  shapeRoundness: 5,
})

/** Raw UI units, before the renderer converts percentages and degrees. */
export const GLASS_STUDIO_RANGES = {
  refThickness: [1, 80, 0.01],
  refDistance: [0, 0.2, 0.001],
  refFactor: [1, 4, 0.01],
  refDispersion: [0, 50, 0.01],
  refFresnelRange: [0, 100, 0.01],
  refFresnelHardness: [0, 100, 0.01],
  refFresnelFactor: [0, 100, 0.01],
  glareRange: [0, 100, 0.01],
  glareHardness: [0, 100, 0.01],
  glareFactor: [0, 120, 0.01],
  glareConvergence: [0, 100, 0.01],
  glareOppositeFactor: [0, 100, 0.01],
  glareAngle: [-180, 180, 0.01],
  blurRadius: [1, 200, 1],
  shadowExpand: [2, 100, 0.01],
  shadowFactor: [0, 100, 0.01],
  shapeRadius: [1, 100, 0.1],
  shapeRoundness: [2, 7, 0.01],
} as const

export const GLASS_STUDIO_PROP_KEYS = [
  'refThickness',
  'refDistance',
  'refFactor',
  'refDispersion',
  'refFresnelRange',
  'refFresnelHardness',
  'refFresnelFactor',
  'glareRange',
  'glareHardness',
  'glareFactor',
  'glareConvergence',
  'glareOppositeFactor',
  'glareAngle',
  'blurRadius',
  'blurEdge',
  'tint',
  'shadowExpand',
  'shadowFactor',
  'shadowPosition',
  'shapeRadius',
  'shapeRoundness',
] as const satisfies readonly (keyof GlassStudioProps)[]

function isNumericKey(key: string): key is keyof typeof GLASS_STUDIO_RANGES {
  return Object.prototype.hasOwnProperty.call(GLASS_STUDIO_RANGES, key)
}

export function resolveStudioProps(
  input: Partial<GlassStudioProps> & {
    thickness?: number
    displace?: number
    distortionScale?: number
  }
): GlassStudioProps {
  const value = { ...GLASS_STUDIO_DEFAULTS }
  for (const key of Object.keys(GLASS_STUDIO_RANGES)) {
    if (!isNumericKey(key)) continue
    const [min, max] = GLASS_STUDIO_RANGES[key]
    const candidate =
      key === 'refThickness'
        ? (input.refThickness ?? input.thickness)
        : key === 'blurRadius'
          ? (input.blurRadius ?? input.displace)
          : key === 'refDistance'
            ? (input.refDistance ??
              (input.distortionScale === undefined
                ? undefined
                : (Math.abs(input.distortionScale) / 180) * 0.05))
            : input[key]
    value[key] =
      candidate === undefined || !Number.isFinite(candidate)
        ? GLASS_STUDIO_DEFAULTS[key]
        : Math.max(min, Math.min(max, candidate))
  }
  const bounded = (candidate: number | undefined, fallback: number, min: number, max: number) =>
    candidate === undefined || !Number.isFinite(candidate)
      ? fallback
      : Math.max(min, Math.min(max, candidate))
  value.blurRadius = Math.round(value.blurRadius)
  value.blurEdge = input.blurEdge ?? GLASS_STUDIO_DEFAULTS.blurEdge
  value.tint = {
    r: bounded(input.tint?.r, 255, 0, 255),
    g: bounded(input.tint?.g, 255, 0, 255),
    b: bounded(input.tint?.b, 255, 0, 255),
    a: bounded(input.tint?.a, 0, 0, 1),
  }
  value.shadowPosition = {
    x: bounded(input.shadowPosition?.x, 0, -20, 20),
    y: bounded(input.shadowPosition?.y, -10, -20, 20),
  }
  return value
}
