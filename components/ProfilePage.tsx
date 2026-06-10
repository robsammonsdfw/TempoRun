import React, { useState, useEffect, useRef } from 'react';
import { AppView, RunMode } from '../types';
import { Navbar } from './Navbar';
import { updateUserProfile, UserProfile } from '../services/apiService';

interface ProfilePageProps {
  onNavigate: (view: AppView, mode?: RunMode) => void;
  profile: UserProfile | null;
  onProfileUpdate: (updated: UserProfile) => void;
  isDark?: boolean;
  onThemeToggle?: () => void;
}

type ProfileSection =
  | 'my-profile'
  | 'my-account'
  | 'performance'
  | 'display'
  | 'privacy'
  | 'data-permissions'
  | 'notifications'
  | 'gear'
  | 'integrations'
  | 'badges';

const NAV_ITEMS: { id: ProfileSection; label: string }[] = [
  { id: 'my-profile',       label: 'My Profile' },
  { id: 'my-account',       label: 'My Account' },
  { id: 'performance',      label: 'My Performance' },
  { id: 'display',          label: 'Display Preferences' },
  { id: 'privacy',          label: 'Privacy Controls' },
  { id: 'data-permissions', label: 'Data Permissions' },
  { id: 'notifications',    label: 'Email Notifications' },
  { id: 'gear',             label: 'My Gear' },
  { id: 'integrations',     label: 'Partner Integrations' },
  { id: 'badges',           label: 'My Badges' },
];

