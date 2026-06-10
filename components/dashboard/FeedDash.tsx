import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../../types';
import { fetchFeed, FeedItem } from '../../services/apiService';
import { RunMapPreview } from '../RunMapPreview';

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET  = 3.28084;

interface FeedDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  unit: 'imperial' | 'metric';
}

const MODE_LABELS: Record<string, string> = {
  running:  'Run',
  cycling:  'Ride',
  walking:  'Walk',
  hiking:   'Hike',
  interval: 'Interval',
  race:     'Race',
};

const MODE_STYLES: Record<string, string> = {
  Run:      'bg-orange-950/50 text-orange-400 border border-orange-500/20',
  Ride:     'bg-emerald-950/50 text-emerald-400 border border-emerald-500/20',
  Hike:     'bg-indigo-950/50 text-indigo-400 border border-indigo-500/20',
  Walk:     'bg-cyan-950/50 text-cyan-400 border border-cyan-500/20',
  Interval: 'bg-purple-950/50 text-purple-400 border border-purple-500/20',
  Race:     'bg-yellow-950/50 text-yellow-400 border border-yellow-500/20',
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
};

const formatDistance = (meters: number, unit: 'imperial' | 'metric'): string =>
  unit === 'imperial'
    ? `${(meters * METERS_TO_MILES).toFixed(2)} mi`
    : `${(meters / 1000).toFixed(2)} km`;

const formatElevation = (meters: number | null, unit: 'imperial' | 'metric'): string => {
  if (!meters) return '0 ft';
  return unit === 'imperial'
    ? `${Math.round(meters * METERS_TO_FEET).toLocaleString()} ft`
    : `${Math.round(meters).toLocaleString()} m`;
};

const formatTimeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getInitials = (first: string | null, last: string | null, email: string): string => {
  const f = first?.[0] ?? '';
  const l = last?.[0]  ?? '';
  return (f + l).toUpperCase() || email?.[0]?.toUpperCase() || '?';
};

const AVATAR_COLORS = [
  'bg-orange-950/50 text-orange-400',
  'bg-emerald-950/50 text-emerald-400',
  'bg-indigo-950/50 text-indigo-400',
  'bg-cyan-950/50 text-cyan-400',
  'bg-pink-950/50 text-pink-400',
  'bg-purple-950/50 text-purple-400',
];

const avatarColor = (authorId: number) => AVATAR_COLORS[authorId % AVATAR_COLORS.length];

// ---- Loading skeleton ----
const FeedSkeleton: React.FC = () => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4 animate-pulse">
    <div className="flex items-start gap-3 mb-4">
      <div className="w-9 h-9 rounded-full bg-zinc-800 flex-shrink-0" />
      <div className="flex-1">
        <div className="h-3 w-32 bg-zinc-800 rounded mb-2" />
        <div className="h-2 w-48 bg-zinc-800 rounded" />
      </div>
    </div>
    <div className="h-4 w-3/4 bg-zinc-800 rounded mb-4" />
    <div className="grid grid-cols-3 gap-2 mb-3">
      {[1,2,3].map(i => <div key={i} className="h-14 bg-zinc-800 rounded-xl" />)}
    </div>
    <div className="h-20 bg-zinc-800 rounded-xl" />
  </div>
);

export const FeedDash: React.FC<FeedDashProps> = ({ onNavigate, unit }) => {
  const [feedTab,     setFeedTab]     = useState<'following' | 'everyone'>('following');
  const [items,       setItems]       = useState<FeedItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [kudosClicked, setKudosClicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetchFeed(50, 0).then(data => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  const handleKudos = (id: number) => {
    setKudosClicked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const displayName = (item: FeedItem) =>
    [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unknown';

  const modeLabel = (mode: string) =>
    MODE_LABELS[mode.toLowerCase()] ?? mode.charAt(0).toUpperCase() + mode.slice(1);

  return (
    <div className="flex-1 min-w-0">

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['following', 'everyone'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFeedTab(tab)}
            className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              feedTab === tab
                ? 'bg-teal-500 text-zinc-950'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <>{[1,2].map(i => <FeedSkeleton key={i} />)}</>
      )}

      {/* Feed items */}
      {!loading && items.map(item => {
        const label = modeLabel(item.mode);
        const style = MODE_STYLES[label] ?? MODE_STYLES.Run;

        return (
          <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">

            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
              {item.profile_image_url ? (
                <img
                  src={item.profile_image_url}
                  alt={displayName(item)}
                  className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-zinc-700"
                />
              ) : (
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${avatarColor(item.author_id)}`}>
                  {getInitials(item.first_name, item.last_name, '')}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-white">{displayName(item)}</div>
                <div className="text-[10px] text-zinc-500">{formatTimeAgo(item.start_time)}</div>
              </div>
              <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${style}`}>
                {label}
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { val: formatDistance(item.distance_meters, unit), lbl: 'Distance' },
                { val: formatElevation(item.elevation_gain, unit), lbl: 'Elev gain' },
                { val: formatDuration(item.duration_seconds),      lbl: 'Time' },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="bg-zinc-800/60 rounded-xl p-3 text-center">
                  <div className="text-base font-black italic text-white">{val}</div>
                  <div className="text-[10px] text-zinc-500 font-bold uppercase">{lbl}</div>
                </div>
              ))}
            </div>

            {/* Route map preview */}
            <RunMapPreview
              routeJson={item.route_json}
              mode={label}
              height={180}
            />

            {/* Kudos row */}
            <div className="flex items-center gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => handleKudos(item.id)}
                className={`flex items-center gap-1.5 text-[11px] font-black uppercase px-3 py-1.5 rounded-lg transition-all ${
                  kudosClicked.has(item.id)
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24"
                  fill={kudosClicked.has(item.id) ? 'currentColor' : 'none'}
                  stroke="currentColor" strokeWidth="2">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                  <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                </svg>
                Kudo
              </button>
              <button className="flex items-center gap-1.5 text-[11px] font-black uppercase px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-all">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Comment
              </button>
            </div>
          </div>
        );
      })}

      {/* Empty state — no runs yet */}
      {!loading && items.length === 0 && (
        <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-3">🏃</div>
          <div className="text-sm font-black text-white mb-1">No activities yet</div>
          <div className="text-[11px] text-zinc-500 mb-4">
            Complete a run or follow friends to see their activities here.
          </div>
          <button
            onClick={() => onNavigate(AppView.MODE_SELECTION)}
            className="px-6 py-2.5 bg-teal-500 text-zinc-950 font-black italic uppercase text-xs rounded-xl active:scale-95 transition-all hover:bg-teal-400"
          >
            Start a Run
          </button>
        </div>
      )}

    </div>
  );
};