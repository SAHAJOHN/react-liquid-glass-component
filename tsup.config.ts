import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/scroll-edge.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  minify: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'styled-components', 'html2canvas'],
  treeshake: true,
})
