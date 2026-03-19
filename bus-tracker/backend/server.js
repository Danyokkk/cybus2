const express = require("express");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const axios = require("axios");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const GTFS_ROOT = path.join(__dirname, "data", "other_gtfs");
const CYPRUS_TIME_ZONE = "Asia/Nicosia";
const REALTIME_POLL_MS = 5000;
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const LIVE_FEEDS = [
  "http://motionbuscard.org.cy:8328/Api/api/gtfs-realtime",
  "http://20.19.98.194:8328/Api/api/gtfs-realtime",
];
const CYPRUS_BOUNDS = {
  minLat: 34.45,
  maxLat: 35.85,
  minLon: 32.0,
  maxLon: 34.95,
};

const OPERATORS = [
  {
    id: "emel",
    prefix: "EMEL_",
    name: "EMEL (Limassol)",
    dir: "EMEL",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C6_google_transit.zip&rel=True",
  },
  {
    id: "osypa",
    prefix: "OSYPA_",
    name: "OSYPA (Pafos)",
    dir: "OSYPA (Pafos)",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C2_google_transit.zip&rel=True",
  },
  {
    id: "osea",
    prefix: "OSEA_",
    name: "OSEA (Famagusta)",
    dir: "OSEA (Famagusta)",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C4_google_transit.zip&rel=True",
  },
  {
    id: "intercity",
    prefix: "INTERCITY_",
    name: "Intercity buses",
    dir: "Intercity buses",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C5_google_transit.zip&rel=True",
  },
  {
    id: "npt",
    prefix: "NPT_",
    name: "NPT",
    dir: "NPT",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C9_google_transit.zip&rel=True",
  },
  {
    id: "lpt",
    prefix: "LPT_",
    name: "LPT",
    dir: "LPT",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C10_google_transit.zip&rel=True",
  },
  {
    id: "pame",
    prefix: "PAME_",
    name: "PAME EXPRESS",
    dir: "PAME EXPRESS",
    staticUrl:
      "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C11_google_transit.zip&rel=True",
  },
];

const state = {
  initialized: false,
  initializing: false,
  loadedAt: null,
  realtimeUpdatedAt: null,
  realtimeFetchStatus: "idle",
  realtimeError: null,
  serviceDate: null,
  dayName: null,
  stops: [],
  routes: [],
  trips: [],
  stopsById: new Map(),
  routesById: new Map(),
  routesByRawId: new Map(),
  tripsById: new Map(),
  tripsByRawId: new Map(),
  patternsById: new Map(),
  patternsByRoute: new Map(),
  stopTimetable: new Map(),
  stopRouteIds: new Map(),
  shapesById: new Map(),
  shapeIdsByRoute: new Map(),
  vehicles: [],
  vehiclesByRoute: new Map(),
  tripUpdates: new Map(),
  operatorSummaries: [],
  meta: {},
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(compression());
app.use(express.json());

function sanitizeColor(color, fallback) {
  const cleaned = String(color || "").replace("#", "").trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return cleaned.toUpperCase();
  }
  return fallback;
}

function hashColor(seed) {
  const palette = [
    "4AE3B5",
    "5CA8FF",
    "FF8A5B",
    "FFD166",
    "A789FF",
    "7CE577",
    "FF6B93",
    "7BDFF2",
  ];
  let hash = 0;
  for (const char of String(seed || "")) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function readCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      resolve(false);
      return;
    }

    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header, index }) => {
            const value = typeof header === "string" ? header : "";
            return index === 0 ? value.replace(/^\ufeff/, "").trim() : value.trim();
          },
        })
      )
      .on("data", (row) => {
        try {
          onRow(row);
        } catch (error) {
          console.error(`CSV row error in ${filePath}:`, error.message);
        }
      })
      .on("end", () => resolve(true))
      .on("error", reject);
  });
}

function getCyprusDateContext(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CYPRUS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }

  const hour = Number(lookup.hour || 0);
  const minute = Number(lookup.minute || 0);
  const second = Number(lookup.second || 0);

  return {
    serviceDate: `${lookup.year}${lookup.month}${lookup.day}`,
    isoDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
    dayName: String(lookup.weekday || "").toLowerCase(),
    secondsAfterMidnight: hour * 3600 + minute * 60 + second,
    timeLabel: `${lookup.hour}:${lookup.minute}`,
  };
}

function getLang(req) {
  const value = String(req.query.lang || "en").toLowerCase();
  return ["en", "el", "ru"].includes(value) ? value : "en";
}

function localizeName(names, lang) {
  if (!names) {
    return "";
  }
  if (lang === "el" && names.el) {
    return names.el;
  }
  if (lang === "ru" && names.ru) {
    return names.ru;
  }
  return names.en || names.el || "";
}

function toNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return null;
  }
  if (typeof value === "object" && typeof value.low === "number") {
    return value.low;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toGtfsSeconds(timeString) {
  if (!timeString) {
    return null;
  }
  const [hh = "0", mm = "0", ss = "0"] = String(timeString).split(":");
  const hours = Number(hh);
  const minutes = Number(mm);
  const seconds = Number(ss);
  if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function formatGtfsTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--:--";
  }
  const normalized = ((seconds % 86400) + 86400) % 86400;
  const hours = String(Math.floor(normalized / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((normalized % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatEpochInCyprus(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CYPRUS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochSeconds * 1000));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withDistance(stop, lang, distanceKm) {
  return {
    stop_id: stop.id,
    code: stop.code,
    name: localizeName(stop.names, lang),
    names: stop.names,
    lat: stop.lat,
    lon: stop.lon,
    operator_id: stop.operatorId,
    operator_name: stop.operatorName,
    distance_km: Number(distanceKm.toFixed(2)),
  };
}

function decorateStop(stop, lang) {
  return withDistance(stop, lang, 0);
}

function decorateRoute(route, lang) {
  return {
    route_id: route.id,
    short_name: route.shortName,
    long_name: localizeName(route.names, lang),
    names: route.names,
    color: route.color,
    text_color: route.textColor,
    operator_id: route.operatorId,
    operator_name: route.operatorName,
    static_gtfs_url: route.staticUrl,
  };
}

function getRoutesForStop(stopId) {
  const routeIds = state.stopRouteIds.get(stopId) || new Set();
  return Array.from(routeIds)
    .map((routeId) => state.routesById.get(routeId))
    .filter(Boolean);
}

function getUpcomingPatternDepartures(pattern, count) {
  const context = getCyprusDateContext();
  const departures = [];

  for (const departure of pattern.departures) {
    if (!Number.isFinite(departure.seconds)) {
      continue;
    }
    let delta = departure.seconds - context.secondsAfterMidnight;
    if (delta < -2 * 60) {
      continue;
    }
    if (delta < 0) {
      delta = 0;
    }
    departures.push({
      trip_id: departure.tripId,
      time: formatGtfsTime(departure.seconds),
      minutes_away: Math.round(delta / 60),
      sort_key: departure.seconds,
    });
  }

  return departures
    .sort((a, b) => a.sort_key - b.sort_key)
    .slice(0, count)
    .map(({ sort_key, ...item }) => item);
}

function getUpcomingArrivals(stopId, lang, limit = 12) {
  const timetable = state.stopTimetable.get(stopId) || [];
  const context = getCyprusDateContext();
  const results = [];

  for (const item of timetable) {
    const trip = state.tripsById.get(item.tripId);
    const route = trip ? state.routesById.get(trip.routeId) : null;
    if (!route) {
      continue;
    }

    const realtimeForTrip = state.tripUpdates.get(item.tripId);
    const realtimeStop = realtimeForTrip ? realtimeForTrip.get(stopId) : null;

    let displayTime = formatGtfsTime(item.arrivalSeconds);
    let sortValue = item.arrivalSeconds;
    let isRealtime = false;
    let delay = 0;

    if (realtimeStop && Number.isFinite(realtimeStop.epoch)) {
      const realtimeTime = formatEpochInCyprus(realtimeStop.epoch);
      if (realtimeTime) {
        displayTime = realtimeTime;
      }
      const realtimeDate = new Date(realtimeStop.epoch * 1000);
      const realtimeContext = getCyprusDateContext(realtimeDate);
      sortValue = realtimeContext.secondsAfterMidnight;
      isRealtime = true;
      delay = realtimeStop.delay || 0;
    }

    let minutesAway = Math.round((sortValue - context.secondsAfterMidnight) / 60);
    if (minutesAway < -2) {
      continue;
    }
    if (minutesAway < 0) {
      minutesAway = 0;
    }

    results.push({
      trip_id: item.tripId,
      route_id: route.id,
      route_short_name: route.shortName,
      route_long_name: localizeName(route.names, lang),
      trip_headsign: localizeName({ en: trip.headsign, el: trip.headsignEl }, lang),
      arrival_time: displayTime,
      minutes_away: minutesAway,
      is_realtime: isRealtime,
      delay_seconds: delay,
      color: route.color,
      text_color: route.textColor,
      operator_name: route.operatorName,
      sort_key: sortValue,
    });
  }

  return results
    .sort((a, b) => a.sort_key - b.sort_key || a.route_short_name.localeCompare(b.route_short_name))
    .slice(0, limit)
    .map(({ sort_key, ...item }) => item);
}

function parseIds(ids) {
  return String(ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function loadTranslations(operator) {
  const translationsPath = path.join(GTFS_ROOT, operator.dir, "translations.txt");
  const routeTranslations = new Map();
  const stopTranslations = new Map();

  await readCsv(translationsPath, (row) => {
    const tableName = row.table_name;
    const fieldName = row.field_name;
    const language = String(row.language || "").toLowerCase();
    const translation = row.translation;
    const recordId = row.record_id;

    if (!translation || !recordId) {
      return;
    }

    if (tableName === "routes" && fieldName === "route_long_name") {
      const existing = routeTranslations.get(recordId) || {};
      existing[language] = translation;
      routeTranslations.set(recordId, existing);
    }

    if (tableName === "stops" && fieldName === "stop_name") {
      const existing = stopTranslations.get(recordId) || {};
      existing[language] = translation;
      stopTranslations.set(recordId, existing);
    }
  });

  return { routeTranslations, stopTranslations };
}

async function loadStaticData() {
  const context = getCyprusDateContext();

  state.stops = [];
  state.routes = [];
  state.trips = [];
  state.stopsById = new Map();
  state.routesById = new Map();
  state.routesByRawId = new Map();
  state.tripsById = new Map();
  state.tripsByRawId = new Map();
  state.patternsById = new Map();
  state.patternsByRoute = new Map();
  state.stopTimetable = new Map();
  state.stopRouteIds = new Map();
  state.shapesById = new Map();
  state.shapeIdsByRoute = new Map();
  state.operatorSummaries = [];
  state.serviceDate = context.serviceDate;
  state.dayName = context.dayName;

  for (const operator of OPERATORS) {
    const operatorPath = path.join(GTFS_ROOT, operator.dir);
    const { routeTranslations, stopTranslations } = await loadTranslations(operator);
    const activeServices = new Set();
    const tripsInOperator = [];
    const tripPatternIds = new Set();
    const activeShapeIds = new Set();
    const operatorRoutes = [];
    const operatorStops = [];

    const calendarFound = await readCsv(path.join(operatorPath, "calendar.txt"), (row) => {
      if (String(row[context.dayName] || "0") === "1") {
        activeServices.add(`${operator.prefix}${row.service_id}`);
      }
    });

    await readCsv(path.join(operatorPath, "calendar_dates.txt"), (row) => {
      if (row.date !== context.serviceDate) {
        return;
      }
      const serviceId = `${operator.prefix}${row.service_id}`;
      if (String(row.exception_type) === "1") {
        activeServices.add(serviceId);
      }
      if (String(row.exception_type) === "2") {
        activeServices.delete(serviceId);
      }
    });

    if (!calendarFound || activeServices.size === 0) {
      await readCsv(path.join(operatorPath, "trips.txt"), (row) => {
        activeServices.add(`${operator.prefix}${row.service_id}`);
      });
    }

    const stopsFile = fs.existsSync(path.join(operatorPath, "stops.txt")) ? "stops.txt" : "stops.csv";
    await readCsv(path.join(operatorPath, stopsFile), (row) => {
      const rawId = row.stop_id || row.code;
      const lat = Number(row.stop_lat || row.lat);
      const lon = Number(row.stop_lon || row.lon);
      if (!rawId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }

      const id = `${operator.prefix}${rawId}`;
      if (state.stopsById.has(id)) {
        return;
      }

      const englishName =
        row.stop_name || row["description[en]"] || row.description || row.name || `Stop ${rawId}`;
      const translations = stopTranslations.get(String(rawId)) || {};
      const stop = {
        id,
        rawId: String(rawId),
        code: row.stop_code || row.code || String(rawId),
        names: {
          en: englishName,
          el: translations.el || null,
          ru: translations.ru || null,
        },
        lat,
        lon,
        operatorId: operator.id,
        operatorName: operator.name,
      };

      state.stopsById.set(id, stop);
      operatorStops.push(stop);
    });

    const agencyNames = new Map();
    await readCsv(path.join(operatorPath, "agency.txt"), (row) => {
      if (row.agency_id) {
        agencyNames.set(row.agency_id, row.agency_name);
      }
    });

    await readCsv(path.join(operatorPath, "routes.txt"), (row) => {
      const rawId = String(row.route_id);
      const id = `${operator.prefix}${rawId}`;
      const translations = routeTranslations.get(rawId) || {};
      const route = {
        id,
        rawId,
        shortName: String(row.route_short_name || row.route_id || "?"),
        names: {
          en: row.route_long_name || row.route_desc || row.route_short_name || operator.name,
          el: translations.el || null,
          ru: translations.ru || null,
        },
        color: sanitizeColor(row.route_color, hashColor(id)),
        textColor: sanitizeColor(row.route_text_color, "F7FAFC"),
        agencyId: row.agency_id || operator.id,
        operatorId: operator.id,
        operatorName: agencyNames.get(row.agency_id) || operator.name,
        staticUrl: operator.staticUrl,
      };

      state.routesById.set(id, route);
      state.routesByRawId.set(rawId, route);
      operatorRoutes.push(route);
    });

    await readCsv(path.join(operatorPath, "trips.txt"), (row) => {
      const serviceId = `${operator.prefix}${row.service_id}`;
      if (!activeServices.has(serviceId)) {
        return;
      }

      const rawTripId = String(row.trip_id);
      const tripId = `${operator.prefix}${rawTripId}`;
      const routeId = `${operator.prefix}${row.route_id}`;
      const route = state.routesById.get(routeId);

      if (!route) {
        return;
      }

      const directionId = row.direction_id !== undefined && row.direction_id !== "" ? String(row.direction_id) : null;
      const headsign = row.trip_headsign || localizeName(route.names, "en");
      const patternKey = `${routeId}::${directionId || headsign}`;
      const shapeId = row.shape_id ? `${operator.prefix}${row.shape_id}` : null;

      const trip = {
        id: tripId,
        rawId: rawTripId,
        routeId,
        serviceId,
        headsign,
        headsignEl: null,
        directionId,
        shapeId,
        patternId: patternKey,
        operatorPrefix: operator.prefix,
      };

      state.tripsById.set(tripId, trip);
      state.tripsByRawId.set(rawTripId, trip);
      tripsInOperator.push(trip);
      tripPatternIds.add(patternKey);

      if (shapeId) {
        activeShapeIds.add(shapeId);
        if (!state.shapeIdsByRoute.has(routeId)) {
          state.shapeIdsByRoute.set(routeId, new Set());
        }
        state.shapeIdsByRoute.get(routeId).add(shapeId);
      }

      if (!state.patternsById.has(patternKey)) {
        state.patternsById.set(patternKey, {
          id: patternKey,
          routeId,
          headsign,
          directionId,
          stopIds: [],
          stopIdSet: new Set(),
          departures: [],
          shapeIds: new Set(),
          tripCount: 0,
        });
      }

      const pattern = state.patternsById.get(patternKey);
      pattern.tripCount += 1;
      if (shapeId) {
        pattern.shapeIds.add(shapeId);
      }

      if (!state.patternsByRoute.has(routeId)) {
        state.patternsByRoute.set(routeId, []);
      }

      const routePatterns = state.patternsByRoute.get(routeId);
      if (!routePatterns.includes(patternKey)) {
        routePatterns.push(patternKey);
      }
    });

    const firstStopCaptured = new Set();
    await readCsv(path.join(operatorPath, "stop_times.txt"), (row) => {
      const trip = state.tripsByRawId.get(String(row.trip_id));
      if (!trip || trip.operatorPrefix !== operator.prefix) {
        return;
      }

      const stopId = `${operator.prefix}${row.stop_id}`;
      const stop = state.stopsById.get(stopId);
      if (!stop) {
        return;
      }

      const arrivalSeconds = toGtfsSeconds(row.arrival_time);
      const departureSeconds = toGtfsSeconds(row.departure_time || row.arrival_time);
      const stopSequence = Number(row.stop_sequence || 0);

      if (!state.stopTimetable.has(stopId)) {
        state.stopTimetable.set(stopId, []);
      }
      state.stopTimetable.get(stopId).push({
        tripId: trip.id,
        arrivalSeconds,
        departureSeconds,
        stopSequence,
      });

      if (!state.stopRouteIds.has(stopId)) {
        state.stopRouteIds.set(stopId, new Set());
      }
      state.stopRouteIds.get(stopId).add(trip.routeId);

      const pattern = state.patternsById.get(trip.patternId);
      if (pattern && !pattern.stopIdSet.has(stopId)) {
        pattern.stopIdSet.add(stopId);
        pattern.stopIds.push(stopId);
      }

      if (!firstStopCaptured.has(trip.id)) {
        const targetPattern = state.patternsById.get(trip.patternId);
        if (targetPattern && Number.isFinite(departureSeconds)) {
          targetPattern.departures.push({
            tripId: trip.id,
            seconds: departureSeconds,
          });
          firstStopCaptured.add(trip.id);
        }
      }
    });

    const tempShapes = new Map();
    await readCsv(path.join(operatorPath, "shapes.txt"), (row) => {
      const shapeId = `${operator.prefix}${row.shape_id}`;
      if (!activeShapeIds.has(shapeId)) {
        return;
      }

      if (!tempShapes.has(shapeId)) {
        tempShapes.set(shapeId, []);
      }

      tempShapes.get(shapeId).push({
        sequence: Number(row.shape_pt_sequence || 0),
        lat: Number(row.shape_pt_lat),
        lon: Number(row.shape_pt_lon),
      });
    });

    for (const [shapeId, points] of tempShapes.entries()) {
      const ordered = points
        .sort((a, b) => a.sequence - b.sequence)
        .map((point) => [point.lon, point.lat]);
      state.shapesById.set(shapeId, ordered);
    }

    state.operatorSummaries.push({
      id: operator.id,
      name: operator.name,
      static_gtfs_url: operator.staticUrl,
      stops: operatorStops.length,
      routes: operatorRoutes.length,
      trips: tripsInOperator.length,
      patterns: tripPatternIds.size,
    });
  }

  state.stops = Array.from(state.stopsById.values()).sort((a, b) =>
    localizeName(a.names, "en").localeCompare(localizeName(b.names, "en"), undefined, { numeric: true })
  );
  state.routes = Array.from(state.routesById.values()).sort((a, b) => {
    const shortCompare = a.shortName.localeCompare(b.shortName, undefined, { numeric: true });
    if (shortCompare !== 0) {
      return shortCompare;
    }
    return localizeName(a.names, "en").localeCompare(localizeName(b.names, "en"));
  });
  state.trips = Array.from(state.tripsById.values());
  state.loadedAt = new Date().toISOString();
  state.meta = {
    loaded_at: state.loadedAt,
    static_service_date: state.serviceDate,
    static_service_day: state.dayName,
    stop_count: state.stops.length,
    route_count: state.routes.length,
    trip_count: state.trips.length,
    operator_count: OPERATORS.length,
    operators: state.operatorSummaries,
    realtime_feed_url: LIVE_FEEDS[0],
  };
}

async function fetchRealtimeBuffer() {
  let lastError = null;

  for (const url of LIVE_FEEDS) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      return response.data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function pollRealtime() {
  try {
    const buffer = await fetchRealtimeBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    const vehicles = [];
    const vehiclesByRoute = new Map();
    const tripUpdates = new Map();

    for (const entity of feed.entity) {
      if (entity.tripUpdate) {
        const rawTripId = entity.tripUpdate.trip?.tripId ? String(entity.tripUpdate.trip.tripId) : null;
        const trip = rawTripId ? state.tripsByRawId.get(rawTripId) || state.tripsById.get(rawTripId) : null;
        const tripId = trip ? trip.id : rawTripId;

        if (!tripId) {
          continue;
        }

        const stopUpdates = new Map();
        for (const stopTime of entity.tripUpdate.stopTimeUpdate || []) {
          const rawStopId = stopTime.stopId ? String(stopTime.stopId) : null;
          if (!rawStopId) {
            continue;
          }

          const stopId = trip ? `${trip.operatorPrefix}${rawStopId}` : rawStopId;
          const epoch = toNumber(stopTime.arrival?.time);
          const delay = toNumber(stopTime.arrival?.delay) || 0;
          stopUpdates.set(stopId, { epoch, delay });
        }

        tripUpdates.set(tripId, stopUpdates);
      }

      if (entity.vehicle) {
        const rawTripId = entity.vehicle.trip?.tripId ? String(entity.vehicle.trip.tripId) : null;
        const rawRouteId = entity.vehicle.trip?.routeId ? String(entity.vehicle.trip.routeId) : null;
        const trip = rawTripId ? state.tripsByRawId.get(rawTripId) || state.tripsById.get(rawTripId) : null;
        const route =
          (trip && state.routesById.get(trip.routeId)) ||
          (rawRouteId && state.routesByRawId.get(rawRouteId)) ||
          null;

        const latitude = entity.vehicle.position?.latitude;
        const longitude = entity.vehicle.position?.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          continue;
        }
        if (!isWithinCyprus(latitude, longitude)) {
          continue;
        }

        const vehicle = {
          id: String(entity.vehicle.vehicle?.id || entity.id || rawTripId || `${latitude}-${longitude}`),
          trip_id: trip ? trip.id : rawTripId,
          route_id: route ? route.id : rawRouteId,
          route_short_name: route ? route.shortName : rawRouteId || "?",
          route_long_name: route ? localizeName(route.names, "en") : "Cyprus Public Transport",
          operator_name: route ? route.operatorName : "Cyprus Public Transport",
          headsign: trip ? trip.headsign : route ? localizeName(route.names, "en") : "Live route",
          lat: latitude,
          lon: longitude,
          bearing: entity.vehicle.position?.bearing || 0,
          speed_mps: entity.vehicle.position?.speed || 0,
          timestamp: toNumber(entity.vehicle.timestamp),
          color: route ? route.color : "4AE3B5",
          text_color: route ? route.textColor : "F7FAFC",
        };

        vehicles.push(vehicle);

        if (vehicle.route_id) {
          if (!vehiclesByRoute.has(vehicle.route_id)) {
            vehiclesByRoute.set(vehicle.route_id, []);
          }
          vehiclesByRoute.get(vehicle.route_id).push(vehicle);
        }
      }
    }

    state.vehicles = vehicles;
    state.vehiclesByRoute = vehiclesByRoute;
    state.tripUpdates = tripUpdates;
    state.realtimeUpdatedAt = new Date().toISOString();
    state.realtimeFetchStatus = "ok";
    state.realtimeError = null;
  } catch (error) {
    state.realtimeFetchStatus = "error";
    state.realtimeError = error.message;
    console.error("Realtime poll failed:", error.message);
  }
}

function ensureReady(req, res, next) {
  if (!state.initialized) {
    res.status(503).json({
      error: "CyBus is still loading GTFS data.",
      initializing: state.initializing,
    });
    return;
  }
  next();
}

function buildRouteDetails(route, lang) {
  const patternIds = state.patternsByRoute.get(route.id) || [];
  const directions = patternIds
    .map((patternId) => state.patternsById.get(patternId))
    .filter(Boolean)
    .map((pattern) => {
      const stops = pattern.stopIds
        .map((stopId) => state.stopsById.get(stopId))
        .filter(Boolean)
        .map((stop) => decorateStop(stop, lang));

      return {
        id: pattern.id,
        direction_id: pattern.directionId,
        headsign: pattern.headsign,
        stop_count: stops.length,
        departures: getUpcomingPatternDepartures(pattern, 8),
        stops,
      };
    });

  const shapeIds = Array.from(state.shapeIdsByRoute.get(route.id) || []);
  const shapes = shapeIds.map((shapeId) => state.shapesById.get(shapeId)).filter(Boolean).slice(0, 6);
  const vehicles = (state.vehiclesByRoute.get(route.id) || []).slice(0, 24);

  return {
    ...decorateRoute(route, lang),
    directions,
    shapes,
    active_vehicle_count: vehicles.length,
    active_vehicles: vehicles,
  };
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinCyprus(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= CYPRUS_BOUNDS.minLat &&
    lat <= CYPRUS_BOUNDS.maxLat &&
    lon >= CYPRUS_BOUNDS.minLon &&
    lon <= CYPRUS_BOUNDS.maxLon
  );
}

function getCandidateStops(stopId, lat, lon, lang) {
  if (stopId) {
    const stop = state.stopsById.get(stopId);
    if (!stop) {
      return [];
    }
    return [
      {
        stop,
        distanceKm: 0,
        label: localizeName(stop.names, lang),
      },
    ];
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return [];
  }

  return state.stops
    .map((stop) => ({ stop, distanceKm: haversineKm(lat, lon, stop.lat, stop.lon) }))
    .filter((item) => item.distanceKm <= 2.5)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      label: localizeName(item.stop.names, lang),
    }));
}

function findTransfer(startPattern, startIndex, endPattern, endIndex) {
  for (let index = startIndex + 1; index < startPattern.stopIds.length; index += 1) {
    const stopId = startPattern.stopIds[index];
    const endTransferIndex = endPattern.stopIds.indexOf(stopId);
    if (endTransferIndex > -1 && endTransferIndex < endIndex) {
      return { stopId, startTransferIndex: index, endTransferIndex };
    }
  }
  return null;
}

function buildPlannerOptions(params, lang) {
  const startCandidates = getCandidateStops(params.fromStopId, params.fromLat, params.fromLon, lang);
  const endCandidates = getCandidateStops(params.toStopId, params.toLat, params.toLon, lang);

  const directOptions = [];
  const transferOptions = [];
  const seen = new Set();
  const patterns = Array.from(state.patternsById.values());

  for (const pattern of patterns) {
    for (const start of startCandidates) {
      const startIndex = pattern.stopIds.indexOf(start.stop.id);
      if (startIndex === -1) {
        continue;
      }

      for (const end of endCandidates) {
        const endIndex = pattern.stopIds.indexOf(end.stop.id);
        if (endIndex === -1 || endIndex <= startIndex) {
          continue;
        }

        const route = state.routesById.get(pattern.routeId);
        if (!route) {
          continue;
        }

        const key = `direct:${route.id}:${start.stop.id}:${end.stop.id}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        directOptions.push({
          type: "direct",
          route_id: route.id,
          summary: `Take ${route.shortName} toward ${pattern.headsign}`,
          score: start.distanceKm + end.distanceKm,
          total_walk_km: Number((start.distanceKm + end.distanceKm).toFixed(2)),
          steps: [
            `Walk to ${localizeName(start.stop.names, lang)}.`,
            `Ride ${route.shortName} toward ${pattern.headsign}.`,
            `Get off at ${localizeName(end.stop.names, lang)}.`,
          ],
          segments: [
            {
              route: decorateRoute(route, lang),
              from: decorateStop(start.stop, lang),
              to: decorateStop(end.stop, lang),
              headsign: pattern.headsign,
            },
          ],
        });
      }
    }
  }

  for (const startPattern of patterns) {
    for (const endPattern of patterns) {
      if (startPattern.routeId === endPattern.routeId) {
        continue;
      }

      for (const start of startCandidates) {
        const startIndex = startPattern.stopIds.indexOf(start.stop.id);
        if (startIndex === -1) {
          continue;
        }

        for (const end of endCandidates) {
          const endIndex = endPattern.stopIds.indexOf(end.stop.id);
          if (endIndex === -1) {
            continue;
          }

          const transfer = findTransfer(startPattern, startIndex, endPattern, endIndex);
          if (!transfer) {
            continue;
          }

          const routeA = state.routesById.get(startPattern.routeId);
          const routeB = state.routesById.get(endPattern.routeId);
          const transferStop = state.stopsById.get(transfer.stopId);
          if (!routeA || !routeB || !transferStop) {
            continue;
          }

          const key = `transfer:${routeA.id}:${routeB.id}:${start.stop.id}:${transfer.stopId}:${end.stop.id}`;
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          transferOptions.push({
            type: "transfer",
            route_id: routeA.id,
            summary: `Take ${routeA.shortName}, then transfer to ${routeB.shortName}`,
            score: start.distanceKm + end.distanceKm + 0.45,
            total_walk_km: Number((start.distanceKm + end.distanceKm).toFixed(2)),
            transfer_stop_id: transfer.stopId,
            steps: [
              `Walk to ${localizeName(start.stop.names, lang)}.`,
              `Ride ${routeA.shortName} toward ${startPattern.headsign}.`,
              `Transfer at ${localizeName(transferStop.names, lang)}.`,
              `Take ${routeB.shortName} toward ${endPattern.headsign}.`,
              `Get off at ${localizeName(end.stop.names, lang)}.`,
            ],
            segments: [
              {
                route: decorateRoute(routeA, lang),
                from: decorateStop(start.stop, lang),
                to: decorateStop(transferStop, lang),
                headsign: startPattern.headsign,
              },
              {
                route: decorateRoute(routeB, lang),
                from: decorateStop(transferStop, lang),
                to: decorateStop(end.stop, lang),
                headsign: endPattern.headsign,
              },
            ],
          });
        }
      }
    }
  }

  const options = [...directOptions, ...transferOptions]
    .sort((a, b) => a.score - b.score)
    .slice(0, 6);

  return {
    origin_candidates: startCandidates.map((item) => withDistance(item.stop, lang, item.distanceKm)),
    destination_candidates: endCandidates.map((item) => withDistance(item.stop, lang, item.distanceKm)),
    options,
    assistant_message: options.length
      ? `I found ${options.length} bus option${options.length === 1 ? "" : "s"} with the shortest walking first.`
      : "I could not find a clean route with the current stop data. Try a nearby stop or a larger search radius.",
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    initialized: state.initialized,
    initializing: state.initializing,
    loaded_at: state.loadedAt,
    realtime_updated_at: state.realtimeUpdatedAt,
    realtime_status: state.realtimeFetchStatus,
    realtime_error: state.realtimeError,
  });
});

app.get("/api/bootstrap", ensureReady, (req, res) => {
  const lang = getLang(req);

  res.json({
    meta: {
      ...state.meta,
      realtime_updated_at: state.realtimeUpdatedAt,
      realtime_status: state.realtimeFetchStatus,
      live_vehicle_count: state.vehicles.length,
    },
    operators: state.operatorSummaries,
    routes: state.routes.map((route) => decorateRoute(route, lang)),
  });
});

app.get("/api/routes", ensureReady, (req, res) => {
  const lang = getLang(req);
  const q = String(req.query.q || "").trim().toLowerCase();
  const operator = String(req.query.operator || "").trim().toLowerCase();

  let routes = state.routes;
  if (operator) {
    routes = routes.filter((route) => route.operatorId === operator);
  }
  if (q) {
    routes = routes.filter((route) => {
      const haystack = [
        route.shortName,
        localizeName(route.names, "en"),
        localizeName(route.names, "el"),
        route.operatorName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  res.json(routes.map((route) => decorateRoute(route, lang)));
});

app.get("/api/routes/:routeId", ensureReady, (req, res) => {
  const route = state.routesById.get(req.params.routeId);
  if (!route) {
    res.status(404).json({ error: "Route not found." });
    return;
  }

  res.json(buildRouteDetails(route, getLang(req)));
});

app.get("/api/stops", ensureReady, (req, res) => {
  const lang = getLang(req);
  const ids = parseIds(req.query.ids);
  const q = String(req.query.q || "").trim().toLowerCase();
  const fetchAll = String(req.query.all || "") === "1";
  const limit = Math.min(Number(req.query.limit || 30), 100);

  if (ids.length > 0) {
    const stops = ids.map((id) => state.stopsById.get(id)).filter(Boolean).map((stop) => decorateStop(stop, lang));
    res.json(stops);
    return;
  }

  let stops = state.stops;
  if (q) {
    stops = stops.filter((stop) => {
      const haystack = [
        localizeName(stop.names, "en"),
        localizeName(stop.names, "el"),
        stop.operatorName,
        stop.code,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const visibleStops = fetchAll ? stops : stops.slice(0, limit);
  res.json(visibleStops.map((stop) => decorateStop(stop, lang)));
});

app.get("/api/stops/nearby", ensureReady, (req, res) => {
  const lang = getLang(req);
  const lat = parseCoordinate(req.query.lat);
  const lon = parseCoordinate(req.query.lon);
  const radiusKm = Math.min(Number(req.query.radius_km || 1.5), 10);
  const limit = Math.min(Number(req.query.limit || 20), 50);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: "lat and lon are required." });
    return;
  }

  const nearby = state.stops
    .map((stop) => ({ stop, distanceKm: haversineKm(lat, lon, stop.lat, stop.lon) }))
    .filter((item) => item.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map((item) => withDistance(item.stop, lang, item.distanceKm));

  res.json(nearby);
});

app.get("/api/stops/:stopId/timetable", ensureReady, (req, res) => {
  const stop = state.stopsById.get(req.params.stopId);
  if (!stop) {
    res.status(404).json({ error: "Stop not found." });
    return;
  }

  const lang = getLang(req);
  const limit = Math.min(Number(req.query.limit || 12), 30);
  res.json({
    stop: decorateStop(stop, lang),
    routes: getRoutesForStop(stop.id).map((route) => decorateRoute(route, lang)),
    arrivals: getUpcomingArrivals(stop.id, lang, limit),
  });
});

app.get("/api/vehicles", ensureReady, (req, res) => {
  const routeId = String(req.query.route_id || "").trim();
  const vehicles = routeId ? state.vehicles.filter((vehicle) => vehicle.route_id === routeId) : state.vehicles;

  res.json({
    updated_at: state.realtimeUpdatedAt,
    status: state.realtimeFetchStatus,
    count: vehicles.length,
    vehicles,
  });
});

app.get("/api/plan-route", ensureReady, (req, res) => {
  const lang = getLang(req);
  const planner = buildPlannerOptions(
    {
      fromStopId: String(req.query.from_stop_id || "").trim() || null,
      toStopId: String(req.query.to_stop_id || "").trim() || null,
      fromLat: parseCoordinate(req.query.from_lat),
      fromLon: parseCoordinate(req.query.from_lon),
      toLat: parseCoordinate(req.query.to_lat),
      toLon: parseCoordinate(req.query.to_lon),
    },
    lang
  );

  res.json(planner);
});

async function start() {
  if (state.initializing || state.initialized) {
    return;
  }

  state.initializing = true;

  try {
    console.log("Loading Cyprus GTFS static data...");
    await loadStaticData();
    console.log(`Loaded ${state.routes.length} routes and ${state.stops.length} stops for ${state.serviceDate}.`);
    await pollRealtime();
    state.initialized = true;
    console.log("Realtime polling ready.");

    setInterval(() => {
      pollRealtime().catch((error) => {
        console.error("Realtime loop error:", error.message);
      });
    }, REALTIME_POLL_MS);
  } catch (error) {
    console.error("CyBus startup failed:", error);
    process.exitCode = 1;
  } finally {
    state.initializing = false;
  }
}

app.listen(PORT, () => {
  console.log(`CyBus backend listening on http://localhost:${PORT}`);
  start().catch((error) => {
    console.error("Unhandled startup error:", error.message);
  });
});
