import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DeepL PDF Translator",
  description: "Translate PDF for Mbak Nikin",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "#fafafa" }}>{children}</body>
    </html>
  );
}
