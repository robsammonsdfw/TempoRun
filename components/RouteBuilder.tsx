
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { getDistanceFromLatLonInM, formatDuration, METERS_TO_MILES, METERS_TO_KM } from '../constants';
import { GeoPoint } from '../types';
import { fetchRouteSegment } from '../services/routingService';

interface LatLng {
  lat: number;
  lng: number;
}

// A segment connects two waypoints (anchors)
interface RouteSegment {
  path: LatLng[]; // The detailed geometry (could be straight or curved along roads)
  distance: number; // In meters
}

interface RouteBuilderProps {
  onClose: () => void;
  onSave: (distanceMeters: number, route: LatLng[]) => void;
  unit: 'imperial' | 'metric';
  initialCenter: GeoPoint | null;
}

// --- Icons ---
const IconUndo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>;
const IconRedo = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>;
const IconDraw = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.5 8.6L18 13l3.5-3.5L2 2z"/></svg>;
const IconMenu = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
const IconTrash = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const IconReverse = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l5 5"/><path d="M4 4l5 5"/></svg>;
const IconManual = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;

// --- Map Events Component ---
const RouteMapEvents = ({ 
  isDrawMode, 
  isLoading,
  onAddPoint 
}: { 
  isDrawMode: boolean; 
  isLoading: boolean;
  onAddPoint: (pt: LatLng) => void 
}) => {
  const map = useMap();
  const isDragging = useRef(false);
  const lastAdd = useRef<number>(0);

  useEffect(() => {
    if (isDrawMode && !isLoading) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [isDrawMode, isLoading, map]);

  useMapEvents({
    click(e) {
      if (!isDrawMode && !isLoading) {
        onAddPoint(e.latlng);
      }
    },
    mousedown() {
      if (isDrawMode && !isLoading) isDragging.current = true;
    },
    mouseup() {
      isDragging.current = false;
    },
    mousemove(e) {
      if (isDrawMode && isDragging.current && !isLoading) {
        // Throttle drawing
        const now = Date.now();
        if (now - lastAdd.current > 40) { 
           onAddPoint(e.latlng);
           lastAdd.current = now;
        }
      }
    }
  });

  return null;
};

export const RouteBuilder: React.FC<RouteBuilderProps> = ({ onClose, onSave, unit, initialCenter }) => {
  // We separate "Waypoints" (user clicks) from "Segments" (the paths between them)
  // Waypoints: [A, B, C]
  // Segments: [Segment(A->B), Segment(B->C)]
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  
  // History Stack
  const [history, setHistory] = useState<{w: LatLng[], s: RouteSegment[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false); 
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [center] = useState<[number, number]>(
    initialCenter ? [initialCenter.lat, initialCenter.lng] : [37.7749, -122.4194]
  );

  // Initialize history
  useEffect(() => {
    if (historyIndex === -1) {
      setHistory([{ w: [], s: [] }]);
      setHistoryIndex(0);
    }
  }, []);

  const addToHistory = (newWaypoints: LatLng[], newSegments: RouteSegment[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ w: newWaypoints, s: newSegments });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleAddPoint = async (pt: LatLng) => {
    if (isLoading) return;

    // 1. New Waypoint list
    const newWaypoints = [...waypoints, pt];
    let newSegments = [...segments];

    // 2. If this is not the first point, calculate segment from previous
    if (newWaypoints.length > 1) {
      const prevPt = newWaypoints[newWaypoints.length - 2];
      
      let segment: RouteSegment;
      
      // Smart Routing Condition: Not drawing, Not manual, Not too close (prevent tiny fetch spam)
      const dist = getDistanceFromLatLonInM(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
      
      if (!isDrawMode && !isManualMode && dist > 10) {
        setIsLoading(true);
        const routed = await fetchRouteSegment(prevPt, pt);
        setIsLoading(false);

        if (routed) {
          segment = routed;
        } else {
          // Fallback to straight line
          segment = { path: [prevPt, pt], distance: dist };
        }
      } else {
        // Manual or Draw Mode = Straight Line
        segment = { path: [prevPt, pt], distance: dist };
      }
      
      newSegments.push(segment);
    }

    setWaypoints(newWaypoints);
    setSegments(newSegments);
    addToHistory(newWaypoints, newSegments);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setWaypoints(prev.w);
      setSegments(prev.s);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setWaypoints(next.w);
      setSegments(next.s);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const handleDeleteAll = () => {
    const emptyW: LatLng[] = [];
    const emptyS: RouteSegment[] = [];
    setWaypoints(emptyW);
    setSegments(emptyS);
    addToHistory(emptyW, emptyS);
    setMenuOpen(false);
  };

  const handleReverse = () => {
    if (waypoints.length < 2) return;
    const revWaypoints = [...waypoints].reverse();
    const revSegments = [...segments].reverse().map(s => ({
       ...s,
       path: [...s.path].reverse()
    }));
    
    setWaypoints(revWaypoints);
    setSegments(revSegments);
    addToHistory(revWaypoints, revSegments);
    setMenuOpen(false);
  };

  // --- Stats Calculation ---
  const fullPath = useMemo(() => {
    // Flatten all segment paths
    return segments.flatMap(s => s.path);
  }, [segments]);

  const totalDistanceMeters = useMemo(() => {
    return segments.reduce((acc, s) => acc + s.distance, 0);
  }, [segments]);

  // Elevation Mocking (Updated to use full path for resolution)
  const { elevationGain, chartData } = useMemo(() => {
    if (fullPath.length < 2) return { elevationGain: 0, chartData: [] };

    let gain = 0;
    let currentElev = 100; // start
    let distSoFar = 0;
    const data = [];

    // Sample the full path to generate elevation data
    // We don't need every single point for the graph, maybe every 5th point for performance if large
    const step = Math.max(1, Math.floor(fullPath.length / 100));

    for (let i = 0; i < fullPath.length; i++) {
        if (i > 0) {
            const segDist = getDistanceFromLatLonInM(fullPath[i-1].lat, fullPath[i-1].lng, fullPath[i].lat, fullPath[i].lng);
            distSoFar += segDist;
            const change = (Math.random() - 0.45) * 5; // Sim variation
            if (change > 0) gain += change;
            currentElev += change;
        }
        
        if (i % step === 0 || i === fullPath.length - 1) {
            data.push({
                d: unit === 'imperial' ? distSoFar * METERS_TO_MILES : distSoFar * METERS_TO_KM,
                elev: Math.max(0, currentElev)
            });
        }
    }
    return { elevationGain: Math.round(gain), chartData: data };
  }, [fullPath, unit]);

  // Derived Stats
  const distVal = unit === 'imperial' ? totalDistanceMeters * METERS_TO_MILES : totalDistanceMeters * METERS_TO_KM;
  const unitLabel = unit === 'imperial' ? 'mi' : 'km';
  const estSpeedMph = 6.7; // Fixed for demo
  const totalSeconds = (totalDistanceMeters * METERS_TO_MILES * 9) * 60; // 9 min/mile basis

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col animate-fade-in">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-[1000] p-4 flex justify-between items-start pointer-events-none">
        <button onClick={onClose} className="pointer-events-auto w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-900 hover:bg-slate-100 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative bg-slate-800">
         <MapContainer center={center} zoom={15} style={{ width: '100%', height: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <RouteMapEvents isDrawMode={isDrawMode} isLoading={isLoading} onAddPoint={handleAddPoint} />
            
            {/* Draw the full calculated path */}
            {fullPath.length > 0 && (
                <Polyline positions={fullPath} pathOptions={{ color: '#ea580c', weight: 4, lineCap: 'round', lineJoin: 'round' }} />
            )}
            
            {/* Draw Waypoint Markers (Anchors) */}
            {waypoints.map((pt, idx) => (
               <CircleMarker 
                  key={idx} 
                  center={pt} 
                  radius={5} 
                  pathOptions={{ 
                     color: '#fff', 
                     fillColor: idx === 0 ? '#10b981' : idx === waypoints.length - 1 ? '#3b82f6' : '#64748b', 
                     fillOpacity: 1 
                  }} 
               />
            ))}
         </MapContainer>

         {/* Loading Indicator Overlay */}
         {isLoading && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1100] bg-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
               <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
               <span className="text-xs font-bold text-slate-700">Routing...</span>
            </div>
         )}

         {/* Tools - Bottom Center Floating */}
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 z-[1000] bg-white rounded-full p-2 shadow-xl border border-slate-100">
             <button onClick={() => setMenuOpen(!menuOpen)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-700 relative">
                 <IconMenu />
                 {menuOpen && (
                     <div className="absolute bottom-full mb-4 left-0 bg-white rounded-xl shadow-xl border border-slate-100 p-2 min-w-[180px] flex flex-col gap-1 text-left text-sm font-semibold text-slate-700">
                         <button onClick={handleReverse} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 rounded-lg"><IconReverse /> Reverse Route</button>
                         <button className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 rounded-lg"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> See tutorial</button>
                         <button onClick={() => setIsManualMode(!isManualMode)} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 rounded-lg">
                            <IconManual /> Manual Mode 
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${isManualMode ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>{isManualMode ? 'ON' : 'OFF'}</span>
                         </button>
                         <div className="h-px bg-slate-100 my-1"></div>
                         <button onClick={handleDeleteAll} className="flex items-center gap-3 px-3 py-2 hover:bg-red-50 text-red-500 rounded-lg"><IconTrash /> Delete all</button>
                     </div>
                 )}
             </button>
             <div className="w-px h-6 bg-slate-200 mx-1"></div>
             <button onClick={() => { setIsDrawMode(!isDrawMode); setIsManualMode(false); }} className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${isDrawMode ? 'bg-orange-500 text-white shadow-lg scale-110' : 'hover:bg-slate-50 text-slate-700'}`}>
                 <IconDraw />
             </button>
             <div className="w-px h-6 bg-slate-200 mx-1"></div>
             <button onClick={handleUndo} disabled={historyIndex <= 0} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-700 disabled:opacity-30">
                 <IconUndo />
             </button>
             <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50 text-slate-700 disabled:opacity-30">
                 <IconRedo />
             </button>
         </div>
      </div>

      {/* Bottom Sheet Stats */}
      <div className="bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.2)] z-[1000] pb-8">
         {/* Handle Bar */}
         <div className="w-full flex justify-center pt-3 pb-1">
             <div className="w-12 h-1.5 bg-slate-200 rounded-full"></div>
         </div>

         {/* Stats Row */}
         <div className="grid grid-cols-3 px-6 py-4 border-b border-slate-100">
             <div className="flex flex-col gap-1">
                 <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Distance</span>
                 <div className="flex items-baseline gap-1">
                     <span className="text-2xl font-black text-slate-900">{distVal.toFixed(2)}</span>
                     <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
                 </div>
             </div>
             <div className="flex flex-col gap-1">
                 <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Elevation</span>
                 <div className="flex items-baseline gap-1">
                     <span className="text-2xl font-black text-slate-900">{elevationGain}</span>
                     <span className="text-xs font-bold text-slate-500">ft</span>
                 </div>
             </div>
             <div className="flex flex-col gap-1">
                 <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Est. Time</span>
                 <div className="flex items-baseline gap-1">
                     <span className="text-2xl font-black text-slate-900">{formatDuration(totalSeconds)}</span>
                 </div>
                 <span className="text-[9px] text-orange-500 font-bold">@ {estSpeedMph.toFixed(1)} mph</span>
             </div>
         </div>

         {/* Elevation Graph Area */}
         <div className="h-24 w-full bg-slate-50 relative">
             <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={chartData}>
                     <Area type="monotone" dataKey="elev" stroke="#94a3b8" fill="#cbd5e1" strokeWidth={0} fillOpacity={0.5} />
                 </AreaChart>
             </ResponsiveContainer>
             {/* Overlay Paved/Unknown Bar */}
             <div className="absolute bottom-0 left-0 right-0 h-1.5 flex">
                 <div className="h-full bg-orange-500" style={{ width: '71%' }}></div>
                 <div className="h-full bg-slate-300" style={{ width: '29%' }}></div>
             </div>
         </div>

         {/* Legend for Surface */}
         <div className="flex gap-4 px-6 py-2 text-[10px] font-bold uppercase">
             <div className="flex items-center gap-1.5">
                 <div className="w-2.5 h-1 bg-orange-500 rounded-full"></div> 71% Paved
             </div>
             <div className="flex items-center gap-1.5">
                 <div className="w-2.5 h-1 bg-slate-300 rounded-full"></div> 29% Unknown
             </div>
         </div>

         {/* Save Button */}
         <div className="px-6 mt-2">
             <button onClick={() => onSave(totalDistanceMeters, fullPath)} className="w-full bg-orange-600 hover:bg-orange-700 text-white py-4 rounded-xl font-black uppercase tracking-wide text-lg shadow-xl shadow-orange-200 transition-all active:scale-95">
                 Save Route
             </button>
         </div>
      </div>
    </div>
  );
};
