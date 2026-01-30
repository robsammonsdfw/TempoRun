
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapTracker } from './components/MapTracker';
import { MusicPacer } from './components/MusicPacer';
import { FuelGauge } from './components/FuelGauge';
import { HydrationGauge } from './components/HydrationGauge';
import { RouteBuilder } from './components/RouteBuilder';
import { saveRunToDatabase, generateSpeech, analyzeFood, consultAiCoach } from './services/geminiService';
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
  
  const [initialLocation, setInitialLocation] = useState<GeoPoint | null>(null);
  const [detectedAddress, setDetectedAddress] = useState<string>("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [manualSearchTerm, setManualSearchTerm] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  
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
    targetSpeed: 2.68 
  });

  const [weightInput, setWeightInput] = useState<number>(155); 
  const [foodInput, setFoodInput] = useState<string>("");
  const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
  const [routeSet, setRouteSet] = useState(false);

  const [manualDistanceInput, setManualDistanceInput] = useState<string>("3.1");

  const [runState, setRunState] = useState<RunState>({
    isActive: false, isPaused: false, startTime: null, elapsedTime: 0,
    totalDistance: 0, currentSpeed: 0, route: [], splits: [], intervals: [], plannedRoute: [],
    caloriesBurned: 0, caloriesConsumed: 0, fluidLostMl: 0, fluidIntakeMl: 0, currentHeartRate: 70, currentGlucose: null,
    currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE
  });

  // AI Chat state for Summary page
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isConsultingAi, setIsConsultingAi] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<{query: string, response: string}[]>([]);

  const [manualHR, setManualHR] = useState<string>("");

  const watchId = useRef<number | null>(null);
  const lastPosition = useRef<GeoPoint | null>(null);
  const accumulatedSplitDistance = useRef<number>(0);
  const splitStartTime = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastSpeedAlertTime = useRef<number>(0);
  
  const speedSmoother = useRef(new AdaptiveSmoother());
  const intervalState = useRef<{
    startTime: number;
    startDist: number;
    maxSpeed: number;
    pendingZone: TrainingZone;
    confirmationTimer: number; 
  }>({ startTime: 0, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 });

  const currentRouteIndexRef = useRef<number>(0); 
  const routeGracePeriodOver = useRef<boolean>(false); 

  const stepCountRef = useRef<number>(0);
  const lastStepTimeRef = useRef<number>(0);
  const accelerationHistory = useRef<number[]>([]);

  const lastSpeechTime = useRef<number>(0);
  const lastDeviationCheck = useRef<number>(0);

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
      setPlannedPath(route); 
      setRouteSet(true);
      setView(AppView.SETUP);
  };

  const checkDeviation = (currentPos: GeoPoint, planned: {lat: number, lng: number}[]) => {
    if (!planned || planned.length === 0) return;
    const now = Date.now();
    if (!routeGracePeriodOver.current) {
       if (runState.elapsedTime > 30) {
         routeGracePeriodOver.current = true;
       } else {
         return; 
       }
    }
    if (now - lastDeviationCheck.current < 5000) return;
    lastDeviationCheck.current = now;
    const { index, distance } = getNearestPointIndex(currentPos, planned);
    if (distance > 60) {
       if (!isOffRoute) {
          setIsOffRoute(true);
          speakStatus("You have drifted from your planned route. Reroute?", true);
       }
    } else {
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
       currentRouteIndexRef.current = 0;
       setIsOffRoute(false);
       speakStatus("Route updated.", true);
    } else {
       speakStatus("Could not find a new route. Try moving to a road.", true);
    }
    setIsRerouting(false);
  };

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
            checkDeviation(newPoint, prev.plannedRoute);
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
          const now = Date.now();
          if (settings.targetSpeed && (now - lastSpeedAlertTime.current > 45000)) {
              const targetMps = settings.targetSpeed;
              const currentMps = prev.currentSpeed;
              const bufferMps = 0.447;
              if (currentMps > 0.5 && currentMps < (targetMps - bufferMps)) {
                  lastSpeedAlertTime.current = now;
                  const currentMph = currentMps * MPS_TO_MPH;
                  const secondsPerMile = currentMps > 0 ? 1609.34 / currentMps : 0;
                  const paceStr = formatDuration(secondsPerMile); 
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
            currentStrideLength: spm > 0 ? (prev.currentSpeed * 60) / spm : 0
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
      plannedRoute: plannedPath,
      totalDistance: 0, elapsedTime: 0, splits: [], intervals: [], caloriesBurned: 0, caloriesConsumed: 0, 
      currentHeartRate: 75, fluidLostMl: 0, fluidIntakeMl: 0, currentGlucose: 95,
      currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE
    });
    setAiResponse(null);
    setAiQuery("");
    setChatHistory([]);
    setCurrentRunId(null);
    speedSmoother.current.reset();
    stepCountRef.current = 0;
    splitStartTime.current = now;
    accumulatedSplitDistance.current = 0;
    lastPosition.current = null;
    lastDeviationCheck.current = 0;
    setIsOffRoute(false);
    currentRouteIndexRef.current = 0;
    routeGracePeriodOver.current = false;
    intervalState.current = { startTime: now, startDist: 0, maxSpeed: 0, pendingZone: TrainingZone.IDLE, confirmationTimer: 0 };
    lastSpeedAlertTime.current = now; 
    setView(AppView.RUNNING);
    speakStatus("Training session started.", true);
  };

  const handleFinishRun = async () => {
    setView(AppView.SUMMARY);
    try {
      const result = await saveRunToDatabase(runState, settings.mode);
      if (result && result.id) {
        setCurrentRunId(result.id);
      }
    } catch (e) {
      console.error("Failed to save run:", e);
    }
  };

  const handleModeSelect = (mode: RunMode) => {
    setSettings(prev => ({ ...prev, mode }));
    setView(AppView.SETUP);
  };

  const performanceMetrics = useMemo(() => {
    const speeds = runState.route.map(p => p.speed || 0).filter(s => s > 0.1);
    const avgSpeed = runState.elapsedTime > 0 ? runState.totalDistance / runState.elapsedTime : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
    const minSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;
    
    return {
      avgSpeed,
      maxSpeed,
      minSpeed,
      avgPace: calculatePace(avgSpeed, settings.unit),
      maxPace: calculatePace(maxSpeed, settings.unit),
      minPace: calculatePace(minSpeed, settings.unit),
      avgSpeedDisplay: formatSpeed(avgSpeed, settings.unit),
      maxSpeedDisplay: formatSpeed(maxSpeed, settings.unit),
      minSpeedDisplay: formatSpeed(minSpeed, settings.unit)
    };
  }, [runState.route, runState.totalDistance, runState.elapsedTime, settings.unit]);

  const handleAiConsultation = async () => {
     if (!aiQuery.trim()) return;
     setIsConsultingAi(true);
     const stats = {
        distance: displayDistance,
        duration: formatDuration(runState.elapsedTime),
        avgSpeed: performanceMetrics.avgSpeedDisplay,
        maxSpeed: performanceMetrics.maxSpeedDisplay,
        minSpeed: performanceMetrics.minSpeedDisplay,
        calories: Math.round(runState.caloriesBurned),
        mode: settings.mode,
        unit: settings.unit
     };
     try {
        const response = await consultAiCoach(aiQuery, stats, currentRunId || undefined);
        setAiResponse(response);
        setChatHistory(prev => [{ query: aiQuery, response }, ...prev]);
        setAiQuery(""); // Clear input after successful send
     } catch (e) {
        setAiResponse("Sorry, I couldn't reach the coach right now.");
     } finally {
        setIsConsultingAi(false);
     }
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
          {[
            { mode: RunMode.ACADEMY, color: 'teal', icon: 'M12 6v6l4 2', title: 'Academy / PT Test', desc: 'Timed performance & pacing' },
            { mode: RunMode.TRAIL, color: 'emerald', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', title: 'Trail & Explorer', desc: 'Environmental focus & GPS' },
            { mode: RunMode.TRACK, color: 'indigo', icon: 'M4 12v-3a9 9 0 0 1 18 0v3', title: 'Track & Speedwork', desc: 'Intensity intervals & splits' },
            { mode: RunMode.ENDURANCE, color: 'orange', icon: 'M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78', title: 'Endurance / Marathon', desc: 'Volume, health & fuel' },
            { mode: RunMode.CASUAL, color: 'purple', icon: 'M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2', title: 'Casual / Weight Loss', desc: 'Motivation & simplicity' }
          ].map((m) => (
            <button key={m.mode} onClick={() => handleModeSelect(m.mode)} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 rounded-2xl flex items-center gap-4 transition-all group">
              <div className={`w-12 h-12 rounded-full bg-${m.color}-500/10 text-${m.color}-500 flex items-center justify-center group-hover:bg-${m.color}-500 group-hover:text-black transition-colors`}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={m.icon}/></svg>
              </div>
              <div className="text-left">
                  <h3 className="text-white font-bold text-lg">{m.title}</h3>
                  <p className="text-slate-400 text-xs">{m.desc}</p>
              </div>
            </button>
          ))}
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
             <h2 className="text-white font-bold text-lg">{settings.mode} Mode</h2>
        </div>
        <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
           <div className="text-center p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <h3 className="text-indigo-400 font-black uppercase text-sm mb-2">Interval Mode Ready</h3>
              <p className="text-slate-400 text-xs leading-relaxed">This app uses <strong>Auto-Lap</strong> detection for sprints and recovery jogs.</p>
           </div>
          <div className="flex bg-slate-900 rounded-xl p-1 shadow-inner">
            <button onClick={() => setSettings(s => ({...s, unit: 'imperial'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'imperial' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Imperial</button>
            <button onClick={() => setSettings(s => ({...s, unit: 'metric'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'metric' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Metric</button>
          </div>
          <button onClick={handleOpenRoutePlanner} className={`w-full group relative overflow-hidden rounded-2xl border-2 transition-all active:scale-95 text-left p-0 ${routeSet ? 'border-orange-500 bg-orange-950/20' : 'border-slate-700 bg-slate-900'}`}>
             <div className="relative p-6 flex items-center justify-between">
                <div>
                   <div className="flex items-center gap-2 mb-1">
                      <div className={`p-1.5 rounded-lg ${routeSet ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-300'}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg></div>
                      <span className={`text-xs font-black uppercase tracking-wider ${routeSet ? 'text-orange-400' : 'text-slate-400'}`}>{routeSet ? 'Route Loaded' : 'Route Planner'}</span>
                   </div>
                   <h3 className="text-xl font-black text-white italic">{routeSet ? 'Custom Course' : 'Create New Route'}</h3>
                </div>
                {routeSet ? <div className="h-10 w-10 rounded-full bg-orange-500 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div> : <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5l7 7-7 7"/></svg></div>}
             </div>
          </button>
          {!routeSet && (
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 flex items-center gap-4">
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Quick Target</label>
                    <div className="flex items-baseline gap-2">
                        <input type="number" value={manualDistanceInput} onChange={(e) => setManualDistanceInput(e.target.value)} className="w-20 bg-transparent text-2xl font-black italic text-white outline-none" placeholder="3.1" />
                        <span className="text-sm font-bold text-slate-500">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
                    </div>
                </div>
                <div className="w-px h-10 bg-slate-700"></div>
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Weight</label>
                    <div className="flex items-baseline gap-2">
                        <input type="number" value={weightInput} onChange={(e) => setWeightInput(parseFloat(e.target.value))} className="w-16 bg-transparent text-2xl font-black italic text-white outline-none" />
                        <span className="text-sm font-bold text-slate-500">{settings.unit === 'imperial' ? 'lbs' : 'kg'}</span>
                    </div>
                </div>
            </div>
          )}
          <div className="pt-4 border-t border-slate-700/50">
             <button onClick={handleStart} className="w-full py-5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-2xl rounded-2xl shadow-xl transform active:scale-95 transition-all italic uppercase tracking-tighter">Start Training</button>
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
             <div className={`w-8 h-8 rounded-full flex items-center justify-center ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-500 animate-pulse' : 'bg-teal-500'}`}><span className="text-white font-black text-[10px] uppercase">{runState.trainingZone === TrainingZone.ANAEROBIC ? 'SPR' : 'RUN'}</span></div>
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
        </div>
        <MapTracker route={runState.route} currentLocation={runState.route[runState.route.length - 1] || null} plannedRoute={runState.plannedRoute} initialCenter={initialLocation} />
        <div className="grid grid-cols-4 gap-2">
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="flex items-center gap-1 text-[10px] font-black text-red-500 uppercase mb-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></div> HR</div><div className="text-2xl font-black italic text-white">{runState.currentHeartRate}</div></div>
           <FuelGauge startCalories={settings.initialFuel ? settings.initialFuel.calories : 0} consumedCalories={runState.caloriesConsumed} burnedCalories={runState.caloriesBurned} onRefuel={() => setRunState(p => ({ ...p, caloriesConsumed: p.caloriesConsumed + 100 }))} />
           <HydrationGauge fluidLost={runState.fluidLostMl} fluidIntake={runState.fluidIntakeMl} onHydrate={() => setRunState(p => ({ ...p, fluidIntakeMl: p.fluidIntakeMl + 150 }))} />
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="text-[10px] font-black text-purple-500 uppercase mb-1">Cadence</div><div className="text-xl font-black italic text-white">{runState.currentCadence || '--'}</div></div>
        </div>
        <MusicPacer currentPace={displayPace} targetSpeedMps={settings.targetSpeed} onTargetSpeedChange={(mps) => setSettings(s => ({...s, targetSpeed: mps}))} />
      </div>
      <div className="fixed bottom-10 left-0 right-0 px-8 flex justify-center gap-6 z-[1000]">
        <button onClick={() => setRunState(p => ({ ...p, isPaused: !p.isPaused }))} className={`h-24 w-24 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${runState.isPaused ? 'bg-teal-500 text-black' : 'bg-white text-black'}`}>{runState.isPaused ? <svg className="w-12 h-12 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> : <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}</button>
        {runState.isPaused && <button onClick={handleFinishRun} className="h-24 w-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl text-white transform scale-110 active:scale-90"><svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg></button>}
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
        <div className="flex flex-col min-h-screen overflow-y-auto animate-fade-in bg-zinc-950 p-6 pb-12">
           <div className="text-center mt-8 mb-6">
              <h2 className="text-6xl font-black italic tracking-tighter text-teal-400 uppercase drop-shadow-[0_0_20px_rgba(20,184,166,0.3)] leading-none">Report</h2>
              <p className="text-zinc-500 font-black uppercase tracking-[0.2em] text-[10px] mt-2">Training Session Finalized</p>
           </div>
           
           <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-zinc-900 border border-white/5 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center shadow-lg">
                 <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Distance</span>
                 <div className="text-4xl font-black italic tracking-tighter text-white">{displayDistance} <span className="text-sm not-italic text-zinc-600">{settings.unit === 'imperial' ? 'mi' : 'km'}</span></div>
              </div>
              <div className="bg-zinc-900 border border-white/5 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center shadow-lg">
                 <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Duration</span>
                 <div className="text-4xl font-black italic tracking-tighter text-white">{formatDuration(runState.elapsedTime)}</div>
              </div>
           </div>

           <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-zinc-900/40 border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                 <span className="text-[10px] font-black text-indigo-400 uppercase block mb-1">Avg Speed</span>
                 <div className="text-2xl font-black italic text-white">{performanceMetrics.avgSpeedDisplay} <span className="text-xs not-italic text-zinc-600">{settings.unit === 'imperial' ? 'mph' : 'kph'}</span></div>
                 <div className="text-[9px] font-bold text-zinc-500 mt-1 uppercase">Pace: {performanceMetrics.avgPace}</div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                 <span className="text-[10px] font-black text-rose-500 uppercase block mb-1">Calories</span>
                 <div className="text-2xl font-black italic text-white">{Math.round(runState.caloriesBurned)} <span className="text-xs not-italic text-zinc-600">kcal</span></div>
                 <div className="text-[9px] font-bold text-zinc-500 mt-1 uppercase">Fuel Gap: {Math.max(0, Math.round(runState.caloriesBurned - runState.caloriesConsumed))}</div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                 <span className="text-[10px] font-black text-emerald-400 uppercase block mb-1">Max Speed</span>
                 <div className="text-2xl font-black italic text-white">{performanceMetrics.maxSpeedDisplay} <span className="text-xs not-italic text-zinc-600">{settings.unit === 'imperial' ? 'mph' : 'kph'}</span></div>
                 <div className="text-[9px] font-bold text-zinc-500 mt-1 uppercase">Pace: {performanceMetrics.maxPace}</div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                 <span className="text-[10px] font-black text-amber-500 uppercase block mb-1">Low Speed</span>
                 <div className="text-2xl font-black italic text-white">{performanceMetrics.minSpeedDisplay} <span className="text-xs not-italic text-zinc-600">{settings.unit === 'imperial' ? 'mph' : 'kph'}</span></div>
                 <div className="text-[9px] font-bold text-zinc-500 mt-1 uppercase">Pace: {performanceMetrics.minPace}</div>
              </div>
           </div>

           {runState.splits.length > 0 && (
             <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-8 mb-8 backdrop-blur-sm">
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-6 border-b border-white/5 pb-3">Split Performance</h3>
                <div className="space-y-4">
                   {runState.splits.map((split, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 pb-4">
                         <div className="flex items-center gap-4">
                            <span className="w-7 h-7 rounded-full bg-zinc-800 text-[10px] font-black flex items-center justify-center text-zinc-400 border border-white/5">{idx + 1}</span>
                            <span className="text-sm font-bold text-white uppercase tracking-tighter">{settings.unit === 'imperial' ? 'Mile' : 'KM'} {idx + 1}</span>
                         </div>
                         <div className="text-right">
                            <div className="text-xl font-black italic text-teal-400">{split.pace}</div>
                            <div className="text-[9px] font-bold text-zinc-600 uppercase mt-0.5">Elapsed: {formatDuration(split.cumulativeTime)}</div>
                         </div>
                      </div>
                   ))}
                </div>
             </div>
           )}

           {/* AI Performance Co-Pilot Section */}
           <div className="bg-indigo-950/20 border-2 border-indigo-500/20 rounded-[2.5rem] p-8 mb-10 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                 <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <h3 className="text-xl font-black italic uppercase tracking-tighter text-indigo-400 mb-2">AI Performance Coach</h3>
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">Discuss your performance, pain, or recovery strategy with our digital intelligence.</p>
              
              {aiResponse && (
                 <div className="bg-zinc-900/80 rounded-2xl p-5 mb-6 border border-indigo-500/30 animate-fade-in">
                    <div className="text-xs text-indigo-400 font-black uppercase mb-2">Coach Response</div>
                    <p className="text-sm text-zinc-200 leading-relaxed italic">"{aiResponse}"</p>
                 </div>
              )}

              <div className="space-y-4">
                 <textarea 
                   value={aiQuery}
                   onChange={(e) => setAiQuery(e.target.value)}
                   placeholder="Example: My shins started burning at mile 2, what should I do?"
                   className="w-full bg-black/40 border border-zinc-700 rounded-2xl p-4 text-sm text-white focus:border-indigo-500 outline-none transition-all min-h-[100px] resize-none"
                 />
                 <button 
                   onClick={handleAiConsultation}
                   disabled={isConsultingAi || !aiQuery.trim()}
                   className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black uppercase italic rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                 >
                    {isConsultingAi ? (
                       <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Consulting Coach...</>
                    ) : 'Consult AI Coach'}
                 </button>
              </div>

              {/* Chat History List */}
              {chatHistory.length > 0 && (
                <div className="mt-6 border-t border-zinc-800 pt-4">
                   <h4 className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-3">Session History</h4>
                   <div className="space-y-2">
                      {chatHistory.map((item, idx) => (
                         <button 
                           key={idx} 
                           onClick={() => setAiResponse(item.response)}
                           className="w-full text-left bg-zinc-900/50 hover:bg-zinc-900 p-3 rounded-xl border border-white/5 flex items-center justify-between group transition-all"
                         >
                            <span className="text-xs text-zinc-300 font-medium truncate pr-2">"{item.query}"</span>
                            <svg className="w-4 h-4 text-indigo-500 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                         </button>
                      ))}
                   </div>
                </div>
              )}

              <div className="mt-6 text-[9px] text-zinc-500 leading-tight border-t border-zinc-800 pt-4 uppercase font-bold tracking-wider">
                 Disclaimer: This digital entity provides general fitness opinions only. This is NOT medical advice. If you experience persistent or severe pain, consult a licensed healthcare professional.
              </div>
           </div>

           <button onClick={() => setView(AppView.MODE_SELECTION)} className="w-full py-6 bg-white text-black font-black uppercase italic rounded-2xl hover:bg-zinc-200 transition-all shadow-[0_15px_40px_rgba(255,255,255,0.15)] active:scale-95 transform">Back to Home</button>
        </div>
      )}
    </div>
  );
};

export default App;
