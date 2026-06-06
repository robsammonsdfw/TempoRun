import React from 'react';
import { AppView, RunMode } from '../../types';
import { UserProfile } from '../../services/apiService';
import { Navbar } from '../Navbar';
import { UserDash } from '../dashboard/UserDash';
import { FeedDash } from '../dashboard/FeedDash';
import { FriendDash } from '../dashboard/FriendDash';

interface DesktopAppProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  currentView: AppView;
  profile: UserProfile | null;
  unit: 'imperial' | 'metric';
}

export const DesktopApp: React.FC<DesktopAppProps> = ({
  onNavigate,
  currentView,
  profile,
  unit,
}) => {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar
        variant="desktop"
        onNavigate={onNavigate}
        currentView={currentView}
        profile={profile}
      />
      <div className="flex flex-1 max-w-7xl mx-auto w-full px-4 py-6 gap-5">
        <UserDash onNavigate={onNavigate} profile={profile} unit={unit} />
        <FeedDash onNavigate={onNavigate} unit={unit} />
        <FriendDash onNavigate={onNavigate} />
      </div>
    </div>
  );
};