export const ProfilePage: React.FC<ProfilePageProps> = ({ onNavigate, profile: initialProfile, onProfileUpdate, isDark = true, onThemeToggle }) => {
  const [section, setSection] = useState<ProfileSection>('my-profile');
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  const [loading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editable field state — initialised from prop
  const [firstName, setFirstName] = useState(initialProfile?.first_name ?? '');
  const [lastName, setLastName] = useState(initialProfile?.last_name ?? '');
  const [bio, setBio] = useState(initialProfile?.bio ?? '');
  const [privacyMode, setPrivacyMode] = useState<'public' | 'private' | 'friends'>(
    (initialProfile?.privacy_mode as any) ?? 'private'
  );

  // On initial mount, sync editable fields from the prop.
  // We do NOT re-sync on every parent update to avoid overwriting
  // local state (e.g. a just-uploaded image) before it has saved.
  const initialised = React.useRef(false);
  useEffect(() => {
    if (initialProfile && !initialised.current) {
      initialised.current = true;  // only lock once we have real data
      setProfile(initialProfile);
      setFirstName(initialProfile.first_name ?? '');
      setLastName(initialProfile.last_name ?? '');
      setBio(initialProfile.bio ?? '');
      setPrivacyMode((initialProfile.privacy_mode as any) ?? 'private');
    }
  }, [initialProfile]);

  const handleSave = async () => {
    setSaving(true);
    const updated = await updateUserProfile({
      first_name: firstName,
      last_name: lastName,
      bio,
      privacy_mode: privacyMode,
      ...(profile?.profile_image_url ? { profile_image_url: profile.profile_image_url } : {}),
    });
    if (updated) {
      setProfile(prev => prev ? { ...prev, ...updated } : prev);
      onProfileUpdate({ ...profile!, ...updated });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  };

  const handlePhotoClick = () => fileInputRef.current?.click();

  // Resize and compress image to stay well under Lambda's 6MB limit.
  // Outputs a JPEG base64 string at max 400x400px and 0.8 quality (~30-60KB typical).
  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        const MAX_SIZE = 400;
        let { width, height } = img;

        if (width > height) {
          if (width > MAX_SIZE) { height = Math.round(height * MAX_SIZE / width); width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width = Math.round(width * MAX_SIZE / height); height = MAX_SIZE; }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }

        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };

      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
      img.src = objectUrl;
    });

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);

    try {
      const base64 = await compressImage(file);

      // Show preview immediately
      setProfile(prev => prev ? { ...prev, profile_image_url: base64 } : prev);

      // Save to database
      const updated = await updateUserProfile({ profile_image_url: base64 });
      if (updated) {
        setProfile(prev => prev ? { ...prev, ...updated } : prev);
        onProfileUpdate({ ...profile!, ...updated });
      }
    } catch (err) {
      console.error('Photo upload error:', err);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const getInitials = () => {
    if (!profile) return '?';
    const f = (firstName || profile.first_name)?.[0] ?? '';
    const l = (lastName || profile.last_name)?.[0] ?? '';
    return (f + l).toUpperCase() || profile.email?.[0]?.toUpperCase() || '?';
  };

  const getDisplayName = () =>
    [firstName, lastName].filter(Boolean).join(' ') || profile?.email || '';

  const renderMyProfile = () => (
    <div>
      <h1 className="text-2xl font-black text-white mb-8">My Profile</h1>

      {/* Photo */}
      <div className="flex items-start gap-6 mb-8 pb-8 border-b border-zinc-800">
        <span className="text-sm text-zinc-400 w-32 pt-2 flex-shrink-0">Current Photo</span>
        <div className="relative group cursor-pointer" onClick={handlePhotoClick}>
          {profile?.profile_image_url ? (
            <img
              src={profile.profile_image_url}
              alt="Profile"
              className="w-20 h-20 rounded-full object-cover border-2 border-zinc-700"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-500 to-orange-500 flex items-center justify-center text-2xl font-black text-white">
              {getInitials()}
            </div>
          )}
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {uploadingPhoto ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
        </div>
      </div>

      {/* Name */}
      <ProfileRow label="Name">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="First name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
          />
          <input
            type="text"
            placeholder="Last name"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
          />
        </div>
      </ProfileRow>

      {/* Bio */}
      <ProfileRow label="Profile Bio">
        <textarea
          placeholder="Tell others a little about yourself..."
          value={bio}
          onChange={e => setBio(e.target.value)}
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors resize-none"
        />
      </ProfileRow>

      {/* Privacy */}
      <ProfileRow label="Profile Visibility">
        <div className="flex gap-2">
          {(['public', 'friends', 'private'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => setPrivacyMode(opt)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
                privacyMode === opt
                  ? 'bg-teal-500 text-zinc-950'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </ProfileRow>

      {/* Read-only fields from intake_data — shown but not editable here */}
      <div className="mt-8 pt-8 border-t border-zinc-800">
        <p className="text-[11px] font-bold uppercase text-zinc-600 tracking-widest mb-4">
          Account Data — edit via My Account
        </p>
        <ReadOnlyRow label="Email" value={profile?.email} />
        <ReadOnlyRow label="Member since" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : undefined} />
        <ReadOnlyRow label="Fitbit" value={profile?.fitbit_user_id ? `Connected · Last sync ${profile.fitbit_last_sync ? new Date(profile.fitbit_last_sync).toLocaleDateString() : 'never'}` : 'Not connected'} />
        <ReadOnlyRow label="Google Fit" value={profile?.google_fit_last_sync ? `Connected · Last sync ${new Date(profile.google_fit_last_sync).toLocaleDateString()}` : 'Not connected'} />
      </div>

      {/* Save */}
      <div className="flex items-center gap-4 mt-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 bg-teal-500 text-zinc-950 font-black italic uppercase text-sm rounded-xl hover:bg-teal-400 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving && <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />}
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
        {saveSuccess && (
          <span className="text-sm text-teal-400 font-bold flex items-center gap-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Saved
          </span>
        )}
      </div>
    </div>
  );

  const renderComingSoon = (label: string) => (
    <div>
      <h1 className="text-2xl font-black text-white mb-8">{label}</h1>
      <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-2xl p-12 text-center">
        <div className="text-4xl mb-3">🔧</div>
        <div className="text-sm font-black text-white mb-1">Coming soon</div>
        <div className="text-xs text-zinc-500">This section is under construction.</div>
      </div>
    </div>
  );

  const renderSection = () => {
    if (loading) return <ProfileSkeleton />;
    switch (section) {
      case 'my-profile':   return renderMyProfile();
      case 'my-account':   return renderComingSoon('My Account');
      case 'performance':  return renderComingSoon('My Performance');
      case 'display':      return renderComingSoon('Display Preferences');
      case 'privacy':      return renderComingSoon('Privacy Controls');
      case 'data-permissions': return renderComingSoon('Data Permissions');
      case 'notifications':   return renderComingSoon('Email Notifications');
      case 'gear':         return renderComingSoon('My Gear');
      case 'integrations': return renderComingSoon('Partner Integrations');
      case 'badges':       return renderComingSoon('My Badges');
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-white font-sans">
      <Navbar onNavigate={onNavigate} currentView={AppView.PROFILE} profile={profile} isDark={isDark} onThemeToggle={onThemeToggle} />

      <div className="flex flex-1 max-w-6xl mx-auto w-full px-4 py-8 gap-8">

        {/* Left Nav */}
        <div className="w-52 flex-shrink-0">
          <nav className="flex flex-col">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`text-left px-4 py-3 rounded-xl text-sm font-bold transition-all mb-0.5 ${
                  section === item.id
                    ? 'bg-orange-500 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {renderSection()}
        </div>

        {/* Right Sidebar */}
        <div className="w-56 flex-shrink-0">
          {/* My Account Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4">
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">My Account</div>
            <div className="text-xs text-zinc-400 mb-1">Email</div>
            <div className="text-xs font-bold text-white truncate mb-3">{profile?.email ?? '—'}</div>
            <div className="text-xs text-zinc-400 mb-1">Display Name</div>
            <div className="text-xs font-bold text-white">{getDisplayName() || '—'}</div>
          </div>

          {/* Social Connections */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Social Connections</div>

            <SocialConnection
              icon="G"
              iconBg="bg-white text-zinc-900"
              name="Google"
              status={profile?.google_fit_last_sync ? `Connected as ${getDisplayName()}` : 'Connect with Google Fit'}
              connected={!!profile?.google_fit_last_sync}
            />
            <SocialConnection
              icon="F"
              iconBg="bg-teal-500 text-white"
              name="Fitbit"
              status={profile?.fitbit_user_id ? `Connected · ID ${profile.fitbit_user_id}` : 'Connect with Fitbit'}
              connected={!!profile?.fitbit_user_id}
            />
            <SocialConnection
              icon="G"
              iconBg="bg-red-500 text-white"
              name="Garmin"
              status="Connect with Garmin"
              connected={false}
            />
            <SocialConnection
              icon="M"
              iconBg="bg-blue-500 text-white"
              name="MyFitnessPal"
              status="Share activities on MFP"
              connected={false}
            />
          </div>
        </div>

      </div>
    </div>
  );
};

// ── Small sub-components ──────────────────────────────────────────────────────

const ProfileRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-6 mb-6">
    <span className="text-sm text-zinc-400 w-32 pt-2.5 flex-shrink-0">{label}</span>
    <div className="flex-1">{children}</div>
  </div>
);

const ReadOnlyRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex items-center gap-6 mb-4">
    <span className="text-sm text-zinc-500 w-32 flex-shrink-0">{label}</span>
    <span className="text-sm text-zinc-300">{value ?? '—'}</span>
  </div>
);

const SocialConnection: React.FC<{
  icon: string;
  iconBg: string;
  name: string;
  status: string;
  connected: boolean;
}> = ({ icon, iconBg, name, status, connected }) => (
  <div className="flex items-start gap-3 mb-4 last:mb-0">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${iconBg}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className={`text-xs font-bold ${connected ? 'text-teal-400' : 'text-zinc-300'}`}>{status}</div>
      {connected && (
        <button className="text-[10px] text-red-400 hover:text-red-300 font-bold mt-0.5 transition-colors">
          Disconnect
        </button>
      )}
    </div>
  </div>
);

const ProfileSkeleton: React.FC = () => (
  <div className="animate-pulse">
    <div className="h-7 w-36 bg-zinc-800 rounded-lg mb-8" />
    <div className="flex gap-6 mb-8 pb-8 border-b border-zinc-800">
      <div className="h-4 w-32 bg-zinc-800 rounded mt-2" />
      <div className="w-20 h-20 rounded-full bg-zinc-800" />
    </div>
    {[1, 2, 3].map(i => (
      <div key={i} className="flex gap-6 mb-6">
        <div className="h-4 w-32 bg-zinc-800 rounded mt-2" />
        <div className="flex-1 h-10 bg-zinc-800 rounded-xl" />
      </div>
    ))}
  </div>
);