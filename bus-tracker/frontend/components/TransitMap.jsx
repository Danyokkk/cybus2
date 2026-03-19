"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const INITIAL_VIEW = {
  center: [33.3617, 35.1264],
  zoom: 8.4,
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
  const vehicleIndexRef = useRef(new Map());
  const stopIndexRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const vehicleCollection = useMemo(() => buildVehicleCollection(vehicles || []), [vehicles]);
  const stopCollection = useMemo(
    () => buildStopCollection(routeDetail, nearbyStops, favoriteStops, selectedStop),
    [favoriteStops, nearbyStops, routeDetail, selectedStop]
  );
  const routeCollection = useMemo(() => buildRouteCollection(routeDetail), [routeDetail]);

  const openPopup = useEffectEvent((lngLat, html) => {
    if (!mapRef.current) {
      return;
    }
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 20 })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(mapRef.current);
  });

  const handleVehicleClick = useEffectEvent((feature) => {
    const vehicle = vehicleIndexRef.current.get(feature.properties.id);
    if (!vehicle) {
      return;
    }
    onVehicleSelect?.(vehicle);
    openPopup(
      [vehicle.lon, vehicle.lat],
      `<div><strong>${escapeHtml(vehicle.route_short_name)}</strong><br/>${escapeHtml(vehicle.headsign)}</div>`
    );
  });

  const handleStopClick = useEffectEvent((feature) => {
    const stop = stopIndexRef.current.get(feature.properties.id);
    if (!stop) {
      return;
    }
    onStopSelect?.(stop);
    openPopup(
      [stop.lon, stop.lat],
      `<div><strong>${escapeHtml(stop.name)}</strong><br/>${escapeHtml(stop.operator_name || "")}</div>`
    );
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
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
        data: routeCollection,
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
        data: stopCollection,
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
      map.addLayer({
        id: "focus-stops-labels",
        type: "symbol",
        source: "focus-stops",
        minzoom: 12,
        layout: {
          "text-field": ["coalesce", ["get", "name"], ["get", "code"]],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#24415B",
          "text-halo-color": "rgba(255, 255, 255, 0.96)",
          "text-halo-width": 1.1,
        },
      });

      map.addSource("vehicles", {
        type: "geojson",
        data: vehicleCollection,
      });
      map.addLayer({
        id: "vehicles-badge-shadow",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 10, 14, 16],
          "circle-opacity": 0.18,
          "circle-blur": 0.8,
          "circle-translate": [0, -20],
        },
      });
      map.addLayer({
        id: "vehicles-badge",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 14, 14],
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 2,
          "circle-translate": [0, -20],
        },
      });
      map.addLayer({
        id: "vehicles-badge-label",
        type: "symbol",
        source: "vehicles",
        layout: {
          "text-field": ["get", "routeShortName"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 14, 16],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-translate": [0, -20],
        },
        paint: {
          "text-color": "#FFFFFF",
        },
      });
      map.addLayer({
        id: "vehicles-icon",
        type: "symbol",
        source: "vehicles",
        layout: {
          "text-field": "🚌",
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, 20, 14, 28],
          "text-rotate": ["get", "bearing"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#FFFFFF",
          "text-halo-color": "rgba(255,255,255,0.92)",
          "text-halo-width": 0.6,
        },
      });

      map.on("click", "vehicles-icon", (event) => {
        const feature = event.features?.[0];
        if (feature) {
          handleVehicleClick(feature);
        }
      });
      map.on("click", "focus-stops-main", (event) => {
        const feature = event.features?.[0];
        if (feature) {
          handleStopClick(feature);
        }
      });

      for (const layerId of ["vehicles-icon", "focus-stops-main"]) {
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
      map.remove();
      readyRef.current = false;
      mapRef.current = null;
    };
  }, [handleStopClick, handleVehicleClick, routeCollection, stopCollection, vehicleCollection]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) {
      return;
    }
    vehicleIndexRef.current = new Map((vehicles || []).map((vehicle) => [vehicle.id, vehicle]));
    mapRef.current.getSource("vehicles")?.setData(vehicleCollection);
  }, [vehicleCollection, vehicles]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) {
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
  }, [favoriteStops, nearbyStops, routeDetail, selectedStop, stopCollection]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) {
      return;
    }
    mapRef.current.getSource("route-lines")?.setData(routeCollection);
  }, [routeCollection]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) {
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
  }, [userLocation]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current || !action) {
      return;
    }

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
  }, [action, routeCollection, selectedStop, stopCollection, userLocation, vehicleCollection, vehicles]);

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
