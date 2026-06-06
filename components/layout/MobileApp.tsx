import React, { useState } from 'react';
import { AppView, RunMode } from '../../types';
import { UserProfile } from '../../services/apiService';
import { Navbar } from '../Navbar';
import { FeedDash } from '../dashboard/FeedDash';

interface MobileAppProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  currentView: AppView;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
}

const NAV_ITEMS = [
  { label: 'Dashboard', view: AppView.SOCIAL },
  { label: 'Maps',      view: AppView.ROUTE_BUILDER },
  { label: 'Challenges',view: AppView.HISTORY },
  { label: 'My Profile',view: AppView.PROFILE },
];

const TRAINING_SUBITEMS = [
  { label: 'Analysis', view: null },
  { label: 'Go Run',   view: AppView.MODE_SELECTION },
];

export const MobileApp: React.FC<MobileAppProps> = ({
  onNavigate,
  currentView,
  profile,
  unit,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [trainingExpanded, setTrainingExpanded] = useState(false);

  const getInitials = () => {
    if (!profile) return '?';
    const f = profile.first_name?.[0] ?? '';
    const l = profile.last_name?.[0] ?? '';
    return (f + l).toUpperCase() || profile.email?.[0]?.toUpperCase() || '?';
  };

  const handleNavigate = (view: AppView, mode?: RunMode) => {
    setMenuOpen(false);
    setTrainingExpanded(false);
    onNavigate(view, mode);
  };

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar
        variant="mobile"
        onNavigate={onNavigate}
        currentView={currentView}
        profile={profile}
        onMobileMenuOpen={() => setMenuOpen(true)}
      />

      {/* Slide-in menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />

          {/* Drawer */}
          <div className="relative bg-zinc-900 border-r border-zinc-800 w-72 h-full shadow-2xl flex flex-col animate-slide-in-left z-10">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <span className="text-lg font-black italic tracking-tighter text-teal-400">SPRINT AI</span>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Profile summary */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
              {profile?.profile_image_url ? (
                <img src={profile.profile_image_url} alt="Profile" className="w-10 h-10 rounded-full object-cover border border-zinc-700" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-orange-500 flex items-center justify-center text-sm font-black text-white">
                  {getInitials()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-white truncate">
                  {[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || ''}
                </div>
                <div className="text-[10px] text-zinc-500 truncate">{profile?.email}</div>
              </div>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto py-3">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.label}
                  onClick={() => handleNavigate(item.view)}
                  className={`w-full text-left px-5 py-3.5 text-sm font-bold transition-colors ${
                    currentView === item.view
                      ? 'text-teal-400 bg-teal-900/20'
                      : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}

              {/* Training with sub-items */}
              <div>
                <button
                  onClick={() => setTrainingExpanded(prev => !prev)}
                  className="w-full text-left px-5 py-3.5 text-sm font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center justify-between"
                >
                  Training
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    className={`transition-transform ${trainingExpanded ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {trainingExpanded && (
                  <div className="bg-zinc-800/50 border-l-2 border-teal-500/30 ml-5">
                    {TRAINING_SUBITEMS.map(sub => (
                      <button
                        key={sub.label}
                        onClick={() => sub.view && handleNavigate(sub.view)}
                        className={`w-full text-left px-4 py-3 text-[13px] font-bold transition-colors ${
                          sub.view === AppView.MODE_SELECTION
                            ? 'text-teal-400 hover:bg-teal-900/30'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        {sub.label === 'Go Run' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="inline mr-1.5 mb-0.5">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                        )}
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>

            {/* Log out */}
            <div className="border-t border-zinc-800 p-4">
              <button
                onClick={() => {
                  document.cookie = 'embracehealth-api-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.embracehealth.ai';
                  window.location.href = 'https://app.embracehealth.ai/login';
                }}
                className="w-full text-left px-2 py-2 text-[11px] font-bold uppercase text-red-400 hover:text-red-300 transition-colors"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feed — only content shown on mobile */}
      <div className="flex-1 px-4 py-4">
        <FeedDash onNavigate={onNavigate} unit={unit} />
      </div>
    </div>
  );
};