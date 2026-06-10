import React, { useMemo } from 'react';
import { RoutePoint } from '../services/apiService';

interface RunMapPreviewProps {
  routeJson: RoutePoint[] | string | null;
  mode: string;
  height?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const parseRoute = (raw: RoutePoint[] | string | null): RoutePoint[] => {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw;
};

// Project lat/lng to pixel coords within the SVG viewBox
const project = (
  points: RoutePoint[],
  w: number,
  h: number,
  pad: number = 12
): { x: number; y: number }[] => {
  if (points.length < 2) return [];

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  // Keep aspect ratio
  const scaleX = (w - pad * 2) / lngRange;
  const scaleY = (h - pad * 2) / latRange;
  const scale  = Math.min(scaleX, scaleY);

  const offsetX = (w - lngRange * scale) / 2;
  const offsetY = (h - latRange * scale) / 2;

  return points.map(p => ({
    x: offsetX + (p.lng - minLng) * scale,
    // lat increases upward, SVG y increases downward
    y: offsetY + (maxLat - p.lat) * scale,
  }));
};

// Build a tile URL for the map background (OpenStreetMap via Carto dark/light)
const getTileUrl = (
  points: RoutePoint[],
  zoom: number = 13
): { url: string; center: { lat: number; lng: number } } | null => {
  if (!points.length) return null;

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  // Tile x/y from lat/lng/zoom
  const n    = Math.pow(2, zoom);
  const tileX = Math.floor((centerLng + 180) / 360 * n);
  const latRad = centerLat * Math.PI / 180;
  const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  return {
    url: `https://a.basemaps.cartocdn.com/dark_all/${zoom}/${tileX}/${tileY}.png`,
    center: { lat: centerLat, lng: centerLng },
  };
};

// Route color by mode — matches Strava's orange palette
const ROUTE_COLOR: Record<string, string> = {
  Run:      '#fc4c02',
  Ride:     '#fc4c02',
  Trail:    '#fc4c02',
  Walk:     '#fc4c02',
  Hike:     '#fc4c02',
  Interval: '#fc4c02',
  Race:     '#fc4c02',
};

// ── Component ──────────────────────────────────────────────────────────────

export const RunMapPreview: React.FC<RunMapPreviewProps> = ({
  routeJson,
  mode,
  height = 180,
}) => {
  const W = 600;
  const H = height;

  const points = useMemo(() => parseRoute(routeJson), [routeJson]);
  const projected = useMemo(() => project(points, W, H), [points, W, H]);

  const polyline = useMemo(() => {
    if (projected.length < 2) return '';
    return projected.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }, [projected]);

  const color = ROUTE_COLOR[mode] ?? '#fc4c02';

  // No route data — show clean empty state
  if (!points.length || points.length < 2) {
    return (
      <div
        className="rounded-xl overflow-hidden bg-zinc-800/40 border border-zinc-700/30 flex items-center justify-center mb-3"
        style={{ height }}
      >
        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">No GPS data</span>
      </div>
    );
  }

  const tileInfo = getTileUrl(points);

  return (
    <div
      className="rounded-xl overflow-hidden relative mb-3 border border-zinc-700/20"
      style={{ height }}
    >
      {/* Map tile background */}
      {tileInfo && (
        <img
          src={tileInfo.url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ imageRendering: 'pixelated' }}
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Dark overlay to make route pop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* SVG route overlay */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }}
      >
        {/* Route shadow for depth */}
        <path
          d={polyline}
          fill="none"
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Route line */}
        <path
          d={polyline}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Start dot */}
        {projected.length > 0 && (
          <circle
            cx={projected[0].x}
            cy={projected[0].y}
            r="5"
            fill="#22c55e"
            stroke="white"
            strokeWidth="1.5"
          />
        )}
        {/* End dot */}
        {projected.length > 1 && (
          <circle
            cx={projected[projected.length - 1].x}
            cy={projected[projected.length - 1].y}
            r="5"
            fill="#3b82f6"
            stroke="white"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  );
};