import React, { useState, useEffect, useCallback } from 'react';
import { AppView, RunMode } from '../types';
import { Navbar } from './Navbar';
import {
  UserProfile, Challenge,
  fetchChallenges, joinChallenge, leaveChallenge,
  submitManualProgress,
  fetchChallengeLeaderboard, ChallengeLeaderboardEntry,
} from '../services/apiService';

// ── Constants ─────────────────────────────────────────────────

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET  = 3.28084;

const SPORT_ICONS: Record<string, string> = {
  run: '🏃', ride: '🚴', walk: '🚶', hike: '⛰️', all: '🏅',
};

const TYPE_LABELS: Record<string, string> = {
  distance: 'Distance', elevation: 'Elevation',
  time: 'Time', frequency: 'Frequency',
};

// ── Helpers ───────────────────────────────────────────────────

const fmtTarget = (c: Challenge, unit: 'imperial' | 'metric'): string => {
  if (c.challenge_type === 'distance')
    return unit === 'imperial'
      ? `${(c.target_value * METERS_TO_MILES).toFixed(0)} mi`
      : `${(c.target_value / 1000).toFixed(0)} km`;
  if (c.challenge_type === 'elevation')
    return unit === 'imperial'
      ? `${Math.round(c.target_value * METERS_TO_FEET).toLocaleString()} ft`
      : `${Math.round(c.target_value).toLocaleString()} m`;
  if (c.challenge_type === 'time') {
    const h = Math.floor(c.target_value / 3600);
    const m = Math.floor((c.target_value % 3600) / 60);
    return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
  }
  if (c.challenge_type === 'frequency') return `${c.target_value}×`;
  return '';
};

