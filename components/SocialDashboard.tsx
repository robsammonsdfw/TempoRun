import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../types';
import { METERS_TO_MILES, METERS_TO_KM } from '../constants';
import { Navbar } from './Navbar';
import { fetchUserProfile, UserProfile } from '../services/apiService';

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
  iconColor: string;
  count: string;
  type: 'challenge' | 'club';
  joined: boolean;
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

interface SocialDashboardProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  unit: 'imperial' | 'metric';
  profile?: UserProfile | null;   
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

const MOCK_PEOPLE: Person[] = [
  { id: 1, name: 'Tibisay Aires', initials: 'TA', avatarColor: 'bg-pink-950/50 text-pink-400', location: 'Maracay, Venezuela', following: false },
  { id: 2, name: 'Lukáš Kubiš', initials: 'LK', avatarColor: 'bg-emerald-950/50 text-emerald-400', location: 'Banskobystrický, SK', following: false },
  { id: 3, name: 'Benjamin Choquert', initials: 'BC', avatarColor: 'bg-indigo-950/50 text-indigo-400', location: 'Tomblaine, France', following: false },
  { id: 4, name: 'Isabel Swan', initials: 'IS', avatarColor: 'bg-orange-950/50 text-orange-400', location: 'Fan favorite', following: false },
];

const MOCK_GROUPS: Group[] = [
  { id: 1, name: 'June Running Streak', icon: '🏃', iconColor: 'text-orange-400', count: '4,218 participants', type: 'challenge', joined: false },
  { id: 2, name: 'Climb 10K ft in June', icon: '⛰️', iconColor: 'text-teal-400', count: '1,803 participants', type: 'challenge', joined: false },
  { id: 3, name: 'Tahoe Trail Runners', icon: '🌲', iconColor: 'text-emerald-400', count: '342 members', type: 'club', joined: false },
  { id: 4, name: 'NorCal Cyclists', icon: '🚴', iconColor: 'text-cyan-400', count: '1,106 members', type: 'club', joined: false },
];

const INITIAL_GOALS: GoalItem[] = [
  { id: 'hr', label: 'Heart Rate', icon: '❤️', color: 'bg-red-500', current: 0, target: 3, unit: 'sessions' },
  { id: 'run', label: 'Running', icon: '🏃', color: 'bg-orange-500', current: 0, target: 15, unit: 'mi' },
  { id: 'bike', label: 'Cycling', icon: '🚴', color: 'bg-emerald-500', current: 0, target: 50, unit: 'mi' },
  { id: 'walk', label: 'Walking', icon: '🚶', color: 'bg-cyan-500', current: 0, target: 20000, unit: 'steps' },
];

