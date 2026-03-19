import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  vehicle_positions: defineTable({
    vehicle_id: v.string(),
    lat: v.number(),
    lon: v.number(),
    bearing: v.optional(v.number()),
    route_short_name: v.optional(v.string()),
    route_id: v.optional(v.string()),
    color: v.optional(v.string()),
    speed: v.optional(v.number()),
    headsign: v.optional(v.string()),
    agency: v.optional(v.string()),
    last_update: v.number(), // timestamp
  }).index("by_vehicle", ["vehicle_id"]),

  stops: defineTable({
    stop_id: v.string(),
    name: v.string(),
    lat: v.number(),
    lon: v.number(),
  }).index("by_stop_id", ["stop_id"]),

  routes: defineTable({
    route_id: v.string(),
    short_name: v.string(),
    long_name: v.string(),
    color: v.string(),
    text_color: v.string(),
  }).index("by_route_id", ["route_id"]),
});
