import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import { AppView, RunMode, GeoPoint } from '../types';
import { Navbar } from './Navbar';
import { RouteBuilder } from './RouteBuilder';
import {
  UserProfile,
  Segment, SegmentEffort,
  Route, RouteDetail,
  fetchSegmentsInBBox,
  fetchSegmentLeaderboard,
  fetchRoutes,
  fetchRouteById,
  starRoute,
  unstarRoute,
} from '../services/apiService';
import { METERS_TO_MILES, METERS_TO_FEET, formatDuration } from '../constants';

// ── Types ────────────────────────────────────────────────────

type MapTab = 'segments' | 'routes' | 'heatmaps';

interface MapsPageProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
  initialCenter: GeoPoint | null;
  onRouteSave: (distanceMeters: number, route: { lat: number; lng: number }[]) => void;
}

// ── Helpers ───────────────────────────────────────────────────

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatDist = (meters: number, unit: 'imperial' | 'metric'): string =>
  unit === 'imperial'
    ? `${(meters * METERS_TO_MILES).toFixed(2)} mi`
    : `${(meters / 1000).toFixed(2)} km`;

const getInitials = (first: string | null, last: string | null): string =>
  ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';

const AVATAR_COLORS = [
  'bg-orange-950/50 text-orange-400',
  'bg-teal-950/50 text-teal-400',
  'bg-indigo-950/50 text-indigo-400',
  'bg-emerald-950/50 text-emerald-400',
  'bg-pink-950/50 text-pink-400',
];

// ── Segment map event listener ────────────────────────────────

const SegmentMapEvents = ({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
}) => {
  const map = useMap();

  const emitBounds = useCallback(() => {
    const b = map.getBounds();
    onBoundsChange({
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLng: b.getWest(),
      maxLng: b.getEast(),
    });
  }, [map, onBoundsChange]);

  useMapEvents({
    moveend: emitBounds,
    zoomend: emitBounds,
  });

  // Emit on first mount
  useEffect(() => { emitBounds(); }, []);

  return null;
};

// ── Route preview map helper ──────────────────────────────────

const FitRoute = ({ path }: { path: { lat: number; lng: number }[] }) => {
  const map = useMap();
  useEffect(() => {
    if (path.length > 1) {
      map.fitBounds(path.map(p => [p.lat, p.lng] as [number, number]), { padding: [30, 30] });
    }
  }, [path]);
  return null;
};

// ── Segment Leaderboard Slide-Up Panel ───────────────────────

