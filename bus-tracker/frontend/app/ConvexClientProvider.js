"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

// Добавляем dummy-fallback, чтобы сборка Vercel не падала, если переменная еще не добавлена
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "https://unconfigured-convex.convex.cloud";
const convex = new ConvexReactClient(convexUrl);

export default function ConvexClientProvider({ children }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
