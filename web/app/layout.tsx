import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import StyledComponentsRegistry from "./registry";
import { GlobalStyle } from "./global-styles";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "React Liquid Glass Component",
  description:
    "Explore React glass surfaces, WebGL refraction, live controls, and scroll edge effects.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} antialiased`}>
      <body className={plusJakartaSans.className}>
        <StyledComponentsRegistry>
          <GlobalStyle />
          {children}
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
