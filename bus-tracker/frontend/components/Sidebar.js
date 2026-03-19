'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function Sidebar({ routes, stops, onSelectRoute, onSelectPlan, selectedRouteId, isOpen, setIsOpen, activeTab, setActiveTab, favorites, toggleFavorite }) {
    const [searchTerm, setSearchTerm] = useState('');
    const { language, setLanguage, t } = useLanguage();

    // Planner State
    const [originQuery, setOriginQuery] = useState('');
    const [originCoords, setOriginCoords] = useState(null);
    const [originSuggestions, setOriginSuggestions] = useState([]);

    const [destQuery, setDestQuery] = useState('');
    const [destCoords, setDestCoords] = useState(null);
    const [destSuggestions, setDestSuggestions] = useState([]);

    const [isSearchingOrigin, setIsSearchingOrigin] = useState(false);
    const [isSearchingDest, setIsSearchingDest] = useState(false);

    const [planResults, setPlanResults] = useState([]);
    const [isPlanning, setIsPlanning] = useState(false);

    // --- Autocomplete Logic ---
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (originQuery && originQuery.length > 2 && !originCoords) {
                setIsSearchingOrigin(true);

                // 1. Local Stops Search
                const localStops = (stops || [])
                    .filter(s => s.name.toLowerCase().includes(originQuery.toLowerCase()))
                    .slice(0, 3)
                    .map(s => ({
                        display_name: `${s.name}, Bus Stop`,
                        lat: s.lat,
                        lon: s.lon,
                        type: 'bus_stop',
                        isLocal: true
                    }));

                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(originQuery)}&countrycodes=cy&limit=5&addressdetails=1&accept-language=${language}`);
                    const data = await res.json();

                    // Combine results
                    setOriginSuggestions([...localStops, ...data]);
                } catch (err) {
                    console.error("Autocomplete fetch error", err);
                    setOriginSuggestions(localStops);
                } finally {
                    setIsSearchingOrigin(false);
                }
            } else {
                setOriginSuggestions([]);
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [originQuery, originCoords, language, stops]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (destQuery && destQuery.length > 2 && !destCoords) {
                setIsSearchingDest(true);

                // 1. Local Stops Search
                const localStops = (stops || [])
                    .filter(s => s.name.toLowerCase().includes(destQuery.toLowerCase()))
                    .slice(0, 3)
                    .map(s => ({
                        display_name: `${s.name}, Bus Stop`,
                        lat: s.lat,
                        lon: s.lon,
                        type: 'bus_stop',
                        isLocal: true
                    }));

                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destQuery)}&countrycodes=cy&limit=5&addressdetails=1&accept-language=${language}`);
                    const data = await res.json();
                    setDestSuggestions([...localStops, ...data]);
                } catch (err) {
                    console.error("Autocomplete fetch error", err);
                    setDestSuggestions(localStops);
                } finally {
                    setIsSearchingDest(false);
                }
            } else {
                setDestSuggestions([]);
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [destQuery, destCoords, language, stops]);

    const selectOrigin = (place) => {
        setOriginQuery(place.display_name);
        setOriginCoords({ lat: place.lat, lon: place.lon });
        setOriginSuggestions([]);
    };

    const selectDest = (place) => {
        setDestQuery(place.display_name);
        setDestCoords({ lat: place.lat, lon: place.lon });
        setDestSuggestions([]);
    };

    const handleUseMyLocation = () => {
        if (!navigator.geolocation) return alert("Geolocation not supported");

        setIsSearchingOrigin(true);
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            setOriginCoords({ lat: latitude, lon: longitude });

            try {
                // Reverse geocoding to get a readable name
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=${language}`);
                const data = await res.json();
                setOriginQuery(data.display_name.split(',').slice(0, 2).join(','));
            } catch (e) {
                setOriginQuery(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            } finally {
                setIsSearchingOrigin(false);
            }
        }, (err) => {
            setIsSearchingOrigin(false);
            alert("Location access denied");
        });
    };

    const filteredRoutes = routes.filter(route =>
        (route.short_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (route.long_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handlePlanRoute = async () => {
        if (!originCoords || !destCoords) {
            alert("Please select valid locations from the suggestions list.");
            return;
        }
        setIsPlanning(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://cyfinal.onrender.com';
            const planRes = await fetch(`${apiUrl}/api/plan-route?lat1=${originCoords.lat}&lon1=${originCoords.lon}&lat2=${destCoords.lat}&lon2=${destCoords.lon}`);
            const plans = await planRes.json();
            setPlanResults(plans);
        } catch (e) {
            console.error(e);
        }
        setIsPlanning(false);
    };

    return (
        <>
            <div className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
                <div className="sidebar-header">
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '10px' }}>
                        <h2 style={{ fontSize: '1.4rem', margin: 0, letterSpacing: '2px', fontWeight: '900' }}>CYPRUS BUS V2</h2>
                    </div>
                </div>

                <div className="sidebar-content-scrollable">
                    {activeTab === 'favorites' ? (
                        <div className="favorites-list">
                            {(!favorites || favorites.length === 0) ? (
                                <div className="empty-state">
                                    <div style={{ fontSize: '3rem', marginBottom: '10px' }}>❤️</div>
                                    <p>{t?.noFavsYet || "No favorite stops yet. Star a stop on the map to see it here!"}</p>
                                </div>
                            ) : (
                                favorites.map(stop => (
                                    <div key={stop.stop_id} className="plan-card fav-item" onClick={() => onSelectRoute(null)}>
                                        <div style={{ fontSize: '1.4rem' }}>🚏</div>
                                        <div style={{ flex: 1 }}>
                                            <div className="stop-name">{stop.name}</div>
                                            <div className="stop-id">ID: {stop.stop_id}</div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleFavorite(stop); }}
                                            className="fav-toggle-btn active"
                                        >
                                            ❤️
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : activeTab === 'planner' ? (
                        <div className="planner-container">
                            <div className="planner-form">
                                <div className="input-group">
                                    <input
                                        className={`planner-input ${isSearchingOrigin ? 'loading' : ''}`}
                                        style={{ paddingLeft: '45px' }}
                                        placeholder={t?.fromPlaceholder || "Departure..."}
                                        value={originQuery}
                                        onChange={e => { setOriginQuery(e.target.value); setOriginCoords(null); }}
                                    />
                                    <button
                                        className="geo-btn"
                                        onClick={handleUseMyLocation}
                                        title={t?.myLocation || "Use My Location"}
                                        type="button"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                    </button>
                                    {originSuggestions.length > 0 && (
                                        <ul className="suggestions-list">
                                            {originSuggestions.map((s, i) => (
                                                <li key={i} onClick={() => selectOrigin(s)} className="suggestion-item">
                                                    <span className="suggestion-icon">{s.type === 'bus_stop' ? '🚏' : '📍'}</span>
                                                    <div className="suggestion-text">
                                                        <div className="main-name">{s.display_name.split(',')[0]}</div>
                                                        <div className="sub-name">{s.display_name.split(',').slice(1, 3).join(',')}</div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div className="input-group">
                                    <input
                                        className={`planner-input ${isSearchingDest ? 'loading' : ''}`}
                                        placeholder={t?.toPlaceholder || "Destination..."}
                                        value={destQuery}
                                        onChange={e => { setDestQuery(e.target.value); setDestCoords(null); }}
                                    />
                                    {destSuggestions.length > 0 && (
                                        <ul className="suggestions-list">
                                            {destSuggestions.map((s, i) => (
                                                <li key={i} onClick={() => selectDest(s)} className="suggestion-item">
                                                    <span className="suggestion-icon">{s.type === 'bus_stop' ? '🚏' : '📍'}</span>
                                                    <div className="suggestion-text">
                                                        <div className="main-name">{s.display_name.split(',')[0]}</div>
                                                        <div className="sub-name">{s.display_name.split(',').slice(1, 3).join(',')}</div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <button className="plan-submit-btn" onClick={handlePlanRoute} disabled={!originCoords || !destCoords}>
                                    {isPlanning ? (t?.analyzing || 'Planning...') : (t?.findRoute || 'Find Routes')}
                                </button>
                            </div>

                            <div className="planner-results">
                                {planResults.map((plan, i) => (
                                    <div key={i} className="plan-card" onClick={() => onSelectPlan(plan)}>
                                        <div className="plan-header">
                                            {plan.type === 'transfer' ? (
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <span className="mini-badge">{plan.route1.short_name}</span>
                                                    <span>➜</span>
                                                    <span className="mini-badge">{plan.route2.short_name}</span>
                                                </div>
                                            ) : (
                                                <span className="mini-badge">{plan.route.short_name}</span>
                                            )}
                                        </div>
                                        <div className="plan-steps">
                                            {plan.type === 'transfer' ? (
                                                <p>Transfer at {plan.hub?.name || 'hub'}</p>
                                            ) : (
                                                <p>Take {plan.route.short_name} to {plan.to?.name || 'destination'}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : activeTab === 'routes' ? (
                        <div className="routes-container">
                            <div className="search-box">
                                <input
                                    type="text"
                                    placeholder={t?.searchPlaceholder || 'Search route...'}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="search-input"
                                />
                            </div>
                            <div className="list-items">
                                <button className={`route-item ${!selectedRouteId ? 'active' : ''}`} onClick={() => onSelectRoute(null)}>
                                    <div className="route-badge all">??</div>
                                    <div className="route-info"><strong>{t?.allRoutes || 'All Routes'}</strong></div>
                                </button>
                                {filteredRoutes.map(route => (
                                    <button
                                        key={route.route_id}
                                        className={`route-item ${selectedRouteId === route.route_id ? 'active' : ''}`}
                                        onClick={() => onSelectRoute(route)}
                                    >
                                        <div className="route-badge" style={{ backgroundColor: `#${route.color || '333'}`, color: `#${route.text_color || 'fff'}` }}>
                                            {route.short_name}
                                        </div>
                                        <div className="route-info">
                                            <div className="route-name">{route.long_name}</div>
                                            <div className="route-agency">{route.agency_name}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : activeTab === 'settings' ? (
                        <div className="settings-container">
                            <div className="setting-card">
                                <span className="icon">🌍</span>
                                <div className="text">
                                    <strong>Language / Язык</strong>
                                    <div className="lang-group">
                                        <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
                                        <button className={language === 'ru' ? 'active' : ''} onClick={() => setLanguage('ru')}>RU</button>
                                        <button className={language === 'el' ? 'active' : ''} onClick={() => setLanguage('el')}>EL</button>
                                    </div>
                                </div>
                            </div>
                            <div className="setting-card" onClick={() => { if (confirm("Refresh all data?")) window.location.reload(); }}>
                                <span className="icon">🔄</span>
                                <div className="text">
                                    <strong>Reboot System</strong>
                                    <p>Reload GTFS & Real-time data</p>
                                </div>
                            </div>
                            <div className="setting-card" onClick={() => window.open('https://t.me/daqxn', '_blank')}>
                                <span className="icon">🌐</span>
                                <div className="text">
                                    <strong>Join Community</strong>
                                    <p>Updates on Telegram @daqxn</p>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                {activeTab !== 'settings' && (
                  <div className="sidebar-footer">
                    <div className="language-selector">
                        {['en', 'el', 'ru'].map(l => (
                            <button key={l} className={`lang-btn ${language === l ? 'active' : ''}`} onClick={() => setLanguage(l)}>
                                {l.toUpperCase()}
                            </button>
                        ))}
                    </div>
                  </div>
                )}
                <style jsx>{`
                    .sidebar {
                        position: fixed;
                        top: auto;
                        bottom: 110px;
                        left: 50%;
                        transform: translateY(150%) translateX(-50%);
                        width: calc(100% - 30px);
                        max-width: 450px;
                        height: 65vh;
                        background: rgba(0, 8, 0, 0.95);
                        backdrop-filter: blur(40px) saturate(180%);
                        -webkit-backdrop-filter: blur(40px) saturate(180%);
                        border: 1px solid rgba(57, 255, 20, 0.2);
                        border-radius: 40px;
                        z-index: 5000;
                        box-shadow: 0 30px 60px rgba(0,0,0,0.9), 0 0 40px rgba(57, 255, 20, 0.1);
                        transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.4s ease;
                        display: flex;
                        flex-direction: column;
                        opacity: 0;
                        pointer-events: none;
                        overflow: hidden;
                    }
                    .sidebar.open {
                        transform: translateY(0) translateX(-50%);
                        opacity: 1;
                        pointer-events: auto;
                    }
                    .sidebar-header {
                        padding: 25px 30px 15px;
                        background: rgba(255, 255, 255, 0.02);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                        text-align: center;
                    }
                    .sidebar-content-scrollable {
                        flex: 1;
                        overflow-y: auto;
                        padding: 0 25px;
                        scrollbar-width: none;
                        display: flex;
                        flex-direction: column;
                    }
                    .sidebar-content-scrollable::-webkit-scrollbar { display: none; }

                    /* Routes Styling */
                    .routes-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
                    .search-box { position: sticky; top: 0; padding: 20px 0; background: rgba(0, 8, 0, 0.01); z-index: 10; }
                    .search-input {
                        width: 100%;
                        padding: 16px 22px;
                        background: rgba(255, 255, 255, 0.05);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 20px;
                        color: #fff;
                        font-weight: 900;
                        outline: none;
                        transition: 0.3s;
                    }
                    .search-input:focus { border-color: var(--nebula-accent); box-shadow: 0 0 20px rgba(57, 255, 20, 0.1); }
                    .list-items { flex: 1; padding-bottom: 20px; }
                    .route-item {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        width: 100%;
                        padding: 16px;
                        background: rgba(255,255,255,0.02);
                        border: 1px solid rgba(255,255,255,0.05);
                        border-radius: 20px;
                        margin-bottom: 12px;
                        cursor: pointer;
                        transition: 0.3s;
                    }
                    .route-item:hover { background: rgba(57, 255, 20, 0.05); border-color: var(--nebula-accent); }
                    .route-item.active { background: rgba(57, 255, 20, 0.1); border-color: var(--nebula-accent); color: var(--nebula-accent); }
                    .route-badge {
                        padding: 8px 12px;
                        border-radius: 12px;
                        font-weight: 900;
                        min-width: 55px;
                        text-align: center;
                        font-size: 0.8rem;
                    }
                    .route-badge.all { background: #333; color: #fff; }
                    .route-info { text-align: left; }
                    .route-name { font-size: 0.85rem; color: #fff; font-weight: 900; line-height: 1.2; }
                    .route-agency { font-size: 0.65rem; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

                    /* Favorites Styling */
                    .favorites-list { padding-top: 20px; padding-bottom: 20px; }
                    .empty-state { text-align: center; padding: 60px 20px; color: #666; font-size: 0.85rem; font-weight: 900; }
                    .fav-item { display: flex; align-items: center; gap: 15px; padding: 18px; }
                    .stop-name { font-size: 0.9rem; color: #fff; font-weight: 900; }
                    .stop-id { font-size: 0.7rem; color: #888; font-weight: 500; margin-top: 2px; }
                    .fav-toggle-btn { background: none; border: none; font-size: 1.3rem; cursor: pointer; transition: 0.2s; }
                    .fav-toggle-btn:hover { transform: scale(1.2); }

                    /* Planner Styling */
                    .planner-container { padding-top: 20px; }
                    .planner-form { display: flex; flex-direction: column; gap: 15px; margin-bottom: 25px; }
                    .input-group { position: relative; }
                    .planner-input {
                        width: 100%;
                        padding: 15px 20px;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 18px;
                        color: #fff;
                        font-weight: 900;
                        outline: none;
                    }
                    .planner-input:focus { border-color: var(--nebula-accent); }
                    .geo-btn { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--nebula-accent); cursor: pointer; }
                    .plan-submit-btn {
                        padding: 15px;
                        border-radius: 18px;
                        background: var(--nebula-accent);
                        color: #000;
                        font-weight: 900;
                        border: none;
                        cursor: pointer;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        transition: 0.3s;
                    }
                    .plan-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                    .plan-submit-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(57, 255, 20, 0.3); }

                    /* Suggestions */
                    .suggestions-list {
                        position: absolute; top: 100%; left: 0; right: 0; background: rgba(0, 15, 0, 0.98); 
                        border: 1px solid var(--glass-border); border-radius: 0 0 20px 20px; z-index: 1000;
                        max-height: 200px; overflow-y: auto; padding: 10px 0;
                    }
                    .suggestion-item { padding: 12px 20px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
                    .suggestion-item:hover { background: rgba(57, 255, 20, 0.1); }
                    .main-name { font-size: 0.8rem; color: #fff; font-weight: 900; }
                    .sub-name { font-size: 0.65rem; color: #888; }

                    /* Planner Result Cards */
                    .plan-card {
                        background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255,255,255,0.05);
                        border-radius: 20px; padding: 18px; margin-bottom: 12px; cursor: pointer; transition: 0.3s;
                    }
                    .plan-card:hover { border-color: var(--nebula-accent); background: rgba(57, 255, 20, 0.05); }
                    .mini-badge { padding: 4px 10px; border-radius: 8px; background: rgba(57, 255, 20, 0.2); color: var(--nebula-accent); font-size: 0.7rem; font-weight: 900; }
                    .plan-steps p { margin: 8px 0 0; font-size: 0.8rem; color: #aaa; font-weight: 700; line-height: 1.4; }

                    /* Footer & Tags */
                    .sidebar-footer { padding: 20px 30px 35px; border-top: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2); display: flex; flex-direction: column; align-items: center; gap: 15px; }
                    .language-selector { display: flex; gap: 10px; }
                    .lang-btn { background: none; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 12px; border-radius: 10px; font-size: 0.7rem; font-weight: 900; cursor: pointer; transition: 0.3s; }
                    .lang-btn.active { background: #fff; color: #000; border-color: #fff; }
                    .daan1k-tag { font-size: 0.75rem; color: #666; font-weight: 900; text-decoration: none; transition: 0.3s; letter-spacing: 1px; }
                    .daan1k-tag:hover { color: var(--nebula-accent); transform: scale(1.05); }

                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        </>
    );
}
