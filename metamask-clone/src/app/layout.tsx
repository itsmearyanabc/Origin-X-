import type { Metadata } from "next";
import { Inter, Space_Mono } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import Loader from "@/components/Loader";
import ChatWidget from "@/components/ChatWidget";


const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["opsz"],
});

const poly = Inter({
  variable: "--font-poly",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

const mono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "MetaMask Clone | Your home in web3",
  description:
    "A Next.js recreation of metamask.io featuring the intro loader, sticky scroll stories, bento grids, and the fox mascot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poly.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink">
        <SmoothScroll>
          <Loader />
          {children}
          <ChatWidget />
        </SmoothScroll>
      </body>
    </html>
  );
}