const fmtProgress = (val: number, c: Challenge, unit: 'imperial' | 'metric'): string => {
  if (c.challenge_type === 'distance')
    return unit === 'imperial'
      ? `${(val * METERS_TO_MILES).toFixed(1)} mi`
      : `${(val / 1000).toFixed(1)} km`;
  if (c.challenge_type === 'elevation')
    return unit === 'imperial'
      ? `${Math.round(val * METERS_TO_FEET).toLocaleString()} ft`
      : `${Math.round(val).toLocaleString()} m`;
  if (c.challenge_type === 'time') {
    const h = Math.floor(val / 3600);
    const m = Math.floor((val % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  return `${val}×`;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const daysLeft = (end: string): number =>
  Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));

const getInitials = (first: string | null, last: string | null): string =>
  ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';

const AVATAR_COLORS = [
  'bg-orange-950/50 text-orange-400', 'bg-teal-950/50 text-teal-400',
  'bg-indigo-950/50 text-indigo-400', 'bg-pink-950/50 text-pink-400',
  'bg-emerald-950/50 text-emerald-400',
];

// ── Subcomponents ─────────────────────────────────────────────

interface ChallengeCardProps {
  challenge: Challenge;
  unit: 'imperial' | 'metric';
  onJoin: (c: Challenge) => void;
  joiningId: number | null;
  onSelect: (c: Challenge) => void;
  compact?: boolean;
}

const ChallengeCard: React.FC<ChallengeCardProps> = ({
  challenge: c, unit, onJoin, joiningId, onSelect, compact = false,
}) => {
  const pct = c.is_joined && c.current_value != null && c.target_value > 0
    ? Math.min(100, (c.current_value / c.target_value) * 100)
    : null;

  return (
    <div
      onClick={() => onSelect(c)}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden cursor-pointer hover:border-zinc-600 transition-all group"
    >
      {/* Color banner based on sport */}
      <div className={`h-1.5 w-full ${
        c.sport_type === 'run'  ? 'bg-orange-500' :
        c.sport_type === 'ride' ? 'bg-emerald-500' :
        c.sport_type === 'walk' ? 'bg-cyan-500' :
        c.sport_type === 'hike' ? 'bg-indigo-500' : 'bg-teal-500'
      }`} />

      <div className={`p-4 ${compact ? '' : 'p-5'}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{SPORT_ICONS[c.sport_type] ?? '🏅'}</span>
            <div>
              <div className="text-sm font-black text-white leading-tight group-hover:text-teal-400 transition-colors">
                {c.title}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {TYPE_LABELS[c.challenge_type]} · {fmtTarget(c, unit)}
              </div>
            </div>
          </div>
          {c.is_system && (
            <span className="text-[9px] font-black text-orange-400 bg-orange-900/20 border border-orange-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
              Featured
            </span>
          )}
        </div>

        {/* Dates & participants */}
        <div className="flex items-center gap-3 mb-3 text-[10px] text-zinc-500">
          <span>📅 {fmtDate(c.start_date)} – {fmtDate(c.end_date)}</span>
        </div>
        <div className="flex items-center gap-3 mb-3 text-[10px] text-zinc-500">
          <span>👥 {c.participant_count.toLocaleString()} participants</span>
          <span className="text-zinc-700">·</span>
          <span>{daysLeft(c.end_date)}d left</span>
          {c.has_manual_entry && (
            <span className="text-yellow-400 ml-auto" title="Contains manual entries">* manual</span>
          )}
        </div>

        {/* Progress bar if joined */}
        {c.is_joined && pct !== null && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-zinc-400">
                {fmtProgress(c.current_value!, c, unit)}
              </span>
              <span className="text-[10px] text-zinc-600">{fmtTarget(c, unit)}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${c.is_completed ? 'bg-teal-500' : 'bg-orange-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={e => { e.stopPropagation(); onJoin(c); }}
          disabled={joiningId === c.id}
          className={`w-full py-2.5 rounded-xl text-[11px] font-black uppercase transition-all active:scale-95 ${
            c.is_joined
              ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              : 'bg-orange-500 text-white hover:bg-orange-400'
          }`}
        >
          {joiningId === c.id ? '...' : c.is_joined ? 'Joined ✓' : 'Join Challenge'}
        </button>
      </div>
    </div>
  );
};

// ── Leaderboard Modal ─────────────────────────────────────────

const LeaderboardModal: React.FC<{
  challenge: Challenge;
  unit: 'imperial' | 'metric';
  onClose: () => void;
  onJoin: (c: Challenge) => void;
  joiningId: number | null;
  onManualEntry: (c: Challenge) => void;
}> = ({ challenge: c, unit, onClose, onJoin, joiningId, onManualEntry }) => {
  const [entries, setEntries] = useState<ChallengeLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChallengeLeaderboard(c.id).then(data => {
      setEntries(data);
      setLoading(false);
    });
  }, [c.id]);

  const pct = c.is_joined && c.current_value != null && c.target_value > 0
    ? Math.min(100, (c.current_value / c.target_value) * 100)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg shadow-2xl z-10 max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{SPORT_ICONS[c.sport_type] ?? '🏅'}</span>
              <h2 className="text-base font-black text-white">{c.title}</h2>
            </div>
            <div className="text-[10px] text-zinc-500">
              {TYPE_LABELS[c.challenge_type]} · {fmtTarget(c, unit)} · {daysLeft(c.end_date)}d left
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* My progress */}
        {c.is_joined && pct !== null && (
          <div className="px-5 py-4 border-b border-zinc-800 bg-teal-900/10">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-black text-white">Your Progress</span>
              <div className="flex items-center gap-2">
                {c.has_manual_entry && (
                  <span className="text-[9px] font-black text-yellow-400 bg-yellow-900/20 px-1.5 py-0.5 rounded-full">* Manual entries</span>
                )}
                <span className="text-[10px] text-zinc-400">
                  {fmtProgress(c.current_value!, c, unit)} / {fmtTarget(c, unit)}
                </span>
              </div>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${c.is_completed ? 'bg-teal-500' : 'bg-orange-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <button
              onClick={() => onManualEntry(c)}
              className="mt-2 text-[10px] font-bold text-teal-400 hover:text-teal-300 transition-colors"
            >
              + Submit manual correction
            </button>
          </div>
        )}

        {/* Leaderboard */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">
            Leaderboard · {c.participant_count} athletes
            {c.leaderboard_mode === 'system_only' && (
              <span className="ml-2 text-yellow-400">System values only</span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-zinc-800 rounded-xl animate-pulse" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-zinc-600 text-sm">
              No participants yet — be the first to join!
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((e, idx) => (
                <div key={e.user_id} className={`flex items-center gap-3 p-3 rounded-xl ${
                  idx === 0 ? 'bg-yellow-900/20 border border-yellow-500/20' : 'bg-zinc-800/50'
                }`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${
                    idx === 0 ? 'bg-yellow-500 text-zinc-900' :
                    idx === 1 ? 'bg-zinc-400 text-zinc-900' :
                    idx === 2 ? 'bg-orange-700 text-white' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>{idx + 1}</div>
                  {e.profile_image_url ? (
                    <img src={e.profile_image_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${AVATAR_COLORS[e.user_id % AVATAR_COLORS.length]}`}>
                      {getInitials(e.first_name, e.last_name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black text-white truncate">
                      {[e.first_name, e.last_name].filter(Boolean).join(' ') || 'Athlete'}
                    </div>
                    <div className="h-1 bg-zinc-700 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full" style={{ width: `${e.pct_complete}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-black text-white">
                      {fmtProgress(e.current_value, { challenge_type: 'distance', target_value: 0, ...e } as any, 'imperial')}
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      {e.has_manual_entry && <span className="text-[9px] text-yellow-400">*</span>}
                      {e.is_completed && <span className="text-[9px] text-teal-400">✓</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Join button if not joined */}
        {!c.is_joined && (
          <div className="p-5 border-t border-zinc-800">
            <button
              onClick={() => onJoin(c)}
              disabled={joiningId === c.id}
              className="w-full py-3 bg-orange-500 text-white font-black uppercase text-sm rounded-xl hover:bg-orange-400 active:scale-95 transition-all"
            >
              {joiningId === c.id ? 'Joining...' : 'Join Challenge'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Manual Entry Modal ────────────────────────────────────────

const ManualEntryModal: React.FC<{
  challenge: Challenge;
  unit: 'imperial' | 'metric';
  onClose: () => void;
  onSubmit: (challengeId: number, value: number, note: string, proof?: string) => Promise<void>;
}> = ({ challenge: c, unit, onClose, onSubmit }) => {
  const [value,   setValue]   = useState('');
  const [note,    setNote]    = useState('');
  const [proof,   setProof]   = useState<string | undefined>(undefined);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const toMeters = (raw: number): number => {
    if (c.challenge_type === 'distance')
      return unit === 'imperial' ? raw / METERS_TO_MILES : raw * 1000;
    if (c.challenge_type === 'elevation')
      return unit === 'imperial' ? raw / METERS_TO_FEET : raw;
    if (c.challenge_type === 'time') return raw * 3600; // hours → seconds
    return raw; // frequency
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setProof(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) { setError('Enter a valid value.'); return; }
    if (!note.trim()) { setError('Please add a note explaining the correction.'); return; }
    setSaving(true);
    await onSubmit(c.id, toMeters(parsed), note.trim(), proof);
    setSaving(false);
    onClose();
  };

  const label = c.challenge_type === 'distance'
    ? unit === 'imperial' ? 'Miles' : 'Kilometers'
    : c.challenge_type === 'elevation'
    ? unit === 'imperial' ? 'Feet' : 'Meters'
    : c.challenge_type === 'time' ? 'Hours'
    : 'Count';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl z-10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="text-base font-black text-white">Manual Correction</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3 text-[11px] text-yellow-300">
            ⚠️ Manual entries are flagged with an asterisk (*) on the leaderboard. Challenges with corrected progress may not count toward prizes.
          </div>
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">New Total ({label})</div>
            <input
              type="number" min="0" step="any" value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={`Enter your corrected total in ${label.toLowerCase()}`}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Reason for correction <span className="text-red-400">*</span></div>
            <textarea
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. GPS dropped signal for 0.3 miles — watch showed 5.1 mi total"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Proof image <span className="text-zinc-600">(optional)</span></div>
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-teal-400 hover:text-teal-300 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              {proof ? 'Image selected ✓' : 'Upload screenshot or photo'}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
          </div>
          {error && <div className="text-xs font-bold text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 font-black uppercase text-xs rounded-xl hover:bg-zinc-700 transition-colors">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex-1 py-3 bg-teal-500 text-zinc-950 font-black uppercase text-xs rounded-xl hover:bg-teal-400 active:scale-95 transition-all disabled:opacity-50">
              {saving ? 'Saving...' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Create Challenge Modal ────────────────────────────────────

const CreateChallengeModal: React.FC<{
  unit: 'imperial' | 'metric';
  hasPublicAccess: boolean;
  onClose: () => void;
  onCreated: () => void;
}> = ({ unit, hasPublicAccess, onClose, onCreated }) => {
  const [title,        setTitle]        = useState('');
  const [description,  setDescription]  = useState('');
  const [type,         setType]         = useState<'distance' | 'elevation' | 'time' | 'frequency'>('distance');
  const [sport,        setSport]        = useState<'run' | 'ride' | 'walk' | 'hike' | 'all'>('run');
  const [targetRaw,    setTargetRaw]    = useState('');
  const [visibility,   setVisibility]   = useState<'groups_only' | 'public'>('groups_only');
  const [lbMode,       setLbMode]       = useState<'corrected' | 'system_only'>('corrected');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const toMeters = (raw: number): number => {
    if (type === 'distance') return unit === 'imperial' ? raw / METERS_TO_MILES : raw * 1000;
    if (type === 'elevation') return unit === 'imperial' ? raw / METERS_TO_FEET : raw;
    if (type === 'time') return raw * 3600;
    return raw;
  };

  const targetLabel = type === 'distance' ? (unit === 'imperial' ? 'Miles' : 'Km')
    : type === 'elevation' ? (unit === 'imperial' ? 'Feet' : 'Meters')
    : type === 'time' ? 'Hours' : 'Count';

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required.'); return; }
    const parsed = parseFloat(targetRaw);
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid target.'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return; }
    if (new Date(endDate) <= new Date(startDate)) { setError('End date must be after start date.'); return; }

    setSaving(true);
    setError(null);
    try {
      const { createChallenge: createChallengeAPI } = await import('../services/apiService');
      const result = await createChallengeAPI({
        title: title.trim(),
        description: description.trim() || undefined,
        challenge_type: type,
        sport_type: sport,
        target_value: toMeters(parsed),
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        visibility,
        leaderboard_mode: lbMode,
      });
      if (!result) throw new Error('Failed to create challenge');
      onCreated();
      onClose();
    } catch (e) {
      setError('Failed to create challenge. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl z-10 my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-black text-white">Create a Challenge</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-5">

          {/* Title */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Challenge Title</div>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. July Running Streak"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 transition-colors" />
          </div>

          {/* Description */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Description <span className="text-zinc-600 normal-case font-normal">(optional)</span></div>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the challenge..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-teal-500 transition-colors" />
          </div>

          {/* Sport */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Activity</div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['run','ride','walk','hike','all'] as const).map(s => (
                <button key={s} onClick={() => setSport(s)}
                  className={`py-2 rounded-xl text-[10px] font-black uppercase transition-all border ${
                    sport === s ? 'border-teal-500 bg-teal-900/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {SPORT_ICONS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Challenge Type</div>
            <div className="grid grid-cols-2 gap-2">
              {(['distance','elevation','time','frequency'] as const).map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`py-2.5 rounded-xl text-[11px] font-black uppercase border transition-all ${
                    type === t ? 'border-teal-500 bg-teal-900/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Target ({targetLabel})</div>
            <input type="number" min="0" step="any" value={targetRaw} onChange={e => setTargetRaw(e.target.value)}
              placeholder={`Enter target in ${targetLabel.toLowerCase()}`}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 transition-colors" />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Start Date</div>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-teal-500 transition-colors" />
            </div>
            <div>
              <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">End Date</div>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-teal-500 transition-colors" />
            </div>
          </div>

          {/* Visibility */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Who can join?</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setVisibility('groups_only')}
                className={`py-2.5 rounded-xl text-[11px] font-black uppercase border transition-all ${
                  visibility === 'groups_only' ? 'border-teal-500 bg-teal-900/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                My Groups
              </button>
              <button
                onClick={() => hasPublicAccess && setVisibility('public')}
                className={`py-2.5 rounded-xl text-[11px] font-black uppercase border transition-all ${
                  !hasPublicAccess ? 'border-zinc-800 bg-zinc-900 text-zinc-700 cursor-not-allowed' :
                  visibility === 'public' ? 'border-teal-500 bg-teal-900/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
                title={!hasPublicAccess ? 'Requires 1,000+ followers' : undefined}
              >
                {hasPublicAccess ? 'Everyone' : '🔒 1K Followers'}
              </button>
            </div>
          </div>

          {/* Leaderboard mode */}
          <div>
            <div className="text-[10px] font-black text-zinc-500 uppercase mb-2">Leaderboard shows</div>
            <div className="grid grid-cols-2 gap-2">
              {(['corrected','system_only'] as const).map(m => (
                <button key={m} onClick={() => setLbMode(m)}
                  className={`py-2.5 rounded-xl text-[11px] font-black uppercase border transition-all ${
                    lbMode === m ? 'border-teal-500 bg-teal-900/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m === 'corrected' ? 'Corrected' : 'System Only'}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="text-xs font-bold text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-3">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 font-black uppercase text-xs rounded-xl hover:bg-zinc-700">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex-1 py-3 bg-orange-500 text-white font-black uppercase text-xs rounded-xl hover:bg-orange-400 active:scale-95 transition-all disabled:opacity-50">
              {saving ? 'Creating...' : 'Create Challenge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────

interface ChallengesPageProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
  isDark?: boolean;
  onThemeToggle?: () => void;
}

const SPORT_FILTERS  = ['All', 'Run', 'Ride', 'Walk', 'Hike'] as const;
const TYPE_FILTERS   = ['All', 'Distance', 'Elevation', 'Time', 'Frequency'] as const;

export const ChallengesPage: React.FC<ChallengesPageProps> = ({
  onNavigate, profile, unit, isDark = true, onThemeToggle,
}) => {
  const [challenges,    setChallenges]    = useState<Challenge[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [joiningId,     setJoiningId]     = useState<number | null>(null);
  const [selectedC,     setSelectedC]     = useState<Challenge | null>(null);
  const [manualC,       setManualC]       = useState<Challenge | null>(null);
  const [showCreate,    setShowCreate]    = useState(false);
  const [sportFilter,   setSportFilter]   = useState<string>('All');
  const [typeFilter,    setTypeFilter]    = useState<string>('All');

  const load = useCallback(() => {
    setLoading(true);
    fetchChallenges().then(data => {
      setChallenges(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleJoin = async (c: Challenge) => {
    setJoiningId(c.id);
    if (c.is_joined) {
      await leaveChallenge(c.id);
    } else {
      await joinChallenge(c.id);
    }
    setChallenges(prev => prev.map(ch =>
      ch.id === c.id
        ? { ...ch, is_joined: !c.is_joined, participant_count: c.is_joined ? ch.participant_count - 1 : ch.participant_count + 1 }
        : ch
    ));
    if (selectedC?.id === c.id) setSelectedC(prev => prev ? { ...prev, is_joined: !c.is_joined } : null);
    setJoiningId(null);
  };

  const handleManualSubmit = async (challengeId: number, value: number, note: string, proof?: string) => {
    await submitManualProgress(challengeId, value, note, proof);
    load();
  };

  // Filter
  const filtered = challenges.filter(c => {
    const matchSport = sportFilter === 'All' || c.sport_type === sportFilter.toLowerCase();
    const matchType  = typeFilter  === 'All' || c.challenge_type === typeFilter.toLowerCase();
    return matchSport && matchType;
  });

  // Sections
  const featured    = filtered.filter(c => c.is_system).slice(0, 1);
  const invited     = filtered.filter(c => (c as any).is_invited && !c.is_joined);
  const recommended = filtered.filter(c => c.is_system && !c.is_joined && !((c as any).is_invited)).slice(0, 4);
  const myChallenges = filtered.filter(c => c.is_joined);
  const allChallenges = filtered.filter(c => !c.is_system || c.is_joined);

  // Follower threshold check — simplified, backend enforces it
  const hasPublicAccess = false; // will be true once user hits 1000 followers

  const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div className="mb-10">
      <div className="flex items-baseline gap-2 mb-4">
        <h2 className="text-lg font-black text-white">{title}</h2>
        {subtitle && <span className="text-[11px] text-zinc-500">{subtitle}</span>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar onNavigate={onNavigate} currentView={AppView.CHALLENGES} profile={profile} isDark={isDark} onThemeToggle={onThemeToggle} />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white">Challenges</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 bg-orange-500 text-white font-black uppercase text-xs rounded-xl hover:bg-orange-400 active:scale-95 transition-all"
          >
            + Create Challenge
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          <div className="flex gap-1.5 flex-wrap">
            {SPORT_FILTERS.map(f => (
              <button key={f} onClick={() => setSportFilter(f)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase transition-all border ${
                  sportFilter === f
                    ? 'bg-zinc-200 text-zinc-900 border-zinc-200'
                    : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}
              >
                {f !== 'All' && SPORT_ICONS[f.toLowerCase()]} {f}
              </button>
            ))}
          </div>
          <div className="w-px bg-zinc-700 mx-1" />
          <div className="flex gap-1.5 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase transition-all border ${
                  typeFilter === f
                    ? 'bg-zinc-200 text-zinc-900 border-zinc-200'
                    : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-48 bg-zinc-900 rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Featured */}
            {featured.length > 0 && (
              <Section title="Featured">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {featured.map(c => (
                    <ChallengeCard key={c.id} challenge={c} unit={unit} onJoin={handleJoin} joiningId={joiningId} onSelect={setSelectedC} />
                  ))}
                </div>
              </Section>
            )}

            {/* Invited */}
            {invited.length > 0 && (
              <Section title="Invited Challenges" subtitle="You've been invited">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {invited.map(c => (
                    <ChallengeCard key={c.id} challenge={c} unit={unit} onJoin={handleJoin} joiningId={joiningId} onSelect={setSelectedC} />
                  ))}
                </div>
              </Section>
            )}

            {/* Recommended */}
            {recommended.length > 0 && (
              <Section title="Recommended For You" subtitle="Based on your activities">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recommended.map(c => (
                    <ChallengeCard key={c.id} challenge={c} unit={unit} onJoin={handleJoin} joiningId={joiningId} onSelect={setSelectedC} />
                  ))}
                </div>
              </Section>
            )}

            {/* My Challenges */}
            {myChallenges.length > 0 && (
              <Section title="My Challenges">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myChallenges.map(c => (
                    <ChallengeCard key={c.id} challenge={c} unit={unit} onJoin={handleJoin} joiningId={joiningId} onSelect={setSelectedC} />
                  ))}
                </div>
              </Section>
            )}

            {/* All Challenges */}
            {allChallenges.length > 0 && (
              <Section title="All Challenges">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {allChallenges.map(c => (
                    <ChallengeCard key={c.id} challenge={c} unit={unit} onJoin={handleJoin} joiningId={joiningId} onSelect={setSelectedC} />
                  ))}
                </div>
              </Section>
            )}

            {/* Empty state */}
            {filtered.length === 0 && (
              <div className="text-center py-20">
                <div className="text-4xl mb-4">🏅</div>
                <div className="text-sm font-black text-white mb-1">No challenges found</div>
                <div className="text-[11px] text-zinc-500">Try adjusting your filters or create your own challenge.</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Leaderboard modal */}
      {selectedC && (
        <LeaderboardModal
          challenge={selectedC}
          unit={unit}
          onClose={() => setSelectedC(null)}
          onJoin={handleJoin}
          joiningId={joiningId}
          onManualEntry={c => { setManualC(c); setSelectedC(null); }}
        />
      )}

      {/* Manual entry modal */}
      {manualC && (
        <ManualEntryModal
          challenge={manualC}
          unit={unit}
          onClose={() => setManualC(null)}
          onSubmit={handleManualSubmit}
        />
      )}

      {/* Create challenge modal */}
      {showCreate && (
        <CreateChallengeModal
          unit={unit}
          hasPublicAccess={hasPublicAccess}
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
    </div>
  );
};