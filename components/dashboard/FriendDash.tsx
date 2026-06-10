import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../../types';
import { fetchDiscoverableUsers, sendFriendRequest, DiscoverableUser } from '../../services/apiService';

interface Group {
  id: number;
  name: string;
  icon: string;
  count: string;
  type: 'challenge' | 'club';
  joined: boolean;
}

interface FriendDashProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
}

// Challenges and clubs are still mock until we build that feature
const MOCK_GROUPS: Group[] = [
  { id: 1, name: 'June Running Streak',  icon: '🏃', count: '4,218 participants', type: 'challenge', joined: false },
  { id: 2, name: 'Climb 10K ft in June', icon: '⛰️', count: '1,803 participants', type: 'challenge', joined: false },
  { id: 3, name: 'Tahoe Trail Runners',  icon: '🌲', count: '342 members',        type: 'club',      joined: false },
  { id: 4, name: 'NorCal Cyclists',      icon: '🚴', count: '1,106 members',      type: 'club',      joined: false },
];

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
  const [people,       setPeople]      = useState<DiscoverableUser[]>([]);
  const [groups,       setGroups]      = useState<Group[]>(MOCK_GROUPS);
  const [requested,    setRequested]   = useState<Set<number>>(new Set());
  const [peopleLoading, setPeopleLoading] = useState(true);

  useEffect(() => {
    fetchDiscoverableUsers().then(data => {
      setPeople(data.slice(0, 5)); // show top 5 in the widget
      setPeopleLoading(false);
    });
  }, []);

  const handleFollow = async (id: number) => {
    const ok = await sendFriendRequest(id);
    if (ok) setRequested(prev => new Set(prev).add(id));
  };

  const handleJoin = (id: number) =>
    setGroups(prev => prev.map(g => g.id === id ? { ...g, joined: !g.joined } : g));

  const GroupList = ({ type }: { type: 'challenge' | 'club' }) => (
    <>
      {groups.filter(g => g.type === type).map(g => (
        <div key={g.id} className="flex items-center gap-2 mb-3 last:mb-0">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm flex-shrink-0">
            {g.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-white leading-tight truncate">{g.name}</div>
            <div className="text-[10px] text-zinc-500">{g.count}</div>
          </div>
          <button
            onClick={() => handleJoin(g.id)}
            className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${
              g.joined ? 'bg-zinc-700 text-zinc-400' : 'bg-orange-500 text-white hover:bg-orange-400'
            }`}
          >
            {g.joined ? 'Joined' : 'Join'}
          </button>
        </div>
      ))}
    </>
  );

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-4">

      {/* Challenges */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Challenges</div>
          <button className="text-[10px] text-teal-500 font-bold">View all</button>
        </div>
        <GroupList type="challenge" />
      </div>

      {/* Clubs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Clubs</div>
          <button className="text-[10px] text-teal-500 font-bold">View all</button>
        </div>
        <GroupList type="club" />
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
                <img
                  src={p.profile_image_url}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-zinc-700"
                />
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