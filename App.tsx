
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapTracker } from './components/MapTracker';
import { MusicPacer } from './components/MusicPacer';
import { FuelGauge } from './components/FuelGauge';
import { HydrationGauge } from './components/HydrationGauge';
import { RouteBuilder } from './components/RouteBuilder';
import { saveRunToDatabase, generateSpeech, analyzeFood } from './services/geminiService';
import { fetchRouteSegment, getNearestPointIndex, calculateRemainingPathDistance } from './services/routingService';
import { AppView, GeoPoint, RunSettings, RunState, TrainingZone, Interval, RunMode } from './types';
import { 
  calculatePace, 
  formatDuration, 
  getDistanceFromLatLonInM, 
  METERS_TO_MILES, 
  METERS_TO_KM,
  LBS_TO_KG,
  calculateCaloriesPerSecondHR,
  calculateCaloriesPerSecondMETs,
  formatSpeed,
  AdaptiveSmoother,
  MPS_TO_MPH
} from './constants';

// Manual Base64 decode for TTS
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Geocoding Helpers ---
const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
    const data = await response.json();
    const parts = [];
    if (data.address) {
       if (data.address.city) parts.push(data.address.city);
       else if (data.address.town) parts.push(data.address.town);
       else if (data.address.village) parts.push(data.address.village);
       if (data.address.state) parts.push(data.address.state);
    }
    if (parts.length === 0 && data.display_name) return data.display_name.split(',')[0];
    return parts.join(', ') || "Unknown Location";
  } catch (e) {
    return "Unknown Location";
  }
};

