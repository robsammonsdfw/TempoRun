import React from 'react';
import { AppView, RunMode } from '../../types';
import { UserProfile } from '../../services/apiService';

interface UserDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
}

interface GoalItem {
  id: string;
  label: string;
  icon: string;
  color: string;
  current: number;
  target: number;
  unit: string;
}

const GOALS: GoalItem[] = [
  { id: 'hr',   label: 'Heart Rate', icon: '❤️', color: 'bg-red-500',     current: 0, target: 3,     unit: 'sessions' },
  { id: 'run',  label: 'Running',    icon: '🏃', color: 'bg-orange-500',  current: 0, target: 15,    unit: 'mi' },
  { id: 'bike', label: 'Cycling',    icon: '🚴', color: 'bg-emerald-500', current: 0, target: 50,    unit: 'mi' },
  { id: 'walk', label: 'Walking',    icon: '🚶', color: 'bg-cyan-500',    current: 0, target: 20000, unit: 'steps' },
];

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

const getInitials = (p: UserProfile | null): string => {
  if (!p) return '?';
  const f = p.first_name?.[0] ?? '';
  const l = p.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || p.email?.[0]?.toUpperCase() || '?';
};

const getDisplayName = (p: UserProfile | null): string => {
  if (!p) return '';
  if (p.first_name || p.last_name) return [p.first_name, p.last_name].filter(Boolean).join(' ');
  return p.email ?? '';
};

const getHandle = (p: UserProfile | null): string => {
  if (!p) return '';
  const base = p.first_name
    ? (p.first_name + (p.last_name ?? '')).toLowerCase().replace(/\s+/g, '')
    : p.email?.split('@')[0] ?? '';
  return '@' + base;
};

export const UserDash: React.FC<UserDashProps> = ({ onNavigate, profile, unit }) => {
  const loading = profile === null;

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-4">

      {/* Profile Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center">
        {loading ? (
          <div className="w-14 h-14 rounded-full bg-zinc-800 animate-pulse mb-2" />
        ) : profile?.profile_image_url ? (
          <img
            src={profile.profile_image_url}
            alt="Profile"
            className="w-14 h-14 rounded-full object-cover mb-2 border-2 border-zinc-700"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-teal-500 to-orange-500 flex items-center justify-center text-lg font-black text-white mb-2">
            {getInitials(profile)}
          </div>
        )}
        {loading ? (
          <>
            <div className="h-4 w-28 bg-zinc-800 rounded animate-pulse mb-1" />
            <div className="h-3 w-20 bg-zinc-800 rounded animate-pulse mb-3" />
          </>
        ) : (
          <>
            <div className="text-sm font-black text-white">{getDisplayName(profile)}</div>
            <div className="text-[11px] text-zinc-500 mb-3">{getHandle(profile)}</div>
          </>
        )}
        <div className="flex w-full justify-around border-t border-zinc-800 pt-3">
          {[['—', 'Following'], ['—', 'Followers'], ['—', 'Activities']].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <div className="text-sm font-black text-white">{val}</div>
              <div className="text-[10px] text-zinc-500 uppercase">{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Goals */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Goals</div>
        {GOALS.map(goal => (
          <div key={goal.id} className="mb-3 last:mb-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{goal.icon}</span>
                <span className="text-[11px] font-bold text-zinc-300">{goal.label}</span>
              </div>
              <span className="text-[10px] text-zinc-500">{goal.current}/{goal.target} {goal.unit}</span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${goal.color} rounded-full transition-all`}
                style={{ width: `${Math.min(100, (goal.current / goal.target) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* This Week */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">This Week</div>
        <div className="text-2xl font-black italic text-white">0 {unit === 'imperial' ? 'mi' : 'km'}</div>
        <div className="text-[10px] text-zinc-600 mb-3">0 ft elevation</div>
        <div className="flex justify-between">
          {DAYS.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="text-[9px] text-zinc-600 font-bold">{d}</div>
              <div className={`w-2 h-2 rounded-full ${i === TODAY_INDEX ? 'bg-teal-500 ring-2 ring-teal-500/30' : 'bg-zinc-800'}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Go Run CTA */}
      <button
        onClick={() => onNavigate(AppView.MODE_SELECTION)}
        className="w-full py-3 bg-teal-500 text-zinc-950 font-black italic uppercase rounded-xl text-sm active:scale-95 transition-all hover:bg-teal-400 flex items-center justify-center gap-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Go Run
      </button>

    </div>
  );
};