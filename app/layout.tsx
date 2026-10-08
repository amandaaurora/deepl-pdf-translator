import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["200", "400", "500"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: "Alih Bahasa",
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
    <html lang="en-GB" className={hanken.variable}>
      <body>{children}</body>
    </html>
  );
}
