import type { Metadata } from "next";
import styled from "styled-components";
import Navbar from "@/components/navbar";
import VideoBackground from "@/components/video-background";
import { DemoPanel } from "@/components/demo/demo-panel";
import { sectionPadding } from "@/lib/responsive";

const MainStyled = styled.main`
  padding: ${sectionPadding.container};
`;

export const metadata: Metadata = {
  title: "React Liquid Glass Component — Demo",
};

export default function DemoPage() {
  return (
    <>
      <VideoBackground src="/bangkok.mp4" />
      <Navbar current="demo" />
      <MainStyled>
        <DemoPanel />
      </MainStyled>
    </>
  );
}
