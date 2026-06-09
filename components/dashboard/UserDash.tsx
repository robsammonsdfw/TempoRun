import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../../types';
import { UserProfile, Goal, WeeklySummary, fetchGoals, fetchRunHistory, fetchWeeklySummary } from '../../services/apiService';

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET  = 3.28084;

interface UserDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// ---- Display helpers ----

const SPORT_META: Record<string, { icon: string; label: string; color: string }> = {
  run:  { icon: '🏃', label: 'Running', color: 'bg-orange-500' },
  ride: { icon: '🚴', label: 'Cycling', color: 'bg-emerald-500' },
  walk: { icon: '🚶', label: 'Walking', color: 'bg-cyan-500' },
  hike: { icon: '⛰️', label: 'Hiking',  color: 'bg-indigo-500' },
};

const formatGoalValue = (meters: number, type: string, unit: 'imperial' | 'metric'): string => {
  if (type === 'time') {
    const h = Math.floor(meters / 3600);
    const m = Math.floor((meters % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  if (type === 'elevation') {
    return unit === 'imperial'
      ? `${Math.round(meters * METERS_TO_FEET).toLocaleString()} ft`
      : `${Math.round(meters).toLocaleString()} m`;
  }
  // distance
  return unit === 'imperial'
    ? `${(meters * METERS_TO_MILES).toFixed(1)} mi`
    : `${(meters / 1000).toFixed(1)} km`;
};

const getWeekBounds = () => {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
};

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

// ---- Component ----

export const UserDash: React.FC<UserDashProps> = ({ onNavigate, profile, unit }) => {
  const [goals, setGoals]               = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading]  = useState(true);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null);

  const profileLoading = profile === null;

  useEffect(() => {
    // Fetch goals
    fetchGoals().then(data => {
      setGoals(data);
      setGoalsLoading(false);
    });

    // Fetch weekly summary from Fitbit/Google Fit widget data.
    // Falls back to run history if no widget data available.
    fetchWeeklySummary().then(summary => {
      if (summary) {
        setWeeklySummary(summary);
      } else {
        // Fallback: aggregate from run history
        fetchRunHistory().then((runs: any[]) => {
          if (!runs?.length) return;
          const { monday, sunday } = getWeekBounds();
          let totalDistance = 0;
          const dailySteps: { date: string; steps: number; hasActivity: boolean }[] = [];

          for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const hasRun = runs.some(r => {
              const rd = new Date(r.start_time);
              return rd >= monday && rd <= sunday &&
                (rd.getDay() === 0 ? 6 : rd.getDay() - 1) === i;
            });
            dailySteps.push({ date: d.toISOString().split('T')[0], steps: 0, hasActivity: hasRun });
          }

          runs.forEach(run => {
            const runDate = new Date(run.start_time);
            if (runDate >= monday && runDate <= sunday) {
              totalDistance += run.distance_meters ?? 0;
            }
          });

          setWeeklySummary({
            totalSteps: 0,
            totalDistanceMeters: totalDistance,
            totalActiveCalories: 0,
            totalActiveZoneMinutes: 0,
            avgRestingHR: null,
            dailySteps,
          });
        });
      }
    });
  }, []);

  const totalDistance = weeklySummary?.totalDistanceMeters ?? 0;

  const weekDistanceLabel = unit === 'imperial'
    ? `${(totalDistance * METERS_TO_MILES).toFixed(1)} mi`
    : `${(totalDistance / 1000).toFixed(1)} km`;

  const weekStepsLabel = weeklySummary?.totalSteps
    ? weeklySummary.totalSteps.toLocaleString() + ' steps'
    : null;

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-4">

      {/* Profile Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center">
        {profileLoading ? (
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
        {profileLoading ? (
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
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Goals</div>
          <button
            onClick={() => onNavigate(AppView.GOALS)}
            className="text-[10px] text-teal-500 font-bold hover:text-teal-400 transition-colors"
          >
            Manage
          </button>
        </div>

        {goalsLoading ? (
          <>{[1,2,3].map(i => (
            <div key={i} className="mb-3">
              <div className="h-3 w-full bg-zinc-800 rounded animate-pulse mb-1" />
              <div className="h-1 w-full bg-zinc-800 rounded animate-pulse" />
            </div>
          ))}</>
        ) : goals.length === 0 ? (
          <div className="text-center py-3">
            <div className="text-[11px] text-zinc-500 mb-2">No goals set yet</div>
            <button
              onClick={() => onNavigate(AppView.GOALS)}
              className="text-[10px] font-black uppercase text-teal-400 border border-teal-500/30 px-3 py-1.5 rounded-lg hover:bg-teal-900/20 transition-colors"
            >
              + Set a goal
            </button>
          </div>
        ) : (
          goals.map(goal => {
            const meta  = SPORT_META[goal.sport_type] ?? SPORT_META.run;
            const pct   = goal.target_value > 0
              ? Math.min(100, (goal.current_value / goal.target_value) * 100)
              : 0;
            const currentLabel = formatGoalValue(goal.current_value, goal.type, unit);
            const targetLabel  = formatGoalValue(goal.target_value,  goal.type, unit);

            return (
              <div key={goal.id} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{meta.icon}</span>
                    <span className="text-[11px] font-bold text-zinc-300">
                      {goal.title || meta.label}
                    </span>
                    {goal.is_completed && (
                      <span className="text-[9px] font-black text-teal-400 bg-teal-900/30 px-1.5 py-0.5 rounded-full">✓</span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {currentLabel}/{targetLabel}
                  </span>
                </div>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${goal.is_completed ? 'bg-teal-500' : meta.color} rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* This Week */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">This Week</div>
        <div className="text-2xl font-black italic text-white">{weekDistanceLabel}</div>
        {weekStepsLabel && (
          <div className="text-[10px] text-zinc-600 mb-1">{weekStepsLabel}</div>
        )}
        {weeklySummary?.totalActiveCalories ? (
          <div className="text-[10px] text-zinc-600 mb-3">
            {weeklySummary.totalActiveCalories.toLocaleString()} active cal
          </div>
        ) : (
          <div className="mb-3" />
        )}
        <div className="flex justify-between">
          {DAYS.map((d, i) => {
            const dayData = weeklySummary?.dailySteps?.[i];
            const hasActivity = dayData?.hasActivity ?? false;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="text-[9px] text-zinc-600 font-bold">{d}</div>
                <div className={`w-2 h-2 rounded-full ${
                  i === TODAY_INDEX && hasActivity ? 'bg-teal-500 ring-2 ring-teal-500/30'
                  : i === TODAY_INDEX              ? 'bg-zinc-600 ring-2 ring-zinc-600/30'
                  : hasActivity                   ? 'bg-teal-500'
                  : 'bg-zinc-800'
                }`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Go Run CTA */}
      <button
        onClick={() => onNavigate(AppView.MODE_SELECTION)}
        className="w-full py-3 bg-teal-500 text-zinc-950 font-black italic uppercase rounded-xl text-sm active:scale-95 transition-all hover:bg-teal-400 flex items-center justify-center gap-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Go Run
      </button>

    </div>
  );
};