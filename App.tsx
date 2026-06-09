import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapTracker } from './components/MapTracker';
import { MusicPacer } from './components/MusicPacer';
import { FuelGauge } from './components/FuelGauge';
import { HydrationGauge } from './components/HydrationGauge';
import { RouteBuilder } from './components/RouteBuilder';
import { IntegrationBanner } from './components/IntegrationBanner';
import { 
  saveRunToDatabase, 
  generateSpeech, 
  analyzeFood, 
  consultAiCoach, 
  fetchRunHistory, 
  fetchRunDetails, 
  fetchCoachInteractions,
  saveRoute
} from './services/apiService';
import { fetchRouteSegment, getNearestPointIndex, calculateRemainingPathDistance } from './services/routingService';
import { AppView, GeoPoint, RunSettings, RunState, TrainingZone, Interval, RunMode } from './types';
import { 
  calculatePace, 
  formatDuration, 
  getDistanceFromLatLonInM, 
  METERS_TO_MILES, 
  METERS_TO_KM,
  METERS_TO_FEET,
  LBS_TO_KG,
  calculateCaloriesPerSecondHR,
  calculateCaloriesPerSecondMETs,
  formatSpeed,
  AdaptiveSmoother,
  MPS_TO_MPH,
  calculateGAP,
  FOOD_BURNS
} from './constants';
import { SocialDashboard } from './components/SocialDashboard';
import { ProfilePage } from './components/ProfilePage';
import { fetchUserProfile, UserProfile } from './services/apiService';
import { GoalsPage } from './components/GoalsPage';


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
        speed: 0,
        altitude: 0
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<AppView>(AppView.SOCIAL);
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
    targetSpeed: 2.68,
    shoeMileage: 324 // Mock mileage
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
    currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE,
    currentAltitude: 0, elevationGain: 0, currentGradient: 0,
    currentPhaseDuration: 0
  });

  // History & AI Chat State
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isConsultingAi, setIsConsultingAi] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<{query: string, response: string, created_at?: string}[]>([]);
  
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [manualHR, setManualHR] = useState<string>("");

  const watchId = useRef<number | null>(null);
  const lastPosition = useRef<GeoPoint | null>(null);
  const accumulatedSplitDistance = useRef<number>(0);
  const splitStartTime = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastSpeedAlertTime = useRef<number>(0);
  const lastFuelAlertTime = useRef<number>(0);
  const lastHrAlertTime = useRef<number>(0);
  const lastFoodCelebration = useRef<number>(0);
  
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

  // --- CROSS-DOMAIN AUTHENTICATION HANDLER ---
  useEffect(() => {
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift();
      return null;
    };

    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');

    if (tokenFromUrl) {
      localStorage.setItem('embracehealth-api-token', tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const currentToken = getCookie('embracehealth-api-token') || localStorage.getItem('embracehealth-api-token');

    if (!currentToken) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `https://app.embracehealth.ai/login?return_to=${returnUrl}`;
    } else {
      const decoded = parseJwt(currentToken);
      if (decoded && decoded.userId) {
        setCurrentUserId(decoded.userId.toString());
        setIsAuthenticated(true);
      } else {
         localStorage.removeItem('embracehealth-api-token');
         const returnUrl = encodeURIComponent(window.location.href);
         window.location.href = `https://app.embracehealth.ai/login?return_to=${returnUrl}`;
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserProfile().then(setUserProfile);
    }
  }, [isAuthenticated]);
   

  // Load chat history when entering Summary view with a Run ID
  useEffect(() => {
    const loadChat = async () => {
      if (view === AppView.SUMMARY && currentRunId) {
        const chats = await fetchCoachInteractions(currentRunId);
        const formatted = chats.map((c: any) => ({
          query: c.user_query,
          response: c.ai_response,
          created_at: c.created_at
        }));
        setChatHistory(formatted);
      }
    };
    loadChat();
  }, [view, currentRunId]);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setInitialLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp,
          speed: pos.coords.speed,
          altitude: pos.coords.altitude
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
    
    const speakBrowser = (txt: string) => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(txt);
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => v.name.includes('Google') || v.name.includes('Samantha') || v.lang === 'en-US');
        if (preferred) utterance.voice = preferred;
        utterance.rate = 1.1;
        window.speechSynthesis.speak(utterance);
      }
    };

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      
      const base64Audio = await generateSpeech(text);
      
      if (base64Audio) {
        if (audioContextRef.current) {
          const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextRef.current, 24000, 1);
          const source = audioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContextRef.current.destination);
          source.start();
        }
      } else {
        speakBrowser(text);
      }
    } catch (e) {
      speakBrowser(text);
    }
  };

  const handleFoodSubmit = async () => {
     if (!foodInput.trim()) return;
     setIsAnalyzingFood(true);
     try {
       // Ensure distance is always a number for analyzeFood context
       const runContext = {
         distance: routeSet ? parseFloat((settings.targetDistance / (settings.unit === 'imperial' ? 1609.34 : 1000)).toFixed(1)) : parseFloat(manualDistanceInput) || 3.1,
         unit: settings.unit === 'imperial' ? 'miles' : 'km',
         mode: settings.mode
       };
       const result = await analyzeFood(foodInput, runContext);
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
        // Ensure distance is always a number for analyzeFood context
        const runContext = {
          distance: routeSet ? parseFloat((settings.targetDistance / (settings.unit === 'imperial' ? 1609.34 : 1000)).toFixed(1)) : parseFloat(manualDistanceInput) || 3.1,
          unit: settings.unit === 'imperial' ? 'miles' : 'km',
          mode: settings.mode
        };
        const result = await analyzeFood(e.target.files[0], runContext);
        setSettings(s => ({...s, initialFuel: result}));
      } catch (e) {
        alert("Could not analyze image.");
      } finally {
        setIsAnalyzingFood(false);
      }
    }
  };

  const handleRouteSave = async (distanceMeters: number, route: { lat: number; lng: number }[]) => {
    // Update local state immediately so the user can start their run
    setSettings(prev => ({ ...prev, targetDistance: distanceMeters }));
    setPlannedPath(route);
    setRouteSet(true);
    setView(AppView.SETUP);
   
    // Persist to DB in the background — failure doesn't block the user
    try {
      await saveRoute({
        distance_meters: distanceMeters,
        path_json: route,
        is_public: true,
        // elevation_gain and elevation_profile will be null until we wire
        // a real elevation API into RouteBuilder
      });
    } catch (e) {
      console.error('Failed to save route to DB:', e);
    }
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
          const { latitude, longitude, speed, altitude } = position.coords;
          const timestamp = position.timestamp;
          let rawSpeed = speed || 0;
          if (rawSpeed < 0) rawSpeed = 0;
          const smoothedSpeed = speedSmoother.current.process(rawSpeed);
          
          setRunState(prev => {
            let addedDist = 0;
            let elevationDelta = 0;
            let newGradient = prev.currentGradient;

            if (lastPosition.current) {
              addedDist = getDistanceFromLatLonInM(lastPosition.current.lat, lastPosition.current.lng, latitude, longitude);
              if (altitude !== null && lastPosition.current.altitude !== null) {
                const altDiff = altitude - lastPosition.current.altitude;
                if (altDiff > 0) elevationDelta = altDiff;
                if (addedDist > 5) {
                    newGradient = (altDiff / addedDist) * 100;
                    if (newGradient > 30) newGradient = 30;
                    if (newGradient < -30) newGradient = -30;
                }
              }
            }

            if (addedDist < 0.5 && rawSpeed < 0.2) addedDist = 0;
            const newTotalDistance = prev.totalDistance + addedDist;
            const newElevationGain = prev.elevationGain + elevationDelta;
            const newPoint: GeoPoint = { lat: latitude, lng: longitude, timestamp, speed: smoothedSpeed, altitude: altitude || 0 };
            
            checkDeviation(newPoint, prev.plannedRoute);
            accumulatedSplitDistance.current += addedDist;
            let newSplits = [...prev.splits];
            
            if (accumulatedSplitDistance.current >= settings.splitDistance) {
               const splitTime = (timestamp - (splitStartTime.current || timestamp)) / 1000;
               const pace = calculatePace(settings.splitDistance / splitTime, settings.unit);
               const labelPrefix = settings.mode === RunMode.TRACK ? 'Lap' : (settings.unit === 'imperial' ? 'mi' : 'km');
               newSplits.push({
                 distanceLabel: `${labelPrefix} ${newSplits.length + 1}`,
                 timeSeconds: splitTime,
                 cumulativeTime: prev.elapsedTime,
                 pace: pace
               });
               speakStatus(`${labelPrefix} ${newSplits.length} complete.`, true);
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
            const phaseDuration = (now - intervalState.current.startTime) / 1000;
            lastPosition.current = newPoint;
            return {
              ...prev,
              totalDistance: newTotalDistance,
              currentSpeed: smoothedSpeed,
              currentAltitude: altitude || prev.currentAltitude,
              elevationGain: newElevationGain,
              currentGradient: newGradient,
              route: [...prev.route, newPoint],
              splits: newSplits,
              intervals: newIntervals,
              trainingZone: activeZone,
              currentPhaseDuration: phaseDuration
            };
          });
      };
      const error = () => setGpsStatus('error');
      navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true });
      watchId.current = navigator.geolocation.watchPosition(success, error, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } else {
      setGpsStatus('off');
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    }
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [runState.isActive, runState.isPaused, settings.splitDistance, settings.mode]);

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
          if (settings.mode === RunMode.ENDURANCE && hr > 150) {
              const now = Date.now();
              if (now - lastHrAlertTime.current > 60000) {
                  lastHrAlertTime.current = now;
                  speakStatus(`Heart rate high at ${hr}.`, true);
              }
          }
          let calsThisSecond = calculateCaloriesPerSecondMETs(prev.currentSpeed, settings.bodyProfile.weight);
          let battery = prev.anaerobicBattery;
          if (prev.trainingZone === TrainingZone.ANAEROBIC) {
             battery = Math.max(0, battery - 1.5); 
             calsThisSecond *= 1.5; 
          } else {
             battery = Math.min(100, battery + 0.2); 
          }
          const stepsInWindow = stepCountRef.current; 
          const spm = (stepsInWindow / (prev.elapsedTime || 1)) * 60; 
          const now = Date.now();
          if (settings.mode === RunMode.ENDURANCE && prev.elapsedTime > 0 && prev.elapsedTime % (45 * 60) === 0) {
              if (now - lastFuelAlertTime.current > 10000) {
                  lastFuelAlertTime.current = now;
                  speakStatus("Fuel check. Time to hydrate.", true);
              }
          }
          if (settings.targetSpeed && (now - lastSpeedAlertTime.current > 45000)) {
              const targetMps = settings.targetSpeed;
              const currentMps = prev.currentSpeed;
              if (currentMps > 0.5 && currentMps < (targetMps - 0.447)) {
                  lastSpeedAlertTime.current = now;
                  speakStatus(`Pace is behind target. Pick it up.`, true);
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
            currentStrideLength: spm > 0 ? (prev.currentSpeed * 60) / spm : 0,
            currentPhaseDuration: prev.currentPhaseDuration + 1
          };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runState.isActive, runState.isPaused, manualHR, settings.targetSpeed, settings.targetDistance, settings.mode]);

  const handleStart = async () => {
    try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {}
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') { try { await (DeviceMotionEvent as any).requestPermission(); } catch (e) {} }
    const now = Date.now();
    const weightKg = settings.unit === 'imperial' ? weightInput * LBS_TO_KG : weightInput;
    let finalTarget = settings.targetDistance;
    let splitDist = settings.splitDistance;
    if (settings.mode === RunMode.TRACK) splitDist = 400;
    if (!routeSet) {
       const manualDistVal = parseFloat(manualDistanceInput);
       if (!isNaN(manualDistVal) && manualDistVal > 0) {
          finalTarget = settings.unit === 'imperial' ? manualDistVal * 1609.34 : manualDistVal * 1000;
       }
    }
    setSettings(prev => ({ ...prev, bodyProfile: { ...prev.bodyProfile, weight: weightKg }, targetDistance: finalTarget, splitDistance: splitDist }));
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    setRunState({
      ...runState, isActive: true, startTime: now, isPaused: false, route: [], plannedRoute: plannedPath,
      totalDistance: 0, elapsedTime: 0, splits: [], intervals: [], caloriesBurned: 0, caloriesConsumed: 0, 
      currentHeartRate: 75, fluidLostMl: 0, fluidIntakeMl: 0, currentGlucose: 95,
      currentCadence: 0, currentStrideLength: 0, anaerobicBattery: 100, trainingZone: TrainingZone.IDLE,
      currentAltitude: 0, elevationGain: 0, currentGradient: 0, currentPhaseDuration: 0
    });
    setAiResponse(null);
    setCurrentRunId(null);
    setView(AppView.RUNNING);
    speakStatus(`Training started.`, true);
  };

  const handleFinishRun = async () => {
    setView(AppView.SUMMARY);
    try {
      const result = await saveRunToDatabase(runState, settings.mode);
      if (result && result.id) setCurrentRunId(result.id);
    } catch (e) {}
  };

  const handleViewHistory = async () => {
    setIsLoadingHistory(true);
    setView(AppView.HISTORY);
    try {
      const history = await fetchRunHistory();
      setRunHistory(history);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleLoadRun = async (runId: number) => {
    try {
      const details = await fetchRunDetails(runId);
      setRunState({
        isActive: false, isPaused: false, startTime: new Date(details.start_time).getTime(),
        elapsedTime: details.duration_seconds, totalDistance: details.distance_meters, currentSpeed: 0,
        route: details.route_json ? JSON.parse(details.route_json) : [],
        splits: details.splits || [], intervals: details.intervals || [], plannedRoute: [],
        caloriesBurned: details.calories_burned, caloriesConsumed: 0, fluidLostMl: 0, fluidIntakeMl: 0,
        currentHeartRate: details.avg_heart_rate, currentGlucose: null, currentCadence: 0, currentStrideLength: 0, 
        anaerobicBattery: 100, trainingZone: TrainingZone.IDLE, currentAltitude: 0, elevationGain: 0, currentGradient: 0,
        currentPhaseDuration: 0
      });
      setSettings(prev => ({...prev, mode: details.mode}));
      setCurrentRunId(runId);
      setView(AppView.SUMMARY);
    } catch (e) { alert("Load failed."); }
  };

  const handleModeSelect = (mode: RunMode) => { setSettings(prev => ({ ...prev, mode })); setView(AppView.SETUP); };

  const performanceMetrics = useMemo(() => {
    const speeds = runState.route.map(p => p.speed || 0).filter(s => s > 0.1);
    const avgSpeed = runState.elapsedTime > 0 ? runState.totalDistance / runState.elapsedTime : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
    return {
      avgSpeed, maxSpeed, avgPace: calculatePace(avgSpeed, settings.unit), maxPace: calculatePace(maxSpeed, settings.unit),
      avgSpeedDisplay: formatSpeed(avgSpeed, settings.unit), maxSpeedDisplay: formatSpeed(maxSpeed, settings.unit)
    };
  }, [runState.route, runState.totalDistance, runState.elapsedTime, settings.unit]);

  const handleAiConsultation = async () => {
     if (!aiQuery.trim()) return;
     setIsConsultingAi(true);
     try {
        const stats = { distance: displayDistance, duration: formatDuration(runState.elapsedTime), avgSpeed: performanceMetrics.avgSpeedDisplay, calories: Math.round(runState.caloriesBurned), mode: settings.mode, unit: settings.unit };
        const response = await consultAiCoach(aiQuery, stats, currentRunId || undefined);
        setAiResponse(response);
        setChatHistory(prev => [{ query: aiQuery, response }, ...prev]);
        setAiQuery(""); 
     } finally { setIsConsultingAi(false); }
  };

  const displayDistance = useMemo(() => (settings.unit === 'imperial' ? runState.totalDistance * METERS_TO_MILES : runState.totalDistance * METERS_TO_KM).toFixed(2), [runState.totalDistance, settings.unit]);
  const displaySpeed = formatSpeed(runState.currentSpeed, settings.unit);
  const displayPace = calculatePace(runState.currentSpeed, settings.unit);
  const displayGAP = useMemo(() => calculatePace(calculateGAP(runState.currentSpeed, runState.currentGradient), settings.unit), [runState.currentSpeed, runState.currentGradient, settings.unit]);
  const displayElevationGain = useMemo(() => settings.unit === 'imperial' ? Math.round(runState.elevationGain * METERS_TO_FEET) : Math.round(runState.elevationGain), [runState.elevationGain, settings.unit]);
  const displayCurrentAltitude = useMemo(() => settings.unit === 'imperial' ? Math.round(runState.currentAltitude * METERS_TO_FEET) : Math.round(runState.currentAltitude), [runState.currentAltitude, settings.unit]);

  if (!isAuthenticated || !currentUserId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-teal-500 font-black italic uppercase tracking-widest animate-pulse">
          Authenticating...
        </div>
      </div>
    );
  }

  const renderLocationModal = () => (
    <div className="fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center p-6 backdrop-blur-sm">
       <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl">
          <div className="text-center">
             <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx="12" cy="9" r="2.5" /></svg>
             </div>
             {isGeocoding ? <div className="py-8 text-slate-400 text-sm animate-pulse">Finding location...</div> : (
                <>
                  <h3 className="text-xl font-bold text-white mb-2">Confirm Start Point</h3>
                  <p className="text-slate-300 text-sm mb-6">{detectedAddress || "Where are you?"}</p>
                  <div className="space-y-3">
                     {detectedAddress && <button onClick={confirmLocation} className="w-full py-4 bg-teal-500 text-slate-900 font-bold rounded-xl">Yes, Start Here</button>}
                     <input type="text" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm" placeholder="Search..." value={manualSearchTerm} onChange={e => setManualSearchTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleManualSearch()} />
                     <button onClick={() => setShowLocationModal(false)} className="text-slate-500 text-xs font-bold uppercase">Cancel</button>
                  </div>
                </>
             )}
          </div>
       </div>
    </div>
  );

  // Added missing UI component for Run Mode selection
  const renderModeSelection = () => (
    <div className="flex flex-col h-screen items-center justify-center p-6 space-y-8 animate-fade-in max-w-md mx-auto">
      <div className="text-center">
        <h1 className="text-6xl font-black italic tracking-tighter text-teal-400 mb-2">SPRINT AI</h1>
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">The Intelligence of Speed</p>
      </div>
      
      <div className="grid grid-cols-1 gap-4 w-full">
        {(Object.keys(RunMode) as Array<keyof typeof RunMode>).map((modeKey) => {
          const mode = RunMode[modeKey];
          return (
            <button
              key={mode}
              onClick={() => handleModeSelect(mode)}
              className="group bg-zinc-900 border border-zinc-800 p-6 rounded-3xl text-left transition-all hover:bg-zinc-800 hover:border-teal-500/50 active:scale-95 flex items-center justify-between"
            >
              <div>
                <h3 className="text-xl font-black italic text-white uppercase group-hover:text-teal-400 transition-colors">{mode}</h3>
                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                  {mode === RunMode.ACADEMY && "AI Coach & Drills"}
                  {mode === RunMode.TRAIL && "Elevation & Off-Road"}
                  {mode === RunMode.TRACK && "Split & Lap Focus"}
                  {mode === RunMode.ENDURANCE && "Long Distance Fueling"}
                  {mode === RunMode.CASUAL && "Calorie Burning Mode"}
                </p>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-700 group-hover:text-teal-500 transition-colors"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          );
        })}
      </div>
      
      <button 
        onClick={handleViewHistory}
        className="text-[10px] font-black uppercase text-zinc-500 hover:text-white tracking-widest transition-colors"
      >
        View Run History
      </button>
    </div>
  );

  // Added missing UI component for Run History view
  const renderHistory = () => (
    <div className="flex flex-col min-h-screen p-6 animate-fade-in max-w-md mx-auto bg-black">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setView(AppView.MODE_SELECTION)} className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h2 className="text-2xl font-black italic uppercase text-teal-400">Run History</h2>
      </div>

      {isLoadingHistory ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : runHistory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p className="text-sm font-bold uppercase tracking-widest">No runs recorded yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {runHistory.map((run) => (
            <div 
              key={run.id}
              onClick={() => handleLoadRun(run.id)}
              className="bg-zinc-900 border border-zinc-800 p-5 rounded-[2rem] flex items-center justify-between cursor-pointer active:scale-95 transition-all hover:border-teal-500/30"
            >
              <div>
                <div className="text-[10px] font-black text-zinc-500 uppercase mb-1">{new Date(run.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • {run.mode}</div>
                <div className="text-2xl font-black italic text-white leading-tight">
                  {(run.distance_meters * (settings.unit === 'imperial' ? METERS_TO_MILES : METERS_TO_KM)).toFixed(2)}
                  <span className="text-sm not-italic text-zinc-600 ml-1">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-zinc-400">{formatDuration(run.duration_seconds)}</div>
                <div className="text-[10px] font-bold text-zinc-600 uppercase">Duration</div>
              </div>
            </div>
          ))}
        </div>
      )}
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
          <div className="flex bg-slate-900 rounded-xl p-1 shadow-inner">
            <button onClick={() => setSettings(s => ({...s, unit: 'imperial'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'imperial' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Imperial</button>
            <button onClick={() => setSettings(s => ({...s, unit: 'metric'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'metric' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Metric</button>
          </div>
          <button onClick={handleOpenRoutePlanner} className={`w-full p-6 rounded-2xl border-2 transition-all ${routeSet ? 'border-orange-500 bg-orange-950/20' : 'border-slate-700 bg-slate-900'}`}>
             <h3 className="text-xl font-black text-white italic">{routeSet ? 'Custom Course Loaded' : 'Create New Route'}</h3>
          </button>
          {!routeSet && (
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 flex items-center gap-4">
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Quick Target</label>
                    <input type="number" value={manualDistanceInput} onChange={e => setManualDistanceInput(e.target.value)} className="w-full bg-transparent text-2xl font-black italic text-white outline-none" />
                </div>
                <div className="w-px h-10 bg-slate-700"></div>
                <div className="flex-1">
                    <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Weight ({settings.unit === 'imperial' ? 'lbs' : 'kg'})</label>
                    <input type="number" value={weightInput} onChange={e => setWeightInput(parseFloat(e.target.value))} className="w-full bg-transparent text-2xl font-black italic text-white outline-none" />
                </div>
            </div>
          )}
          
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 space-y-3">
             <div className="flex justify-between items-center">
                 <label className="text-[9px] text-teal-400 font-bold uppercase block">Pre-Run Fuel Check (AI)</label>
                 {isAnalyzingFood && <span className="text-[9px] text-teal-500 animate-pulse font-bold">ANALYZING...</span>}
             </div>
             <div className="flex gap-2">
                 <input type="text" value={foodInput} onChange={e => setFoodInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleFoodSubmit()} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm outline-none placeholder-slate-600" placeholder="E.g. Banana & Protein Bar" />
                 <button onClick={handleFoodSubmit} className="bg-slate-700 text-white px-3 rounded-xl font-bold text-xs uppercase">Check</button>
             </div>
             <div className="flex justify-center">
                 <label className="text-[10px] text-slate-500 hover:text-teal-400 cursor-pointer flex items-center gap-1 font-bold uppercase">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    Scan Food Photo
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                 </label>
             </div>
             {settings.initialFuel && (
                <div className="bg-teal-900/20 border border-teal-500/30 rounded-xl p-3">
                    <div className="flex justify-between items-start mb-1"><span className="text-xs font-black text-white">{settings.initialFuel.description}</span><span className="text-xs font-black text-teal-400">{settings.initialFuel.calories} kcal</span></div>
                    {settings.initialFuel.opinion && <div className="mt-2 text-[10px] text-teal-100 italic border-t border-teal-500/20 pt-2">"{settings.initialFuel.opinion}"</div>}
                </div>
             )}
          </div>
          <IntegrationBanner userId={currentUserId!} />
          <button onClick={handleStart} className="w-full py-5 bg-teal-500 text-slate-950 font-black text-2xl rounded-2xl shadow-xl transform active:scale-95 transition-all italic uppercase">Start Training</button>
        </div>
      </div>
      {showLocationModal && renderLocationModal()}
    </div>
  );

  const renderRunning = () => {
    if (settings.mode === RunMode.CASUAL) {
      const totalCals = Math.round(runState.caloriesBurned);
      const foodItem = FOOD_BURNS.slice().reverse().find(f => totalCals >= f.k) || null;
      return (
        <div className="flex flex-col h-screen relative bg-gradient-to-b from-purple-900 to-black">
           <div className="pt-12 px-8 flex justify-between items-center z-10"><span className="text-xs font-black text-purple-300 uppercase tracking-widest">Weight Loss Mode</span><span className="text-[10px] text-purple-200 font-bold">GPS: {gpsStatus}</span></div>
           <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-12 z-10">
              <div className="text-center"><div className="text-[140px] font-black text-white leading-none tracking-tighter drop-shadow-2xl">{totalCals}</div><span className="text-xl font-black text-purple-400 uppercase tracking-[0.3em]">Calories Burned</span></div>
              <div className="w-full bg-white/10 backdrop-blur-md rounded-[2.5rem] p-6 border border-white/10 flex items-center gap-6">
                  <div className="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center text-5xl">{foodItem ? foodItem.icon : "🔥"}</div>
                  <div><div className="text-[10px] font-bold text-purple-300 uppercase mb-1">Equivalent To</div><div className="text-2xl font-black text-white italic leading-tight">{foodItem ? `You burned a ${foodItem.label}!` : "Keep moving!"}</div></div>
              </div>
              <div className="flex gap-12 opacity-80"><div className="text-center"><div className="text-3xl font-black text-white">{formatDuration(runState.elapsedTime)}</div><span className="text-[10px] font-bold text-slate-400 uppercase">Duration</span></div><div className="text-center"><div className="text-3xl font-black text-white">{displayDistance}</div><span className="text-[10px] font-bold text-slate-400 uppercase">Miles</span></div></div>
           </div>
           <div className="fixed bottom-10 left-0 right-0 px-8 flex justify-center gap-6 z-[1000]">
              <button onClick={() => setRunState(p => ({ ...p, isPaused: !p.isPaused }))} className={`h-24 w-24 rounded-full flex items-center justify-center shadow-2xl ${runState.isPaused ? 'bg-purple-500' : 'bg-white text-black'}`}>{runState.isPaused ? "Play" : "Pause"}</button>
              {runState.isPaused && <button onClick={handleFinishRun} className="h-24 w-24 bg-red-600 rounded-full flex items-center justify-center text-white">Stop</button>}
           </div>
        </div>
      );
    }
    return (
      <div className={`flex flex-col h-screen bg-black transition-colors duration-1000 ${runState.trainingZone === TrainingZone.ANAEROBIC ? 'bg-indigo-950' : 'bg-black'}`}>
      <div className="bg-zinc-900/80 p-6 z-10">
        <div className="flex justify-between items-center mb-2">
           <div><span className="text-[10px] text-zinc-500 font-black uppercase block">Time</span><h2 className="text-3xl font-black italic text-white">{formatDuration(runState.elapsedTime)}</h2></div>
           <div className="text-right"><span className="text-[10px] text-zinc-500 font-black uppercase block">Distance</span><h2 className="text-4xl font-black italic text-teal-400 leading-none">{displayDistance} <span className="text-lg text-zinc-600 not-italic">{settings.unit === 'imperial' ? 'mi' : 'km'}</span></h2></div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48">
        <div className="bg-gradient-to-br from-zinc-900 to-black p-8 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center relative shadow-2xl">
          <div className="text-[120px] font-black italic tracking-tighter text-white leading-none transform -skew-x-6">{displaySpeed}</div>
          <div className="text-xl font-black text-teal-500 italic uppercase">{settings.unit === 'imperial' ? 'MPH' : 'KPH'}</div>
          <div className="mt-4 flex gap-8"><div className="text-center"><div className="text-[10px] font-black text-zinc-500 uppercase">Pace</div><div className="text-2xl font-black text-white italic">{displayPace}</div></div><div className="text-center"><div className="text-[10px] font-black text-zinc-500 uppercase">Match</div><div className="text-2xl font-black italic text-indigo-400">{Math.round(runState.anaerobicBattery)}%</div></div></div>
        </div>
        <MapTracker route={runState.route} currentLocation={runState.route[runState.route.length - 1] || null} plannedRoute={runState.plannedRoute} initialCenter={initialLocation} />
        <div className="grid grid-cols-4 gap-2">
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="text-[10px] font-black text-red-500 uppercase mb-1">HR</div><div className="text-2xl font-black italic text-white">{runState.currentHeartRate}</div></div>
           <FuelGauge startCalories={settings.initialFuel ? settings.initialFuel.calories : 0} consumedCalories={runState.caloriesConsumed} burnedCalories={runState.caloriesBurned} onRefuel={() => setRunState(p => ({ ...p, caloriesConsumed: p.caloriesConsumed + 100 }))} />
           <HydrationGauge fluidLost={runState.fluidLostMl} fluidIntake={runState.fluidIntakeMl} onHydrate={() => setRunState(p => ({ ...p, fluidIntakeMl: p.fluidIntakeMl + 150 }))} />
           <div className="bg-zinc-900/50 p-2 rounded-3xl border border-white/5 flex flex-col items-center justify-center"><div className="text-[10px] font-black text-purple-500 uppercase mb-1">SPM</div><div className="text-xl font-black text-white">{runState.currentCadence || '--'}</div></div>
        </div>
      </div>
      <div className="fixed bottom-10 left-0 right-0 px-8 flex justify-center gap-6 z-[1000]">
        <button onClick={() => setRunState(p => ({ ...p, isPaused: !p.isPaused }))} className={`h-24 w-24 rounded-full flex items-center justify-center shadow-2xl ${runState.isPaused ? 'bg-teal-500' : 'bg-white text-black'}`}>{runState.isPaused ? "Play" : "Pause"}</button>
        {runState.isPaused && <button onClick={handleFinishRun} className="h-24 w-24 bg-red-600 rounded-full flex items-center justify-center text-white">Stop</button>}
      </div>
    </div>
    );
  };

  return (
    <div className="bg-black min-h-screen text-white font-sans selection:bg-teal-500/30 overflow-x-hidden">
      {view === AppView.SOCIAL && (
        <SocialDashboard
          onNavigate={(newView, mode) => {
            if (mode) setSettings(s => ({ ...s, mode }));
            setView(newView);
          }}
          unit={settings.unit}
          profile={userProfile}
        />
      )}
      {view === AppView.PROFILE && (
        <ProfilePage
          onNavigate={(newView, mode) => {
            if (mode) setSettings(s => ({ ...s, mode }));
            setView(newView);
          }}
          profile={userProfile}
          onProfileUpdate={(updated) => setUserProfile(updated)}
        />
      )}
      {view === AppView.GOALS && (
        <GoalsPage
          onNavigate={(newView, mode) => {
            if (mode) setSettings(s => ({ ...s, mode }));
            setView(newView);
          }}
          profile={userProfile}
          unit={settings.unit}
        />
      )}
      {view === AppView.MODE_SELECTION && renderModeSelection()}
      {view === AppView.SETUP && renderSetup()}
      {view === AppView.RUNNING && renderRunning()}
      {view === AppView.HISTORY && renderHistory()}
      {view === AppView.ROUTE_BUILDER && (
        <RouteBuilder
          onClose={() => setView(AppView.SETUP)}
          onSave={handleRouteSave}
          unit={settings.unit}
          initialCenter={initialLocation}
        />
      )}
       {view === AppView.SUMMARY && (
        <div className="flex flex-col min-h-screen overflow-y-auto animate-fade-in bg-zinc-950 p-6 pb-12">
           <div className="text-center mt-8 mb-6"><h2 className="text-6xl font-black italic tracking-tighter text-teal-400 uppercase leading-none">Report</h2></div>
           <div className="grid grid-cols-2 gap-4 mb-6"><div className="bg-zinc-900 rounded-[2.5rem] p-8 text-center shadow-lg"><span className="text-[10px] font-black text-zinc-500 uppercase">Distance</span><div className="text-4xl font-black text-white">{displayDistance}</div></div><div className="bg-zinc-900 rounded-[2.5rem] p-8 text-center shadow-lg"><span className="text-[10px] font-black text-zinc-500 uppercase">Time</span><div className="text-4xl font-black text-white">{formatDuration(runState.elapsedTime)}</div></div></div>
           <div className="bg-indigo-950/20 border-2 border-indigo-500/20 rounded-[2.5rem] p-8 mb-10 shadow-2xl relative overflow-hidden group">
              <h3 className="text-xl font-black italic uppercase text-indigo-400 mb-2">AI Performance Coach</h3>
              {aiResponse && <div className="bg-zinc-900/80 rounded-2xl p-5 mb-6 border border-indigo-500/30 animate-fade-in"><p className="text-sm text-zinc-200 leading-relaxed italic">"{aiResponse}"</p></div>}
              <textarea value={aiQuery} onChange={e => setAiQuery(e.target.value)} placeholder="Ask about your run..." className="w-full bg-black/40 border border-zinc-700 rounded-2xl p-4 text-sm text-white focus:border-indigo-500 outline-none transition-all min-h-[100px] resize-none" />
              <button onClick={handleAiConsultation} disabled={isConsultingAi || !aiQuery.trim()} className="w-full py-4 bg-indigo-600 text-white font-black uppercase italic rounded-xl transition-all shadow-lg active:scale-95">{isConsultingAi ? 'Consulting...' : 'Consult AI Coach'}</button>
           </div>
           <div className="mb-4">
             <IntegrationBanner userId={currentUserId!} />
           </div>
           <button onClick={() => setView(AppView.MODE_SELECTION)} className="w-full py-6 bg-white text-black font-black uppercase italic rounded-2xl shadow-xl active:scale-95">Back to Home</button>
        </div>
      )}
    </div>
  );
};

export default App;