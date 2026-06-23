'use client'

import styled from 'styled-components'

const VideoBackgroundStyled = styled.video`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: -1;
`

export default function VideoBackground({ src }: { src: string }) {
  return (
    <VideoBackgroundStyled
      src={src}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
    />
  )
}