const forwardGeocode = async (text: string): Promise<GeoPoint | null> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}`);
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        timestamp: Date.now(),
        speed: 0
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.MODE_SELECTION);
  const [gpsStatus, setGpsStatus] = useState<'off' | 'searching' | 'locked' | 'error'>('off');
  
  // Location State
  const [initialLocation, setInitialLocation] = useState<GeoPoint | null>(null);
  const [detectedAddress, setDetectedAddress] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [manualSearchTerm, setManualSearchTerm] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  
  // Route Management
  const [plannedPath, setPlannedPath] = useState<{lat: number, lng: number}[]>([]);
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [isRerouting, setIsRerouting] = useState(false);
  
  const [settings, setSettings] = useState<RunSettings>({
    mode: RunMode.ACADEMY,
    targetDistance: 5000, 
    splitDistance: 1609.34, 
    unit: 'imperial',
    bodyProfile: { weight: 70, age: 30, gender: 'male' },
    devices: { fitbitConnected: false, glucoseMonitorConnected: false },
    initialFuel: null,
    targetSpeed: 2.68 // Default to ~6mph (2.68 m/s)
  });

  const [weightInput, setWeightInput] = useState<number>(155); 
  const [foodInput, setFoodInput] = useState<string>("");
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
  const [routeSet, setRouteSet] = useState(false);

  // Manual Distance Input (for when not using Route Builder)
  const [manualDistanceInput, setManualDistanceInput] = useState<string>("3.1");

  const [runState, setRunState] = useState<RunState>({
    isActive: false, isPaused: false, startTime: null, elapsedTime: 0,
    totalDistance: 0, currentSpeed: 0, route: [], splits: [], intervals: [], plannedRoute: [],
    caloriesBurned: 0, caloriesConsumed: 0, fluidLostMl: 0, fluidIntakeMl: 0, currentHeartRate: 70, currentGlucose: null,
    currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE
  });

  const [manualHR, setManualHR] = useState<string>("");

  // Refs for logic engines
  const watchId = useRef<number | null>(null);
  const lastPosition = useRef<GeoPoint | null>(null);
  const accumulatedSplitDistance = useRef<number>(0);
  const splitStartTime = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastSpeedAlertTime = useRef<number>(0);
  
  // Advanced Smoothing & Interval Logic Refs
  const speedSmoother = useRef(new AdaptiveSmoother());
  const intervalState = useRef<{
    startTime: number;
    startDist: number;
    maxSpeed: number;
    pendingZone: TrainingZone;
    confirmationTimer: number; // Hysteresis timer
  }>({ startTime: 0, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 });

  // Route Tracking Refs
  const currentRouteIndexRef = useRef<number>(0); // Tracks where we are on the planned line
  const routeGracePeriodOver = useRef<boolean>(false); // Don't alert deviation in first 30s

  // Pedometer Refs
  const stepCountRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);
  const accelerationHistory = useRef<number[]>([]);

  // Voice Co-Pilot Refs
  const lastSpeechTime = useRef<number>(0);
  const lastDeviationCheck = useRef<number>(0);

  // --- Initial Location (For Route Builder) ---
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setInitialLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp,
          speed: pos.coords.speed
        });
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setDetectedAddress(addr);
      }, 
      (err) => console.log("Init GPS Error", err),
      { enableHighAccuracy: true }
    );
  }, []);

  // --- Route Planner Init Logic ---
  const handleOpenRoutePlanner = async () => {
    if (initialLocation && detectedAddress) {
       setShowLocationModal(true);
    } else if (initialLocation) {
       setIsGeocoding(true);
       const addr = await reverseGeocode(initialLocation.lat, initialLocation.lng);
       setDetectedAddress(addr);
       setIsGeocoding(false);
       setShowLocationModal(true);
    } else {
       setShowLocationModal(true);
    }
  };

  const confirmLocation = () => {
    setShowLocationModal(false);
    setView(AppView.ROUTE_BUILDER);
  };

  const handleManualSearch = async () => {
    if(!manualSearchTerm) return;
    setIsGeocoding(true);
    const point = await forwardGeocode(manualSearchTerm);
    setIsGeocoding(false);
    if (point) {
      setInitialLocation(point);
      setDetectedAddress(manualSearchTerm);
      setShowLocationModal(false);
      setView(AppView.ROUTE_BUILDER);
    } else {
      alert("Location not found. Try a City, State format.");
    }
  };

  // --- Voice Coach Logic ---
  const speakStatus = async (text: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastSpeechTime.current < 10000) return;
    lastSpeechTime.current = now;
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      const base64Audio = await generateSpeech(text);
      if (base64Audio && audioContextRef.current) {
        const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextRef.current, 24000, 1);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
      }
    } catch (e) {
      console.error("TTS Error:", e);
    }
  };

  // --- Food Analysis ---
  const handleFoodSubmit = async () => {
     if (!foodInput.trim()) return;
     setIsAnalyzingFood(true);
     try {
       const result = await analyzeFood(foodInput);
       setSettings(s => ({...s, initialFuel: result}));
       setFoodInput("");
     } catch (e) {
       alert("Could not analyze food. Try again.");
     } finally {
       setIsAnalyzingFood(false);
     }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setIsAnalyzingFood(true);
      try {
        const result = await analyzeFood(e.target.files[0]);
        setSettings(s => ({...s, initialFuel: result}));
      } catch (e) {
        alert("Could not analyze image.");
      } finally {
        setIsAnalyzingFood(false);
      }
    }
  };

  const handleRouteSave = (distanceMeters: number, route: any[]) => {
      setSettings(prev => ({
          ...prev,
          targetDistance: distanceMeters
      }));
      setPlannedPath(route); // Store locally
      setRouteSet(true);
      setView(AppView.SETUP);
  };

  // --- Rerouting Logic ---
  const checkDeviation = (currentPos: GeoPoint, planned: {lat: number, lng: number}[]) => {
    if (!planned || planned.length === 0) return;
    
    const now = Date.now();
    
    // GPS settling grace period (30 seconds)
    if (!routeGracePeriodOver.current) {
       if (runState.elapsedTime > 30) {
         routeGracePeriodOver.current = true;
       } else {
         return; // Skip deviation checks early on
       }
    }

    // Check every 5 seconds
    if (now - lastDeviationCheck.current < 5000) return;
    lastDeviationCheck.current = now;

    // Find nearest point on ENTIRE planned route to allow mid-run joins
    const { index, distance } = getNearestPointIndex(currentPos, planned);
    
    // Threshold: 60 meters (relaxed from 40m to account for corners/GPS drift)
    if (distance > 60) {
       if (!isOffRoute) {
          setIsOffRoute(true);
          speakStatus("You have drifted from your planned route. Reroute?", true);
       }
    } else {
       // We are ON route. Update our progress index.
       // This effectively "Snaps" to the route, even if we started at index 50.
       currentRouteIndexRef.current = index;
       
       if (isOffRoute) {
         setIsOffRoute(false);
         speakStatus("Back on track.", true);
       }
    }
  };

  const handleReroute = async () => {
    if (!lastPosition.current || runState.plannedRoute.length === 0) return;
    
    setIsRerouting(true);
    const destination = runState.plannedRoute[runState.plannedRoute.length - 1];
    
    const newRouteData = await fetchRouteSegment(
       { lat: lastPosition.current.lat, lng: lastPosition.current.lng }, 
       { lat: destination.lat, lng: destination.lng }
    );

    if (newRouteData) {
       setRunState(prev => ({
          ...prev,
          plannedRoute: newRouteData.path
       }));
       // Reset progress tracking to start of new route
       currentRouteIndexRef.current = 0;
       setIsOffRoute(false);
       speakStatus("Route updated.", true);
    } else {
       speakStatus("Could not find a new route. Try moving to a road.", true);
    }
    setIsRerouting(false);
  };

  // --- Pedometer Logic (DeviceMotion) ---
  useEffect(() => {
    const handleMotion = (event: DeviceMotionEvent) => {
      if (!runState.isActive || runState.isPaused) return;

      const acc = event.acceleration;
      if (!acc || !acc.x || !acc.y || !acc.z) return;
      const magnitude = Math.sqrt(acc.x*acc.x + acc.y*acc.y + acc.z*acc.z);
      accelerationHistory.current.push(magnitude);
      if (accelerationHistory.current.length > 5) accelerationHistory.current.shift();
      const avg = accelerationHistory.current.reduce((a,b)=>a+b,0) / accelerationHistory.current.length;
      if (avg > 1.5 && (Date.now() - lastStepTimeRef.current > 250)) {
         stepCountRef.current += 1;
         lastStepTimeRef.current = Date.now();
      }
    };
    if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', handleMotion);
    }
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('devicemotion', handleMotion);
    };
  }, [runState.isActive, runState.isPaused]);

  // --- Geolocation & Interval Engine ---
  useEffect(() => {
    if (runState.isActive && !runState.isPaused) {
      setGpsStatus('searching');
      speedSmoother.current.reset();

      const success = (position: GeolocationPosition) => {
          setGpsStatus('locked');
          const { latitude, longitude, speed } = position.coords;
          const timestamp = position.timestamp;
          
          let rawSpeed = speed || 0;
          if (rawSpeed < 0) rawSpeed = 0;
          const smoothedSpeed = speedSmoother.current.process(rawSpeed);

          setRunState(prev => {
            let addedDist = 0;
            if (lastPosition.current) {
              addedDist = getDistanceFromLatLonInM(lastPosition.current.lat, lastPosition.current.lng, latitude, longitude);
            }
            if (addedDist < 0.5 && rawSpeed < 0.2) addedDist = 0;

            const newTotalDistance = prev.totalDistance + addedDist;
            const newPoint: GeoPoint = { lat: latitude, lng: longitude, timestamp, speed: smoothedSpeed };

            // Check Deviation
            checkDeviation(newPoint, prev.plannedRoute);

            // Splits Logic
            accumulatedSplitDistance.current += addedDist;
            let newSplits = [...prev.splits];
            if (accumulatedSplitDistance.current >= settings.splitDistance) {
               const splitTime = (timestamp - (splitStartTime.current || timestamp)) / 1000;
               const pace = calculatePace(settings.splitDistance / splitTime, settings.unit);
               newSplits.push({
                 distanceLabel: `${newSplits.length + 1} ${settings.unit === 'imperial' ? 'mi' : 'km'}`,
                 timeSeconds: splitTime,
                 cumulativeTime: prev.elapsedTime,
                 pace: pace
               });
               speakStatus(`Split ${newSplits.length} complete. Pace: ${pace}.`, true);
               accumulatedSplitDistance.current = 0;
               splitStartTime.current = timestamp;
            }

            // Interval Logic (Simplified for brevity)
            let detectedZone = TrainingZone.AEROBIC;
            if (smoothedSpeed < 1.0) detectedZone = TrainingZone.IDLE;
            else if (smoothedSpeed > 4.0) detectedZone = TrainingZone.ANAEROBIC;
            
            const now = Date.now();
            if (detectedZone !== intervalState.current.pendingZone) {
               intervalState.current.pendingZone = detectedZone;
               intervalState.current.confirmationTimer = now;
            }

            let activeZone = prev.trainingZone;
            let newIntervals = [...prev.intervals];

            if (now - intervalState.current.confirmationTimer > 3000 && detectedZone !== activeZone) {
               if (prev.elapsedTime > 5) { 
                  const intervalDuration = (now - intervalState.current.startTime) / 1000;
                  const intervalDist = newTotalDistance - intervalState.current.startDist;
                  const intervalAvgSpeed = intervalDuration > 0 ? intervalDist / intervalDuration : 0;
                  if (intervalDuration > 10) { 
                    newIntervals.push({
                      id: newIntervals.length + 1,
                      type: activeZone === TrainingZone.ANAEROBIC ? 'SPRINT' : activeZone === TrainingZone.AEROBIC ? 'RECOVERY' : 'WARMUP',
                      startTime: intervalState.current.startTime,
                      duration: intervalDuration,
                      distance: intervalDist,
                      avgPace: calculatePace(intervalAvgSpeed, settings.unit),
                      avgSpeed: intervalAvgSpeed,
                      maxSpeed: intervalState.current.maxSpeed
                    });
                    if (activeZone === TrainingZone.ANAEROBIC) speakStatus("Sprint finished. Recover.", true);
                    else if (detectedZone === TrainingZone.ANAEROBIC) speakStatus("Sprint started!", true);
                  }
               }
               activeZone = detectedZone;
               intervalState.current.startTime = now;
               intervalState.current.startDist = newTotalDistance;
               intervalState.current.maxSpeed = 0;
            }

            lastPosition.current = newPoint;

            return {
              ...prev,
              totalDistance: newTotalDistance,
              currentSpeed: smoothedSpeed,
              route: [...prev.route, newPoint],
              splits: newSplits,
              intervals: newIntervals,
              trainingZone: activeZone
            };
          });
      };

      const error = (err: GeolocationPositionError) => {
        console.error("GPS Watch Error:", err);
        setGpsStatus('error');
      };

      navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true });
      watchId.current = navigator.geolocation.watchPosition(success, error, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } else {
      setGpsStatus('off');
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    }
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [runState.isActive, runState.isPaused, settings.splitDistance]);

  // --- Main Timer & Physics Loop ---
  useEffect(() => {
    let interval: number;
    if (runState.isActive && !runState.isPaused) {
      interval = window.setInterval(() => {
        setRunState(prev => {
          let hr = prev.currentHeartRate;
          if (manualHR) hr = parseInt(manualHR, 10);
          else {
            const target = prev.trainingZone === TrainingZone.ANAEROBIC ? 175 : prev.trainingZone === TrainingZone.AEROBIC ? 145 : 90;
            hr = Math.round(prev.currentHeartRate * 0.9 + target * 0.1);
          }
          let calsThisSecond = calculateCaloriesPerSecondMETs(prev.currentSpeed, settings.bodyProfile.weight);
          let battery = prev.anaerobicBattery;
          if (prev.trainingZone === TrainingZone.ANAEROBIC) {
             battery = Math.max(0, battery - 1.5); 
             calsThisSecond *= 1.5; 
          } else if (prev.trainingZone === TrainingZone.IDLE || prev.trainingZone === TrainingZone.AEROBIC) {
             battery = Math.min(100, battery + 0.2); 
          }
          const stepsInWindow = stepCountRef.current; 
          const spm = (stepsInWindow / (prev.elapsedTime || 1)) * 60; 
          const stride = spm > 0 ? (prev.currentSpeed * 60) / spm : 0;

          // --- Speed Monitoring Alert Check ---
          const now = Date.now();
          // Check every few seconds, debounced by 45s to avoid spam
          if (settings.targetSpeed && (now - lastSpeedAlertTime.current > 45000)) {
              const targetMps = settings.targetSpeed;
              const currentMps = prev.currentSpeed;
              // 1 MPH buffer (approx 0.447 m/s)
              const bufferMps = 0.447;

              // Trigger if speed is significantly below target AND we are still moving (e.g. > 0.5 m/s)
              if (currentMps > 0.5 && currentMps < (targetMps - bufferMps)) {
                  lastSpeedAlertTime.current = now;
                  
                  const currentMph = currentMps * MPS_TO_MPH;
                  
                  // Calculate Pace for a Mile
                  const secondsPerMile = currentMps > 0 ? 1609.34 / currentMps : 0;
                  const paceStr = formatDuration(secondsPerMile); // e.g. "12:00"

                  // Calculate Final Destination Time
                  // We use the Dynamic Remaining Route Distance + Offset, rather than purely target - ran.
                  // This handles starting mid-route.
                  let distRemaining = 0;
                  if (prev.plannedRoute.length > 0) {
                     distRemaining = calculateRemainingPathDistance(prev.plannedRoute, currentRouteIndexRef.current);
                  } else {
                     distRemaining = Math.max(0, settings.targetDistance - prev.totalDistance);
                  }

                  const secondsRemaining = currentMps > 0 ? distRemaining / currentMps : 0;
                  
                  let finishTimeStr = "";
                  const h = Math.floor(secondsRemaining / 3600);
                  const m = Math.floor((secondsRemaining % 3600) / 60);
                  
                  if (h > 0) finishTimeStr += `${h} hour${h !== 1 ? 's' : ''} `;
                  if (m > 0 || h === 0) finishTimeStr += `${m} minute${m !== 1 ? 's' : ''}`;
                  if (h === 0 && m === 0) finishTimeStr = "less than a minute";

                  // Construct the message
                  const msg = `You've slowed your pace to ${currentMph.toFixed(1)} miles per hour. At this pace, you'll complete a mile in ${paceStr.replace(':', ' minutes ')} seconds, and reach your final destination in ${finishTimeStr}.`;
                  
                  speakStatus(msg, true);
              }
          }

          return {
            ...prev,
            elapsedTime: prev.elapsedTime + 1,
            caloriesBurned: prev.caloriesBurned + calsThisSecond,
            fluidLostMl: prev.fluidLostMl + (12/60),
            currentHeartRate: hr,
            anaerobicBattery: battery,
            currentCadence: Math.min(240, Math.round(spm)),
            currentStrideLength: stride
          };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runState.isActive, runState.isPaused, manualHR, settings.targetSpeed, settings.targetDistance]);

  const handleStart = async () => {
    try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {}
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') { try { await (DeviceMotionEvent as any).requestPermission(); } catch (e) {} }

    const now = Date.now();
    const weightKg = settings.unit === 'imperial' ? weightInput * LBS_TO_KG : weightInput;
    
    // Determine target distance: Route Builder vs Manual Input
    let finalTarget = settings.targetDistance;
    if (!routeSet) {
       const manualDistVal = parseFloat(manualDistanceInput);
       if (!isNaN(manualDistVal) && manualDistVal > 0) {
          finalTarget = settings.unit === 'imperial' ? manualDistVal * 1609.34 : manualDistVal * 1000;
       }
    }

    setSettings(prev => ({ 
       ...prev, 
       bodyProfile: { ...prev.bodyProfile, weight: weightKg },
       targetDistance: finalTarget 
    }));
    
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    setRunState({
      ...runState, isActive: true, startTime: now, isPaused: false, route: [], 
      plannedRoute: plannedPath, // Import planned route here (might be empty)
      totalDistance: 0, elapsedTime: 0, splits: [], intervals: [], caloriesBurned: 0, caloriesConsumed: 0, 
      currentHeartRate: 75, fluidLostMl: 0, fluidIntakeMl: 0, currentGlucose: 95,
      currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE
    });
    
    speedSmoother.current.reset();
    stepCountRef.current = 0;
    splitStartTime.current = now;
    accumulatedSplitDistance.current = 0;
    lastPosition.current = null;
    lastDeviationCheck.current = 0;
    setIsOffRoute(false);
    
    // Reset Route Tracking Logic
    currentRouteIndexRef.current = 0;
    routeGracePeriodOver.current = false;

    intervalState.current = { startTime: now, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 };
    lastSpeedAlertTime.current = now; // Reset alert timer so we don't alert immediately on start
    
    setView(AppView.RUNNING);
    speakStatus("Training session started.", true);
  };

  const handleHydrate = () => {
    setRunState(prev => ({ ...prev, fluidIntakeMl: prev.fluidIntakeMl + 150 }));
  };
  
  const handleRefuel = () => {
     // Adds 100 calories (typical gel)
     setRunState(prev => ({ ...prev, caloriesConsumed: prev.caloriesConsumed + 100 }));
  };

  const handleModeSelect = (mode: RunMode) => {
    setSettings(prev => ({ ...prev, mode }));
    setView(AppView.SETUP);
  };

  const displayDistance = useMemo(() => {
    const d = settings.unit === 'imperial' ? runState.totalDistance * METERS_TO_MILES : runState.totalDistance * METERS_TO_KM;
    return d.toFixed(2);
  }, [runState.totalDistance, settings.unit]);

  const displaySpeed = formatSpeed(runState.currentSpeed, settings.unit);
  const displayPace = calculatePace(runState.currentSpeed, settings.unit);

  const renderLocationModal = () => (
    <div className="fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center p-6 animate-fade-in backdrop-blur-sm">
       <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl">
          <div className="text-center">
             <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx="12" cy="9" r="2.5" /></svg>
             </div>
             {isGeocoding ? (
                <div className="py-8"><div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div><p className="text-slate-400 text-sm">Finding location...</p></div>
             ) : (
                <>
                  <h3 className="text-xl font-bold text-white mb-2">Confirm Start Point</h3>
                  {detectedAddress ? (
                     <p className="text-slate-300 text-sm mb-6">I see you're in <strong className="text-white block text-lg mt-1">{detectedAddress}</strong><span className="block mt-1 text-slate-500 text-xs">Is that correct?</span></p>
                  ) : <p className="text-slate-300 text-sm mb-6">We couldn't detect your exact address. Please enter it manually.</p>}
                  <div className="space-y-3">
                     {detectedAddress && <button onClick={confirmLocation} className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold rounded-xl transition-all">Yes, Start Here</button>}
                     <div className="relative">
                        <div className="text-xs text-slate-500 font-bold uppercase mb-2 text-left">{detectedAddress ? "Or change location" : "Enter Location"}</div>
                        <div className="flex gap-2">
                           <input type="text" className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-teal-500 outline-none" placeholder="City, State or Zip" value={manualSearchTerm} onChange={(e) => setManualSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}/>
                           <button onClick={handleManualSearch} className="bg-slate-700 hover:bg-slate-600 text-white px-4 rounded-xl font-bold text-sm">Search</button>
                        </div>
                     </div>
                     <button onClick={() => setShowLocationModal(false)} className="mt-4 text-slate-500 text-xs font-bold uppercase hover:text-slate-300">Cancel</button>
                  </div>
                </>
             )}
          </div>
       </div>
    </div>
  );

  const renderModeSelection = () => (
    <div className="flex flex-col h-full p-6 animate-fade-in max-w-md mx-auto w-full pb-12 relative">
       <div className="text-center mt-6 flex flex-col items-center mb-8">
          <img src="/logo.svg" alt="EmbraceHealth.ai" className="h-16 mb-2" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-2">Select Your Mission</p>
       </div>
       <div className="space-y-3">
          <button onClick={() => handleModeSelect(RunMode.ACADEMY)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
             <div className="w-12 h-12 rounded-full bg-teal-500/10 text-teal-500 flex items-center justify-center group-hover:bg-teal-500 group-hover:text-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
             </div>
             <div className="text-left">
                <h3 className="text-white font-bold text-lg">Academy / PT Test</h3>
                <p className="text-slate-400 text-xs">Timed performance & pacing</p>
             </div>
          </button>

          <button onClick={() => handleModeSelect(RunMode.TRAIL)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
             <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 19l-2-2m0 0l-2 2m2-2V5a2 2 0 012-2h4a2 2 0 012 2v5l3 3m-9 9l4-4m0 0l4 4m-4-4V5"/></svg>
             </div>
             <div className="text-left">
                <h3 className="text-white font-bold text-lg">Trail & Explorer</h3>
                <p className="text-slate-400 text-xs">Environmental focus & GPS</p>
             </div>
          </button>

          <button onClick={() => handleModeSelect(RunMode.TRACK)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
             <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v-3a9 9 0 0 1 18 0v3m-18 0v3a9 9 0 0 0 18 0v-3"/></svg>
             </div>
             <div className="text-left">
                <h3 className="text-white font-bold text-lg">Track & Speedwork</h3>
                <p className="text-slate-400 text-xs">Intensity intervals & splits</p>
             </div>
          </button>

          <button onClick={() => handleModeSelect(RunMode.ENDURANCE)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
             <div className="w-12 h-12 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center group-hover:bg-orange-500 group-hover:text-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/></svg>
             </div>
             <div className="text-left">
                <h3 className="text-white font-bold text-lg">Endurance / Marathon</h3>
                <p className="text-slate-400 text-xs">Volume, health & fuel</p>
             </div>
          </button>

          <button onClick={() => handleModeSelect(RunMode.CASUAL)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
             <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center group-hover:bg-purple-500 group-hover:text-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
             </div>
             <div className="text-left">
                <h3 className="text-white font-bold text-lg">Casual / Weight Loss</h3>
                <p className="text-slate-400 text-xs">Motivation & simplicity</p>
             </div>
          </button>
       </div>
    </div>
  );

  const renderSetup = () => (
    <div className="flex flex-col h-full p-6 animate-fade-in max-w-md mx-auto w-full pb-12 relative">
      <div className="flex-1 space-y-6">
        <div className="flex items-center gap-2 mt-4">
             <button onClick={() => setView(AppView.MODE_SELECTION)} className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
             </button>
             <h2 className="text-white font-bold text-lg">{settings.mode === RunMode.ACADEMY ? 'Academy Mode' : settings.mode === RunMode.TRAIL ? 'Trail Mode' : settings.mode === RunMode.TRACK ? 'Track Mode' : settings.mode === RunMode.ENDURANCE ? 'Endurance Mode' : 'Casual Mode'}</h2>
        </div>
        <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
           <div className="text-center p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <h3 className="text-indigo-400 font-black uppercase text-sm mb-2">Interval Mode Ready</h3>
              <p className="text-slate-400 text-xs leading-relaxed">This app uses <strong>Auto-Lap</strong> detection. Sprints (&gt;10mph) and Recovery jogs are detected automatically.</p>
           </div>
          <div className="flex bg-slate-900 rounded-xl p-1 shadow-inner">
            <button onClick={() => setSettings(s => ({...s, unit: 'imperial'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'imperial' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Imperial</button>
            <button onClick={() => setSettings(s => ({...s, unit: 'metric'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'metric' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Metric</button>
          </div>

          {/* Route or Simple Distance Input */}
          <button onClick={handleOpenRoutePlanner} className={`w-full group relative overflow-hidden rounded-2xl border-2 transition-all active:scale-95 text-left p-0 ${routeSet ? 'border-orange-500 bg-orange-950/20' : 'border-slate-700 bg-slate-900'}`}>
             <div className="absolute inset-0 bg-[url('https://maps.wikimedia.org/img/osm-intl,13,37.7749,-122.4194,300x150.png')] bg-cover opacity-20 group-hover:opacity-40 transition-opacity mix-blend-overlay"></div>
             <div className="relative p-6 flex items-center justify-between">
                <div>
                   <div className="flex items-center gap-2 mb-1">
                      <div className={`p-1.5 rounded-lg ${routeSet ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-300'}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg></div>
                      <span className={`text-xs font-black uppercase tracking-wider ${routeSet ? 'text-orange-400' : 'text-slate-400'}`}>{routeSet ? 'Route Loaded' : 'Route Planner'}</span>
                   </div>
                   <h3 className="text-xl font-black text-white italic">{routeSet ? 'Custom Course' : 'Create New Route'}</h3>
                   {routeSet && <div className="text-xs text-slate-400 font-bold mt-1">{(settings.targetDistance / (settings.unit === 'imperial' ? 1609.34 : 1000)).toFixed(2)} {settings.unit === 'imperial' ? 'mi' : 'km'} Target</div>}
                </div>
                {!routeSet && <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>}
                {routeSet && <div className="h-10 w-10 rounded-full bg-orange-500 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
             </div>
          </button>
          
          {/* Simple Manual Distance Override */}
          {!routeSet && (
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 flex items-center gap-4">
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Or Quick Target</label>
                    <div className="flex items-baseline gap-2">
                        <input type="number" value={manualDistanceInput} onChange={(e) => setManualDistanceInput(e.target.value)} className="w-20 bg-transparent text-2xl font-black italic text-white outline-none" placeholder="3.1" />
                        <span className="text-sm font-bold text-slate-500">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
                    </div>
                </div>
                <div className="w-px h-10 bg-slate-700"></div>
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Body Weight</label>
                    <div className="flex items-baseline gap-2">
                        <input type="number" value={weightInput} onChange={(e) => setWeightInput(parseFloat(e.target.value))} className="w-16 bg-transparent text-2xl font-black italic text-white outline-none" />
                        <span className="text-sm font-bold text-slate-500">{settings.unit === 'imperial' ? 'lbs' : 'kg'}</span>
                    </div>
                </div>
            </div>
          )}

          {/* Food Analysis Section (Restored) */}
          <div className="pt-2">
            <h4 className="text-[10px] font-black uppercase text-slate-500 mb-2">Pre-Race Fuel</h4>
            {settings.initialFuel ? (
              <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-3 flex justify-between items-center">
                 <div><div className="text-emerald-400 font-bold text-sm">{settings.initialFuel.description}</div><div className="text-xs text-emerald-600 font-bold">{settings.initialFuel.calories} kcal</div></div>
                 <button onClick={() => setSettings(s => ({...s, initialFuel: null}))} className="text-slate-400 hover:text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            ) : (
              <div className="flex gap-2">
                 <input type="text" value={foodInput} onChange={(e) => setFoodInput(e.target.value)} placeholder="e.g. Banana and oatmeal" className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 text-sm text-white focus:border-teal-500 outline-none" />
                 <button onClick={handleFoodSubmit} disabled={isAnalyzingFood} className="bg-slate-700 hover:bg-slate-600 text-white px-3 rounded-xl flex items-center justify-center disabled:opacity-50">{isAnalyzingFood ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>}</button>
                 <label className="bg-slate-700 hover:bg-slate-600 text-white w-12 rounded-xl flex items-center justify-center cursor-pointer">
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                 </label>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-700/50">
             <button onClick={handleStart} className="w-full py-5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-2xl rounded-2xl shadow-[0_10px_40px_rgba(20,184,166,0.3)] transform active:scale-95 transition-all italic">START TRAINING</button>
          </div>
        </div>
      </div>
      {showLocationModal && renderLocationModal()}
    </div>
  );

  const renderRunning = () => (
    <div className={`flex flex-col h-screen overflow-hidden relative transition-colors duration-1000 ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-950' : 'bg-black'}`}>
      <div className="bg-zinc-900/80 backdrop-blur-xl border-b border-white/5 p-6 z-10">
        <div className="flex justify-between items-center mb-2">
           <div className="flex items-center gap-3">
             <div className={`w-8 h-8 rounded-full flex items-center justify-center ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-500 animate-pulse' : 'bg-teal-500'}`}><span className="text-white font-black text-xs">{runState.trainingZone === TrainingZone.ANAEROBIC ? 'SPR' : 'RUN'}</span></div>
             <div><span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest block">Time</span><h2 className="text-3xl font-black italic text-white leading-none tracking-tighter">{formatDuration(runState.elapsedTime)}</h2></div>
           </div>
           <div className="flex flex-col items-end">
             <div className="flex items-center gap-1 mb-1">
               {gpsStatus === 'locked' ? <span className="text-[10px] text-teal-500 font-bold uppercase">GPS Ready</span> : <span className="text-[10px] text-amber-500 font-bold uppercase animate-pulse">Searching...</span>}
               <div className={`w-2 h-2 rounded-full ${gpsStatus === 'locked' ? 'bg-teal-500' : 'bg-amber-500'}`}></div>
             </div>
             <div className="text-right"><span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Distance</span><h2 className="text-4xl font-black italic text-teal-400 leading-none tracking-tighter">{displayDistance} <span className="text-lg text-zinc-600 not-italic">{settings.unit === 'imperial' ? 'mi' : 'km'}</span></h2></div>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48 scrollbar-hide">
        <div className="bg-gradient-to-br from-zinc-900 to-black p-8 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center relative shadow-2xl overflow-hidden">
          <div className="absolute top-4 left-6 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Speedometer</div>
          <div className="relative z-10"><div className="text-[120px] font-black italic tracking-tighter text-white leading-none transform -skew-x-6 drop-shadow-2xl">{displaySpeed}</div><div className="absolute -bottom-2 right-0 text-xl font-black text-teal-500 italic uppercase">{settings.unit === 'imperial' ? 'MPH' : 'KPH'}</div></div>
          <div className="mt-4 flex gap-8 z-10">
            <div className="text-center"><div className="text-[10px] font-black text-zinc-500 uppercase">Current Pace</div><div className="text-2xl font-black text-white italic">{displayPace}</div></div>
            <div className="text-center"><div className="text-[10px] font-black text-zinc-500 uppercase">Matches Left</div><div className={`text-2xl font-black italic ${runState.anaerobicBattery < 20 ? 'text-red-500 animate-pulse' : 'text-indigo-400'}`}>{Math.round(runState.anaerobicBattery)}%</div></div>
          </div>
          <div className={`absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'from-indigo-600/40' : 'from-teal-600/10'} to-transparent opacity-50`}></div>
        </div>

        {/* Off-Route Alert & Reroute Button */}
        {isOffRoute && (
           <div className="bg-amber-500/10 border border-amber-500/50 rounded-2xl p-4 flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-full bg-amber-500 text-black flex items-center justify-center animate-pulse">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                 </div>
                 <div>
                    <h4 className="font-bold text-amber-500 text-sm uppercase">Off Route</h4>
                    <p className="text-xs text-amber-200">Deviation detected.</p>
                 </div>
              </div>
              <button 
                 onClick={handleReroute} 
                 disabled={isRerouting}
                 className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold uppercase text-xs rounded-lg transition-colors flex items-center gap-2"
              >
                 {isRerouting ? 'Updating...' : 'Reroute'}
                 {!isRerouting && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>}
              </button>
           </div>
        )}

        <MapTracker 
           route={runState.route} 
           currentLocation={runState.route[runState.route.length - 1] || null} 
           plannedRoute={runState.plannedRoute}
           initialCenter={initialLocation}
        />
        {/* Remaining Widgets */}
        <div className="grid grid-cols-4 gap-2">
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="flex items-center gap-1 text-[10px] font-black text-red-500 uppercase mb-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></div> HR</div><div className="text-2xl font-black italic text-white">{runState.currentHeartRate} <span className="text-[8px] not-italic text-zinc-600">BPM</span></div></div>
           <FuelGauge startCalories={settings.initialFuel ? settings.initialFuel.calories : 0} consumedCalories={runState.caloriesConsumed} burnedCalories={runState.caloriesBurned} onRefuel={handleRefuel} />
           <HydrationGauge fluidLost={runState.fluidLostMl} fluidIntake={runState.fluidIntakeMl} onHydrate={handleHydrate} />
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="text-[10px] font-black text-purple-500 uppercase mb-1">Cadence</div><div className="text-xl font-black italic text-white">{runState.currentCadence > 0 ? runState.currentCadence : '--'}</div><div className="text-[8px] not-italic text-zinc-600 font-bold uppercase">SPM</div></div>
        </div>
        <MusicPacer 
          currentPace={displayPace} 
          targetSpeedMps={settings.targetSpeed}
          onTargetSpeedChange={(mps) => setSettings(s => ({...s, targetSpeed: mps}))}
        />
      </div>
      <div className="fixed bottom-10 left-0 right-0 px-8 flex justify-center gap-6 z-[1000]">
        <button onClick={() => setRunState(p => ({ ...p, isPaused: !p.isPaused }))} className={`h-24 w-24 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${runState.isPaused ? 'bg-teal-500 text-black' : 'bg-white text-black'}`}>{runState.isPaused ? <svg className="w-12 h-12 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> : <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}</button>
        {runState.isPaused && <button onClick={() => setView(AppView.SUMMARY)} className="h-24 w-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl text-white transform scale-110 active:scale-90"><svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg></button>}
      </div>
    </div>
  );

  return (
    <div className="bg-black min-h-screen text-white font-sans selection:bg-teal-500/30 overflow-x-hidden">
      {view === AppView.MODE_SELECTION && renderModeSelection()}
      {view === AppView.SETUP && renderSetup()}
      {view === AppView.RUNNING && renderRunning()}
      {view === AppView.ROUTE_BUILDER && <RouteBuilder onClose={() => setView(AppView.SETUP)} onSave={handleRouteSave} unit={settings.unit} initialCenter={initialLocation} />}
      {view === AppView.SUMMARY && (
        <div className="p-8 max-w-md mx-auto h-screen flex flex-col justify-center animate-fade-in">
           <div className="bg-zinc-900 rounded-[3rem] p-10 border border-white/5 text-center shadow-2xl">
              <h2 className="text-5xl font-black italic tracking-tighter text-teal-400 mb-2 uppercase">Finish</h2>
              <div className="grid grid-cols-2 gap-4 my-8"><div className="bg-black/50 p-4 rounded-3xl"><div className="text-[10px] font-black text-zinc-600 uppercase">Total Distance</div><div className="text-2xl font-black italic">{displayDistance} {settings.unit === 'imperial' ? 'mi' : 'km'}</div></div><div className="bg-black/50 p-4 rounded-3xl"><div className="text-[10px] font-black text-zinc-600 uppercase">Intervals</div><div className="text-2xl font-black italic text-indigo-400">{runState.intervals.filter(i => i.type === 'SPRINT').length}</div></div></div>
              <button onClick={() => setView(AppView.MODE_SELECTION)} className="w-full py-5 bg-white text-black font-black uppercase italic rounded-2xl hover:bg-zinc-200 transition-all">Start New Run</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
