/** Backdrop operations implemented in order by the WebGL backdrop pass. */
export interface BackdropFilter {
  sigma: number
  saturation: number
  brightness: number
}

// CSS computed filter values are serialized as px and numbers/percentages.
// Keep the bounds finite and conservative for GPU arithmetic; unknown syntax
// must stay on the native rendering path.
const number = '[+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?'
const filter = new RegExp(
  `^blur\\(\\s*(${number})px\\s*\\)(?:\\s+saturate\\(\\s*(${number})(%)?\\s*\\))?(?:\\s+brightness\\(\\s*(${number})(%)?\\s*\\))?$`,
  'i'
)

export function parseBackdropFilter(value: string): BackdropFilter | null {
  const match = filter.exec(value.trim())
  if (!match?.[1]) return null
  const sigma = Number(match[1])
  const saturation = match[2] === undefined ? 1 : Number(match[2]) / (match[3] ? 100 : 1)
  const brightness = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1)
  if (
    ![sigma, saturation, brightness].every(Number.isFinite) ||
    sigma < 0 ||
    sigma > 200 ||
    saturation < 0 ||
    saturation > 4 ||
    brightness < 0 ||
    brightness > 4
  )
    return null
  return { sigma, saturation, brightness }
}
