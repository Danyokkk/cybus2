"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const INITIAL_VIEW = {
  center: [33.3617, 35.1264],
  zoom: 8.4,
};

const EMPTY_COLLECTION = {
  type: "FeatureCollection",
  features: [],
};

const STREET_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildVehicleCollection(vehicles) {
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [vehicle.lon, vehicle.lat],
      },
      properties: {
        id: vehicle.id,
        kind: "vehicle",
        color: `#${vehicle.color || "4AE3B5"}`,
        routeShortName: vehicle.route_short_name,
        headsign: vehicle.headsign,
        bearing: vehicle.bearing || 0,
      },
    })),
  };
}

function buildVehicleMarker(vehicle) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "bus-marker";
  marker.setAttribute("aria-label", `${vehicle.route_short_name} ${vehicle.headsign}`);

  const badge = document.createElement("span");
  badge.className = "bus-marker-badge";
  badge.textContent = vehicle.route_short_name || "?";
  badge.style.background = `#${vehicle.color || "2EC5A2"}`;
  badge.style.color = `#${vehicle.text_color || "FFFFFF"}`;

  const bus = document.createElement("span");
  bus.className = "bus-marker-body";
  bus.style.background = `#${vehicle.color || "2EC5A2"}`;
  bus.style.color = `#${vehicle.text_color || "FFFFFF"}`;
  bus.style.transform = `rotate(${vehicle.bearing || 0}deg)`;

  const windows = document.createElement("span");
  windows.className = "bus-marker-windows";

  const nose = document.createElement("span");
  nose.className = "bus-marker-nose";

  bus.append(windows, nose);
  marker.append(badge, bus);
  return marker;
}

function buildStopCollection(routeDetail, nearbyStops, favoriteStops, selectedStop) {
  const rank = {
    route: 1,
    nearby: 2,
    favorite: 3,
    selected: 4,
  };
  const merged = new Map();

  const pushStop = (stop, kind) => {
    if (!stop?.stop_id) {
      return;
    }
    const current = merged.get(stop.stop_id);
    if (current && rank[current.kind] > rank[kind]) {
      return;
    }
    merged.set(stop.stop_id, { ...stop, kind });
  };

  for (const direction of routeDetail?.directions || []) {
    for (const stop of direction.stops || []) {
      pushStop(stop, "route");
    }
  }
  for (const stop of nearbyStops || []) {
    pushStop(stop, "nearby");
  }
  for (const stop of favoriteStops || []) {
    pushStop(stop, "favorite");
  }
  if (selectedStop) {
    pushStop(selectedStop, "selected");
  }

  return {
    type: "FeatureCollection",
    features: Array.from(merged.values()).map((stop) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [stop.lon, stop.lat],
      },
      properties: {
        id: stop.stop_id,
        kind: stop.kind,
        name: stop.name,
        code: stop.code,
      },
    })),
  };
}

