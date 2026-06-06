import React, { useState } from 'react';
import { AppView, RunMode } from '../../types';

interface Person {
  id: number;
  name: string;
  initials: string;
  avatarColor: string;
  location: string;
  following: boolean;
}

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

const MOCK_PEOPLE: Person[] = [
  { id: 1, name: 'Tibisay Aires',     initials: 'TA', avatarColor: 'bg-pink-950/50 text-pink-400',    location: 'Maracay, Venezuela',    following: false },
  { id: 2, name: 'Lukáš Kubiš',       initials: 'LK', avatarColor: 'bg-emerald-950/50 text-emerald-400', location: 'Banskobystrický, SK', following: false },
  { id: 3, name: 'Benjamin Choquert', initials: 'BC', avatarColor: 'bg-indigo-950/50 text-indigo-400', location: 'Tomblaine, France',    following: false },
  { id: 4, name: 'Isabel Swan',       initials: 'IS', avatarColor: 'bg-orange-950/50 text-orange-400', location: 'Fan favorite',         following: false },
];

const MOCK_GROUPS: Group[] = [
  { id: 1, name: 'June Running Streak',  icon: '🏃', count: '4,218 participants', type: 'challenge', joined: false },
  { id: 2, name: 'Climb 10K ft in June', icon: '⛰️', count: '1,803 participants', type: 'challenge', joined: false },
  { id: 3, name: 'Tahoe Trail Runners',  icon: '🌲', count: '342 members',        type: 'club',      joined: false },
  { id: 4, name: 'NorCal Cyclists',      icon: '🚴', count: '1,106 members',      type: 'club',      joined: false },
];

export const FriendDash: React.FC<FriendDashProps> = ({ onNavigate }) => {
  const [people, setPeople] = useState<Person[]>(MOCK_PEOPLE);
  const [groups, setGroups] = useState<Group[]>(MOCK_GROUPS);

  const handleFollow = (id: number) =>
    setPeople(prev => prev.map(p => p.id === id ? { ...p, following: !p.following } : p));

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

      {/* People */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">People</div>
          <button className="text-[10px] text-teal-500 font-bold">Find friends</button>
        </div>
        {people.map(p => (
          <div key={p.id} className="flex items-center gap-2 mb-3 last:mb-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${p.avatarColor}`}>
              {p.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold text-white truncate">{p.name}</div>
              <div className="text-[10px] text-zinc-500 truncate">{p.location}</div>
            </div>
            <button
              onClick={() => handleFollow(p.id)}
              className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${
                p.following
                  ? 'bg-zinc-700 text-zinc-400'
                  : 'border border-teal-500/50 text-teal-400 hover:bg-teal-900/30'
              }`}
            >
              {p.following ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>

    </div>
  );
};