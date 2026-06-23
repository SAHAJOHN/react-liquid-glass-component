import type { Metadata } from "next";
import styled from "styled-components";
import Navbar from "@/components/navbar";
import VideoBackground from "@/components/video-background";
import HeroCard from "@/components/showcase/hero-card";
import VariantGrid from "@/components/showcase/variant-grid";
import InstallSnippet from "@/components/showcase/install-snippet";
import { sectionGap, sectionPadding } from "@/lib/responsive";

const MainStyled = styled.main`
  display: flex;
  flex-direction: column;
  gap: ${sectionGap};
  padding: ${sectionPadding.container};
`;

export const metadata: Metadata = {
  title: "React Liquid Glass Component — Showcase",
};

export default function ShowcasePage() {
  return (
    <>
      <VideoBackground src="/bangkok.mp4" />
      <Navbar current="showcase" />
      <MainStyled>
        <HeroCard />
        <VariantGrid />
        <InstallSnippet />
      </MainStyled>
    </>
  );
}
