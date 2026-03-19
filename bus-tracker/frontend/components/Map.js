'use client';

import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMapEvents, LayersControl, useMap, ZoomControl } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useState, useRef, useMemo, memo, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

// Standard Leaflet Marker Shadow fix
L.Icon.Default.mergeOptions({
    iconRetinaUrl: iconRetinaUrl.src || iconRetinaUrl,
    iconUrl: iconUrl.src || iconUrl,
    shadowUrl: shadowUrl.src || shadowUrl,
});

// 3D 🛑 Stop Pin (Style from User Image)
const stopIcon = L.divIcon({
    className: 'custom-stop-icon',
    html: `
        <div style="
            position: relative;
            width: 32px;
            height: 38px;
            display: flex;
            flex-direction: column;
            align-items: center;
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
        ">
            <!-- Pin Body -->
            <div style="
                background: #ff0033; 
                width: 32px; 
                height: 32px; 
                border-radius: 50% 50% 50% 6px; 
                transform: rotate(-45deg); 
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid white;
            ">
                <!-- Inner White Circle -->
                <div style="
                    background: white; 
                    width: 20px; 
                    height: 20px; 
                    border-radius: 50%; 
                    transform: rotate(45deg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
                ">
                    <span style="font-size: 14px;">🚌</span>
                </div>
            </div>
            <!-- Base Shadow -->
            <div style="
                width: 14px;
                height: 4px;
                background: rgba(0,0,0,0.3);
                border-radius: 50%;
                margin-top: -2px;
            "></div>
        </div>
    `,
    iconSize: [32, 42],
    iconAnchor: [16, 38],
    popupAnchor: [0, -40]
});

