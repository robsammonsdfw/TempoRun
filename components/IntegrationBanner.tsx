import React, { useEffect, useState } from 'react';
import { fetchDeviceStatus } from '../services/apiService';

export const IntegrationBanner: React.FC<{ userId: string }> = ({ userId }) => {
  const [isFitbitConnected, setIsFitbitConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      const status = await fetchDeviceStatus(userId);
      setIsFitbitConnected(status.fitbitConnected);
    };
    checkStatus();
  }, [userId]);

  if (isFitbitConnected === null) return null; // Loading state

  return (
    <div className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 mt-4 ${
      isFitbitConnected 
        ? 'bg-teal-900/30 border-teal-500/30 text-teal-400' 
        : 'bg-slate-800 border-slate-700 text-slate-400'
    }`}>
      {/* Simple Watch Icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="6" width="12" height="12" rx="3" ry="3"></rect>
        <path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M8 18v4"></path><path d="M16 18v4"></path>
      </svg>
      
      {isFitbitConnected ? (
        <span>Fitbit Connected. Runs will sync automatically.</span>
      ) : (
        <span className="flex-1">
          Fitbit not connected. <a href="https://app.embracehealth.ai/settings" target="_blank" rel="noreferrer" className="text-indigo-400 underline">Log into EmbraceHealth</a> to link your account for syncing.
        </span>
      )}
    </div>
  );
};