function buildRouteCollection(routeDetail) {
  const features = [];
  for (const coordinates of routeDetail?.shapes || []) {
    if (!coordinates?.length) {
      continue;
    }
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        color: `#${routeDetail.color || "4AE3B5"}`,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function fitMapToFeatureCollection(map, collection, fallbackZoom = 13) {
  if (!collection?.features?.length) {
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const feature of collection.features) {
    if (feature.geometry.type === "Point") {
      bounds.extend(feature.geometry.coordinates);
    }
    if (feature.geometry.type === "LineString") {
      for (const point of feature.geometry.coordinates) {
        bounds.extend(point);
      }
    }
  }

  if (bounds.isEmpty()) {
    map.easeTo({ center: INITIAL_VIEW.center, zoom: fallbackZoom, duration: 800 });
    return;
  }

  map.fitBounds(bounds, {
    padding: 72,
    duration: 900,
    maxZoom: 14.5,
  });
}

export default function TransitMap({
  vehicles,
  routeDetail,
  nearbyStops,
  favoriteStops,
  selectedStop,
  userLocation,
  action,
  onVehicleSelect,
  onStopSelect,
  loadingLabel,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const readyRef = useRef(false);
  const vehicleMarkersRef = useRef(new Map());
  const vehicleIndexRef = useRef(new Map());
  const stopIndexRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const onVehicleSelectRef = useRef(onVehicleSelect);
  const onStopSelectRef = useRef(onStopSelect);
  const handledActionTokenRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const vehicleCollection = useMemo(() => buildVehicleCollection(vehicles || []), [vehicles]);
  const stopCollection = useMemo(
    () => buildStopCollection(routeDetail, nearbyStops, favoriteStops, selectedStop),
    [favoriteStops, nearbyStops, routeDetail, selectedStop]
  );
  const routeCollection = useMemo(() => buildRouteCollection(routeDetail), [routeDetail]);

  useEffect(() => {
    onVehicleSelectRef.current = onVehicleSelect;
    onStopSelectRef.current = onStopSelect;
  }, [onStopSelect, onVehicleSelect]);

  const openPopup = useCallback((lngLat, html) => {
    if (!mapRef.current) {
      return;
    }
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 20 })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(mapRef.current);
  }, []);

  const handleVehicleClick = useCallback((vehicle) => {
    if (!vehicle) {
      return;
    }
    onVehicleSelectRef.current?.(vehicle);
    openPopup(
      [vehicle.lon, vehicle.lat],
      `<div><strong>${escapeHtml(vehicle.route_short_name)}</strong><br/>${escapeHtml(vehicle.headsign)}</div>`
    );
  }, [openPopup]);

  const handleStopClick = useCallback((feature) => {
    const stop = stopIndexRef.current.get(feature.properties.id);
    if (!stop) {
      return;
    }
    onStopSelectRef.current?.(stop);
    openPopup(
      [stop.lon, stop.lat],
      `<div><strong>${escapeHtml(stop.name)}</strong><br/>${escapeHtml(stop.operator_name || "")}</div>`
    );
  }, [openPopup]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: 0,
      bearing: 0,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      readyRef.current = true;
      setMapReady(true);

      map.addSource("route-lines", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addLayer({
        id: "route-lines-glow",
        type: "line",
        source: "route-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 10,
          "line-opacity": 0.16,
          "line-blur": 1,
        },
      });
      map.addLayer({
        id: "route-lines-main",
        type: "line",
        source: "route-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      map.addSource("focus-stops", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addLayer({
        id: "focus-stops-glow",
        type: "circle",
        source: "focus-stops",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 10],
          "circle-color": [
            "match",
            ["get", "kind"],
            "selected",
            "#4AE3B5",
            "favorite",
            "#FFD166",
            "nearby",
            "#7BDFF2",
            "#FF8A5B",
          ],
          "circle-opacity": 0.18,
          "circle-blur": 0.7,
        },
      });
      map.addLayer({
        id: "focus-stops-main",
        type: "circle",
        source: "focus-stops",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 6],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#FFFFFF",
          "circle-color": [
            "match",
            ["get", "kind"],
            "selected",
            "#4AE3B5",
            "favorite",
            "#FFD166",
            "nearby",
            "#7BDFF2",
            "#FF8A5B",
          ],
        },
      });
      map.on("click", "focus-stops-main", (event) => {
        const feature = event.features?.[0];
        if (feature) {
          handleStopClick(feature);
        }
      });

      for (const layerId of ["focus-stops-main"]) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      userMarkerRef.current?.remove();
      for (const marker of vehicleMarkersRef.current.values()) {
        marker.remove();
      }
      vehicleMarkersRef.current.clear();
      map.remove();
      readyRef.current = false;
      setMapReady(false);
      mapRef.current = null;
    };
  }, [handleStopClick]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }
    vehicleIndexRef.current = new Map((vehicles || []).map((vehicle) => [vehicle.id, vehicle]));

    for (const marker of vehicleMarkersRef.current.values()) {
      marker.remove();
    }
    vehicleMarkersRef.current.clear();

    for (const vehicle of vehicles || []) {
      const element = buildVehicleMarker(vehicle);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        handleVehicleClick(vehicle);
      });

      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([vehicle.lon, vehicle.lat])
        .addTo(mapRef.current);

      vehicleMarkersRef.current.set(vehicle.id, marker);
    }
  }, [handleVehicleClick, mapReady, vehicles]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }
    stopIndexRef.current = new Map(
      Array.from(
        new Map(
          [...(favoriteStops || []), ...(nearbyStops || []), ...(selectedStop ? [selectedStop] : []), ...((routeDetail?.directions || []).flatMap((direction) => direction.stops || []))].map((stop) => [stop.stop_id, stop])
        ).values()
      ).map((stop) => [stop.stop_id, stop])
    );
    mapRef.current.getSource("focus-stops")?.setData(stopCollection);
  }, [favoriteStops, mapReady, nearbyStops, routeDetail, selectedStop, stopCollection]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }
    mapRef.current.getSource("route-lines")?.setData(routeCollection);
  }, [mapReady, routeCollection]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }

    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    const markerElement = document.createElement("div");
    markerElement.style.width = "18px";
    markerElement.style.height = "18px";
    markerElement.style.borderRadius = "999px";
    markerElement.style.background = "#4AE3B5";
    markerElement.style.border = "3px solid rgba(255,255,255,0.92)";
    markerElement.style.boxShadow = "0 0 0 8px rgba(74, 227, 181, 0.15)";

    userMarkerRef.current?.remove();
    userMarkerRef.current = new maplibregl.Marker({ element: markerElement })
      .setLngLat([userLocation.lon, userLocation.lat])
      .addTo(mapRef.current);
  }, [mapReady, userLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !action) {
      return;
    }

    if (handledActionTokenRef.current === action.token) {
      return;
    }

    handledActionTokenRef.current = action.token;

    const map = mapRef.current;

    if (action.type === "fitVehicles") {
      fitMapToFeatureCollection(map, vehicleCollection, 9);
      return;
    }

    if (action.type === "route") {
      if (routeCollection.features.length) {
        fitMapToFeatureCollection(map, routeCollection, 12);
      } else {
        fitMapToFeatureCollection(map, stopCollection, 13);
      }
      return;
    }

    if (action.type === "stop" && selectedStop) {
      map.easeTo({
        center: [selectedStop.lon, selectedStop.lat],
        zoom: 15.2,
        duration: 900,
      });
      return;
    }

    if (action.type === "vehicle") {
      const vehicle = (vehicles || []).find((item) => item.id === action.vehicleId);
      if (!vehicle) {
        return;
      }
      map.easeTo({
        center: [vehicle.lon, vehicle.lat],
        zoom: 13.8,
        duration: 900,
      });
      return;
    }

    if (action.type === "user" && userLocation) {
      map.easeTo({
        center: [userLocation.lon, userLocation.lat],
        zoom: 14,
        duration: 800,
      });
    }
  }, [action, mapReady, routeCollection, selectedStop, stopCollection, userLocation, vehicleCollection, vehicles]);

  return (
    <>
      <div ref={containerRef} className="map-canvas" />
      {!mapReady && (
        <div className="map-empty">
          <div className="glass-panel map-empty-card">{loadingLabel}</div>
        </div>
      )}
    </>
  );
}