const SegmentPanel: React.FC<{
  segment: Segment;
  efforts: SegmentEffort[];
  loading: boolean;
  unit: 'imperial' | 'metric';
  onClose: () => void;
}> = ({ segment, efforts, loading, unit, onClose }) => (
  <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-zinc-900 border-t border-zinc-700 rounded-t-2xl shadow-2xl animate-slide-up max-h-[60vh] flex flex-col">
    {/* Handle */}
    <div className="flex justify-center pt-3 pb-1">
      <div className="w-10 h-1 rounded-full bg-zinc-700" />
    </div>

    {/* Header */}
    <div className="flex items-start justify-between px-5 py-3 border-b border-zinc-800">
      <div>
        <div className="text-base font-black text-white">{segment.name}</div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">{segment.sport_type}</span>
          <span className="text-[10px] text-zinc-500">{formatDist(segment.distance_meters, unit)}</span>
          {segment.elevation_gain > 0 && (
            <span className="text-[10px] text-zinc-500">
              +{unit === 'imperial' ? Math.round(segment.elevation_gain * METERS_TO_FEET) : Math.round(segment.elevation_gain)}
              {unit === 'imperial' ? 'ft' : 'm'}
            </span>
          )}
        </div>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    {/* KOM / QOM row */}
    <div className="grid grid-cols-2 gap-3 px-5 py-3 border-b border-zinc-800">
      <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3 text-center">
        <div className="text-[9px] font-black text-yellow-500 uppercase mb-1">KOM</div>
        <div className="text-lg font-black text-white">
          {segment.kom_time_seconds ? formatTime(segment.kom_time_seconds) : '—'}
        </div>
      </div>
      <div className="bg-pink-900/20 border border-pink-500/20 rounded-xl p-3 text-center">
        <div className="text-[9px] font-black text-pink-400 uppercase mb-1">QOM</div>
        <div className="text-lg font-black text-white">
          {segment.qom_time_seconds ? formatTime(segment.qom_time_seconds) : '—'}
        </div>
      </div>
    </div>

    {/* Leaderboard */}
    <div className="flex-1 overflow-y-auto px-5 py-3">
      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">
        Leaderboard · {segment.athlete_count} athletes
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-12 bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : efforts.length === 0 ? (
        <div className="text-center py-8 text-zinc-600 text-sm">No efforts recorded yet. Be the first!</div>
      ) : (
        <div className="space-y-2">
          {efforts.map((effort, idx) => (
            <div key={effort.id} className={`flex items-center gap-3 p-3 rounded-xl ${idx === 0 ? 'bg-yellow-900/20 border border-yellow-500/20' : 'bg-zinc-800/50'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${
                idx === 0 ? 'bg-yellow-500 text-zinc-900' :
                idx === 1 ? 'bg-zinc-400 text-zinc-900' :
                idx === 2 ? 'bg-orange-700 text-white' :
                'bg-zinc-700 text-zinc-400'
              }`}>
                {idx + 1}
              </div>
              {effort.profile_image_url ? (
                <img src={effort.profile_image_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${AVATAR_COLORS[effort.user_id % AVATAR_COLORS.length]}`}>
                  {getInitials(effort.first_name, effort.last_name)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-white truncate">
                  {[effort.first_name, effort.last_name].filter(Boolean).join(' ') || 'Athlete'}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {new Date(effort.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-base font-black text-white">{formatTime(effort.elapsed_seconds)}</div>
                {effort.is_pr && (
                  <div className="text-[9px] font-black text-teal-400 uppercase">PR</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

// ── Segments Tab ─────────────────────────────────────────────

const SegmentsTab: React.FC<{
  unit: 'imperial' | 'metric';
  initialCenter: GeoPoint | null;
}> = ({ unit, initialCenter }) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [efforts, setEfforts] = useState<SegmentEffort[]>([]);
  const [effortsLoading, setEffortsLoading] = useState(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const center: [number, number] = initialCenter
    ? [initialCenter.lat, initialCenter.lng]
    : [40.6170, -111.7519]; // Salt Lake City default

  const handleBoundsChange = useCallback((bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => {
    // Debounce so we don't hammer the API on every pixel of pan
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      const results = await fetchSegmentsInBBox(
        bounds.minLat, bounds.maxLat,
        bounds.minLng, bounds.maxLng
      );
      setSegments(results);
    }, 400);
  }, []);

  const handleSegmentClick = async (seg: Segment) => {
    setSelectedSegment(seg);
    setEfforts([]);
    setEffortsLoading(true);
    const lb = await fetchSegmentLeaderboard(seg.id);
    setEfforts(lb);
    setEffortsLoading(false);
  };

  return (
    <div className="relative flex-1">
      <MapContainer
        center={center}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <SegmentMapEvents onBoundsChange={handleBoundsChange} />

        {segments.map(seg => (
          <React.Fragment key={seg.id}>
            {/* Clickable segment line */}
            <Polyline
              positions={[[seg.start_lat, seg.start_lng], [seg.end_lat, seg.end_lng]]}
              pathOptions={{
                color: selectedSegment?.id === seg.id ? '#14b8a6' : '#ea580c',
                weight: selectedSegment?.id === seg.id ? 5 : 3,
                opacity: 0.9,
              }}
              eventHandlers={{ click: () => handleSegmentClick(seg) }}
            />
            {/* Start marker */}
            <CircleMarker
              center={[seg.start_lat, seg.start_lng]}
              radius={5}
              pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
              eventHandlers={{ click: () => handleSegmentClick(seg) }}
            />
            {/* End marker */}
            <CircleMarker
              center={[seg.end_lat, seg.end_lng]}
              radius={5}
              pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
              eventHandlers={{ click: () => handleSegmentClick(seg) }}
            />
          </React.Fragment>
        ))}
      </MapContainer>

      {/* Segment count badge */}
      {segments.length > 0 && !selectedSegment && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] bg-zinc-900/90 border border-zinc-700 rounded-full px-4 py-1.5 text-[11px] font-bold text-zinc-300">
          {segments.length} segment{segments.length !== 1 ? 's' : ''} in view — tap to explore
        </div>
      )}

      {/* Slide-up leaderboard panel */}
      {selectedSegment && (
        <SegmentPanel
          segment={selectedSegment}
          efforts={efforts}
          loading={effortsLoading}
          unit={unit}
          onClose={() => setSelectedSegment(null)}
        />
      )}
    </div>
  );
};

// ── Routes Tab ───────────────────────────────────────────────

const RoutesTab: React.FC<{
  unit: 'imperial' | 'metric';
  initialCenter: GeoPoint | null;
  onRouteSave: (distanceMeters: number, route: { lat: number; lng: number }[]) => void;
  onNavigate: (view: AppView, mode?: RunMode) => void;
}> = ({ unit, initialCenter, onRouteSave, onNavigate }) => {
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const center: [number, number] = initialCenter
    ? [initialCenter.lat, initialCenter.lng]
    : [40.6170, -111.7519];

  useEffect(() => {
    fetchRoutes().then(data => {
      setRoutes(data);
      setLoading(false);
    });
  }, []);

  const handleRouteClick = async (route: Route) => {
    if (selectedRoute?.id === route.id) { setSelectedRoute(null); return; }
    setPreviewLoading(true);
    const detail = await fetchRouteById(route.id);
    setSelectedRoute(detail);
    setPreviewLoading(false);
  };

  const handleStar = async (e: React.MouseEvent, route: Route) => {
    e.stopPropagation();
    if (route.is_starred) {
      await unstarRoute(route.id);
    } else {
      await starRoute(route.id);
    }
    setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, is_starred: !r.is_starred } : r));
  };

  const handleLoadForRun = () => {
    if (!selectedRoute?.path_json?.length) return;
    const totalDist = selectedRoute.distance_meters;
    onRouteSave(totalDist, selectedRoute.path_json);
    onNavigate(AppView.SETUP);
  };

  if (mode === 'create') {
    return (
      <RouteBuilder
        onClose={() => setMode('list')}
        onSave={(dist, path) => { onRouteSave(dist, path); setMode('list'); }}
        unit={unit}
        initialCenter={initialCenter}
      />
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Route list sidebar */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800 overflow-y-auto">
        <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">My Routes</div>
          <button
            onClick={() => setMode('create')}
            className="text-[10px] font-black uppercase text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Route
          </button>
        </div>

        {loading ? (
          <div className="p-4 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-zinc-800 rounded-xl animate-pulse" />)}
          </div>
        ) : routes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="text-3xl mb-3">🗺️</div>
            <div className="text-sm font-black text-white mb-1">No routes yet</div>
            <div className="text-[11px] text-zinc-500 mb-4">Create your first route to see it here.</div>
            <button
              onClick={() => setMode('create')}
              className="px-4 py-2 bg-teal-500 text-zinc-950 font-black uppercase text-[10px] rounded-xl hover:bg-teal-400 transition-colors"
            >
              Create Route
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {routes.map(route => (
              <div
                key={route.id}
                onClick={() => handleRouteClick(route)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  selectedRoute?.id === route.id
                    ? 'bg-teal-900/20 border-teal-500/40'
                    : 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black text-white truncate">
                      {route.name || `Route ${new Date(route.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-500">{formatDist(route.distance_meters, unit)}</span>
                      {route.elevation_gain > 0 && (
                        <span className="text-[10px] text-zinc-500">
                          +{unit === 'imperial'
                            ? Math.round(route.elevation_gain * METERS_TO_FEET) + ' ft'
                            : Math.round(route.elevation_gain) + ' m'}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={e => handleStar(e, route)}
                    className={`flex-shrink-0 transition-colors ${route.is_starred ? 'text-yellow-400' : 'text-zinc-600 hover:text-zinc-400'}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={route.is_starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                </div>
                {route.run_count > 0 && (
                  <div className="text-[9px] text-zinc-600 mt-1">Run {route.run_count} time{route.run_count !== 1 ? 's' : ''}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Load for run button */}
        {selectedRoute && (
          <div className="p-3 border-t border-zinc-800 mt-auto">
            <button
              onClick={handleLoadForRun}
              className="w-full py-3 bg-teal-500 text-zinc-950 font-black uppercase text-xs rounded-xl hover:bg-teal-400 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Run This Route
            </button>
          </div>
        )}
      </div>

      {/* Map preview */}
      <div className="flex-1 relative">
        {previewLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60">
            <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <MapContainer
          center={center}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {selectedRoute?.path_json && selectedRoute.path_json.length > 1 && (
            <>
              <Polyline
                positions={selectedRoute.path_json.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: '#ea580c', weight: 4, lineCap: 'round' }}
              />
              <CircleMarker
                center={[selectedRoute.path_json[0].lat, selectedRoute.path_json[0].lng]}
                radius={6}
                pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
              />
              <CircleMarker
                center={[
                  selectedRoute.path_json[selectedRoute.path_json.length - 1].lat,
                  selectedRoute.path_json[selectedRoute.path_json.length - 1].lng,
                ]}
                radius={6}
                pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
              />
              <FitRoute path={selectedRoute.path_json} />
            </>
          )}
          {!selectedRoute && (
            <div className="absolute inset-0 flex items-center justify-center z-[500] pointer-events-none">
              <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl px-4 py-3 text-[11px] font-bold text-zinc-400">
                Select a route to preview it on the map
              </div>
            </div>
          )}
        </MapContainer>

        {/* Route detail overlay */}
        {selectedRoute && (
          <div className="absolute bottom-4 left-4 right-4 z-[500] bg-zinc-900/95 border border-zinc-700 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-black text-white">
                  {selectedRoute.name || 'Unnamed Route'}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-zinc-400">{formatDist(selectedRoute.distance_meters, unit)}</span>
                  {selectedRoute.elevation_gain > 0 && (
                    <span className="text-[10px] text-zinc-400">
                      +{unit === 'imperial'
                        ? Math.round(selectedRoute.elevation_gain * METERS_TO_FEET) + ' ft elev'
                        : Math.round(selectedRoute.elevation_gain) + ' m elev'}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-600 capitalize">{selectedRoute.surface_type}</span>
                </div>
              </div>
              <button
                onClick={handleLoadForRun}
                className="px-4 py-2 bg-teal-500 text-zinc-950 font-black uppercase text-[10px] rounded-xl hover:bg-teal-400 active:scale-95 transition-all flex items-center gap-1.5"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run It
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Heatmaps Tab ─────────────────────────────────────────────

const HeatmapsTab: React.FC<{ initialCenter: GeoPoint | null }> = ({ initialCenter }) => {
  const center: [number, number] = initialCenter
    ? [initialCenter.lat, initialCenter.lng]
    : [40.6170, -111.7519];

  return (
    <div className="relative flex-1">
      <MapContainer
        center={center}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      </MapContainer>
      <div className="absolute inset-0 z-[500] flex items-center justify-center pointer-events-none">
        <div className="bg-zinc-900/95 border border-zinc-700 rounded-2xl p-8 text-center max-w-xs">
          <div className="text-3xl mb-3">🔥</div>
          <div className="text-sm font-black text-white mb-1">Heatmaps Coming Soon</div>
          <div className="text-[11px] text-zinc-500">
            Heatmaps require aggregating GPS data across all users. This feature will be available once activity data scales up.
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main MapsPage ─────────────────────────────────────────────

export const MapsPage: React.FC<MapsPageProps> = ({
  onNavigate,
  profile,
  unit,
  initialCenter,
  onRouteSave,
}) => {
  const [activeTab, setActiveTab] = useState<MapTab>('segments');

  const TABS: { id: MapTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'segments',
      label: 'Segments',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/></svg>,
    },
    {
      id: 'routes',
      label: 'Routes',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l4-8 4 4 4-6 4 4"/></svg>,
    },
    {
      id: 'heatmaps',
      label: 'Heatmaps',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
    },
  ];

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white font-sans">
      <Navbar
        onNavigate={onNavigate}
        currentView={AppView.MAPS}
        profile={profile}
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id
                ? 'bg-teal-500 text-zinc-950'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — fills remaining height */}
      <div className="flex flex-1 overflow-hidden relative">
        {activeTab === 'segments' && (
          <SegmentsTab unit={unit} initialCenter={initialCenter} />
        )}
        {activeTab === 'routes' && (
          <RoutesTab
            unit={unit}
            initialCenter={initialCenter}
            onRouteSave={onRouteSave}
            onNavigate={onNavigate}
          />
        )}
        {activeTab === 'heatmaps' && (
          <HeatmapsTab initialCenter={initialCenter} />
        )}
      </div>
    </div>
  );
};