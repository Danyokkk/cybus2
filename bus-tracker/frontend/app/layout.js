import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Fredoka, Nunito } from "next/font/google";
import { LanguageProvider } from "../context/LanguageContext";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";

const headingFont = Fredoka({
  subsets: ["latin", "greek"],
  variable: "--font-heading",
});

const bodyFont = Nunito({
  subsets: ["latin", "greek", "cyrillic"],
  variable: "--font-body",
});

export const metadata = {
  title: "CyBus | Live Cyprus Transit",
  description:
    "Live bus tracking for Cyprus with GTFS schedules, favourites, nearby stops, route lookup, and a route helper.",
  manifest: "/manifest.json",
  openGraph: {
    title: "CyBus | Live Cyprus Transit",
    description: "Realtime bus tracking and route discovery across Cyprus.",
    siteName: "CyBus",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07111f",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${bodyFont.variable}`} suppressHydrationWarning>
        <LanguageProvider>
          {children}
          <SpeedInsights />
          <Analytics />
        </LanguageProvider>
      </body>
    </html>
  );
}
