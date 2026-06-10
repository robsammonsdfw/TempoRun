import { BpmAnalysisResult, RunState, FuelData } from '../types';

const rawUrl = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000';
const API_URL = rawUrl.replace(/\/$/, '');

const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() ?? null;
  return null;
};

const parseJwt = (token: string): any => {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
};

const getUserId = (): string | null => {
  const token = getCookie('embracehealth-api-token');
  if (!token) return null;
  const decoded = parseJwt(token);
  return decoded?.userId ? String(decoded.userId) : null;
};

const baseHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const userId = getUserId();
  if (userId) headers['x-user-id'] = userId;
  return headers;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============================================================
// USER PROFILE
// ============================================================

export interface UserProfile {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  privacy_mode: 'public' | 'private' | 'friends';
  role: string;
  dashboard_prefs: Record<string, any>;
  profile_image_url: string | null;
  fitbit_user_id: string | null;
  fitbit_last_sync: string | null;
  google_fit_last_sync: string | null;
  created_at: string;
}

export const fetchUserProfile = async (): Promise<UserProfile | null> => {
  try {
    const res = await fetch(`${API_URL}/user/profile`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchUserProfile error:', error);
    return null;
  }
};

export const updateUserProfile = async (
  fields: Partial<Pick<UserProfile, 'first_name' | 'last_name' | 'bio' | 'privacy_mode' | 'dashboard_prefs' | 'profile_image_url'>>
): Promise<UserProfile | null> => {
  try {
    const res = await fetch(`${API_URL}/user/profile`, {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`Failed to update profile: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('updateUserProfile error:', error);
    return null;
  }
};

// ============================================================
// INTEGRATIONS
// ============================================================

export const fetchDeviceStatus = async (userId: string): Promise<{ fitbitConnected: boolean }> => {
  try {
    const res = await fetch(`${API_URL}/integrations/status`, {
      headers: { ...baseHeaders(), 'x-user-id': userId },
    });
    if (!res.ok) throw new Error('Failed to fetch device status');
    return await res.json();
  } catch (error) {
    console.error('fetchDeviceStatus error:', error);
    return { fitbitConnected: false };
  }
};

// ============================================================
// RUNS
// ============================================================

export const fetchRunHistory = async () => {
  try {
    const res = await fetch(`${API_URL}/runs`, { headers: baseHeaders() });
    if (!res.ok) throw new Error('Failed to fetch history');
    return await res.json();
  } catch (error) {
    console.error('fetchRunHistory error:', error);
    return [];
  }
};

export const fetchRunDetails = async (runId: number) => {
  try {
    const res = await fetch(`${API_URL}/runs/${runId}`, { headers: baseHeaders() });
    if (!res.ok) throw new Error('Failed to fetch run details');
    return await res.json();
  } catch (error) {
    console.error('fetchRunDetails error:', error);
    throw error;
  }
};

export const saveRunToDatabase = async (runState: RunState, mode: string) => {
  try {
    const payload = {
      start_time: new Date(runState.startTime || Date.now()).toISOString(),
      mode,
      duration_seconds: runState.elapsedTime,
      distance_meters: runState.totalDistance,
      calories_burned: runState.caloriesBurned,
      avg_heart_rate: runState.currentHeartRate,
      elevation_gain: runState.elevationGain ?? 0,
      route: JSON.stringify(runState.route),
      splits: runState.splits,
      intervals: runState.intervals,
    };
    const res = await fetch(`${API_URL}/runs`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (error) {
    console.error('saveRunToDatabase error:', error);
  }
};

// ============================================================
// COACH
// ============================================================

export const fetchCoachInteractions = async (runId: number) => {
  try {
    const res = await fetch(`${API_URL}/coach-interactions?runId=${runId}`, {
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch interactions');
    return await res.json();
  } catch (error) {
    console.error('fetchCoachInteractions error:', error);
    return [];
  }
};

export const consultAiCoach = async (
  query: string,
  runStats: any,
  runId?: number
): Promise<string> => {
  try {
    const res = await fetch(`${API_URL}/consult-ai-coach`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ query, runStats, runId }),
    });
    if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
    const data = await res.json();
    return data.text;
  } catch (error) {
    console.error('consultAiCoach error:', error);
    return 'I encountered an error while consulting your digital coach. Please try again.';
  }
};

// ============================================================
// AI — FOOD / RHYTHM / SPEECH
// ============================================================

export const analyzeFood = async (
  input: File | string,
  context?: { distance: number; unit: string; mode: string }
): Promise<FuelData> => {
  try {
    let payload: any = {};
    if (typeof input === 'string') {
      payload = { type: 'text', data: input };
    } else {
      payload = { type: 'image', data: await blobToBase64(input), mimeType: input.type };
    }
    if (context) payload.context = context;
    const res = await fetch(`${API_URL}/analyze-food`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
    return await res.json();
  } catch (error) {
    console.error('analyzeFood error:', error);
    throw error;
  }
};

export const analyzeMusicRhythm = async (
  audioBlob: Blob,
  currentPace: string
): Promise<BpmAnalysisResult> => {
  try {
    const res = await fetch(`${API_URL}/analyze-rhythm`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({
        audioData: await blobToBase64(audioBlob),
        mimeType: audioBlob.type,
        currentPace,
      }),
    });
    if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
    return await res.json();
  } catch (error) {
    console.error('analyzeMusicRhythm error:', error);
    throw error;
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  try {
    const res = await fetch(`${API_URL}/generate-speech`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Server Error: ${res.statusText}`);
    const data = await res.json();
    return data.audioData;
  } catch (error) {
    console.error('generateSpeech error:', error);
    return '';
  }
};

// ============================================================
// GOALS
// ============================================================

export type GoalType = 'distance' | 'time' | 'elevation';
export type GoalFrequency = 'weekly' | 'monthly' | 'yearly';
export type GoalSport = 'run' | 'ride' | 'walk' | 'hike';

export interface Goal {
  id: string;
  title: string | null;
  type: GoalType;
  frequency: GoalFrequency;
  target_value: number;
  sport_type: GoalSport;
  start_date: string;
  end_date: string;
  is_private: boolean;
  current_value: number;
  period_start: string | null;
  period_end: string | null;
  is_completed: boolean;
}

export interface CreateGoalPayload {
  title?: string;
  type: GoalType;
  frequency: GoalFrequency;
  target_value: number;
  sport_type: GoalSport;
  start_date: string;
  end_date: string;
  is_private?: boolean;
}

export const fetchGoals = async (): Promise<Goal[]> => {
  try {
    const res = await fetch(`${API_URL}/goals`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch goals: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchGoals error:', error);
    return [];
  }
};

export const createGoal = async (payload: CreateGoalPayload): Promise<Goal | null> => {
  try {
    const res = await fetch(`${API_URL}/goals`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to create goal: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('createGoal error:', error);
    return null;
  }
};

export const deleteGoal = async (goalId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/goals/${goalId}`, {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete goal: ${res.status}`);
    return true;
  } catch (error) {
    console.error('deleteGoal error:', error);
    return false;
  }
};

// ============================================================
// FEED
// ============================================================

export interface RoutePoint {
  lat: number;
  lng: number;
  altitude?: number;
  speed?: number;
  timestamp?: string;
}

export interface FeedItem {
  id: number;
  start_time: string;
  mode: string;
  distance_meters: number;
  duration_seconds: number;
  calories_burned: number | null;
  avg_heart_rate: number | null;
  elevation_gain: number | null;
  route_json: RoutePoint[] | string | null;
  author_id: number;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  viewer_tier_id: number | null;
}

export const fetchFeed = async (limit = 50, offset = 0): Promise<FeedItem[]> => {
  try {
    const res = await fetch(`${API_URL}/feed?limit=${limit}&offset=${offset}`, {
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchFeed error:', error);
    return [];
  }
};

// ============================================================
// FRIENDS
// ============================================================

export interface Friend {
  friendship_id: number;
  friend_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  profile_image_url: string | null;
  tier_id: number | null;
  tier_name: string | null;
  status: string;
}

export interface DiscoverableUser {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  profile_image_url: string | null;
  bio: string | null;
}

export const fetchFriends = async (): Promise<Friend[]> => {
  try {
    const res = await fetch(`${API_URL}/friends`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch friends: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchFriends error:', error);
    return [];
  }
};

export const fetchPendingRequests = async (): Promise<any[]> => {
  try {
    const res = await fetch(`${API_URL}/friends/pending`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch pending: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchPendingRequests error:', error);
    return [];
  }
};

export const fetchDiscoverableUsers = async (): Promise<DiscoverableUser[]> => {
  try {
    const res = await fetch(`${API_URL}/friends/discover`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch discoverable users: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchDiscoverableUsers error:', error);
    return [];
  }
};

export const sendFriendRequest = async (receiverId: number): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/friends`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ receiver_id: receiverId }),
    });
    return res.ok;
  } catch (error) {
    console.error('sendFriendRequest error:', error);
    return false;
  }
};

export const updateFriendship = async (
  friendshipId: number,
  status: 'accepted' | 'declined',
  tierId?: number
): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/friends/${friendshipId}`, {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify({ status, tier_id: tierId }),
    });
    return res.ok;
  } catch (error) {
    console.error('updateFriendship error:', error);
    return false;
  }
};

// ============================================================
// ROUTES
// ============================================================

export interface Route {
  id: number;
  name: string | null;
  distance_meters: number;
  elevation_gain: number;
  start_elevation: number | null;
  end_elevation: number | null;
  surface_type: string;
  paved_percent: number;
  is_public: boolean;
  star_count: number;
  run_count: number;
  is_starred: boolean;
  created_at: string;
}

export interface RouteDetail extends Route {
  path_json: { lat: number; lng: number }[];
  elevation_profile: { distance_meters: number; altitude_meters: number }[];
}

export const saveRoute = async (payload: {
  name?: string;
  distance_meters: number;
  elevation_gain?: number;
  surface_type?: string;
  paved_percent?: number;
  path_json: { lat: number; lng: number }[];
  elevation_profile?: { distance_meters: number; altitude_meters: number }[];
  is_public?: boolean;
}): Promise<Route | null> => {
  try {
    const res = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to save route: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('saveRoute error:', error);
    return null;
  }
};

export const fetchRoutes = async (): Promise<Route[]> => {
  try {
    const res = await fetch(`${API_URL}/routes`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch routes: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchRoutes error:', error);
    return [];
  }
};

export const fetchRouteById = async (routeId: number): Promise<RouteDetail | null> => {
  try {
    const res = await fetch(`${API_URL}/routes/${routeId}`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch route: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchRouteById error:', error);
    return null;
  }
};

export const starRoute = async (routeId: number): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/routes/${routeId}/star`, {
      method: 'POST',
      headers: baseHeaders(),
    });
    return res.ok;
  } catch (error) {
    console.error('starRoute error:', error);
    return false;
  }
};

export const unstarRoute = async (routeId: number): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/routes/${routeId}/star`, {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    return res.ok;
  } catch (error) {
    console.error('unstarRoute error:', error);
    return false;
  }
};

// ============================================================
// SEGMENTS
// ============================================================

export interface Segment {
  id: number;
  name: string;
  sport_type: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  distance_meters: number;
  elevation_gain: number;
  effort_count: number;
  athlete_count: number;
  kom_time_seconds: number | null;
  qom_time_seconds: number | null;
}

export interface SegmentEffort {
  id: number;
  elapsed_seconds: number;
  start_time: string;
  is_pr: boolean;
  avg_heart_rate: number | null;
  avg_speed_mps: number | null;
  rank: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

export const fetchSegmentsInBBox = async (
  minLat: number, maxLat: number,
  minLng: number, maxLng: number,
  sport?: string
): Promise<Segment[]> => {
  try {
    const params = new URLSearchParams({
      minLat: String(minLat), maxLat: String(maxLat),
      minLng: String(minLng), maxLng: String(maxLng),
      ...(sport ? { sport } : {}),
    });
    const res = await fetch(`${API_URL}/segments?${params}`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch segments: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchSegmentsInBBox error:', error);
    return [];
  }
};

export const fetchSegmentLeaderboard = async (segmentId: number): Promise<SegmentEffort[]> => {
  try {
    const res = await fetch(`${API_URL}/segments/${segmentId}/leaderboard`, { headers: baseHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchSegmentLeaderboard error:', error);
    return [];
  }
};

export const createSegment = async (payload: {
  name: string;
  sport_type: string;
  start_lat: number; start_lng: number;
  end_lat: number;   end_lng: number;
  path_json: { lat: number; lng: number }[];
  distance_meters?: number;
  elevation_gain?: number;
  is_private?: boolean;
}): Promise<Segment | null> => {
  try {
    const res = await fetch(`${API_URL}/segments`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to create segment: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('createSegment error:', error);
    return null;
  }
};

// ============================================================
// WIDGET DATA (Fitbit / Google Fit — read only)
// ============================================================

export interface WeeklySummary {
  totalSteps: number;
  totalDistanceMeters: number;
  totalActiveCalories: number;
  totalActiveZoneMinutes: number;
  avgRestingHR: number | null;
  dailySteps: { date: string; steps: number; hasActivity: boolean }[];
}

export interface TodayVitals {
  heartRate?: number;
  restingHeartRate?: number;
  spo2?: number;
  vo2Max?: number;
  sleepScore?: number;
  weight?: number;
  bmi?: number;
}

export const fetchWeeklySummary = async (): Promise<WeeklySummary | null> => {
  try {
    const res = await fetch(`${API_URL}/widgets/weekly-summary`, {
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch weekly summary: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchWeeklySummary error:', error);
    return null;
  }
};

export const fetchTodayVitals = async (): Promise<TodayVitals> => {
  try {
    const res = await fetch(`${API_URL}/widgets/today-vitals`, {
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch vitals: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchTodayVitals error:', error);
    return {};
  }
};

export const fetchWidgetHistory = async (
  key: string,
  start: string,
  end: string
): Promise<{ date: string; value: number }[]> => {
  try {
    const params = new URLSearchParams({ key, start, end });
    const res = await fetch(`${API_URL}/widgets/history?${params}`, {
      headers: baseHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch widget history: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('fetchWidgetHistory error:', error);
    return [];
  }
};