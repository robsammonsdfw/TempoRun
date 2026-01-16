
import { BodyProfile } from './types';

export const METERS_TO_MILES = 0.000621371;
export const METERS_TO_KM = 0.001;
export const LBS_TO_KG = 0.453592;
export const MPS_TO_MPH = 2.23694;
export const MPS_TO_KPH = 3.6;

// Helper to format seconds into MM:SS or HH:MM:SS
export const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// Calculate Haversine distance between two points in meters
export const getDistanceFromLatLonInM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d * 1000; // Distance in meters
};

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Convert Speed (m/s) to Speed string (MPH or KPH)
export const formatSpeed = (speedMps: number, unit: 'imperial' | 'metric'): string => {
  if (speedMps <= 0.1) return "0.0";
  const speed = unit === 'imperial' ? speedMps * MPS_TO_MPH : speedMps * MPS_TO_KPH;
  return speed.toFixed(1);
};

// Convert Speed (m/s) to Pace (mm:ss per mile/km)
export const calculatePace = (speedMps: number, unit: 'imperial' | 'metric'): string => {
  if (speedMps <= 0.1) return "-:--"; 

  let paceSeconds = 0;
  if (unit === 'imperial') {
    const speedMpm = speedMps * 60 * METERS_TO_MILES;
    paceSeconds = speedMpm > 0 ? 1 / speedMpm * 60 : 0;
  } else {
    const speedKpm = speedMps * 60 * METERS_TO_KM;
    paceSeconds = speedKpm > 0 ? 1 / speedKpm * 60 : 0;
  }

  if (paceSeconds > 1200 || paceSeconds <= 0) return "Walk";
  return formatDuration(paceSeconds);
};

// --- Health Calculations ---
export const getMETs = (speedMps: number): number => {
  const speedKph = speedMps * 3.6;
  if (speedKph < 0.5) return 1.0; 
  if (speedKph < 4.0) return 3.0; 
  if (speedKph < 8.0) return 6.0; 
  if (speedKph < 11.0) return 9.8; 
  if (speedKph < 14.5) return 12.8; 
  return 16.0; 
};

export const calculateCaloriesPerSecondHR = (hr: number, profile: BodyProfile): number => {
  const { weight, age, gender } = profile;
  let kCalPerMin = 0;
  if (gender === 'male') {
    kCalPerMin = ((-55.0969 + (0.6309 * hr) + (0.1988 * weight) + (0.2017 * age)) / 4.184);
  } else {
    kCalPerMin = ((-20.4022 + (0.4472 * hr) - (0.1263 * weight) + (0.074 * age)) / 4.184);
  }
  if (hr < 40) return 0;
  return Math.max(0, kCalPerMin / 60);
};

export const calculateCaloriesPerSecondMETs = (speedMps: number, weightKg: number): number => {
  const mets = getMETs(speedMps);
  const kCalPerMin = (mets * 3.5 * weightKg) / 200;
  return kCalPerMin / 60;
};

// --- Advanced Smoothing & Training Logic ---

/**
 * Adaptive Smoother for GPS Speed.
 * Standard low-pass filters lag too much during sprints. 
 * This increases trust in raw data when acceleration is high.
 */
export class AdaptiveSmoother {
  private lastValue: number = 0;
  private alpha: number = 0.15; // Baseline smoothing (0.0 to 1.0)

  process(raw: number): number {
    // If jump is unrealistic (> 12 m/s aka 27mph), discard or clamp
    if (raw > 12) return this.lastValue; 

    // Detect high acceleration event (Sprint Start)
    const diff = Math.abs(raw - this.lastValue);
    
    // Dynamic Alpha: If difference is big, trust raw more (higher alpha)
    // If difference is small, trust history more (lower alpha)
    let dynamicAlpha = this.alpha;
    if (diff > 1.5) dynamicAlpha = 0.6; // React fast to sprints
    else if (diff > 0.5) dynamicAlpha = 0.3;

    this.lastValue = this.lastValue * (1 - dynamicAlpha) + raw * dynamicAlpha;
    return Math.max(0, this.lastValue);
  }

  reset() {
    this.lastValue = 0;
  }
}
