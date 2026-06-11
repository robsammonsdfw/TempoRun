import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../../types';
import {
  fetchDiscoverableUsers, sendFriendRequest, DiscoverableUser,
  fetchChallenges, joinChallenge, leaveChallenge, Challenge,
} from '../../services/apiService';

const METERS_TO_MILES = 0.000621371;
const METERS_TO_FEET  = 3.28084;

interface FriendDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
}

const SPORT_ICONS: Record<string, string> = {
  run: '🏃', ride: '🚴', walk: '🚶', hike: '⛰️', all: '🏅',
};

const formatChallengeTarget = (c: Challenge): string => {
  if (c.challenge_type === 'distance') {
    return `${(c.target_value * METERS_TO_MILES).toFixed(0)} mi`;
  }
  if (c.challenge_type === 'elevation') {
    return `${Math.round(c.target_value * METERS_TO_FEET).toLocaleString()} ft`;
  }
  if (c.challenge_type === 'time') {
    const h = Math.floor(c.target_value / 3600);
    return h > 0 ? `${h}h` : `${Math.floor(c.target_value / 60)}m`;
  }
  if (c.challenge_type === 'frequency') return `${c.target_value}x`;
  return '';
};

const formatProgress = (c: Challenge): string => {
  if (c.current_value === null || c.current_value === undefined) return '';
  if (c.challenge_type === 'distance') {
    return `${(c.current_value * METERS_TO_MILES).toFixed(1)} mi`;
  }
  if (c.challenge_type === 'elevation') {
    return `${Math.round(c.current_value * METERS_TO_FEET).toLocaleString()} ft`;
  }
  if (c.challenge_type === 'time') {
    const h = Math.floor(c.current_value / 3600);
    return h > 0 ? `${h}h` : `${Math.floor(c.current_value / 60)}m`;
  }
  if (c.challenge_type === 'frequency') return `${c.current_value}x`;
  return '';
};

const getInitials = (first: string | null, last: string | null, email: string): string => {
  const f = first?.[0] ?? '';
  const l = last?.[0]  ?? '';
  return (f + l).toUpperCase() || email?.[0]?.toUpperCase() || '?';
};

const AVATAR_COLORS = [
  'bg-pink-950/50 text-pink-400',
  'bg-emerald-950/50 text-emerald-400',
  'bg-indigo-950/50 text-indigo-400',
  'bg-orange-950/50 text-orange-400',
  'bg-cyan-950/50 text-cyan-400',
  'bg-purple-950/50 text-purple-400',
];

const avatarColor = (id: number) => AVATAR_COLORS[id % AVATAR_COLORS.length];

