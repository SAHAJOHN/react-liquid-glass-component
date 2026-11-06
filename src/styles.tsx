import glassCss from './styles/glass.css?inline'
import sceneCss from './styles/scene.css?inline'
import scrollEdgeCss from './styles/scroll-edge.css?inline'

/** Static CSS is rendered on the server and remains available without a CSS-in-JS runtime. */
export function GlassStyles() {
  return <style data-liquid-glass-styles="glass" dangerouslySetInnerHTML={{ __html: glassCss }} />
}

/** Managed panes share the scene stylesheet, including glass fallback styles. */
export function SceneStyles() {
  return (
    <style
      data-liquid-glass-styles="scene"
      dangerouslySetInnerHTML={{ __html: `${glassCss}\n${sceneCss}` }}
    />
  )
}

export function ScrollEdgeStyles() {
  return (
    <style
      data-liquid-glass-styles="scroll-edge"
      dangerouslySetInnerHTML={{ __html: scrollEdgeCss }}
    />
  )
}
