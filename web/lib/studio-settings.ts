import { GLASS_STUDIO_DEFAULTS, type GlassStudioProps } from '@/components/liquid-glass-client'

export function createStudioSettings(): GlassStudioProps {
  return {
    ...GLASS_STUDIO_DEFAULTS,
    tint: { ...GLASS_STUDIO_DEFAULTS.tint },
    shadowPosition: { ...GLASS_STUDIO_DEFAULTS.shadowPosition },
  }
}
