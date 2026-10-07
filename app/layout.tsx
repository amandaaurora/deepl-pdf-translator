import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeepL Translator",
  description: "Translate PDF for Mbak Nikin",
  icons: {
    icon: "/favicon.ico",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