const ACTIVITY_TYPE_STYLES: Record<string, string> = {
  Run: 'bg-orange-950/50 text-orange-400 border border-orange-500/20',
  Ride: 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/20',
  Hike: 'bg-indigo-950/50 text-indigo-400 border border-indigo-500/20',
  Walk: 'bg-cyan-950/50 text-cyan-400 border border-cyan-500/20',
};

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const SocialDashboard: React.FC<SocialDashboardProps> = ({ onNavigate, unit }) => {
  const [feedTab, setFeedTab] = useState<'following' | 'everyone'>('following');
  const [people, setPeople] = useState<Person[]>(MOCK_PEOPLE);
  const [groups, setGroups] = useState<Group[]>(MOCK_GROUPS);
  const [kudosClicked, setKudosClicked] = useState<Set<number>>(new Set());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    fetchUserProfile().then(data => {
      setProfile(data);
      setProfileLoading(false);
    });
  }, []);

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
      ? (p.first_name + (p.last_name ? p.last_name : '')).toLowerCase().replace(/\s+/g, '')
      : p.email?.split('@')[0] ?? '';
    return '@' + base;
  };

  const handleFollow = (id: number) => {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, following: !p.following } : p));
  };

  const handleJoin = (id: number) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, joined: !g.joined } : g));
  };

  const handleKudos = (id: number) => {
    setKudosClicked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const formatDistance = (mi: number) =>
    unit === 'imperial' ? `${mi.toFixed(2)} mi` : `${(mi / METERS_TO_MILES / 1000).toFixed(2)} km`;

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar onNavigate={onNavigate} currentView={AppView.SOCIAL} profile={profile} />

      <div className="flex flex-1 max-w-7xl mx-auto w-full px-4 py-6 gap-5">

        {/* LEFT SIDEBAR */}
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
              <div className="text-center"><div className="text-sm font-black text-white">—</div><div className="text-[10px] text-zinc-500 uppercase">Following</div></div>
              <div className="text-center"><div className="text-sm font-black text-white">—</div><div className="text-[10px] text-zinc-500 uppercase">Followers</div></div>
              <div className="text-center"><div className="text-sm font-black text-white">—</div><div className="text-[10px] text-zinc-500 uppercase">Activities</div></div>
            </div>
          </div>

          {/* Goals */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Goals</div>
            {INITIAL_GOALS.map(goal => (
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
            <div className="text-2xl font-black italic text-white">0 mi</div>
            <div className="text-[10px] text-zinc-600 mb-3">0 ft elevation</div>
            <div className="flex justify-between">
              {DAYS.map((d, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="text-[9px] text-zinc-600 font-bold">{d}</div>
                  <div className={`w-2 h-2 rounded-full ${i === 4 ? 'bg-teal-500 ring-2 ring-teal-500/30' : 'bg-zinc-800'}`} />
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

        {/* MAIN FEED */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setFeedTab('following')}
              className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${feedTab === 'following' ? 'bg-teal-500 text-zinc-950' : 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-white'}`}
            >
              Following
            </button>
            <button
              onClick={() => setFeedTab('everyone')}
              className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${feedTab === 'everyone' ? 'bg-teal-500 text-zinc-950' : 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-white'}`}
            >
              Everyone
            </button>
          </div>

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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  {activity.achievement}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { val: formatDistance(activity.distanceMi), lbl: 'Distance' },
                  { val: `${activity.elevationFt.toLocaleString()} ft`, lbl: 'Elev gain' },
                  { val: activity.durationLabel, lbl: 'Time' },
                ].map(({ val, lbl }) => (
                  <div key={lbl} className="bg-zinc-800/60 rounded-xl p-3 text-center">
                    <div className="text-base font-black italic text-white">{val}</div>
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">{lbl}</div>
                  </div>
                ))}
              </div>

              {/* Map Placeholder */}
              <div className="bg-zinc-800/40 rounded-xl h-20 mb-3 flex items-center justify-center overflow-hidden border border-zinc-700/30">
                <svg width="100%" height="80" viewBox="0 0 400 80" preserveAspectRatio="none">
                  {activity.type === 'Ride' ? (
                    <path d="M10 55 Q50 25 90 50 Q130 70 170 40 Q210 15 250 45 Q290 68 330 35 Q360 20 390 45" fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round"/>
                  ) : (
                    <path d="M60 65 Q90 35 120 30 Q155 25 175 45 Q200 62 220 42 Q245 20 265 52 Q275 62 255 70 Q220 80 180 76 Q140 72 110 76 Q85 78 60 65Z" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
                  )}
                  <circle cx={activity.type === 'Ride' ? 10 : 60} cy={activity.type === 'Ride' ? 55 : 65} r="4" fill="#22c55e"/>
                  <circle cx={activity.type === 'Ride' ? 390 : 265} cy={activity.type === 'Ride' ? 45 : 52} r="4" fill="#3b82f6"/>
                </svg>
              </div>

              {/* Kudos Row */}
              <div className="flex items-center gap-3 pt-3 border-t border-zinc-800">
                <button
                  onClick={() => handleKudos(activity.id)}
                  className={`flex items-center gap-1.5 text-[11px] font-black uppercase px-3 py-1.5 rounded-lg transition-all ${kudosClicked.has(activity.id) ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={kudosClicked.has(activity.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                  Kudo
                </button>
                <button className="flex items-center gap-1.5 text-[11px] font-black uppercase px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-all">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Comment
                </button>
                <span className="ml-auto text-[11px] text-zinc-500">
                  {activity.kudos + (kudosClicked.has(activity.id) ? 1 : 0)} kudos{activity.comments > 0 ? ` · ${activity.comments} comments` : ''}
                </span>
              </div>
            </div>
          ))}

          {/* Empty State */}
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

        {/* RIGHT SIDEBAR */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-4">

          {/* Challenges */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Challenges</div>
              <button className="text-[10px] text-teal-500 font-bold">View all</button>
            </div>
            {groups.filter(g => g.type === 'challenge').map(g => (
              <div key={g.id} className="flex items-center gap-2 mb-3 last:mb-0">
                <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm flex-shrink-0">{g.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-white leading-tight truncate">{g.name}</div>
                  <div className="text-[10px] text-zinc-500">{g.count}</div>
                </div>
                <button
                  onClick={() => handleJoin(g.id)}
                  className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${g.joined ? 'bg-zinc-700 text-zinc-400' : 'bg-orange-500 text-white hover:bg-orange-400'}`}
                >
                  {g.joined ? 'Joined' : 'Join'}
                </button>
              </div>
            ))}
          </div>

          {/* Clubs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Clubs</div>
              <button className="text-[10px] text-teal-500 font-bold">View all</button>
            </div>
            {groups.filter(g => g.type === 'club').map(g => (
              <div key={g.id} className="flex items-center gap-2 mb-3 last:mb-0">
                <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm flex-shrink-0">{g.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-white leading-tight truncate">{g.name}</div>
                  <div className="text-[10px] text-zinc-500">{g.count}</div>
                </div>
                <button
                  onClick={() => handleJoin(g.id)}
                  className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${g.joined ? 'bg-zinc-700 text-zinc-400' : 'bg-orange-500 text-white hover:bg-orange-400'}`}
                >
                  {g.joined ? 'Joined' : 'Join'}
                </button>
              </div>
            ))}
          </div>

          {/* People to Follow */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">People</div>
              <button className="text-[10px] text-teal-500 font-bold">Find friends</button>
            </div>
            {people.map(p => (
              <div key={p.id} className="flex items-center gap-2 mb-3 last:mb-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${p.avatarColor}`}>{p.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-white truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{p.location}</div>
                </div>
                <button
                  onClick={() => handleFollow(p.id)}
                  className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg transition-all flex-shrink-0 ${p.following ? 'bg-zinc-700 text-zinc-400' : 'border border-teal-500/50 text-teal-400 hover:bg-teal-900/30'}`}
                >
                  {p.following ? 'Following' : 'Follow'}
                </button>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};