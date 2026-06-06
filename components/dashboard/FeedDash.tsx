import React, { useState } from 'react';
import { AppView, RunMode } from '../../types';
import { METERS_TO_MILES, METERS_TO_KM } from '../../constants';

interface FeedActivity {
  id: number;
  user: string;
  initials: string;
  avatarColor: string;
  time: string;
  device: string;
  location: string;
  title: string;
  type: 'Run' | 'Ride' | 'Hike' | 'Walk';
  distanceMi: number;
  elevationFt: number;
  durationLabel: string;
  kudos: number;
  comments: number;
  achievement?: string;
}

interface FeedDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  unit: 'imperial' | 'metric';
}

const MOCK_FEED: FeedActivity[] = [
  {
    id: 1,
    user: 'Ruby Lindquist',
    initials: 'RL',
    avatarColor: 'bg-orange-950/50 text-orange-400',
    time: 'May 29 · 3:58 PM',
    device: 'Garmin Edge 850',
    location: 'Truckee, CA',
    title: 'my bike > my money',
    type: 'Ride',
    distanceMi: 18.02,
    elevationFt: 2290,
    durationLabel: '2h 2m',
    kudos: 73,
    comments: 2,
    achievement: 'QOM — Climbing Beavers back door',
  },
  {
    id: 2,
    user: 'Phoebe Crosthwaite',
    initials: 'PC',
    avatarColor: 'bg-indigo-950/50 text-indigo-400',
    time: 'Today · 10:18 AM',
    device: 'Suunto Race 2',
    location: 'Tahoe National Forest, CA',
    title: "Wanted to maybe try to loop it but there's so much snow on the back side",
    type: 'Hike',
    distanceMi: 11.5,
    elevationFt: 2379,
    durationLabel: '2h 12m',
    kudos: 21,
    comments: 0,
  },
];

const ACTIVITY_TYPE_STYLES: Record<string, string> = {
  Run:  'bg-orange-950/50 text-orange-400 border border-orange-500/20',
  Ride: 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/20',
  Hike: 'bg-indigo-950/50 text-indigo-400 border border-indigo-500/20',
  Walk: 'bg-cyan-950/50 text-cyan-400 border border-cyan-500/20',
};

export const FeedDash: React.FC<FeedDashProps> = ({ onNavigate, unit }) => {
  const [feedTab, setFeedTab] = useState<'following' | 'everyone'>('following');
  const [kudosClicked, setKudosClicked] = useState<Set<number>>(new Set());

  const formatDistance = (mi: number) =>
    unit === 'imperial'
      ? `${mi.toFixed(2)} mi`
      : `${(mi * METERS_TO_MILES * METERS_TO_KM).toFixed(2)} km`;

  const handleKudos = (id: number) => {
    setKudosClicked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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

      {/* Activity Cards */}
      {MOCK_FEED.map(activity => (
        <div key={activity.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">

          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${activity.avatarColor}`}>
              {activity.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-white">{activity.user}</div>
              <div className="text-[10px] text-zinc-500">{activity.time} · {activity.device} · {activity.location}</div>
            </div>
            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${ACTIVITY_TYPE_STYLES[activity.type]}`}>
              {activity.type}
            </span>
          </div>

          {/* Title */}
          <div className="text-base font-black text-white mb-2 italic">{activity.title}</div>

          {/* Achievement */}
          {activity.achievement && (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-1.5 mb-3 w-fit">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              {activity.achievement}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { val: formatDistance(activity.distanceMi), lbl: 'Distance' },
              { val: `${activity.elevationFt.toLocaleString()} ft`,  lbl: 'Elev gain' },
              { val: activity.durationLabel, lbl: 'Time' },
            ].map(({ val, lbl }) => (
              <div key={lbl} className="bg-zinc-800/60 rounded-xl p-3 text-center">
                <div className="text-base font-black italic text-white">{val}</div>
                <div className="text-[10px] text-zinc-500 font-bold uppercase">{lbl}</div>
              </div>
            ))}
          </div>

          {/* Route preview */}
          <div className="bg-zinc-800/40 rounded-xl h-20 mb-3 overflow-hidden border border-zinc-700/30">
            <svg width="100%" height="80" viewBox="0 0 400 80" preserveAspectRatio="none">
              {activity.type === 'Ride' ? (
                <path d="M10 55 Q50 25 90 50 Q130 70 170 40 Q210 15 250 45 Q290 68 330 35 Q360 20 390 45"
                  fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round"/>
              ) : (
                <path d="M60 65 Q90 35 120 30 Q155 25 175 45 Q200 62 220 42 Q245 20 265 52 Q275 62 255 70 Q220 80 180 76 Q140 72 110 76 Q85 78 60 65Z"
                  fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
              )}
              <circle cx={activity.type === 'Ride' ? 10  : 60}  cy={activity.type === 'Ride' ? 55 : 65} r="4" fill="#22c55e"/>
              <circle cx={activity.type === 'Ride' ? 390 : 265} cy={activity.type === 'Ride' ? 45 : 52} r="4" fill="#3b82f6"/>
            </svg>
          </div>

          {/* Kudos row */}
          <div className="flex items-center gap-3 pt-3 border-t border-zinc-800">
            <button
              onClick={() => handleKudos(activity.id)}
              className={`flex items-center gap-1.5 text-[11px] font-black uppercase px-3 py-1.5 rounded-lg transition-all ${
                kudosClicked.has(activity.id) ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24"
                fill={kudosClicked.has(activity.id) ? 'currentColor' : 'none'}
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
            <span className="ml-auto text-[11px] text-zinc-500">
              {activity.kudos + (kudosClicked.has(activity.id) ? 1 : 0)} kudos
              {activity.comments > 0 ? ` · ${activity.comments} comments` : ''}
            </span>
          </div>
        </div>
      ))}

      {/* Empty state */}
      <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-2xl p-10 text-center">
        <div className="text-4xl mb-3">🏃</div>
        <div className="text-sm font-black text-white mb-1">Add your first activity</div>
        <div className="text-[11px] text-zinc-500 mb-4">Record a run or upload a workout to start your feed.</div>
        <button
          onClick={() => onNavigate(AppView.MODE_SELECTION)}
          className="px-6 py-2.5 bg-teal-500 text-zinc-950 font-black italic uppercase text-xs rounded-xl active:scale-95 transition-all hover:bg-teal-400"
        >
          Start a Run
        </button>
      </div>

    </div>
  );
};