import React, { useState, useEffect } from 'react';
import { AppView, RunMode } from '../types';
import { UserProfile } from '../services/apiService';
import { DesktopApp } from './layout/DesktopApp';
import { MobileApp } from './layout/MobileApp';

interface SocialDashboardProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  unit: 'imperial' | 'metric';
  profile?: UserProfile | null;
  isDark?: boolean;
  onThemeToggle?: () => void;
}

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDesktop;
};

export const SocialDashboard: React.FC<SocialDashboardProps> = ({
  onNavigate,
  unit,
  profile = null,
  isDark = true,
  onThemeToggle,
}) => {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <DesktopApp
        onNavigate={onNavigate}
        currentView={AppView.SOCIAL}
        profile={profile}
        unit={unit}
        isDark={isDark}
        onThemeToggle={onThemeToggle}
      />
    );
  }

  return (
    <MobileApp
      onNavigate={onNavigate}
      currentView={AppView.SOCIAL}
      profile={profile}
      unit={unit}
    />
  );
};