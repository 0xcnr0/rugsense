import type { ReactNode } from "react";
import type { Metadata } from "next";

const title = "RugSense — scored launch intelligence";
const description =
  "Every freshly-launched token, scored for safety + momentum into one AVOID/WATCH/HOT decision. Skip the rugs, catch the real ones — in one x402 call. Live on Base.";
const url = "https://rugsense.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title,
  description,
  keywords: ["Base", "x402", "token launches", "rug check", "honeypot", "onchain", "AI agents", "Agentic.Market"],
  openGraph: { title, description, url, siteName: title, type: "website" },
  twitter: { card: "summary", title, description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0, background: "#0b0d12", color: "#e6e8eb" }}>
        {children}
      </body>
    </html>
  );
}
