import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../types';
import { Navbar } from './Navbar';
import { UserProfile, Goal, GoalSport, GoalType, GoalFrequency, fetchGoals, createGoal, deleteGoal } from '../services/apiService';

interface GoalsPageProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
}

const SPORT_OPTIONS: { value: GoalSport; label: string; icon: string }[] = [
  { value: 'run',  label: 'Running', icon: '🏃' },
  { value: 'ride', label: 'Cycling', icon: '🚴' },
  { value: 'walk', label: 'Walking', icon: '🚶' },
  { value: 'hike', label: 'Hiking',  icon: '⛰️' },
];

const TYPE_OPTIONS: { value: GoalType; label: string; description: string }[] = [
  { value: 'distance',  label: 'Distance',  description: 'Total miles or kilometers' },
  { value: 'time',      label: 'Time',      description: 'Total hours of activity' },
  { value: 'elevation', label: 'Elevation', description: 'Total feet or meters climbed' },
];

const FREQ_OPTIONS: { value: GoalFrequency; label: string }[] = [
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly' },
];

const SPORT_COLOR: Record<GoalSport, string> = {
  run:  'bg-orange-500',
  ride: 'bg-emerald-500',
  walk: 'bg-cyan-500',
  hike: 'bg-indigo-500',
};

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET  = 3.28084;

const formatValue = (meters: number, type: GoalType, unit: 'imperial' | 'metric'): string => {
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
  return unit === 'imperial'
    ? `${(meters * METERS_TO_MILES).toFixed(1)} mi`
    : `${(meters / 1000).toFixed(1)} km`;
};

// ---- Create Goal Modal ----

interface CreateModalProps {
  unit: 'imperial' | 'metric';
  onClose: () => void;
  onCreated: (goal: Goal) => void;
}

