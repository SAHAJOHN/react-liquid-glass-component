export const colors = {
  background: '#000',
  foreground: '#fff',
  foregroundMuted: 'rgba(255, 255, 255, 0.65)',
  foregroundDim: 'rgba(255, 255, 255, 0.5)',
  foregroundFaint: 'rgba(255, 255, 255, 0.45)',
  navBackground: 'rgba(0, 0, 0, 0.45)',
  navBorder: 'rgba(255, 255, 255, 0.06)',
  glassBackground: '#00000066',
  installBackground: '#0064ff38',
  codeBackground: 'rgb(175 102 165 / 66%)',
  buttonBackground: 'rgba(255, 255, 255, 0.08)',
  buttonBorder: 'rgba(255, 255, 255, 0.1)',
  inputBackground: 'rgba(255, 255, 255, 0.12)',
  selectBackground: 'rgba(255, 255, 255, 0.08)',
  selectOptionBackground: '#222',
} as const

export const fonts = {
  sans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
} as const

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

export const fontSize = {
  xs: '0.65rem',
  sm: '0.72rem',
  base: '0.78rem',
  md: '0.8rem',
  lg: '0.9rem',
  xl: '0.95rem',
  '2xl': '1rem',
  '3xl': '1.8rem',
  '4xl': '2.6rem',
} as const

export const borderRadius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '9999px',
} as const

export const sectionPadding = {
  container: '24px',
  controls: '24px',
} as const

export const sectionGap = '48px' as const

export const breakpoints = {
  mobile: '700px',
} as const

const tokens = {
  colors,
  fonts,
  fontWeight,
  fontSize,
  borderRadius,
  sectionPadding,
  sectionGap,
  breakpoints,
}

export default tokens
