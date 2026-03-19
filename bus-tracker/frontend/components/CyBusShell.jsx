"use client";

import {
  Heart,
  Languages,
  LocateFixed,
  MapPinned,
  Navigation,
  Route,
  Search,
  Settings,
  Sparkles,
  Star,
  Waves,
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { useLanguage } from "../context/LanguageContext";
import TransitMap from "./TransitMap";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const FAVORITES_KEY = "cybus-favorite-stops";

const PANELS = [
  { id: "nearby", icon: LocateFixed },
  { id: "favorites", icon: Heart },
  { id: "lines", icon: Route },
  { id: "directions", icon: Sparkles },
  { id: "settings", icon: Settings },
];

function formatUpdatedAt(value) {
  if (!value) {
    return "--";
  }
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function buildRouteColors(route) {
  return {
    backgroundColor: `#${route.color}`,
    color: `#${route.text_color || "F7FAFC"}`,
  };
}

async function fetchJson(pathname, { lang, params } = {}) {
  const search = new URLSearchParams();
  if (lang) {
    search.set("lang", lang);
  }
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const response = await fetch(`${API_URL}${pathname}?${search.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }

  return response.json();
}

export default function CyBusShell() {
  const { language, languages, setLanguage, t } = useLanguage();
  const [bootstrap, setBootstrap] = useState({ routes: [], operators: [], meta: null });
  const [vehiclesState, setVehiclesState] = useState({ vehicles: [], updated_at: null, status: "loading" });
  const [panel, setPanel] = useState("nearby");
  const [panelOpen, setPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedStopTimetable, setSelectedStopTimetable] = useState(null);
  const [favoriteStopIds, setFavoriteStopIds] = useState([]);
  const [favoriteStops, setFavoriteStops] = useState([]);
  const [nearbyStops, setNearbyStops] = useState([]);
  const [locationError, setLocationError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [routeQuery, setRouteQuery] = useState("");
  const [mapAction, setMapAction] = useState({ type: "fitVehicles", token: 1 });
  const [plannerMode, setPlannerMode] = useState("location");
  const [plannerFromQuery, setPlannerFromQuery] = useState("");
  const [plannerToQuery, setPlannerToQuery] = useState("");
  const [plannerFromResults, setPlannerFromResults] = useState([]);
  const [plannerToResults, setPlannerToResults] = useState([]);
  const [plannerFromStop, setPlannerFromStop] = useState(null);
  const [plannerToStop, setPlannerToStop] = useState(null);
  const [plannerResult, setPlannerResult] = useState(null);
  const [plannerLoading, setPlannerLoading] = useState(false);

  const deferredRouteQuery = useDeferredValue(routeQuery);
  const deferredPlannerFromQuery = useDeferredValue(plannerFromQuery);
  const deferredPlannerToQuery = useDeferredValue(plannerToQuery);

  useEffect(() => {
    const saved = window.localStorage.getItem(FAVORITES_KEY);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setFavoriteStopIds(parsed);
      }
    } catch {
      window.localStorage.removeItem(FAVORITES_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteStopIds));
  }, [favoriteStopIds]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setPanelOpen(!media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const loadBootstrap = useEffectEvent(async () => {
    setLoading(true);
    try {
      const data = await fetchJson("/api/bootstrap", { lang: language });
      startTransition(() => {
        setBootstrap(data);
      });
    } finally {
      setLoading(false);
    }
  });

  const pollVehicles = useEffectEvent(async () => {
    try {
      const data = await fetchJson("/api/vehicles", { lang: language });
      startTransition(() => {
        setVehiclesState(data);
      });
    } catch (error) {
      startTransition(() => {
        setVehiclesState((current) => ({ ...current, status: "error" }));
      });
    }
  });

  const loadRouteDetail = useEffectEvent(async (routeId, focus = true) => {
    if (!routeId) {
      return;
    }
    const detail = await fetchJson(`/api/routes/${routeId}`, { lang: language });
    startTransition(() => {
      setSelectedRoute(detail);
      setPanel("lines");
      setPanelOpen(true);
      if (focus) {
        setMapAction({ type: "route", token: Date.now(), routeId: detail.route_id });
      }
    });
  });

  const loadStopTimetable = useEffectEvent(async (stop, focus = true) => {
    if (!stop?.stop_id) {
      return;
    }
    const timetable = await fetchJson(`/api/stops/${stop.stop_id}/timetable`, { lang: language });
    startTransition(() => {
      setSelectedStop(timetable.stop);
      setSelectedStopTimetable(timetable);
      setPanelOpen(true);
      if (focus) {
        setMapAction({ type: "stop", token: Date.now(), stopId: stop.stop_id });
      }
    });
  });

  const loadFavoriteStops = useEffectEvent(async () => {
    if (favoriteStopIds.length === 0) {
      setFavoriteStops([]);
      return;
    }
    const data = await fetchJson("/api/stops", {
      lang: language,
      params: { ids: favoriteStopIds.join(",") },
    });
    startTransition(() => {
      setFavoriteStops(data);
    });
  });

  const searchStops = useEffectEvent(async (query, setter) => {
    if (!query || query.trim().length < 2) {
      setter([]);
      return;
    }

    const results = await fetchJson("/api/stops", {
      lang: language,
      params: { q: query.trim(), limit: 8 },
    });
    setter(results);
  });

  const requestNearbyStops = useEffectEvent(async () => {
    if (!navigator.geolocation) {
      setLocationError(t.locateError);
      return null;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          setUserLocation(coords);
          setLocationError(null);
          const results = await fetchJson("/api/stops/nearby", {
            lang: language,
            params: {
              lat: coords.lat,
              lon: coords.lon,
              radius_km: 1.8,
              limit: 20,
            },
          });
          startTransition(() => {
            setNearbyStops(results);
            setPanel("nearby");
            setPanelOpen(true);
            setMapAction({ type: "user", token: Date.now() });
          });
          resolve(coords);
        },
        () => {
          setLocationError(t.locateError);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  });

  const runPlanner = useEffectEvent(async () => {
    if (!plannerToStop?.stop_id) {
      return;
    }

    let startCoords = userLocation;
    if (plannerMode === "location" && !userLocation) {
      startCoords = await requestNearbyStops();
    }

    setPlannerLoading(true);
    try {
      const params =
        plannerMode === "location"
          ? {
              from_lat: startCoords?.lat,
              from_lon: startCoords?.lon,
              to_stop_id: plannerToStop.stop_id,
            }
          : {
              from_stop_id: plannerFromStop?.stop_id,
              to_stop_id: plannerToStop.stop_id,
            };
      const data = await fetchJson("/api/plan-route", { lang: language, params });
      startTransition(() => {
        setPlannerResult(data);
        setPanelOpen(true);
      });
    } finally {
      setPlannerLoading(false);
    }
  });

  useEffect(() => {
    loadBootstrap().catch((error) => {
      console.error(error);
    });
  }, [language, loadBootstrap]);

  useEffect(() => {
    pollVehicles().catch((error) => {
      console.error(error);
    });
    const interval = window.setInterval(() => {
      pollVehicles().catch((error) => {
        console.error(error);
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [language, pollVehicles]);

  useEffect(() => {
    loadFavoriteStops().catch((error) => {
      console.error(error);
    });
  }, [favoriteStopIds, language, loadFavoriteStops]);

  useEffect(() => {
    if (selectedRoute?.route_id) {
      loadRouteDetail(selectedRoute.route_id, false).catch((error) => {
        console.error(error);
      });
    }
  }, [language, selectedRoute?.route_id, loadRouteDetail]);

  useEffect(() => {
    if (selectedStop?.stop_id) {
      loadStopTimetable(selectedStop, false).catch((error) => {
        console.error(error);
      });
    }
  }, [language, selectedStop?.stop_id, loadStopTimetable]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      searchStops(plannerMode === "stop" ? deferredPlannerFromQuery : "", setPlannerFromResults).catch((error) => {
        console.error(error);
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [deferredPlannerFromQuery, plannerMode, searchStops]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      searchStops(deferredPlannerToQuery, setPlannerToResults).catch((error) => {
        console.error(error);
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [deferredPlannerToQuery, searchStops]);

  const filteredRoutes = useMemo(() => {
    if (!deferredRouteQuery.trim()) {
      return bootstrap.routes;
    }
    const q = deferredRouteQuery.trim().toLowerCase();
    return bootstrap.routes.filter((route) =>
      [route.short_name, route.long_name, route.operator_name].join(" ").toLowerCase().includes(q)
    );
  }, [bootstrap.routes, deferredRouteQuery]);

  const liveStats = useMemo(
    () => [
      { label: t.liveVehicles, value: vehiclesState.count ?? vehiclesState.vehicles.length ?? 0 },
      { label: t.routes, value: bootstrap.meta?.route_count ?? 0 },
      { label: t.nearby, value: nearbyStops.length },
    ],
    [bootstrap.meta?.route_count, nearbyStops.length, t.liveVehicles, t.nearby, t.routes, vehiclesState]
  );

  const toggleFavorite = (stop) => {
    setFavoriteStopIds((current) => {
      if (current.includes(stop.stop_id)) {
        return current.filter((stopId) => stopId !== stop.stop_id);
      }
      return [stop.stop_id, ...current];
    });
  };

  const handleVehicleSelect = useEffectEvent(async (vehicle) => {
    if (!vehicle?.route_id) {
      return;
    }
    await loadRouteDetail(vehicle.route_id, false);
    setMapAction({ type: "vehicle", token: Date.now(), vehicleId: vehicle.id });
  });

  const isFavoriteStop = (stopId) => favoriteStopIds.includes(stopId);

  const renderSelectedStop = selectedStopTimetable ? (
    <section className="selection-card">
      <div className="stop-name-row">
        <div>
          <p className="tiny-label">{t.arrivals}</p>
          <h3>{selectedStopTimetable.stop.name}</h3>
          <p className="muted">
            {t.stopCode}: {selectedStopTimetable.stop.code}
          </p>
        </div>
        <button
          className={`favorite-toggle ${isFavoriteStop(selectedStopTimetable.stop.stop_id) ? "active" : ""}`}
          onClick={() => toggleFavorite(selectedStopTimetable.stop)}
          aria-label={t.favorite}
        >
          <Star size={16} fill={isFavoriteStop(selectedStopTimetable.stop.stop_id) ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="chip-row" style={{ flexWrap: "wrap" }}>
        {selectedStopTimetable.routes.slice(0, 6).map((route) => (
          <span key={route.route_id} className="meta-chip">
            {route.short_name}
          </span>
        ))}
      </div>
      <div className="arrivals-list">
        {selectedStopTimetable.arrivals.length === 0 ? (
          <p className="muted">{t.noArrivals}</p>
        ) : (
          selectedStopTimetable.arrivals.map((arrival) => (
            <div key={`${arrival.trip_id}-${arrival.arrival_time}`} className="arrival-row">
              <span className="route-pill" style={buildRouteColors(arrival)}>
                {arrival.route_short_name}
              </span>
              <div>
                <div className="arrival-time">{arrival.arrival_time}</div>
                <div className="muted">{arrival.trip_headsign}</div>
              </div>
              <strong>
                {arrival.minutes_away}
                {t.minutesAway}
              </strong>
            </div>
          ))
        )}
      </div>
    </section>
  ) : null;

  if (loading && !bootstrap.meta) {
    return (
      <main className="loading-screen">
        <div className="loading-orb" />
        <div className="loading-copy">
          <p className="eyebrow">CyBus RT</p>
          <h1>{t.loading}</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`glass-panel app-panel ${panelOpen ? "open" : ""}`}>
        <div className="mobile-panel-toggle">
          <div>
            <p className="eyebrow">{t.appTitle}</p>
            <strong>{t.openPanels}</strong>
          </div>
          <button className="icon-button" onClick={() => setPanelOpen((current) => !current)} aria-label={t.panelClose}>
            <Waves size={18} />
          </button>
        </div>

        <section className="hero-card">
          <div className="title-row">
            <div className="title-block">
              <p className="eyebrow">{t.liveNow}</p>
              <h1>{t.heroTitle}</h1>
            </div>
            <div className="badge">
              <span className="badge-dot" />
              {vehiclesState.status === "ok" ? t.liveVehicles : t.dataStatus}
            </div>
          </div>
          <p className="panel-copy">{t.heroBody}</p>

          <div className="stats-grid">
            {liveStats.map((item) => (
              <div key={item.label} className="stat-card">
                <p className="stat-value">{item.value}</p>
                <div className="stat-label">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="hero-actions">
            <button
              className="button button-primary"
              onClick={() => {
                setMapAction({ type: "fitVehicles", token: Date.now() });
                if (window.matchMedia("(max-width: 900px)").matches) {
                  setPanelOpen(false);
                }
              }}
            >
              <MapPinned size={18} />
              {t.trackBuses}
            </button>
            <button className="button button-secondary" onClick={() => requestNearbyStops().catch(console.error)}>
              <LocateFixed size={18} />
              {t.findNearby}
            </button>
          </div>
        </section>

        <nav className="tab-bar">
          {PANELS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`tab-button ${panel === item.id ? "active" : ""}`}
                onClick={() => {
                  setPanel(item.id);
                  setPanelOpen(true);
                }}
              >
                <Icon size={16} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
                {t[item.id]}
              </button>
            );
          })}
        </nav>

        {renderSelectedStop}

        <div className="panel-section scroll-area">
          {panel === "nearby" && (
            <>
              <div className="section-header">
                <div className="title-block">
                  <h2>{t.nearby}</h2>
                  <p className="section-subtitle">{locationError || t.noNearby}</p>
                </div>
              </div>
              <div className="nearby-list">
                {nearbyStops.map((stop) => (
                  <StopCard
                    key={stop.stop_id}
                    stop={stop}
                    t={t}
                    favorite={isFavoriteStop(stop.stop_id)}
                    onFavorite={() => toggleFavorite(stop)}
                    onOpen={() => loadStopTimetable(stop).catch(console.error)}
                  />
                ))}
              </div>
            </>
          )}

          {panel === "favorites" && (
            <>
              <div className="section-header">
                <div className="title-block">
                  <h2>{t.favorites}</h2>
                  <p className="section-subtitle">{favoriteStops.length === 0 ? t.noFavorites : t.mapHint}</p>
                </div>
              </div>
              <div className="favorites-list">
                {favoriteStops.map((stop) => (
                  <StopCard
                    key={stop.stop_id}
                    stop={stop}
                    t={t}
                    favorite
                    onFavorite={() => toggleFavorite(stop)}
                    onOpen={() => loadStopTimetable(stop).catch(console.error)}
                  />
                ))}
              </div>
            </>
          )}

          {panel === "lines" && (
            <>
              <div className="section-header">
                <div className="title-block">
                  <h2>{t.lines}</h2>
                  <p className="section-subtitle">{selectedRoute ? t.routeDirections : t.pickRoute}</p>
                </div>
              </div>

              <label>
                <span className="tiny-label">{t.searchRoutes}</span>
                <div style={{ position: "relative" }}>
                  <Search size={16} style={{ position: "absolute", left: 16, top: 16, opacity: 0.55 }} />
                  <input
                    className="search-input"
                    style={{ paddingLeft: 42 }}
                    value={routeQuery}
                    onChange={(event) => setRouteQuery(event.target.value)}
                    placeholder={t.searchRoutes}
                  />
                </div>
              </label>

              {selectedRoute && (
                <section className="route-card">
                  <div className="route-row" style={{ justifyContent: "space-between" }}>
                    <div className="route-row">
                      <span className="route-pill" style={buildRouteColors(selectedRoute)}>
                        {selectedRoute.short_name}
                      </span>
                      <div>
                        <h3>{selectedRoute.long_name}</h3>
                        <p className="muted">{selectedRoute.operator_name}</p>
                      </div>
                    </div>
                    <button
                      className="button button-secondary"
                      onClick={() => setMapAction({ type: "route", token: Date.now(), routeId: selectedRoute.route_id })}
                    >
                      {t.focusRoute}
                    </button>
                  </div>

                  <div className="meta-grid">
                    <span className="meta-chip">
                      {t.activeBuses}: {selectedRoute.active_vehicle_count}
                    </span>
                    <span className="meta-chip">
                      {t.updated}: {formatUpdatedAt(vehiclesState.updated_at)}
                    </span>
                  </div>

                  <div className="route-directions">
                    {selectedRoute.directions.map((direction) => (
                      <div key={direction.id} className="direction-card">
                        <p className="tiny-label">{direction.headsign}</p>
                        <div className="chip-row" style={{ flexWrap: "wrap", marginTop: 8 }}>
                          {direction.departures.slice(0, 6).map((departure) => (
                            <span key={`${direction.id}-${departure.trip_id}`} className="departure-chip">
                              {departure.time} · {departure.minutes_away}
                              {t.minutesAway}
                            </span>
                          ))}
                        </div>
                        <div className="stop-list" style={{ marginTop: 12 }}>
                          {direction.stops.slice(0, 12).map((stop) => (
                            <button
                              key={`${direction.id}-${stop.stop_id}`}
                              className="stop-card"
                              onClick={() => loadStopTimetable(stop).catch(console.error)}
                            >
                              <div className="stop-name-row">
                                <strong>{stop.name}</strong>
                                <span className="muted">{stop.code}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="route-list">
                {filteredRoutes.slice(0, 60).map((route) => (
                  <button
                    key={route.route_id}
                    className="route-card"
                    onClick={() => loadRouteDetail(route.route_id).catch(console.error)}
                  >
                    <div className="route-row">
                      <span className="route-pill" style={buildRouteColors(route)}>
                        {route.short_name}
                      </span>
                      <div>
                        <strong>{route.long_name}</strong>
                        <div className="muted">{route.operator_name}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {panel === "directions" && (
            <>
              <div className="section-header">
                <div className="title-block">
                  <h2>{t.plannerTitle}</h2>
                  <p className="section-subtitle">{t.plannerBody}</p>
                </div>
              </div>

              <div className="planner-card">
                <div className="chip-row" style={{ flexWrap: "wrap" }}>
                  <button
                    className={`tab-button ${plannerMode === "location" ? "active" : ""}`}
                    onClick={() => setPlannerMode("location")}
                  >
                    {t.currentLocation}
                  </button>
                  <button
                    className={`tab-button ${plannerMode === "stop" ? "active" : ""}`}
                    onClick={() => setPlannerMode("stop")}
                  >
                    {t.startStop}
                  </button>
                </div>

                {plannerMode === "stop" && (
                  <label>
                    <span className="tiny-label">{t.from}</span>
                    <input
                      className="planner-input"
                      value={plannerFromQuery}
                      onChange={(event) => {
                        setPlannerFromQuery(event.target.value);
                        setPlannerFromStop(null);
                      }}
                      placeholder={t.searchStops}
                    />
                    <div className="search-results">
                      {plannerFromResults.map((stop) => (
                        <button
                          key={`from-${stop.stop_id}`}
                          className="result-card"
                          onClick={() => {
                            setPlannerFromStop(stop);
                            setPlannerFromQuery(stop.name);
                            setPlannerFromResults([]);
                          }}
                        >
                          <strong>{stop.name}</strong>
                          <span className="muted">{stop.operator_name}</span>
                        </button>
                      ))}
                    </div>
                  </label>
                )}

                <label>
                  <span className="tiny-label">{t.to}</span>
                  <input
                    className="planner-input"
                    value={plannerToQuery}
                    onChange={(event) => {
                      setPlannerToQuery(event.target.value);
                      setPlannerToStop(null);
                    }}
                    placeholder={t.destination}
                  />
                  <div className="search-results">
                    {plannerToResults.map((stop) => (
                      <button
                        key={`to-${stop.stop_id}`}
                        className="result-card"
                        onClick={() => {
                          setPlannerToStop(stop);
                          setPlannerToQuery(stop.name);
                          setPlannerToResults([]);
                        }}
                      >
                        <strong>{stop.name}</strong>
                        <span className="muted">{stop.operator_name}</span>
                      </button>
                    ))}
                  </div>
                </label>

                <button className="button button-primary" disabled={plannerLoading} onClick={() => runPlanner().catch(console.error)}>
                  <Navigation size={18} />
                  {plannerLoading ? t.loading : t.getDirections}
                </button>
              </div>

              <section className="planner-card">
                <h3>{t.routeOptions}</h3>
                {plannerResult?.options?.length ? (
                  plannerResult.options.map((option, index) => (
                    <div key={`${option.summary}-${index}`} className="planner-card">
                      <div className="route-row" style={{ justifyContent: "space-between" }}>
                        <strong>{option.summary}</strong>
                        <span className="meta-chip">{option.type === "direct" ? t.direct : t.transfer}</span>
                      </div>
                      <div className="muted">
                        {t.walk}: {option.total_walk_km} km
                      </div>
                      <div className="directions-list">
                        {option.steps.map((step) => (
                          <div key={step} className="result-card">
                            {step}
                          </div>
                        ))}
                      </div>
                      <div className="chip-row" style={{ flexWrap: "wrap" }}>
                        {option.segments.map((segment) => (
                          <button
                            key={`${segment.route.route_id}-${segment.from.stop_id}`}
                            className="button button-secondary"
                            onClick={() => loadRouteDetail(segment.route.route_id).catch(console.error)}
                          >
                            {segment.route.short_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">{plannerResult ? t.plannerNone : t.plannerEmpty}</p>
                )}
              </section>
            </>
          )}

          {panel === "settings" && (
            <>
              <div className="section-header">
                <div className="title-block">
                  <h2>{t.settings}</h2>
                  <p className="section-subtitle">{t.darkGlass}</p>
                </div>
              </div>

              <section className="settings-card">
                <h3>{t.language}</h3>
                <div className="language-grid">
                  {languages.map((item) => (
                    <button
                      key={item.value}
                      className={`language-button ${language === item.value ? "active" : ""}`}
                      onClick={() => setLanguage(item.value)}
                    >
                      <Languages size={16} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="status-card">
                <h3>{t.dataStatus}</h3>
                <div className="status-row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t.realtimeFeed}</span>
                  <strong>{vehiclesState.status}</strong>
                </div>
                <div className="status-row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t.updated}</span>
                  <strong>{formatUpdatedAt(vehiclesState.updated_at)}</strong>
                </div>
                <div className="status-row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t.staticGtfs}</span>
                  <strong>{bootstrap.meta?.static_service_date || "--"}</strong>
                </div>
                <p className="muted">{t.refreshHint}</p>
              </section>
            </>
          )}
        </div>
      </aside>

      <section className="glass-panel map-stage">
        <TransitMap
          vehicles={vehiclesState.vehicles || []}
          routeDetail={selectedRoute}
          nearbyStops={nearbyStops}
          favoriteStops={favoriteStops}
          selectedStop={selectedStop}
          userLocation={userLocation}
          action={mapAction}
          onVehicleSelect={(vehicle) => handleVehicleSelect(vehicle).catch(console.error)}
          onStopSelect={(stop) => loadStopTimetable(stop).catch(console.error)}
          loadingLabel={t.loadingMap}
        />

        <div className="map-overlay">
          <div className="glass-panel map-card">
            <p className="tiny-label">{t.liveNow}</p>
            <h3 style={{ margin: "0.2rem 0 0.5rem" }}>{t.liveVehicles}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {vehiclesState.vehicles?.length || 0} · {t.updated} {formatUpdatedAt(vehiclesState.updated_at)}
            </p>
          </div>
          {selectedRoute && (
            <div className="glass-panel map-card">
              <div className="route-row">
                <span className="route-pill" style={buildRouteColors(selectedRoute)}>
                  {selectedRoute.short_name}
                </span>
                <div>
                  <strong>{selectedRoute.long_name}</strong>
                  <div className="muted">{selectedRoute.operator_name}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function StopCard({ stop, t, favorite, onFavorite, onOpen }) {
  return (
    <button className="stop-card" onClick={onOpen}>
      <div className="stop-name-row">
        <div>
          <strong>{stop.name}</strong>
          <div className="muted">{stop.operator_name}</div>
        </div>
        <button
          type="button"
          className={`favorite-toggle ${favorite ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onFavorite();
          }}
          aria-label={t.favorite}
        >
          <Heart size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="meta-grid">
        {Number.isFinite(stop.distance_km) && stop.distance_km > 0 ? (
          <span className="meta-chip">{stop.distance_km} km</span>
        ) : null}
        <span className="meta-chip">
          {t.stopCode}: {stop.code}
        </span>
      </div>
    </button>
  );
}
