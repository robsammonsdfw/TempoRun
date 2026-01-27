
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapTracker } from './components/MapTracker';
import { MusicPacer } from './components/MusicPacer';
import { FuelGauge } from './components/FuelGauge';
import { HydrationGauge } from './components/HydrationGauge';
import { RouteBuilder } from './components/RouteBuilder';
import { saveRunToDatabase, generateSpeech, analyzeFood } from './services/geminiService';
import { AppView, GeoPoint, RunSettings, RunState, TrainingZone, Interval } from './types';
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
  AdaptiveSmoother
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
  const [view, setView] = useState<AppView>(AppView.SETUP);
  const [gpsStatus, setGpsStatus] = useState<'off' | 'searching' | 'locked' | 'error'>('off');
  
  // Location State
  const [initialLocation, setInitialLocation] = useState<GeoPoint | null>(null);
  const [detectedAddress, setDetectedAddress] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [manualSearchTerm, setManualSearchTerm] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  
  const [settings, setSettings] = useState<RunSettings>({
    targetDistance: 5000, 
    splitDistance: 1609.34, 
    unit: 'imperial',
    bodyProfile: { weight: 70, age: 30, gender: 'male' },
    devices: { fitbitConnected: false, glucoseMonitorConnected: false },
    initialFuel: null
  });

  const [weightInput, setWeightInput] = useState<number>(155); 
  const [foodInput, setFoodInput] = useState<string>("");
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
  const [routeSet, setRouteSet] = useState(false);

  const [runState, setRunState] = useState<RunState>({
    isActive: false, isPaused: false, startTime: null, elapsedTime: 0,
    totalDistance: 0, currentSpeed: 0, route: [], splits: [], intervals: [],
    caloriesBurned: 0, fluidLostMl: 0, fluidIntakeMl: 0, currentHeartRate: 70, currentGlucose: null,
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
  
  // Advanced Smoothing & Interval Logic Refs
  const speedSmoother = useRef(new AdaptiveSmoother());
  const intervalState = useRef<{
    startTime: number;
    startDist: number;
    maxSpeed: number;
    pendingZone: TrainingZone;
    confirmationTimer: number; // Hysteresis timer
  }>({ startTime: 0, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 });

  // Pedometer Refs
  const stepCountRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);
  const accelerationHistory = useRef<number[]>([]);

  // Voice Co-Pilot Refs
  const lastSpeechTime = useRef<number>(0);
  const lowFuelWarned = useRef<boolean>(false);

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
        // Background reverse geocode
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setDetectedAddress(addr);
      }, 
      (err) => console.log("Init GPS Error", err),
      { enableHighAccuracy: true }
    );
  }, []);

  // --- Route Planner Init Logic ---
  const handleOpenRoutePlanner = async () => {
    // If we already have a location and address, show confirmation
    if (initialLocation && detectedAddress) {
       setShowLocationModal(true);
    } 
    // If we have location but no address yet, try to fetch it then show modal
    else if (initialLocation) {
       setIsGeocoding(true);
       const addr = await reverseGeocode(initialLocation.lat, initialLocation.lng);
       setDetectedAddress(addr);
       setIsGeocoding(false);
       setShowLocationModal(true);
    }
    // If no location at all (permissions?), show modal in manual mode
    else {
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
      setDetectedAddress(manualSearchTerm); // Or fetch real address from point
      // Auto confirm if found
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
      setRouteSet(true);
      setView(AppView.SETUP);
  };

  // --- Pedometer Logic (DeviceMotion) ---
  useEffect(() => {
    const handleMotion = (event: DeviceMotionEvent) => {
      if (!runState.isActive || runState.isPaused) return;

      const acc = event.acceleration;
      if (!acc || !acc.x || !acc.y || !acc.z) return;

      // Simple magnitude calculation
      const magnitude = Math.sqrt(acc.x*acc.x + acc.y*acc.y + acc.z*acc.z);
      
      // Zero-crossing / Peak detection for step counting
      // Threshold typically around 1.0 - 1.5 m/s^2 above gravity (but acceleration object usually has gravity removed or we use accelerationIncludingGravity)
      // If using `acceleration`, gravity is removed. 
      // We look for peaks > 1.2
      
      accelerationHistory.current.push(magnitude);
      if (accelerationHistory.current.length > 5) accelerationHistory.current.shift();

      const avg = accelerationHistory.current.reduce((a,b)=>a+b,0) / accelerationHistory.current.length;
      
      if (avg > 1.5 && (Date.now() - lastStepTimeRef.current > 250)) { // 250ms debounce (max 240 SPM)
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
          
          // 1. Process Speed
          let rawSpeed = speed || 0;
          if (rawSpeed < 0) rawSpeed = 0;
          const smoothedSpeed = speedSmoother.current.process(rawSpeed);

          setRunState(prev => {
            // Distance Calc
            let addedDist = 0;
            if (lastPosition.current) {
              addedDist = getDistanceFromLatLonInM(lastPosition.current.lat, lastPosition.current.lng, latitude, longitude);
            }
            // Basic jitter filter (ignore extremely tiny movements if speed is low)
            if (addedDist < 0.5 && rawSpeed < 0.2) addedDist = 0;

            const newTotalDistance = prev.totalDistance + addedDist;
            const newPoint: GeoPoint = { lat: latitude, lng: longitude, timestamp, speed: smoothedSpeed };

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

            // --- INTERVAL STATE MACHINE ---
            // Thresholds:
            // Sprint > 4.5 m/s (~10mph) or significantly higher than average
            // Aerobic > 2.0 m/s (~4.5mph)
            // Idle < 1.0 m/s
            
            let detectedZone = TrainingZone.AEROBIC;
            if (smoothedSpeed < 1.0) detectedZone = TrainingZone.IDLE;
            else if (smoothedSpeed > 4.0) detectedZone = TrainingZone.ANAEROBIC; // Hard threshold for demo

            // Hysteresis Logic: Wait 3 seconds to confirm zone change
            const now = Date.now();
            if (detectedZone !== intervalState.current.pendingZone) {
               intervalState.current.pendingZone = detectedZone;
               intervalState.current.confirmationTimer = now;
            }

            let activeZone = prev.trainingZone;
            let newIntervals = [...prev.intervals];

            // If confirmed change
            if (now - intervalState.current.confirmationTimer > 3000 && detectedZone !== activeZone) {
               // CLOSE PREVIOUS INTERVAL
               if (prev.elapsedTime > 5) { // don't log startup
                  const intervalDuration = (now - intervalState.current.startTime) / 1000;
                  const intervalDist = newTotalDistance - intervalState.current.startDist;
                  const intervalAvgSpeed = intervalDuration > 0 ? intervalDist / intervalDuration : 0;
                  
                  if (intervalDuration > 10) { // Only log > 10s intervals
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
                    
                    if (activeZone === TrainingZone.ANAEROBIC) {
                       speakStatus(`Sprint finished. ${formatDuration(intervalDuration)}. Recover now.`, true);
                    } else if (detectedZone === TrainingZone.ANAEROBIC) {
                       speakStatus("Sprint started! Go go go!", true);
                    }
                  }
               }
               
               // RESET FOR NEW ZONE
               activeZone = detectedZone;
               intervalState.current.startTime = now;
               intervalState.current.startDist = newTotalDistance;
               intervalState.current.maxSpeed = 0;
            }

            // Update Max Speed for current interval
            if (smoothedSpeed > intervalState.current.maxSpeed) {
              intervalState.current.maxSpeed = smoothedSpeed;
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
      watchId.current = navigator.geolocation.watchPosition(success, error, { 
        enableHighAccuracy: true, 
        timeout: 15000, 
        maximumAge: 0 
      });
    } else {
      setGpsStatus('off');
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    }
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [runState.isActive, runState.isPaused, settings.splitDistance]);

  // --- Main Timer & Physics Loop (1Hz) ---
  useEffect(() => {
    let interval: number;
    if (runState.isActive && !runState.isPaused) {
      interval = window.setInterval(() => {
        setRunState(prev => {
          // Heart Rate Logic
          let hr = prev.currentHeartRate;
          if (manualHR) hr = parseInt(manualHR, 10);
          else {
            // Simulate HR based on Zone
            const target = prev.trainingZone === TrainingZone.ANAEROBIC ? 175 : prev.trainingZone === TrainingZone.AEROBIC ? 145 : 90;
            hr = Math.round(prev.currentHeartRate * 0.9 + target * 0.1);
          }

          // Energy Calculations
          let calsThisSecond = calculateCaloriesPerSecondMETs(prev.currentSpeed, settings.bodyProfile.weight);
          
          // Anaerobic Battery Logic ("Matches")
          // Drain if sprinting (speed > 4m/s). Drain rate depends on speed.
          // Recharge if recovering (speed < 2.5m/s). Recharge is slow.
          let battery = prev.anaerobicBattery;
          if (prev.trainingZone === TrainingZone.ANAEROBIC) {
             battery = Math.max(0, battery - 1.5); // Drain ~1.5% per second of sprint
             calsThisSecond *= 1.5; // EPOC Burn Multiplier
          } else if (prev.trainingZone === TrainingZone.IDLE || prev.trainingZone === TrainingZone.AEROBIC) {
             battery = Math.min(100, battery + 0.2); // Recharge 0.2% per second
          }

          // Cadence & Stride Logic
          // We count steps in the last second (approx by diffing refs) - effectively SPM is calculated over longer window usually
          // For realtime viz, we just use a simplified model here or rely on the event listener
          // Calculate SPM based on steps in last 5 seconds ideally, but here we estimate
          const stepsInWindow = stepCountRef.current; 
          const spm = (stepsInWindow / (prev.elapsedTime || 1)) * 60; // Average SPM overall
          // Instant SPM is harder without a rolling window, let's use a 5s rolling average in reality
          // For this specific 1s update:
          const stride = spm > 0 ? (prev.currentSpeed * 60) / spm : 0;

          return {
            ...prev,
            elapsedTime: prev.elapsedTime + 1,
            caloriesBurned: prev.caloriesBurned + calsThisSecond,
            fluidLostMl: prev.fluidLostMl + (12/60),
            currentHeartRate: hr,
            anaerobicBattery: battery,
            currentCadence: Math.min(240, Math.round(spm)), // Cap at human limit
            currentStrideLength: stride
          };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runState.isActive, runState.isPaused, manualHR]);

  const handleStart = async () => {
    // Request Wake Lock
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn("Wake Lock rejected", err);
    }

    // Permission for iOS Motion
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        await (DeviceMotionEvent as any).requestPermission();
      } catch (e) { console.warn(e); }
    }

    const now = Date.now();
    const weightKg = settings.unit === 'imperial' ? weightInput * LBS_TO_KG : weightInput;
    setSettings(prev => ({ ...prev, bodyProfile: { ...prev.bodyProfile, weight: weightKg } }));
    
    // Audio Context
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    // Reset State
    setRunState({
      ...runState, isActive: true, startTime: now, isPaused: false, route: [], 
      totalDistance: 0, elapsedTime: 0, splits: [], intervals: [], caloriesBurned: 0, 
      currentHeartRate: 75, fluidLostMl: 0, fluidIntakeMl: 0, currentGlucose: 95,
      currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE
    });
    
    // Reset Refs
    speedSmoother.current.reset();
    stepCountRef.current = 0;
    splitStartTime.current = now;
    accumulatedSplitDistance.current = 0;
    lastPosition.current = null;
    intervalState.current = { startTime: now, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 };
    
    setView(AppView.RUNNING);
    speakStatus("Training session started. GPS locked. Good luck.", true);
  };

  const handleHydrate = () => {
    setRunState(prev => ({ ...prev, fluidIntakeMl: prev.fluidIntakeMl + 150 }));
  };

  const displayDistance = useMemo(() => {
    const d = settings.unit === 'imperial' ? runState.totalDistance * METERS_TO_MILES : runState.totalDistance * METERS_TO_KM;
    return d.toFixed(2);
  }, [runState.totalDistance, settings.unit]);

  const displaySpeed = formatSpeed(runState.currentSpeed, settings.unit);
  const displayPace = calculatePace(runState.currentSpeed, settings.unit);

  // --- Location Confirmation Modal ---
  const renderLocationModal = () => (
    <div className="fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center p-6 animate-fade-in backdrop-blur-sm">
       <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl">
          <div className="text-center">
             <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400">
                   <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                   <circle cx="12" cy="9" r="2.5" />
                </svg>
             </div>
             
             {isGeocoding ? (
                <div className="py-8">
                   <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                   <p className="text-slate-400 text-sm">Finding location...</p>
                </div>
             ) : (
                <>
                  <h3 className="text-xl font-bold text-white mb-2">Confirm Start Point</h3>
                  {detectedAddress ? (
                     <p className="text-slate-300 text-sm mb-6">
                        I see you're in <strong className="text-white block text-lg mt-1">{detectedAddress}</strong>
                        <span className="block mt-1 text-slate-500 text-xs">Is that correct?</span>
                     </p>
                  ) : (
                     <p className="text-slate-300 text-sm mb-6">We couldn't detect your exact address. Please enter it manually.</p>
                  )}

                  <div className="space-y-3">
                     {detectedAddress && (
                        <button onClick={confirmLocation} className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold rounded-xl transition-all">
                           Yes, Start Here
                        </button>
                     )}
                     
                     <div className="relative">
                        <div className="text-xs text-slate-500 font-bold uppercase mb-2 text-left">{detectedAddress ? "Or change location" : "Enter Location"}</div>
                        <div className="flex gap-2">
                           <input 
                              type="text" 
                              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-teal-500 outline-none"
                              placeholder="City, State or Zip"
                              value={manualSearchTerm}
                              onChange={(e) => setManualSearchTerm(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                           />
                           <button onClick={handleManualSearch} className="bg-slate-700 hover:bg-slate-600 text-white px-4 rounded-xl font-bold text-sm">
                              Search
                           </button>
                        </div>
                     </div>
                     
                     <button onClick={() => setShowLocationModal(false)} className="mt-4 text-slate-500 text-xs font-bold uppercase hover:text-slate-300">
                        Cancel
                     </button>
                  </div>
                </>
             )}
          </div>
       </div>
    </div>
  );

  const renderSetup = () => (
    <div className="flex flex-col h-full p-6 animate-fade-in max-w-md mx-auto w-full pb-12 relative">
      <div className="flex-1 space-y-6">
        <div className="text-center mt-6 flex flex-col items-center">
          <img src="/logo.svg" alt="EmbraceHealth.ai" className="h-16 mb-2" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-2">Performance Intervals</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
           <div className="text-center p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <h3 className="text-indigo-400 font-black uppercase text-sm mb-2">Interval Mode Ready</h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                This app uses <strong>Auto-Lap</strong> detection. Sprints (&gt;10mph) and Recovery jogs are detected automatically. 
                Keep your phone on your body for Step Analysis.
              </p>
           </div>

           {/* Unit Toggle */}
          <div className="flex bg-slate-900 rounded-xl p-1 shadow-inner">
            <button onClick={() => setSettings(s => ({...s, unit: 'imperial'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'imperial' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Imperial</button>
            <button onClick={() => setSettings(s => ({...s, unit: 'metric'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'metric' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Metric</button>
          </div>

          {/* New Prominent Route Builder Card */}
          <button 
             onClick={handleOpenRoutePlanner}
             className={`w-full group relative overflow-hidden rounded-2xl border-2 transition-all active:scale-95 text-left p-0
                ${routeSet ? 'border-orange-500 bg-orange-950/20' : 'border-slate-700 bg-slate-900'}
             `}
          >
             <div className="absolute inset-0 bg-[url('https://maps.wikimedia.org/img/osm-intl,13,37.7749,-122.4194,300x150.png')] bg-cover opacity-20 group-hover:opacity-40 transition-opacity mix-blend-overlay"></div>
             <div className="relative p-6 flex items-center justify-between">
                <div>
                   <div className="flex items-center gap-2 mb-1">
                      <div className={`p-1.5 rounded-lg ${routeSet ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                      <span className={`text-xs font-black uppercase tracking-wider ${routeSet ? 'text-orange-400' : 'text-slate-400'}`}>
                         {routeSet ? 'Route Loaded' : 'Route Planner'}
                      </span>
                   </div>
                   <h3 className="text-xl font-black text-white italic">
                      {routeSet ? 'Custom Course' : 'Create New Route'}
                   </h3>
                   {routeSet && (
                      <div className="text-xs text-slate-400 font-bold mt-1">
                         {(settings.targetDistance / (settings.unit === 'imperial' ? 1609.34 : 1000)).toFixed(2)} {settings.unit === 'imperial' ? 'mi' : 'km'} Target
                      </div>
                   )}
                </div>
                {!routeSet && <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>}
                {routeSet && <div className="h-10 w-10 rounded-full bg-orange-500 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
             </div>
          </button>

          {/* Quick Distance Input (Secondary) */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <label className="text-[10px] uppercase font-black text-slate-500 mb-2 block">Or Quick Distance Goal</label>
            <div className="relative">
               <input type="number" className="w-full bg-transparent border-b-2 border-slate-700 text-white py-2 font-bold text-xl focus:border-teal-500 outline-none transition-all placeholder-slate-700" placeholder="0.0" value={(settings.targetDistance / (settings.unit === 'imperial' ? 1609.34 : 1000)).toFixed(1)} onChange={(e) => setSettings(prev => ({...prev, targetDistance: parseFloat(e.target.value) * (settings.unit === 'imperial' ? 1609.34 : 1000)}))} />
               <span className="absolute right-0 top-3 text-slate-500 font-black text-xs">{settings.unit === 'imperial' ? 'MI' : 'KM'}</span>
            </div>
          </div>

          {/* Fuel Gauge Setup Section */}
          <div className="border-t border-slate-700 pt-4">
             <label className="text-[10px] uppercase font-black text-slate-500 mb-2 block flex justify-between">
                <span>Fuel Tank</span>
                {settings.initialFuel && <span className="text-teal-400">Filled!</span>}
             </label>
             <div className="bg-slate-900 p-4 rounded-2xl border border-slate-700">
                {!settings.initialFuel ? (
                  <>
                     <div className="flex gap-2 mb-2">
                       <input 
                         type="text" 
                         className="flex-1 bg-slate-800 rounded-lg p-3 text-sm text-white border border-slate-700 focus:border-teal-500 outline-none" 
                         placeholder="What did you eat?"
                         value={foodInput}
                         onChange={(e) => setFoodInput(e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && handleFoodSubmit()}
                       />
                       <button onClick={handleFoodSubmit} disabled={isAnalyzingFood} className="bg-teal-600 text-white p-3 rounded-lg font-bold">
                         {isAnalyzingFood ? '...' : 'Add'}
                       </button>
                     </div>
                     <button onClick={() => fileInputRef.current?.click()} className="w-full mt-2 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 transition-all">
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                       {isAnalyzingFood ? 'Analyzing...' : 'Snap Photo'}
                     </button>
                     <input type="file" ref={fileInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleImageUpload} />
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                     <div>
                       <div className="text-white font-bold">{settings.initialFuel.description}</div>
                       <div className="text-teal-400 font-black text-xl">{Math.round(settings.initialFuel.calories)} <span className="text-xs">kcal</span></div>
                     </div>
                     <button onClick={() => setSettings(s => ({...s, initialFuel: null}))} className="text-red-500 text-xs font-bold uppercase hover:underline">Clear</button>
                  </div>
                )}
             </div>
          </div>

          <div className="pt-4 border-t border-slate-700/50">
             <button onClick={handleStart} className="w-full py-5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-2xl rounded-2xl shadow-[0_10px_40px_rgba(20,184,166,0.3)] transform active:scale-95 transition-all italic">
                START TRAINING
             </button>
          </div>
        </div>
      </div>
      
      {showLocationModal && renderLocationModal()}
    </div>
  );

  const renderRunning = () => (
    <div className={`flex flex-col h-screen overflow-hidden relative transition-colors duration-1000 ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-950' : 'bg-black'}`}>
      
      {/* Top Header */}
      <div className="bg-zinc-900/80 backdrop-blur-xl border-b border-white/5 p-6 z-10">
        <div className="flex justify-between items-center mb-2">
           <div className="flex items-center gap-3">
             <div className={`w-8 h-8 rounded-full flex items-center justify-center ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-500 animate-pulse' : 'bg-teal-500'}`}>
                <span className="text-white font-black text-xs">{runState.trainingZone === TrainingZone.ANAEROBIC ? 'SPR' : 'RUN'}</span>
             </div>
             <div>
                <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest block">Time</span>
                <h2 className="text-3xl font-black italic text-white leading-none tracking-tighter">{formatDuration(runState.elapsedTime)}</h2>
             </div>
           </div>
           
           <div className="flex flex-col items-end">
             <div className="flex items-center gap-1 mb-1">
               {gpsStatus === 'locked' ? <span className="text-[10px] text-teal-500 font-bold uppercase">GPS Ready</span> : <span className="text-[10px] text-amber-500 font-bold uppercase animate-pulse">Searching...</span>}
               <div className={`w-2 h-2 rounded-full ${gpsStatus === 'locked' ? 'bg-teal-500' : 'bg-amber-500'}`}></div>
             </div>
             <div className="text-right">
               <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Distance</span>
               <h2 className="text-4xl font-black italic text-teal-400 leading-none tracking-tighter">
                 {displayDistance} <span className="text-lg text-zinc-600 not-italic">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
               </h2>
             </div>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48 scrollbar-hide">
        
        {/* Speedometer Card */}
        <div className="bg-gradient-to-br from-zinc-900 to-black p-8 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center relative shadow-2xl overflow-hidden">
          <div className="absolute top-4 left-6 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Speedometer</div>
          <div className="relative z-10">
             <div className="text-[120px] font-black italic tracking-tighter text-white leading-none transform -skew-x-6 drop-shadow-2xl">{displaySpeed}</div>
             <div className="absolute -bottom-2 right-0 text-xl font-black text-teal-500 italic uppercase">{settings.unit === 'imperial' ? 'MPH' : 'KPH'}</div>
          </div>
          <div className="mt-4 flex gap-8 z-10">
            <div className="text-center">
              <div className="text-[10px] font-black text-zinc-500 uppercase">Current Pace</div>
              <div className="text-2xl font-black text-white italic">{displayPace}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black text-zinc-500 uppercase">Matches Left</div>
              <div className={`text-2xl font-black italic ${runState.anaerobicBattery < 20 ? 'text-red-500 animate-pulse' : 'text-indigo-400'}`}>
                 {Math.round(runState.anaerobicBattery)}%
              </div>
            </div>
          </div>
          {/* Background Gradient for Speed */}
          <div className={`absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'from-indigo-600/40' : 'from-teal-600/10'} to-transparent opacity-50`}></div>
        </div>

        {/* Anaerobic Battery Bar */}
        <div className="bg-zinc-900/50 p-3 rounded-2xl border border-white/5">
           <div className="flex justify-between text-[10px] font-black uppercase text-zinc-500 mb-1">
             <span>Anaerobic Battery</span>
             <span className={runState.anaerobicBattery < 20 ? 'text-red-500' : 'text-indigo-400'}>{runState.anaerobicBattery < 100 ? 'Draining' : 'Full'}</span>
           </div>
           <div className="h-4 bg-zinc-800 rounded-full overflow-hidden">
             <div 
               className={`h-full transition-all duration-500 ${runState.anaerobicBattery < 30 ? 'bg-red-500' : 'bg-indigo-500'}`} 
               style={{ width: `${runState.anaerobicBattery}%` }}
             ></div>
           </div>
        </div>

        {/* 4-Column Layout */}
        <div className="grid grid-cols-4 gap-2">
           {/* Heart Rate */}
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center">
              <div className="flex items-center gap-1 text-[10px] font-black text-red-500 uppercase mb-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></div> HR
              </div>
              <div className="text-2xl font-black italic text-white">{runState.currentHeartRate} <span className="text-[8px] not-italic text-zinc-600">BPM</span></div>
           </div>
           
           <FuelGauge startCalories={settings.initialFuel ? settings.initialFuel.calories : 0} burnedCalories={runState.caloriesBurned} />
           <HydrationGauge fluidLost={runState.fluidLostMl} fluidIntake={runState.fluidIntakeMl} onHydrate={handleHydrate} />

           {/* Cadence / Form */}
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center">
              <div className="text-[10px] font-black text-purple-500 uppercase mb-1">Cadence</div>
              <div className="text-xl font-black italic text-white">{runState.currentCadence > 0 ? runState.currentCadence : '--'}</div>
              <div className="text-[8px] not-italic text-zinc-600 font-bold uppercase">SPM</div>
           </div>
        </div>

        <MapTracker route={runState.route} currentLocation={runState.route[runState.route.length - 1] || null} />
        <MusicPacer currentPace={displayPace} />
        
        {/* Interval Feed */}
        <div className="bg-zinc-900/50 rounded-3xl border border-white/5 p-6">
           <h3 className="font-black italic uppercase text-zinc-400 mb-4 tracking-tighter">Live Intervals</h3>
           {runState.intervals.length > 0 ? (
              <div className="space-y-3">
                 {runState.intervals.slice().reverse().map((int, i) => (
                   <div key={i} className={`flex justify-between items-center p-3 rounded-xl border-l-4 ${int.type === 'SPRINT' ? 'bg-indigo-500/10 border-indigo-500' : 'bg-black/40 border-zinc-600'}`}>
                      <div>
                        <span className={`text-[10px] font-black uppercase block ${int.type === 'SPRINT' ? 'text-indigo-400' : 'text-zinc-500'}`}>{int.type}</span>
                        <span className="font-black text-white italic">{formatDuration(int.duration)}</span>
                      </div>
                      <div className="text-right">
                         <div className="text-xs text-zinc-400 font-bold">{int.avgPace}</div>
                         <div className="text-[9px] text-zinc-600 uppercase font-black">{Math.round(int.distance)}m</div>
                      </div>
                   </div>
                 ))}
              </div>
           ) : <p className="text-zinc-600 text-xs font-bold uppercase italic text-center py-4">Start sprinting to log intervals</p>}
        </div>
      </div>

      <div className="fixed bottom-10 left-0 right-0 px-8 flex justify-center gap-6 z-[1000]">
        <button onClick={() => setRunState(p => ({ ...p, isPaused: !p.isPaused }))} className={`h-24 w-24 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${runState.isPaused ? 'bg-teal-500 text-black' : 'bg-white text-black'}`}>
           {runState.isPaused ? <svg className="w-12 h-12 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> : <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}
        </button>
        {runState.isPaused && (
          <button onClick={() => setView(AppView.SUMMARY)} className="h-24 w-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl text-white transform scale-110 active:scale-90">
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-black min-h-screen text-white font-sans selection:bg-teal-500/30 overflow-x-hidden">
      {view === AppView.SETUP && renderSetup()}
      {view === AppView.RUNNING && renderRunning()}
      {view === AppView.ROUTE_BUILDER && (
        <RouteBuilder 
          onClose={() => setView(AppView.SETUP)} 
          onSave={handleRouteSave}
          unit={settings.unit}
          initialCenter={initialLocation}
        />
      )}
      {view === AppView.SUMMARY && (
        <div className="p-8 max-w-md mx-auto h-screen flex flex-col justify-center animate-fade-in">
           <div className="bg-zinc-900 rounded-[3rem] p-10 border border-white/5 text-center shadow-2xl">
              <h2 className="text-5xl font-black italic tracking-tighter text-teal-400 mb-2 uppercase">Finish</h2>
              <div className="grid grid-cols-2 gap-4 my-8">
                 <div className="bg-black/50 p-4 rounded-3xl">
                    <div className="text-[10px] font-black text-zinc-600 uppercase">Total Distance</div>
                    <div className="text-2xl font-black italic">{displayDistance} {settings.unit === 'imperial' ? 'mi' : 'km'}</div>
                 </div>
                 <div className="bg-black/50 p-4 rounded-3xl">
                    <div className="text-[10px] font-black text-zinc-600 uppercase">Intervals</div>
                    <div className="text-2xl font-black italic text-indigo-400">{runState.intervals.filter(i => i.type === 'SPRINT').length}</div>
                 </div>
              </div>
              <button onClick={() => setView(AppView.SETUP)} className="w-full py-5 bg-white text-black font-black uppercase italic rounded-2xl hover:bg-zinc-200 transition-all">Start New Run</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
