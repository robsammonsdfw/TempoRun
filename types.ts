
export interface GeoPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number | null; // meters per second
}

export interface Split {
  distanceLabel: string; // e.g., "1 mi"
  timeSeconds: number; // Time taken for this specific split
  cumulativeTime: number; // Total time elapsed
  pace: string; // Pace string e.g. "8:30 /mi"
}

export interface DeviceStatus {
  fitbitConnected: boolean;
  glucoseMonitorConnected: boolean;
}

export interface BodyProfile {
  weight: number; // in kg
  age: number;
  gender: 'male' | 'female';
}

export interface FuelData {
  calories: number;
  description: string;
  macros?: {
    protein: number;
    carbs: number;
    fats: number;
  }
}

export interface RunState {
  isActive: boolean;
  isPaused: boolean;
  startTime: number | null;
  elapsedTime: number; // seconds
  totalDistance: number; // meters
  currentSpeed: number; // meters per second
  route: GeoPoint[];
  splits: Split[];
  
  // Health Data
  caloriesBurned: number;
  currentHeartRate: number;
  currentGlucose: number | null; // mg/dL
}

export interface RunSettings {
  targetDistance: number; // meters
  splitDistance: number; // meters
  unit: 'imperial' | 'metric'; // miles or km
  bodyProfile: BodyProfile;
  devices: DeviceStatus;
  initialFuel: FuelData | null;
}

export interface BpmAnalysisResult {
  bpm: number;
  genre: string;
  advice: string;
}

export enum AppView {
  SETUP = 'SETUP',
  RUNNING = 'RUNNING',
  SUMMARY = 'SUMMARY',
}
