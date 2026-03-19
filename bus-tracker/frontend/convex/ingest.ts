import { action } from "./_generated/server";
import { api } from "./_generated/api";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

export const pollBusData = action({
  args: {},
  handler: async (ctx) => {
    try {
      // Pull enriched, minimized data from the cybus backend
      const url = "https://cyfinal.onrender.com/api/vehicle_positions";
      const response = await fetch(url);
      
      if (!response.ok) throw new Error("Cybus API fetch failed");
      
      const buses = await response.json();

      const updates = [];
      for (const bus of buses) {
        if (bus.id) {
          updates.push({
            vehicle_id: bus.id,
            lat: bus.lt,
            lon: bus.ln,
            bearing: bus.b,
            speed: bus.s,
            route_id: bus.r,
            route_short_name: bus.sn,
            color: bus.c,
            headsign: bus.h,
            agency: bus.ag || "CPT",
          });
        }
      }

      if (updates.length > 0) {
        await ctx.runMutation(api.vehicles.updatePositions, { updates });
        console.log(`Ingested ${updates.length} enriched vehicles to Convex`);
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  },
});

export const pingRender = action({
  args: {},
  handler: async () => {
    try {
      // Pings Render to prevent it from ever sleeping (Free Tier 24/7 Uptime)
      await fetch("https://cyfinal.onrender.com/api/routes");
      console.log("Pinged Render to keep it awake!");
    } catch (e) {
      console.error("Ping failed", e);
    }
  },
});
