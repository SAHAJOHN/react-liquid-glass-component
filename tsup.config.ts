import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/scroll-edge.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  minify: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'html2canvas'],
  treeshake: true,
  loader: { '.css': 'text' },
  async onSuccess() {
    const files = ['src/styles/glass.css', 'src/styles/scene.css', 'src/styles/scroll-edge.css']
    const styles = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    if (styles.some((style) => /<\/style/i.test(style)))
      throw new Error('Static CSS must not contain an HTML style end tag')
    await mkdir('dist', { recursive: true })
    await writeFile('dist/styles.css', `${styles.join('\n')}\n`)
  },
})
