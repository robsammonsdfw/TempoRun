
export interface GeoPoint {
  lat: number;
  lng: number;
  altitude: number | null; // meters
  timestamp: number;
  speed: number | null; // meters per second
}

export interface Split {
  distanceLabel: string; // e.g., "1 mi"
  timeSeconds: number; // Time taken for this specific split
  cumulativeTime: number; // Total time elapsed
  pace: string; // Pace string e.g. "8:30 /mi"
}

export interface Interval {
  id: number;
  type: 'SPRINT' | 'RECOVERY' | 'WARMUP';
  startTime: number;
  duration: number; // seconds
  distance: number; // meters
  avgPace: string;
  avgSpeed: number; // m/s
  maxSpeed: number; // m/s
}

export enum TrainingZone {
  IDLE = 'IDLE',
  AEROBIC = 'AEROBIC',
  ANAEROBIC = 'ANAEROBIC'
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
  };
  opinion?: string; // AI advice on fuel suitability
}

export interface RunState {
  isActive: boolean;
  isPaused: boolean;
  startTime: number | null;
  elapsedTime: number; // seconds
  totalDistance: number; // meters
  currentSpeed: number; // meters per second
  
  // Trail / Elevation Data
  currentAltitude: number; // meters
  elevationGain: number; // total meters climbed
  currentGradient: number; // percentage grade
  
  // Track Data
  currentPhaseDuration: number; // seconds in current zone (sprint/rest)

  route: GeoPoint[];
  splits: Split[];
  intervals: Interval[];
  
  // Route Planning
  plannedRoute: { lat: number; lng: number }[]; 
  
  // Biometrics & Energy
  currentCadence: number; // Steps Per Minute (SPM)
  currentStrideLength: number; // Meters
  anaerobicBattery: number; // 0-100% (Matches remaining)
  trainingZone: TrainingZone;

  // Health Data
  caloriesBurned: number;
  caloriesConsumed: number; // New: Track intake during run
  fluidLostMl: number; // Estimated sweat loss in ml
  fluidIntakeMl: number; // User logged intake in ml
  currentHeartRate: number;
  currentGlucose: number | null; // mg/dL
}

export enum RunMode {
  ACADEMY = 'ACADEMY',
  TRAIL = 'TRAIL',
  TRACK = 'TRACK',
  ENDURANCE = 'ENDURANCE',
  CASUAL = 'CASUAL'
}

export interface RunSettings {
  mode: RunMode; // Purpose of the run
  targetDistance: number; // meters
  splitDistance: number; // meters
  unit: 'imperial' | 'metric'; // miles or km
  bodyProfile: BodyProfile;
  devices: DeviceStatus;
  initialFuel: FuelData | null;
  targetSpeed: number | null; // meters per second (for pacer alerts)
  shoeMileage: number; // miles on current shoes
}

export interface BpmAnalysisResult {
  bpm: number;
  genre: string;
  advice: string;
}

export enum AppView {
  SOCIAL         = 'SOCIAL',
  MODE_SELECTION = 'MODE_SELECTION',
  SETUP          = 'SETUP',
  RUNNING        = 'RUNNING',
  SUMMARY        = 'SUMMARY',
  ROUTE_BUILDER  = 'ROUTE_BUILDER',
  HISTORY        = 'HISTORY',
  PROFILE        = 'PROFILE',
  GOALS          = 'GOALS',       
  MAPS           = 'MAPS',   

}
 