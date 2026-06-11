import React, { useState, useRef, useEffect } from 'react';
import { AppView, RunMode } from '../types';
import { UserProfile } from '../services/apiService';

export const handleLogout = () => {
  alert('To log out, please log out from the main EmbraceHealth app at app.embracehealth.ai.');
  window.location.href = 'https://app.embracehealth.ai';
};

interface NavbarProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  currentView: AppView;
  profile?: UserProfile | null;
  variant?: 'desktop' | 'mobile';
  onMobileMenuOpen?: () => void;
  isDark?: boolean;
  onThemeToggle?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  currentView,
  profile,
  variant = 'desktop',
  onMobileMenuOpen,
  isDark = true,
  onThemeToggle,
}) => {
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [showClubsModal, setShowClubsModal] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    if (avatarOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [avatarOpen]);

  const getInitials = () => {
    if (!profile) return '?';
    const f = profile.first_name?.[0] ?? '';
    const l = profile.last_name?.[0] ?? '';
    return (f + l).toUpperCase() || profile.email?.[0]?.toUpperCase() || '?';
  };

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email
    : '';

  const Avatar = () => (
    profile?.profile_image_url ? (
      <img
        src={profile.profile_image_url}
        alt="Profile"
        className="w-8 h-8 rounded-full object-cover border border-zinc-700"
      />
    ) : (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-orange-500 flex items-center justify-center text-[11px] font-black text-white">
        {getInitials()}
      </div>
    )
  );

  // ── Mobile variant ──────────────────────────────────────────
  if (variant === 'mobile') {
    return (
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <button
          onClick={() => onNavigate(AppView.SOCIAL)}
          className="text-lg"
        ><span className="font-black italic tracking-tighter"><span className="text-teal-400">embrace</span><span className="text-orange-500">health</span><span className="text-zinc-400">RUN</span></span></button>
        <button
          onClick={onMobileMenuOpen}
          className="w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-zinc-800 border border-zinc-700"
          aria-label="Open menu"
        >
          <span className="w-4 h-0.5 bg-zinc-300 rounded-full" />
          <span className="w-4 h-0.5 bg-zinc-300 rounded-full" />
          <span className="w-3 h-0.5 bg-zinc-300 rounded-full" />
        </button>
      </div>
    );
  }

  // ── Desktop variant ─────────────────────────────────────────
  return (
    <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <button
        onClick={() => onNavigate(AppView.SOCIAL)}
        className="text-xl hover:opacity-80 transition-opacity"
      ><span className="font-black italic tracking-tighter"><span className="text-teal-400">embrace</span><span className="text-orange-500">health</span><span className="text-zinc-400">RUN</span></span></button>

      <div className="flex items-center gap-6">
        {/* Dashboard */}
        <button
          onClick={() => onNavigate(AppView.SOCIAL)}
          className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${
            currentView === AppView.SOCIAL ? 'text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Dashboard
        </button>

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
            <div className="absolute top-full left-0 mt-2 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden w-52 shadow-2xl z-50">
              <button
                onClick={() => { onNavigate(AppView.SOCIAL); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                Activity Feed
              </button>
              <button
                onClick={() => { setShowClubsModal(true); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                Clubs
              </button>
              <button
                onClick={() => { onNavigate(AppView.MAPS); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                My Segments
              </button>
              <button
                onClick={() => { onNavigate(AppView.MAPS); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                My Routes
              </button>
              <div className="border-t border-zinc-700/50 mx-3 my-1" />
              <div className="px-4 py-1.5 text-[9px] font-black text-zinc-600 uppercase tracking-widest">Training</div>
              <button
                onClick={() => { onNavigate(AppView.GOALS); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                My Goals
              </button>
              <button
                onClick={() => { onNavigate(AppView.MODE_SELECTION); setTrainingOpen(false); }}
                className="w-full text-left px-4 py-3 text-[11px] font-bold text-teal-400 hover:bg-teal-900/40 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Go Run
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => onNavigate(AppView.MAPS)}
          className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${
            currentView === AppView.MAPS ? 'text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Maps
        </button>

        <button
          onClick={() => onNavigate(AppView.HISTORY)}
          className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${
            currentView === AppView.HISTORY ? 'text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Challenges
        </button>
      </div>

      {/* Clubs Coming Soon Modal */}
      {showClubsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowClubsModal(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl z-10">
            <div className="text-4xl mb-4">🏃</div>
            <h3 className="text-lg font-black text-white mb-2">Clubs Coming Soon</h3>
            <p className="text-[12px] text-zinc-400 leading-relaxed mb-6">
              Clubs are under development and will be available shortly. Connect with local and virtual running groups, organize events, and track club activities together.
            </p>
            <button
              onClick={() => setShowClubsModal(false)}
              className="px-6 py-2.5 bg-teal-500 text-zinc-950 font-black uppercase text-xs rounded-xl hover:bg-teal-400 active:scale-95 transition-all"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Theme toggle */}
      {onThemeToggle && (
        <div className="flex items-center gap-2 mr-2">
          <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Mode</span>
          <button
            onClick={onThemeToggle}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
              isDark ? 'bg-zinc-700' : 'bg-zinc-300'
            }`}
            aria-label="Toggle dark mode"
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform duration-200 flex items-center justify-center text-[9px] ${
              isDark ? 'translate-x-5 bg-teal-400' : 'translate-x-0 bg-white'
            }`}>
              {isDark ? '🌙' : '☀️'}
            </span>
          </button>
        </div>
      )}

      {/* Avatar dropdown */}
      <div className="relative" ref={avatarRef}>
        <button
          onClick={() => setAvatarOpen(prev => !prev)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Avatar />
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" className="text-zinc-500"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {avatarOpen && (
          <div className="absolute top-full right-0 mt-2 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden w-48 shadow-2xl z-50">
            <div className="px-4 py-3 border-b border-zinc-700">
              <div className="text-xs font-black text-white truncate">{displayName || 'My Account'}</div>
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
                onClick={handleLogout}
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