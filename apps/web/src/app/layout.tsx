import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FigmaPress — FigmaからWordPressへ",
  description:
    "Figmaデザインを編集可能なGutenbergブロックまたはElementorページへ変換し、WordPressに下書きを作成します。",
  applicationName: "FigmaPress",
  keywords: ["Figma", "WordPress", "Gutenberg", "Elementor", "サイト制作", "自動変換"],
  openGraph: {
    title: "FigmaPress — FigmaからWordPressへ",
    description: "デザインを、編集できるWordPressページに。",
    type: "website",
    locale: "ja_JP",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a1720",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