export const FriendDash: React.FC<FriendDashProps> = ({ onNavigate }) => {
  const [people,           setPeople]          = useState<DiscoverableUser[]>([]);
  const [challenges,       setChallenges]       = useState<Challenge[]>([]);
  const [requested,        setRequested]        = useState<Set<number>>(new Set());
  const [peopleLoading,    setPeopleLoading]    = useState(true);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [joiningId,        setJoiningId]        = useState<number | null>(null);

  useEffect(() => {
    fetchDiscoverableUsers().then(data => {
      setPeople(data.slice(0, 5));
      setPeopleLoading(false);
    });
    fetchChallenges().then(data => {
      setChallenges(data);
      setChallengeLoading(false);
    });
  }, []);

  const handleFollow = async (id: number) => {
    const ok = await sendFriendRequest(id);
    if (ok) setRequested(prev => new Set(prev).add(id));
  };

  const handleJoinLeave = async (c: Challenge) => {
    setJoiningId(c.id);
    if (c.is_joined) {
      await leaveChallenge(c.id);
      setChallenges(prev => prev.map(ch =>
        ch.id === c.id ? { ...ch, is_joined: false, participant_count: ch.participant_count - 1 } : ch
      ));
    } else {
      await joinChallenge(c.id);
      setChallenges(prev => prev.map(ch =>
        ch.id === c.id ? { ...ch, is_joined: true, participant_count: ch.participant_count + 1 } : ch
      ));
    }
    setJoiningId(null);
  };

  const activeChallenges = challenges.filter(c =>
    new Date(c.end_date) >= new Date()
  ).slice(0, 4);

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-4">

      {/* Challenges */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Challenges</div>
          <button
            onClick={() => onNavigate(AppView.HISTORY)}
            className="text-[10px] text-teal-500 font-bold hover:text-teal-400 transition-colors"
          >
            View all
          </button>
        </div>

        {challengeLoading ? (
          <>{[1,2].map(i => (
            <div key={i} className="flex items-center gap-2 mb-3 animate-pulse">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 flex-shrink-0" />
              <div className="flex-1">
                <div className="h-2.5 w-28 bg-zinc-800 rounded mb-1" />
                <div className="h-2 w-16 bg-zinc-800 rounded" />
              </div>
            </div>
          ))}</>
        ) : activeChallenges.length === 0 ? (
          <div className="text-[11px] text-zinc-500 text-center py-2">No active challenges.</div>
        ) : (
          activeChallenges.map(c => {
            const pct = c.is_joined && c.current_value && c.target_value
              ? Math.min(100, (c.current_value / c.target_value) * 100)
              : null;

            return (
              <div key={c.id} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm flex-shrink-0">
                    {SPORT_ICONS[c.sport_type] ?? '🏅'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-white leading-tight truncate flex items-center gap-1">
                      {c.title}
                      {c.has_manual_entry && (
                        <span className="text-[9px] text-yellow-400" title="Contains manual entries">*</span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                      {c.participant_count.toLocaleString()} participants
                      {c.is_joined && c.current_value !== null && (
                        <span className="text-teal-400">
                          · {formatProgress(c)}/{formatChallengeTarget(c)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleJoinLeave(c)}
                    disabled={joiningId === c.id}
                    className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${
                      c.is_joined
                        ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                        : 'bg-orange-500 text-white hover:bg-orange-400'
                    }`}
                  >
                    {joiningId === c.id ? '...' : c.is_joined ? 'Joined' : 'Join'}
                  </button>
                </div>

                {/* Progress bar for joined challenges */}
                {c.is_joined && pct !== null && (
                  <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden ml-9">
                    <div
                      className={`h-full rounded-full transition-all ${c.is_completed ? 'bg-teal-500' : 'bg-orange-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Clubs — still coming soon */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Clubs</div>
          <button className="text-[10px] text-teal-500 font-bold">View all</button>
        </div>
        <div className="text-center py-4">
          <div className="text-2xl mb-2">🏃</div>
          <div className="text-[11px] text-zinc-500">Clubs coming soon</div>
        </div>
      </div>

      {/* People to follow */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">People</div>
          <button className="text-[10px] text-teal-500 font-bold">Find friends</button>
        </div>

        {peopleLoading ? (
          <>{[1,2,3].map(i => (
            <div key={i} className="flex items-center gap-2 mb-3 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-zinc-800 flex-shrink-0" />
              <div className="flex-1">
                <div className="h-2.5 w-24 bg-zinc-800 rounded mb-1" />
                <div className="h-2 w-16 bg-zinc-800 rounded" />
              </div>
            </div>
          ))}</>
        ) : people.length === 0 ? (
          <div className="text-[11px] text-zinc-500 text-center py-2">
            No new people to follow yet.
          </div>
        ) : (
          people.map(p => (
            <div key={p.id} className="flex items-center gap-2 mb-3 last:mb-0">
              {p.profile_image_url ? (
                <img src={p.profile_image_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-zinc-700" />
              ) : (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${avatarColor(p.id)}`}>
                  {getInitials(p.first_name, p.last_name, p.email)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-white truncate">
                  {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}
                </div>
                {p.bio && <div className="text-[10px] text-zinc-500 truncate">{p.bio}</div>}
              </div>
              <button
                onClick={() => handleFollow(p.id)}
                disabled={requested.has(p.id)}
                className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${
                  requested.has(p.id)
                    ? 'bg-zinc-700 text-zinc-400'
                    : 'border border-teal-500/50 text-teal-400 hover:bg-teal-900/30'
                }`}
              >
                {requested.has(p.id) ? 'Sent' : 'Follow'}
              </button>
            </div>
          ))
        )}
      </div>

    </div>
  );
};