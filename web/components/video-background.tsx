'use client'

import styled from 'styled-components'

const VideoBackgroundStyled = styled.video`
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  pointer-events: none;
`

/** LiquidGlassScene reads this video directly; no intermediate canvas is needed. */
export default function VideoBackground({ src }: { src: string }) {
  return (
    <VideoBackgroundStyled
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    />
  )
}
