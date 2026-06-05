import React, { useState } from 'react';
import { AppView, RunMode } from '../types';
import { UserProfile } from '../services/apiService';

interface NavbarProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  currentView: AppView;
  profile?: UserProfile | null;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentView, profile }) => {
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const getInitials = () => {
    if (!profile) return '?';
    const f = profile.first_name?.[0] ?? '';
    const l = profile.last_name?.[0] ?? '';
    return (f + l).toUpperCase() || profile.email?.[0]?.toUpperCase() || '?';
  };

  const navItem = (label: string, view: AppView) => (
    <button
      onClick={() => onNavigate(view)}
      className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${
        currentView === view ? 'text-white' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <button
        onClick={() => onNavigate(AppView.SOCIAL)}
        className="text-xl font-black italic tracking-tighter text-teal-400 hover:text-teal-300 transition-colors"
      >
        SPRINT AI
      </button>

      <div className="flex items-center gap-6">
        {navItem('Dashboard', AppView.SOCIAL)}

        {/* Training dropdown */}
        <div
          className="relative"
          onMouseEnter={() => setTrainingOpen(true)}
          onMouseLeave={() => setTrainingOpen(false)}
        >
          <button
            className={`text-[11px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1 ${
              [AppView.RUNNING, AppView.MODE_SELECTION, AppView.SETUP].includes(currentView)
                ? 'text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Training
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              className={`transition-transform ${trainingOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {trainingOpen && (
            <div className="absolute top-full left-0 mt-2 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden w-44 shadow-2xl">
              <button className="w-full text-left px-4 py-3 text-[11px] font-bold uppercase text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">
                Analysis
              </button>
              <button
                onClick={() => { onNavigate(AppView.MODE_SELECTION); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold uppercase text-teal-400 hover:bg-teal-900/40 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Go Run
              </button>
            </div>
          )}
        </div>

        {navItem('Maps', AppView.ROUTE_BUILDER)}
        {navItem('Challenges', AppView.HISTORY)}
      </div>

      {/* Avatar + dropdown */}
      <div
        className="relative flex items-center gap-2 cursor-pointer"
        onMouseEnter={() => setAvatarOpen(true)}
        onMouseLeave={() => setAvatarOpen(false)}
      >
        {profile?.profile_image_url ? (
          <img
            src={profile.profile_image_url}
            alt="Profile"
            className="w-8 h-8 rounded-full object-cover border border-zinc-700"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-orange-500 flex items-center justify-center text-[11px] font-black text-white">
            {getInitials()}
          </div>
        )}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" className="text-zinc-500"
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>

        {avatarOpen && (
          <div className="absolute top-full right-0 mt-2 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden w-48 shadow-2xl">
            <div className="px-4 py-3 border-b border-zinc-700">
              <div className="text-xs font-black text-white truncate">
                {[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || 'My Account'}
              </div>
              <div className="text-[10px] text-zinc-500 truncate">{profile?.email}</div>
            </div>
            <button
              onClick={() => { onNavigate(AppView.PROFILE); setAvatarOpen(false); }}
              className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              My Profile
            </button>
            <button className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors">
              Settings
            </button>
            <div className="border-t border-zinc-700">
              <button
                onClick={() => {
                  localStorage.removeItem('embracehealth-api-token');
                  window.location.href = 'https://app.embracehealth.ai/login';
                }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-red-400 hover:bg-zinc-700 transition-colors"
              >
                Log Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};