const CreateGoalModal: React.FC<CreateModalProps> = ({ unit, onClose, onCreated }) => {
  const [sport,     setSport]     = useState<GoalSport>('run');
  const [type,      setType]      = useState<GoalType>('distance');
  const [frequency, setFrequency] = useState<GoalFrequency>('weekly');
  const [targetRaw, setTargetRaw] = useState<string>('');
  const [title,     setTitle]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Placeholder for the target input based on type + unit
  const targetPlaceholder = () => {
    if (type === 'time')      return unit === 'imperial' ? 'e.g. 5 (hours)' : 'e.g. 5 (hours)';
    if (type === 'elevation') return unit === 'imperial' ? 'e.g. 5000 (ft)' : 'e.g. 1500 (m)';
    return unit === 'imperial' ? 'e.g. 20 (miles)' : 'e.g. 30 (km)';
  };

  const targetLabel = () => {
    if (type === 'time')      return 'Hours';
    if (type === 'elevation') return unit === 'imperial' ? 'Feet' : 'Meters';
    return unit === 'imperial' ? 'Miles' : 'Kilometers';
  };

  // Convert user-entered display value to meters (backend always stores meters)
  const toMeters = (raw: number): number => {
    if (type === 'time')      return raw * 3600;                      // hours → seconds
    if (type === 'elevation') return unit === 'imperial' ? raw / METERS_TO_FEET : raw;
    return unit === 'imperial' ? raw / METERS_TO_MILES : raw * 1000; // mi or km → meters
  };

  const handleSubmit = async () => {
    const parsed = parseFloat(targetRaw);
    if (isNaN(parsed) || parsed <= 0) {
      setError('Please enter a valid target value greater than 0.');
      return;
    }

    setSaving(true);
    setError(null);

    const today = new Date();
    const endDate = new Date(today);

    if (frequency === 'weekly') {
      endDate.setDate(today.getDate() + (7 * 52)); // ~1 year of rolling weeks
    } else if (frequency === 'monthly') {
      endDate.setFullYear(today.getFullYear() + 1);
    } else {
      endDate.setFullYear(today.getFullYear() + 1);
    }

    const created = await createGoal({
      title:        title.trim() || undefined,
      type,
      frequency,
      target_value: toMeters(parsed),
      sport_type:   sport,
      start_date:   today.toISOString().split('T')[0],
      end_date:     endDate.toISOString().split('T')[0],
      is_private:   true,
    });

    setSaving(false);

    if (!created) {
      setError('Failed to create goal. Please try again.');
      return;
    }

    onCreated(created);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl z-10">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-black text-white">Set a Goal</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Sport */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Activity</div>
            <div className="grid grid-cols-4 gap-2">
              {SPORT_OPTIONS.map(s => (
                <button
                  key={s.value}
                  onClick={() => setSport(s.value)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    sport === s.value
                      ? 'border-teal-500 bg-teal-900/20 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-[10px] font-black uppercase">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Goal Type</div>
            <div className="space-y-2">
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    type === t.value
                      ? 'border-teal-500 bg-teal-900/20'
                      : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div className="text-left">
                    <div className="text-sm font-black text-white">{t.label}</div>
                    <div className="text-[10px] text-zinc-500">{t.description}</div>
                  </div>
                  {type === t.value && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Frequency */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Frequency</div>
            <div className="grid grid-cols-3 gap-2">
              {FREQ_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  className={`py-2.5 rounded-xl text-[11px] font-black uppercase border transition-all ${
                    frequency === f.value
                      ? 'border-teal-500 bg-teal-900/20 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
              Target ({targetLabel()})
            </div>
            <input
              type="number"
              min="0"
              step="any"
              value={targetRaw}
              onChange={e => setTargetRaw(e.target.value)}
              placeholder={targetPlaceholder()}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm font-bold placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>

          {/* Optional title */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
              Label <span className="text-zinc-600 normal-case font-normal">(optional)</span>
            </div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Summer Base Building"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>

          {error && (
            <div className="text-xs font-bold text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 font-black uppercase text-xs rounded-xl hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 py-3 bg-teal-500 text-zinc-950 font-black uppercase text-xs rounded-xl hover:bg-teal-400 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <div className="w-3 h-3 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving...' : 'Set Goal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---- Main Goals Page ----

export const GoalsPage: React.FC<GoalsPageProps> = ({ onNavigate, profile, unit }) => {
  const [goals,       setGoals]       = useState<Goal[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);

  useEffect(() => {
    fetchGoals().then(data => {
      setGoals(data);
      setLoading(false);
    });
  }, []);

  const handleCreated = (goal: Goal) => {
    setGoals(prev => [goal, ...prev]);
    setShowCreate(false);
  };

  const handleDelete = async (goalId: string) => {
    setDeletingId(goalId);
    await deleteGoal(goalId);
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setDeletingId(null);
  };

  const groupedGoals = SPORT_OPTIONS.reduce((acc, sport) => {
    acc[sport.value] = goals.filter(g => g.sport_type === sport.value);
    return acc;
  }, {} as Record<GoalSport, Goal[]>);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar onNavigate={onNavigate} currentView={AppView.GOALS} profile={profile} />

      <div className="max-w-3xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-white">My Goals</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Set weekly, monthly, or yearly targets for each activity type.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 bg-orange-500 text-white font-black uppercase text-xs rounded-xl hover:bg-orange-400 active:scale-95 transition-all"
          >
            + Set a Goal
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-24 bg-zinc-900 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <div className="text-sm font-black text-white mb-1">No goals yet</div>
            <div className="text-[11px] text-zinc-500 mb-4">
              Set a goal to start tracking your weekly, monthly, or yearly progress.
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-2.5 bg-teal-500 text-zinc-950 font-black uppercase text-xs rounded-xl hover:bg-teal-400 active:scale-95 transition-all"
            >
              Set Your First Goal
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {SPORT_OPTIONS.map(sport => {
              const sportGoals = groupedGoals[sport.value];
              if (sportGoals.length === 0) return null;
              return (
                <div key={sport.value}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{sport.icon}</span>
                    <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">{sport.label}</span>
                  </div>
                  <div className="space-y-3">
                    {sportGoals.map(goal => {
                      const pct = goal.target_value > 0
                        ? Math.min(100, (goal.current_value / goal.target_value) * 100)
                        : 0;
                      const currentLabel = formatValue(goal.current_value, goal.type, unit);
                      const targetLabel  = formatValue(goal.target_value,  goal.type, unit);
                      const color = SPORT_COLOR[goal.sport_type];

                      return (
                        <div key={goal.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-white">
                                  {goal.title || `${sport.label} ${goal.type}`}
                                </span>
                                {goal.is_completed && (
                                  <span className="text-[9px] font-black text-teal-400 bg-teal-900/30 px-1.5 py-0.5 rounded-full">✓ Complete</span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-500 mt-0.5 capitalize">
                                {goal.frequency} · {goal.type}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDelete(goal.id)}
                              disabled={deletingId === goal.id}
                              className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors font-bold uppercase px-2 py-1"
                            >
                              {deletingId === goal.id ? '...' : 'Remove'}
                            </button>
                          </div>

                          {/* Progress */}
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-black text-white">{currentLabel}</span>
                            <span className="text-[10px] text-zinc-500">of {targetLabel}</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${goal.is_completed ? 'bg-teal-500' : color} rounded-full transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-zinc-600 mt-1 text-right">{pct.toFixed(0)}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateGoalModal
          unit={unit}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};