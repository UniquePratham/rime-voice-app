import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spotter — Hands-free voice copilot for strength coaches",
  description:
    "Spotter is a voice-native coaching copilot. Coaching commands are spoken, interrupted, and corrected mid-air — Rime voice output is the primary channel and the interruptible state machine keeps every spoken answer consistent.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}