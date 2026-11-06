/**
 * Pure 2D individual translations are already reflected in viewport bounds.
 * Accept only resolved CSSOM lengths/percentages; z translation and unresolved
 * expressions must remain on the native rendering path.
 */
export function isSupportedIndividualTranslate(value: string | undefined): boolean {
  const input = value?.trim() ?? ''
  if (!input || input === 'none') return true
  const components = input.split(/\s+/)
  if (components.length < 1 || components.length > 2) return false
  return components.every((component) => {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|%)?$/i.exec(component)
    if (!match?.[1]) return false
    const amount = Number(match[1])
    return Number.isFinite(amount) && (Boolean(match[2]) || amount === 0)
  })
}