// User Location "Radar" Icon - Fat Neon Green
const userLocationIcon = L.divIcon({
    className: 'custom-user-location-icon',
    html: '<div style="background: #39ff14; width: 22px; height: 22px; border-radius: 50%; border: 4px solid #fff; box-shadow: 0 0 20px #39ff14, 0 0 40px rgba(57, 255, 20, 0.4); animation: sonar 2s infinite;"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});

// Plan Point Icons
const planStartIcon = L.divIcon({
    className: 'custom-plan-icon',
    html: '<div style="background: #39ff14; border: 2px solid white; box-shadow: 0 0 10px #39ff14; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #000; font-size: 10px;">START</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const planHubIcon = L.divIcon({
    className: 'custom-plan-icon',
    html: '<div style="background: #e056fd; border: 2px solid white; box-shadow: 0 0 10px #e056fd; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #fff; font-size: 10px;">BUS</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const planEndIcon = L.divIcon({
    className: 'custom-plan-icon',
    html: '<div style="background: #ff0033; border: 2px solid white; box-shadow: 0 0 10px #ff0033; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #fff; font-size: 10px;">END</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const TimetablePopup = ({ stop, routes, onSelectRoute, favorites, onToggleFavorite }) => {
    const [arrivals, setArrivals] = useState([]);
    const [loading, setLoading] = useState(true);

    const isFav = favorites?.some(f => f.stop_id === stop.stop_id);

    useEffect(() => {
        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://cyfinal.onrender.com';
        fetch(`${apiUrl}/api/stops/${stop.stop_id}/timetable`)
            .then(res => res.json())
            .then(data => {
                const now = new Date();
                const currentTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

                // Filter: Upcoming AND within 60 minutes
                const upcoming = data.filter(a => {
                    if (a.arrival_time < currentTime) return false;

                    const [h, m] = a.arrival_time.split(':');
                    const busTime = new Date();
                    busTime.setHours(h, m, 0);
                    const diffMins = (busTime - now) / 60000;

                    return diffMins <= 60;
                });

                setArrivals(upcoming.slice(0, 10));
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [stop.stop_id]);

    const uniqueRoutes = [...new Set(arrivals.map(a => a.route_short_name))];

    if (loading) return <div style={{ minWidth: '320px', padding: '20px', textAlign: 'center', color: '#fff', fontWeight: 'bold' }}>Loading arrivals...</div>;

    return (
        <div style={{ minWidth: '320px', maxWidth: '350px', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div>
                    <h3 style={{ margin: '0 0 5px 0', fontSize: '1.2rem', color: '#fff', fontWeight: '900', letterSpacing: '-0.5px' }}>{stop.name}</h3>
                    <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '12px', fontWeight: 'bold' }}>STOP ID: {stop.stop_id}</div>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(stop); }}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.6rem',
                        cursor: 'pointer',
                        padding: '5px',
                        lineHeight: 1,
                        filter: isFav ? 'drop-shadow(0 0 5px rgba(255,0,51,0.5))' : 'grayscale(1)',
                        transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                    {isFav ? '❤️' : '🤍'}
                </button>
            </div>

            {uniqueRoutes.length > 0 && (
                <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>Routes stopping here:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {uniqueRoutes.map(shortName => {
                            // Match using 'short_name' (from server) or fallback
                            const routeInfo = routes.find(r => r.short_name === shortName || r.route_short_name === shortName);
                            // Use 'color' (server) or 'route_color'
                            const color = routeInfo ? `#${routeInfo.color || routeInfo.route_color}` : '#0070f3';
                            const textColor = routeInfo ? `#${routeInfo.text_color || routeInfo.route_text_color}` : 'white';

                            return (
                                <span
                                    key={shortName}
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent map click
                                        if (routeInfo) onSelectRoute(routeInfo);
                                    }}
                                    style={{
                                        backgroundColor: color,
                                        color: textColor,
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        fontSize: '0.8rem',
                                        cursor: routeInfo ? 'pointer' : 'default',
                                        fontWeight: 'bold',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                        transition: 'transform 0.1s',
                                        display: 'inline-block'
                                    }}
                                    onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
                                    onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                                    title={routeInfo ? `View Route ${shortName}` : ''}
                                >
                                    {shortName}
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', color: '#ddd' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid var(--glass-border)', textAlign: 'left', color: '#fff', opacity: 0.6, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                        <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>⏰ Arrive</th>
                        <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>⏳ In</th>
                        <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>🚌 Route</th>
                        <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>📍 Dest.</th>
                    </tr>
                </thead>
                <tbody>
                    {arrivals.length === 0 ? (
                        <tr><td colSpan="4" style={{ padding: '15px', textAlign: 'center', color: '#888' }}>No buses in the next hour.</td></tr>
                    ) : (
                        arrivals.map((arr, i) => {
                            const now = new Date();
                            const [h, m] = arr.arrival_time.split(':');
                            const busTime = new Date();
                            busTime.setHours(h, m, 0);
                            const diff = Math.floor((busTime - now) / 60000);
                            const timeDisplay = diff >= 0 ? `${diff}m` : 'Now';

                            const routeInfo = routes.find(r => r.short_name === arr.route_short_name || r.route_short_name === arr.route_short_name);
                            const rColor = routeInfo ? (routeInfo.color || routeInfo.route_color) : '4834d4';
                            const badgeColor = rColor.startsWith('#') ? rColor : `#${rColor}`;

                            return (
                                <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                    <td style={{ padding: '10px 4px', color: '#fff', fontWeight: 'bold' }}>
                                        {arr.arrival_time.slice(0, 5)}
                                    </td>
                                    <td style={{ padding: '10px 4px', fontWeight: '900', color: '#fff' }}>{timeDisplay}</td>
                                    <td style={{ padding: '10px 4px' }}>
                                        <span
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (routeInfo) onSelectRoute(routeInfo);
                                            }}
                                            style={{
                                                backgroundColor: badgeColor,
                                                padding: '4px 8px',
                                                borderRadius: '6px',
                                                border: `1px solid rgba(255,255,255,0.2)`,
                                                color: '#fff',
                                                cursor: routeInfo ? 'pointer' : 'default',
                                                fontSize: '0.8rem',
                                                fontWeight: '900',
                                                boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                                            }}
                                        >
                                            {arr.route_short_name}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px 4px', color: '#bbb' }}>{arr.trip_headsign}</td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};

// Icon Cache to prevent redundant divIcon creation
const iconCache = new Map();

// Custom Bus Icon Generator (Balloon Label + Rotated Bus)
const createBusIcon = (routeShortName, bearing = 0, color = '#44bd32', zoom = 15) => {
    // Quantize bearing to 10-degree steps to reduce cache size and re-mounts
    const qBearing = Math.round((bearing || 0) / 10) * 10;
    // Dynamic scale to keep buses "readable" even when zoomed out (doesn't shrink as much as map)
    const scale = zoom < 12 ? 0.8 : zoom < 14 ? 0.9 : 1.0;

    const key = `${routeShortName}_${qBearing}_${color}_${scale}`;
    if (iconCache.has(key)) return iconCache.get(key);

    const icon = L.divIcon({
        className: 'custom-bus-marker-container',
        html: `
            <div class="balloon-bus-marker">
                <div class="balloon-label" style="background-color: ${color};">
                    ${routeShortName || '?'}
                </div>
                <div class="rotated-bus-wrapper" style="transform: rotate(${(qBearing || 0)}deg) scale(${scale})">
                    <svg viewBox="0 0 50 100" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 32px; filter: drop-shadow(0 1.5px 3px rgba(0,0,0,0.4));">
                        <!-- Bus Chassis -->
                        <rect x="5" y="5" width="40" height="90" rx="10" fill="${color}" stroke="white" stroke-width="4" />
                        <!-- Front Windshield -->
                        <path d="M10 15 Q25 10 40 15 L40 30 Q25 35 10 30 Z" fill="rgba(0,0,0,0.8)" />
                        <!-- Roof Details -->
                        <rect x="15" y="45" width="20" height="25" rx="3" fill="rgba(255,255,255,0.2)" />
                        <!-- Headlights -->
                        <circle cx="15" cy="10" r="3" fill="#fffb00" />
                        <circle cx="35" cy="10" r="3" fill="#fffb00" />
                    </svg>
                </div>
            </div>
        `,
        iconSize: [40, 60],
        iconAnchor: [20, 50],
        popupAnchor: [0, -50]
    });

    iconCache.set(key, icon);
    // Limit cache size
    if (iconCache.size > 1000) {
        const firstKey = iconCache.keys().next().value;
        iconCache.delete(firstKey);
    }

    return icon;
};

// Memoized Bus Marker Component to prevent re-renders unless data changes
const BusMarker = memo(({ id, lat, lon, bearing, shortName, color, speed, headsign, agency, isFirstLoad, isNew, onVehicleClick, t, rawVehicle, mapZoom }) => {
    const routeInfo = useMemo(() => null, []);

    const vColor = color ? (color.startsWith('#') ? color : '#' + color) : '#44bd32';
    // Text color logic could be simplified or passed from props
    const vTextColor = 'white';

    return (
        <Marker
            position={[lat, lon]}
            icon={createBusIcon(shortName, bearing, vColor, mapZoom || 15)}
            className="smooth-move"
            eventHandlers={{
                click: () => {
                    if (onVehicleClick) onVehicleClick(rawVehicle);
                }
            }}
        >
            <Popup className="bus-popup" minWidth={200} autoPan={false}>
                <div style={{ textAlign: 'center', minWidth: '180px', padding: '5px' }}>
                    <div style={{
                        backgroundColor: vColor,
                        color: vTextColor,
                        padding: '10px 18px',
                        borderRadius: '25px',
                        display: 'inline-block',
                        fontSize: '1.3rem',
                        fontWeight: '900',
                        marginBottom: '12px',
                        boxShadow: '0 3px 8px rgba(0,0,0,0.3)',
                        border: '2px solid rgba(255,255,255,0.2)'
                    }}>
                        {shortName || '?'}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '900', marginBottom: '8px', color: '#fff', letterSpacing: '-0.5px' }}>
                        {headsign || 'Bus Route'}
                    </div>
                    <div style={{ textAlign: 'left', fontSize: '0.85rem', marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '14px' }}>
                        <div style={{ marginBottom: '8px' }}><strong style={{ color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase' }}>ID:</strong> <span style={{ fontFamily: 'monospace', color: '#fff' }}>{id}</span></div>
                        <div style={{ marginBottom: '8px' }}><strong style={{ color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase' }}>Operator:</strong> <span style={{ color: '#fff' }}>{agency || 'CPT'}</span></div>
                        <div style={{ marginBottom: '6px', color: '#4834d4' }}>
                            <strong style={{ color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase' }}>{t?.speed || 'Speed'}:</strong> {(speed ? (speed * 3.6).toFixed(1) : '0.0')} km/h
                        </div>
                    </div>
                </div>
            </Popup>
        </Marker>
    );
});

const MapEvents = ({ map, setMapZoom, updateVisibleElements, shapes, onSelectRoute, selectedPlan }) => {
    useMapEvents({
        movestart: () => {
            if (map?._container) map._container.classList.add('map-moving');
        },
        moveend: () => {
            setMapZoom(map.getZoom());
            updateVisibleElements();
            if (map?._container) map._container.classList.remove('map-moving');
        },
        zoomstart: () => {
            if (map?._container) map._container.classList.add('map-moving');
        },
        zoomend: () => {
            setMapZoom(map.getZoom());
            updateVisibleElements();
            if (map?._container) map._container.classList.remove('map-moving');
        },
        popupclose: (e) => {
            if (e.popup.options.className === 'bus-popup') {
                if (onSelectRoute) onSelectRoute(null);
            }
        },
        click: () => {
            // Close sidebar on mobile when clicking anywhere on the map
            if (window.innerWidth < 768 && setIsOpen) {
                setIsOpen(false);
            }
        }
    });

    // Auto-Zoom logic
    useEffect(() => {
        if (!map) return;

        // Priority 1: Selected Plan (specific points)
        if (selectedPlan) {
            const points = [
                [selectedPlan.from.lat, selectedPlan.from.lon],
                [selectedPlan.to.lat, selectedPlan.to.lon]
            ];
            if (selectedPlan.hub) points.push([selectedPlan.hub.lat, selectedPlan.hub.lon]);

            map.fitBounds(points, { padding: [100, 100], animate: true, maxZoom: 16 });
            return;
        }

        // Priority 2: Route Shapes
        if (shapes && shapes.length > 0) {
            const allPoints = shapes.flat();
            if (allPoints.length > 0) {
                map.fitBounds(allPoints, { padding: [70, 70], animate: true, maxZoom: 15 });
            }
        }
    }, [shapes, selectedPlan, map]);

    return null;
};

export default function BusMap({
    stops, shapes, routes, vehicles, selectedPlan, onSelectRoute, routeColor, onVehicleClick,
    showToast, showStops, setShowStops, isSatellite, setIsSatellite, isOpen, setIsOpen,
    favorites, toggleFavorite
}) {
    const mapRef = useRef(null);
    const { t } = useLanguage();
    const [locLoading, setLocLoading] = useState(false);
    const [isFirstLoad, setIsFirstLoad] = useState(true);
    const seenVehicles = useRef(new Set());

    // Manage visible stops for performance
    const [visibleStops, setVisibleStops] = useState([]);
    const [mapZoom, setMapZoom] = useState(10);
    const [userLoc, setUserLoc] = useState(null);


    // 1. Map Events Handling Logic (Stops only, Vehicles are handled directly)
    const updateVisibleStops = useCallback(() => {
        if (!mapRef.current) return;
        const m = mapRef.current;
        const bounds = m.getBounds();
        const zoom = m.getZoom();
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

        const buffer = isMobile ? 0.05 : 0.15;
        const paddedBounds = bounds.pad(buffer);

        // Filter stops only
        if (showStops && zoom >= 15 && Array.isArray(stops)) {
            const filteredStops = stops.filter(s =>
                s && s.lat !== undefined && s.lon !== undefined &&
                paddedBounds.contains([s.lat, s.lon])
            );
            setVisibleStops(filteredStops);
        } else {
            setVisibleStops([]);
        }
    }, [showStops, stops]);

    // Update visibility when source data or settings change
    useEffect(() => {
        updateVisibleStops(mapRef.current);
    }, [showStops, stops, updateVisibleStops]);

    // Trigger update on vehicles change for "seen" logic and first load removal
    useEffect(() => {
        if (Array.isArray(vehicles) && vehicles.length > 0 && isFirstLoad) {
            vehicles.forEach(v => seenVehicles.current.add(v.id || v.vehicle_id));
            setIsFirstLoad(false);
        }
    }, [vehicles, isFirstLoad]);

    const geoInProgress = useRef(false);
    const userLocRef = useRef(null);
    const pendingErrorTimeout = useRef(null);

    // Geolocation - Strict iOS Compliance
    useEffect(() => {
        const btn = document.getElementById('my-location-btn');
        if (!btn) return;

        const handleLocClick = (e) => {
            e.preventDefault();
            if (geoInProgress.current) return;
            if (!navigator.geolocation) {
                if (showToast) showToast("Geolocation is not supported by your browser");
                return;
            }

            setLocLoading(true);
            geoInProgress.current = true;

            if (pendingErrorTimeout.current) {
                clearTimeout(pendingErrorTimeout.current);
                pendingErrorTimeout.current = null;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    if (pendingErrorTimeout.current) {
                        clearTimeout(pendingErrorTimeout.current);
                        pendingErrorTimeout.current = null;
                    }

                    setUserLoc([latitude, longitude]);
                    userLocRef.current = [latitude, longitude];
                    setLocLoading(false);
                    geoInProgress.current = false;
                    setShowStops(true);
                    if (mapRef.current) mapRef.current.setView([latitude, longitude], 15, { animate: true });
                },
                (err) => {
                    setLocLoading(false);
                    geoInProgress.current = false;
                    if (userLocRef.current) return;
                    if (err.code === 1) {
                        pendingErrorTimeout.current = setTimeout(() => {
                            if (!userLocRef.current && showToast) {
                                showToast("Location access denied. Check browser/OS settings.");
                            }
                        }, 1000);
                    } else if (err.code === 3) {
                        console.warn("Location timeout.");
                    } else {
                        if (showToast) showToast("Could not find location. Try again.");
                    }
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
            );
        };

        btn.addEventListener('click', handleLocClick);
        return () => {
            btn.removeEventListener('click', handleLocClick);
            if (pendingErrorTimeout.current) clearTimeout(pendingErrorTimeout.current);
        };
    }, [showToast]);

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%' }}>
            {/* Desktop Map Controls (hidden via CSS on mobile, but kept in DOM for functional triggers) */}
            <div className="map-controls-container" style={{ position: 'absolute', top: '100px', right: '25px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button onClick={() => setIsSatellite(!isSatellite)} className="stops-toggle-btn" title={isSatellite ? t.streetView : t.satelliteView}>
                    <span>{isSatellite ? '🏙️' : '🛰️'}</span>
                </button>
                <button onClick={() => setShowStops(!showStops)} className={`stops-toggle-btn ${showStops ? 'active' : ''}`} title={showStops ? t.hideStops : t.showStops}>
                    <span>{showStops ? '✕' : '🚏'}</span>
                </button>
                <button id="my-location-btn" className="stops-toggle-btn" title={t.myLocation}>
                    <span>{locLoading ? '⌛' : '🎯'}</span>
                </button>
                <button
                    onClick={() => {
                        if (confirm("Reboot site and refresh all data?")) {
                            window.location.reload(true);
                        }
                    }}
                    className="stops-toggle-btn"
                    title="Reboot"
                >
                    <span>🔄</span>
                </button>
            </div>

            <MapContainer
                center={[35.1264, 33.4299]}
                zoom={9}
                minZoom={8}
                maxBounds={[[32.5, 30.0], [36.5, 37.0]]}
                maxBoundsViscosity={1.0}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
                ref={mapRef}
                preferCanvas={true}
            >
                <ZoomControl position="bottomright" />
                <MapEvents
                    map={mapRef.current}
                    setMapZoom={setMapZoom}
                    updateVisibleElements={updateVisibleStops}
                    shapes={shapes}
                    onSelectRoute={onSelectRoute}
                    selectedPlan={selectedPlan}
                    setIsOpen={setIsOpen}
                />

                {isSatellite ? (
                    <>
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" />
                    </>
                ) : (
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                        maxZoom={20}
                    />
                )}

                {shapes && shapes.length > 0 && shapes.map((shape, index) => (
                    <Polyline key={`shape-${index}`} positions={shape} pathOptions={{ color: routeColor ? (routeColor.startsWith('#') ? routeColor : '#' + routeColor) : '#0070f3', weight: 6, opacity: 0.9 }} />
                ))}

                {showStops && mapZoom < 15 && (
                    <div className="zoom-hint-pill" style={{ borderColor: 'rgba(255,0,51,0.3)' }}>
                        {t.zoomInToSeeStops || 'Zoom in to see stops'}
                    </div>
                )}

                {showStops && mapZoom >= 15 && visibleStops.map((stop) => (
                    <Marker
                        key={`stop-${stop.stop_id}`}
                        position={[stop.lat, stop.lon]}
                        icon={stopIcon}
                    >
                        <Popup minWidth={300} autoPan={false}>
                            <TimetablePopup stop={stop} routes={routes || []} onSelectRoute={onSelectRoute} favorites={favorites} onToggleFavorite={toggleFavorite} />
                        </Popup>
                    </Marker>
                ))}

                {/* Optimized Memoized Bus Markers */}
                {vehicles && vehicles.length > 0 && vehicles.map((v, i) => {
                    const vId = v.id || v.vehicle_id;
                    const vLat = v.lt || v.lat;
                    const vLon = v.ln || v.lon;
                    if (vLat === undefined || vLon === undefined) return null;

                    const rId = v.r || v.route_id;
                    // Dynamically map properties missing from lightweight Convex payload
                    const route = routes?.find(r => r.route_id === rId);

                    return (
                        <BusMarker
                            key={`bus-${vId || i}`}
                            id={vId}
                            lat={vLat}
                            lon={vLon}
                            bearing={v.b !== undefined ? v.b : v.bearing}
                            shortName={v.sn || v.route_short_name || (route ? route.short_name : '??')}
                            color={v.c || v.color || (route ? route.color : '0070f3')}
                            speed={v.s || v.speed}
                            headsign={v.h || v.headsign || (route ? route.long_name : 'Cyprus Bus')}
                            agency={v.ag || v.agency || (route ? route.agency_name : 'CPT')}
                            onVehicleClick={onVehicleClick}
                            rawVehicle={v}
                            mapZoom={mapZoom} // Pass zoom for scaling, but component is memoized
                        />
                    );
                })}

                {userLoc && (
                    <Marker position={userLoc} icon={userLocationIcon} zIndexOffset={1000}>
                        <Popup><div>You are here</div></Popup>
                    </Marker>
                )}

                {selectedPlan && (
                    <>
                        {/* START POINT */}
                        <Marker position={[selectedPlan.from.lat, selectedPlan.from.lon]} icon={planStartIcon} zIndexOffset={2000}>
                            <Popup className="plan-popup">
                                <div style={{ textAlign: 'center' }}>
                                    <strong style={{ color: '#39ff14' }}>START HERE</strong><br />
                                    {selectedPlan.from.name}<br />
                                    Ride: <b>{selectedPlan.type === 'transfer' ? selectedPlan.route1.short_name : selectedPlan.route.short_name}</b>
                                </div>
                            </Popup>
                        </Marker>

                        {/* TRANSFER HUB */}
                        {selectedPlan.type === 'transfer' && (
                            <Marker position={[selectedPlan.hub.lat, selectedPlan.hub.lon]} icon={planHubIcon} zIndexOffset={2000}>
                                <Popup className="plan-popup">
                                    <div style={{ textAlign: 'center' }}>
                                        <strong style={{ color: '#e056fd' }}>CHANGE BUS</strong><br />
                                        {selectedPlan.hub.name}<br />
                                        Wait for: <b>{selectedPlan.route2.short_name}</b>
                                    </div>
                                </Popup>
                            </Marker>
                        )}

                        {/* END POINT */}
                        <Marker position={[selectedPlan.to.lat, selectedPlan.to.lon]} icon={planEndIcon} zIndexOffset={2000}>
                            <Popup className="plan-popup">
                                <div style={{ textAlign: 'center' }}>
                                    <strong style={{ color: '#ff0033' }}>DESTINATION</strong><br />
                                    {selectedPlan.to.name}<br />
                                    Exit here.
                                </div>
                            </Popup>
                        </Marker>
                    </>
                )}
            </MapContainer>
        </div>
    );
}


