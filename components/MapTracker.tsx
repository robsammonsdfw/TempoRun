
import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import { GeoPoint } from '../types';

interface MapTrackerProps {
  route: GeoPoint[];
  currentLocation: GeoPoint | null;
  plannedRoute?: { lat: number; lng: number }[];
}

// Helper to center map
const RecenterMap: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
};

export const MapTracker: React.FC<MapTrackerProps> = ({ route, currentLocation, plannedRoute }) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return <div className="h-64 bg-slate-800 animate-pulse rounded-xl" />;

  const center: [number, number] = currentLocation 
    ? [currentLocation.lat, currentLocation.lng] 
    : [37.7749, -122.4194]; 

  const path = route.map(p => [p.lat, p.lng] as [number, number]);

  return (
    <div className="h-64 w-full rounded-xl overflow-hidden border border-slate-700 shadow-inner z-0 relative">
      <MapContainer 
        center={center} 
        zoom={16} 
        scrollWheelZoom={false} 
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        {/* Render Planned Route (Ghost Path) */}
        {plannedRoute && plannedRoute.length > 0 && (
          <Polyline 
            positions={plannedRoute} 
            pathOptions={{ color: '#64748b', weight: 6, dashArray: '10, 10', opacity: 0.5, lineCap: 'round' }} 
          />
        )}

        {/* Render Actual Run Path */}
        <Polyline 
          positions={path} 
          pathOptions={{ color: '#10b981', weight: 4, opacity: 0.9 }} 
        />
        
        {currentLocation && (
          <>
            <CircleMarker 
              center={[currentLocation.lat, currentLocation.lng]} 
              pathOptions={{ color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1 }} 
              radius={6} 
            />
            <RecenterMap center={[currentLocation.lat, currentLocation.lng]} />
          </>
        )}
      </MapContainer>
      <div className="absolute bottom-2 right-2 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400 rounded z-[400]">
        OpenStreetMap
      </div>
    </div>
  );
};
