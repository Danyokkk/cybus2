"use client";

import dynamic from "next/dynamic";

const CyBusShell = dynamic(() => import("../components/CyBusShell"), {
  ssr: false,
  loading: () => (
    <main className="loading-screen">
      <div className="loading-orb" />
      <div className="loading-copy">
        <p className="eyebrow">CyBus</p>
        <h1>Preparing live Cyprus transit...</h1>
      </div>
    </main>
  ),
});

export default function HomePage() {
  return <CyBusShell />;
}
