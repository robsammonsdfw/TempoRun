
import { BodyProfile } from './types';

export const METERS_TO_MILES = 0.000621371;
export const METERS_TO_KM = 0.001;
export const LBS_TO_KG = 0.453592;

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

// Convert Speed (m/s) to Pace (mm:ss per mile/km)
export const calculatePace = (speedMps: number, unit: 'imperial' | 'metric'): string => {
  if (speedMps <= 0.1) return "-:--"; // Not moving significantly

  let paceSeconds = 0;
  if (unit === 'imperial') {
    // Minutes per Mile
    const speedMpm = speedMps * 60 * METERS_TO_MILES;
    paceSeconds = 1 / speedMpm * 60;
  } else {
    // Minutes per KM
    const speedKpm = speedMps * 60 * METERS_TO_KM;
    paceSeconds = 1 / speedKpm * 60;
  }

  // Cap readable pace at 20 min/mile for walking
  if (paceSeconds > 1200) return "Walk";

  return formatDuration(paceSeconds);
};

// --- Health Calculations ---

/**
 * Estimates Metabolic Equivalent of Task (METs) based on speed (m/s)
 */
export const getMETs = (speedMps: number): number => {
  const speedKph = speedMps * 3.6;
  if (speedKph < 0.5) return 1.0; // Resting
  if (speedKph < 4.0) return 3.0; // Walking
  if (speedKph < 8.0) return 6.0; // Jogging
  if (speedKph < 11.0) return 9.8; // Running 6mph
  if (speedKph < 14.5) return 12.8; // Running 9mph
  return 16.0; // Sprinting
};

/**
 * Calculates calories burned per SECOND based on Heart Rate
 * Formula: Keytel et al.
 */
export const calculateCaloriesPerSecondHR = (
  hr: number, 
  profile: BodyProfile
): number => {
  const { weight, age, gender } = profile;
  let kCalPerMin = 0;

  if (gender === 'male') {
    // (-55.0969 + 0.6309 x HR + 0.1988 x W + 0.2017 x A) / 4.184
    kCalPerMin = ((-55.0969 + (0.6309 * hr) + (0.1988 * weight) + (0.2017 * age)) / 4.184);
  } else {
    // (-20.4022 + 0.4472 x HR - 0.1263 x W + 0.074 x A) / 4.184
    kCalPerMin = ((-20.4022 + (0.4472 * hr) - (0.1263 * weight) + (0.074 * age)) / 4.184);
  }

  // Fallback to METs if HR is unreasonably low (sensor error or not wearing)
  if (hr < 40) return 0;

  return Math.max(0, kCalPerMin / 60);
};

/**
 * Fallback calorie calc based on METs (speed) if HR missing
 */
export const calculateCaloriesPerSecondMETs = (speedMps: number, weightKg: number): number => {
  const mets = getMETs(speedMps);
  // Kcal/min = (METs * 3.5 * weightKg) / 200
  const kCalPerMin = (mets * 3.5 * weightKg) / 200;
  return kCalPerMin / 60;
};
