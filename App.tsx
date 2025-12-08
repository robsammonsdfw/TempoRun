import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapTracker } from './components/MapTracker';
import { SplitsChart } from './components/SplitsChart';
import { MusicPacer } from './components/MusicPacer';
import { saveRunToDatabase } from './services/geminiService'; // Imported from the new logic
import { AppView, GeoPoint, RunSettings, RunState, Split } from './types';
import { 
  calculatePace, 
  formatDuration, 
  getDistanceFromLatLonInM, 
  METERS_TO_MILES, 
  METERS_TO_KM,
  LBS_TO_KG,
  calculateCaloriesPerSecondHR,
  calculateCaloriesPerSecondMETs
} from './constants';

const App: React.FC = () => {
  // --- State ---
  const [view, setView] = useState<AppView>(AppView.SETUP);
  const [isSaving, setIsSaving] = useState(false);
  
  // Settings
  const [settings, setSettings] = useState<RunSettings>({
    targetDistance: 5000, 
    splitDistance: 1609.34, 
    unit: 'imperial',
    bodyProfile: {
      weight: 70, // kg
      age: 30,
      gender: 'male'
    },
    devices: {
      fitbitConnected: false,
      glucoseMonitorConnected: false
    }
  });

  // Local state for UI inputs (weight in lbs/kg handling)
  const [weightInput, setWeightInput] = useState<number>(155); // default lbs

  // Run State
  const [runState, setRunState] = useState<RunState>({
    isActive: false,
    isPaused: false,
    startTime: null,
    elapsedTime: 0,
    totalDistance: 0,
    currentSpeed: 0,
    route: [],
    splits: [],
    caloriesBurned: 0,
    currentHeartRate: 70, // resting default
    currentGlucose: null
  });

  // Manual HR Override State (if no device)
  const [manualHR, setManualHR] = useState<string>("");

  // Refs
  const watchId = useRef<number | null>(null);
  const lastPosition = useRef<GeoPoint | null>(null);
  const accumulatedSplitDistance = useRef<number>(0);
  const splitStartTime = useRef<number>(0);

  // --- Geolocation Logic ---
  useEffect(() => {
    if (runState.isActive && !runState.isPaused) {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
      }

      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, speed } = position.coords;
          const timestamp = position.timestamp;
          
          const newPoint: GeoPoint = {
            lat: latitude,
            lng: longitude,
            timestamp,
            speed: speed
          };

          setRunState(prev => {
            let addedDist = 0;
            if (lastPosition.current) {
              addedDist = getDistanceFromLatLonInM(
                lastPosition.current.lat,
                lastPosition.current.lng,
                newPoint.lat,
                newPoint.lng
              );
            }

            if (addedDist > 50 && prev.route.length > 0) return prev; 

            const newTotalDistance = prev.totalDistance + addedDist;
            
            accumulatedSplitDistance.current += addedDist;
            let newSplits = [...prev.splits];
            
            if (accumulatedSplitDistance.current >= settings.splitDistance) {
               const splitTime = (timestamp - splitStartTime.current) / 1000;
               const pace = calculatePace(settings.splitDistance / splitTime, settings.unit);
               
               newSplits.push({
                 distanceLabel: `${newSplits.length + 1}${settings.unit === 'imperial' ? 'mi' : 'km'}`,
                 timeSeconds: splitTime,
                 cumulativeTime: prev.elapsedTime,
                 pace: pace
               });
               
               accumulatedSplitDistance.current = 0;
               splitStartTime.current = timestamp;
            }

            lastPosition.current = newPoint;

            return {
              ...prev,
              totalDistance: newTotalDistance,
              currentSpeed: speed || 0,
              route: [...prev.route, newPoint],
              splits: newSplits
            };
          });
        },
        (error) => console.error(error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
      );
    } else {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    }

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [runState.isActive, runState.isPaused, settings.splitDistance, settings.unit]);

  // --- Timer & Health Logic ---
  useEffect(() => {
    let interval: number;
    if (runState.isActive && !runState.isPaused) {
      interval = window.setInterval(() => {
        setRunState(prev => {
          // 1. Determine Heart Rate
          let hr = prev.currentHeartRate;
          
          if (manualHR) {
            hr = parseInt(manualHR, 10) || prev.currentHeartRate;
          } else if (settings.devices.fitbitConnected) {
            // Simulate Fitbit reading (fluctuate slightly based on exertion)
            const targetHR = 100 + (prev.currentSpeed * 10); // Rough estimation
            const noise = Math.random() * 4 - 2;
            hr = Math.max(60, Math.min(200, Math.round(targetHR + noise)));
          } else {
            // Estimate based on speed if no device
            // Base 70 + 15 bpm per m/s approx
            const estimated = 70 + (prev.currentSpeed * 15);
            // Smooth it
            hr = Math.round(prev.currentHeartRate * 0.8 + estimated * 0.2); 
          }

          // 2. Glucose
          let glucose = prev.currentGlucose;
          if (settings.devices.glucoseMonitorConnected) {
             // Simulate stable glucose with minor fluctuations
             const base = 95;
             const noise = Math.random() * 2 - 1;
             glucose = Math.round((base + noise) * 10) / 10;
          }

          // 3. Calculate Calories for this second
          let calsThisSecond = 0;
          // Prefer HR formula if we have a reasonable HR or device connected
          if (settings.devices.fitbitConnected || manualHR) {
             calsThisSecond = calculateCaloriesPerSecondHR(hr, settings.bodyProfile);
          } else {
             // Fallback to Speed/METs
             calsThisSecond = calculateCaloriesPerSecondMETs(prev.currentSpeed, settings.bodyProfile.weight);
          }

          return {
            ...prev,
            elapsedTime: prev.elapsedTime + 1,
            caloriesBurned: prev.caloriesBurned + calsThisSecond,
            currentHeartRate: hr,
            currentGlucose: glucose
          };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runState.isActive, runState.isPaused, settings.devices, settings.bodyProfile, manualHR]);


  // --- Event Handlers ---

  const handleStart = () => {
    const now = Date.now();
    
    // Convert weight input to kg for internal calc if imperial
    const weightKg = settings.unit === 'imperial' ? weightInput * LBS_TO_KG : weightInput;

    setSettings(prev => ({
      ...prev,
      bodyProfile: { ...prev.bodyProfile, weight: weightKg }
    }));

    setRunState({
      ...runState,
      isActive: true,
      startTime: now,
      isPaused: false,
      route: [], 
      totalDistance: 0,
      elapsedTime: 0,
      splits: [],
      caloriesBurned: 0,
      currentHeartRate: 75,
      currentGlucose: settings.devices.glucoseMonitorConnected ? 95 : null
    });
    
    splitStartTime.current = now;
    accumulatedSplitDistance.current = 0;
    lastPosition.current = null;
    
    setView(AppView.RUNNING);
  };

  const handleStop = async () => {
    setRunState(prev => ({ ...prev, isActive: false, isPaused: true }));
    setIsSaving(true);
    // Auto-save logic
    await saveRunToDatabase(runState);
    setIsSaving(false);
    setView(AppView.SUMMARY);
  };

  const handleUnitChange = (u: 'imperial' | 'metric') => {
    setSettings({
      ...settings,
      unit: u,
      targetDistance: u === 'imperial' ? 3 * 1609.34 : 5000, 
      splitDistance: u === 'imperial' ? 1609.34 : 1000
    });
    // Convert current weight input for display convenience
    if (u === 'imperial') {
       setWeightInput(Math.round(weightInput / LBS_TO_KG)); // kg to lbs (approx logic for toggle)
    } else {
       setWeightInput(Math.round(weightInput * LBS_TO_KG)); // lbs to kg
    }
  };

  // --- Derived Values ---

  const displayDistance = useMemo(() => {
    const d = settings.unit === 'imperial' 
      ? runState.totalDistance * METERS_TO_MILES 
      : runState.totalDistance * METERS_TO_KM;
    return d.toFixed(2);
  }, [runState.totalDistance, settings.unit]);

  const displayPace = calculatePace(runState.currentSpeed, settings.unit);
  
  const progressPercent = Math.min(100, (runState.totalDistance / settings.targetDistance) * 100);
  
  const estimatedArrival = useMemo(() => {
    if (runState.currentSpeed < 0.5) return "Checking...";
    const remainingDist = settings.targetDistance - runState.totalDistance;
    if (remainingDist <= 0) return "Done";
    const secondsRemaining = remainingDist / runState.currentSpeed;
    const arrivalDate = new Date(Date.now() + secondsRemaining * 1000);
    return arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [runState.currentSpeed, runState.totalDistance, settings.targetDistance]);

  const estimatedDuration = useMemo(() => {
     if (runState.currentSpeed < 0.5) return "--:--";
     const remainingDist = settings.targetDistance - runState.totalDistance;
     if (remainingDist <= 0) return "0:00";
     const secondsRemaining = remainingDist / runState.currentSpeed;
     return formatDuration(runState.elapsedTime + secondsRemaining);
  }, [runState.currentSpeed, runState.totalDistance, settings.targetDistance, runState.elapsedTime]);


  // --- Renders ---

  const renderSetup = () => (
    <div className="flex flex-col h-full p-6 animate-fade-in max-w-md mx-auto w-full pb-12">
      <div className="flex-1 flex flex-col justify-start space-y-6">
        <div className="text-center mt-6">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-blue-500">
            TempoRun AI
          </h1>
          <p className="text-slate-400 mt-2">Pace, Map & Health Tracker</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl space-y-6">
          {/* Unit Toggle */}
          <div className="flex bg-slate-900 rounded-lg p-1">
            <button 
              onClick={() => handleUnitChange('imperial')}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${settings.unit === 'imperial' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}
            >
              Miles / Lbs
            </button>
            <button 
              onClick={() => handleUnitChange('metric')}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${settings.unit === 'metric' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}
            >
              KM / Kg
            </button>
          </div>

          {/* Goal Section */}
          <div>
            <label className="text-xs uppercase font-bold text-slate-500 mb-2 block">Run Target</label>
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <input 
                  type="number" 
                  className="w-full bg-slate-900 border border-slate-700 text-white p-3 rounded-xl focus:ring-2 focus:ring-teal-500"
                  defaultValue={settings.unit === 'imperial' ? 3.1 : 5}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      setSettings(prev => ({
                        ...prev,
                        targetDistance: val * (settings.unit === 'imperial' ? 1609.34 : 1000)
                      }));
                    }
                  }}
                />
                <span className="absolute right-3 top-3 text-slate-500 text-xs font-bold">{settings.unit === 'imperial' ? 'MI' : 'KM'}</span>
              </div>
              <div className="relative">
                 <select 
                    className="w-full bg-slate-900 border border-slate-700 text-white p-3 rounded-xl focus:ring-2 focus:ring-teal-500 appearance-none"
                    value={settings.splitDistance}
                    onChange={(e) => setSettings(prev => ({...prev, splitDistance: parseFloat(e.target.value)}))}
                 >
                    <option value={settings.unit === 'imperial' ? 1609.34 : 1000}>1 {settings.unit === 'imperial' ? 'mi' : 'km'} Split</option>
                    <option value={settings.unit === 'imperial' ? 804.67 : 500}>0.5 {settings.unit === 'imperial' ? 'mi' : 'km'} Split</option>
                 </select>
              </div>
            </div>
          </div>

          {/* Body Metrics Section */}
          <div>
             <label className="text-xs uppercase font-bold text-slate-500 mb-2 block">Body Metrics (for Calories)</label>
             <div className="grid grid-cols-3 gap-3">
               <div>
                 <input 
                   type="number" 
                   className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded-lg text-sm"
                   placeholder="Weight"
                   value={weightInput}
                   onChange={(e) => setWeightInput(parseFloat(e.target.value))}
                 />
                 <span className="text-[10px] text-slate-500 text-right block mt-1">{settings.unit === 'imperial' ? 'lbs' : 'kg'}</span>
               </div>
               <div>
                 <input 
                   type="number" 
                   className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded-lg text-sm"
                   placeholder="Age"
                   value={settings.bodyProfile.age}
                   onChange={(e) => setSettings(prev => ({...prev, bodyProfile: {...prev.bodyProfile, age: parseFloat(e.target.value)}}))}
                 />
                 <span className="text-[10px] text-slate-500 text-right block mt-1">yrs</span>
               </div>
               <div>
                 <select 
                    className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded-lg text-sm"
                    value={settings.bodyProfile.gender}
                    onChange={(e) => setSettings(prev => ({...prev, bodyProfile: {...prev.bodyProfile, gender: e.target.value as 'male' | 'female'}}))}
                 >
                   <option value="male">Male</option>
                   <option value="female">Female</option>
                 </select>
                 <span className="text-[10px] text-slate-500 text-right block mt-1">Sex</span>
               </div>
             </div>
          </div>

          {/* Integrations Section */}
          <div className="pt-2 border-t border-slate-700">
             <label className="text-xs uppercase font-bold text-slate-500 mb-2 block">Devices & Integrations</label>
             <div className="space-y-2">
                <button 
                  onClick={() => setSettings(prev => ({...prev, devices: {...prev.devices, fitbitConnected: !prev.devices.fitbitConnected}}))}
                  className={`w-full p-3 rounded-lg flex items-center justify-between border transition-all ${settings.devices.fitbitConnected ? 'bg-teal-900/30 border-teal-500/50' : 'bg-slate-900 border-slate-700'}`}
                >
                   <div className="flex items-center gap-3">
                      <div className="bg-slate-800 p-1.5 rounded-full text-teal-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-slate-300">Fitbit / Heart Monitor</span>
                   </div>
                   <span className={`text-xs px-2 py-1 rounded ${settings.devices.fitbitConnected ? 'bg-teal-500 text-slate-900 font-bold' : 'text-slate-500'}`}>
                     {settings.devices.fitbitConnected ? 'CONNECTED' : 'OFF'}
                   </span>
                </button>

                <button 
                  onClick={() => setSettings(prev => ({...prev, devices: {...prev.devices, glucoseMonitorConnected: !prev.devices.glucoseMonitorConnected}}))}
                  className={`w-full p-3 rounded-lg flex items-center justify-between border transition-all ${settings.devices.glucoseMonitorConnected ? 'bg-blue-900/30 border-blue-500/50' : 'bg-slate-900 border-slate-700'}`}
                >
                   <div className="flex items-center gap-3">
                      <div className="bg-slate-800 p-1.5 rounded-full text-blue-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75v-4.5m0 4.5h4.5m-4.5 0 6-6m-3 18c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-slate-300">Glucose Monitor</span>
                   </div>
                   <span className={`text-xs px-2 py-1 rounded ${settings.devices.glucoseMonitorConnected ? 'bg-blue-500 text-white font-bold' : 'text-slate-500'}`}>
                     {settings.devices.glucoseMonitorConnected ? 'CONNECTED' : 'OFF'}
                   </span>
                </button>
             </div>
          </div>
        </div>
      </div>

      <button 
        onClick={handleStart}
        className="w-full py-4 mt-6 bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold text-xl rounded-2xl shadow-lg shadow-teal-500/20 transform active:scale-95 transition-all"
      >
        START RUN
      </button>
    </div>
  );

  const renderRunning = () => (
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden relative">
      {/* Top Header - Sticky Stats */}
      <div className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 p-4 pb-2 z-10 sticky top-0">
        <div className="flex justify-between items-center mb-4">
           <div>
             <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total Time</span>
             <h2 className="text-3xl font-mono text-white leading-none">{formatDuration(runState.elapsedTime)}</h2>
           </div>
           <div className="text-right">
             <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Distance</span>
             <h2 className="text-3xl font-mono text-white leading-none">
               {displayDistance} <span className="text-sm text-slate-500">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
             </h2>
           </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-teal-500 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-32">
        
        {/* Speedometer Card */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 flex flex-col items-center justify-center">
             <span className="text-xs text-slate-400 uppercase font-bold">Current Pace</span>
             <span className="text-2xl font-bold text-teal-400">{displayPace}</span>
             <span className="text-[10px] text-slate-500">min/{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
          </div>
           <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 flex flex-col items-center justify-center">
             <span className="text-xs text-slate-400 uppercase font-bold">Est. Arrival</span>
             <span className="text-xl font-bold text-blue-400">{estimatedArrival}</span>
             <span className="text-[10px] text-slate-500">Finish: {estimatedDuration}</span>
          </div>
        </div>

        {/* Health Stats Card */}
        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700">
           <div className="flex items-center justify-between mb-3">
              <h3 className="text-slate-200 font-bold text-sm uppercase">Health Stats</h3>
              {settings.devices.fitbitConnected && <span className="text-[10px] text-teal-500 bg-teal-900/30 px-2 py-0.5 rounded">Device Active</span>}
           </div>
           
           <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-900/50 p-3 rounded-xl flex flex-col items-center justify-center relative">
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-red-500 animate-pulse absolute top-2 right-2 opacity-80">
                   <path d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
                 </svg>
                 <span className="text-2xl font-bold text-white">{runState.currentHeartRate}</span>
                 <span className="text-[10px] text-slate-500">BPM</span>
                 
                 {!settings.devices.fitbitConnected && (
                    <input 
                      type="number" 
                      placeholder="Set" 
                      className="mt-1 w-full text-center bg-slate-800 text-xs text-slate-300 rounded border-none p-1 focus:ring-1 focus:ring-teal-500"
                      value={manualHR}
                      onChange={(e) => setManualHR(e.target.value)}
                    />
                 )}
              </div>

              <div className="bg-slate-900/50 p-3 rounded-xl flex flex-col items-center justify-center">
                 <span className="text-2xl font-bold text-orange-400">{Math.round(runState.caloriesBurned)}</span>
                 <span className="text-[10px] text-slate-500">KCAL</span>
              </div>

              <div className="bg-slate-900/50 p-3 rounded-xl flex flex-col items-center justify-center opacity-90">
                 {runState.currentGlucose ? (
                   <>
                    <span className="text-2xl font-bold text-blue-400">{runState.currentGlucose}</span>
                    <span className="text-[10px] text-slate-500">mg/dL</span>
                   </>
                 ) : (
                   <>
                    <span className="text-lg text-slate-600 font-bold">--</span>
                    <span className="text-[10px] text-slate-600">Glucose</span>
                   </>
                 )}
              </div>
           </div>
        </div>

        {/* Map */}
        <MapTracker 
          route={runState.route} 
          currentLocation={runState.route[runState.route.length - 1] || null} 
        />
        
        {/* Music Integration */}
        <MusicPacer currentPace={displayPace} />

        {/* Splits */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
           <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-200">Splits</h3>
              <span className="text-xs text-slate-500">Interval: {settings.splitDistance}m</span>
           </div>
           
           <div className="mb-4">
             {runState.splits.length > 0 ? (
               <table className="w-full text-sm text-left text-slate-400">
                 <thead className="text-xs text-slate-500 uppercase bg-slate-900/50">
                   <tr>
                     <th className="px-2 py-1 rounded-l">Dist</th>
                     <th className="px-2 py-1">Time</th>
                     <th className="px-2 py-1 rounded-r">Pace</th>
                   </tr>
                 </thead>
                 <tbody>
                   {runState.splits.slice().reverse().slice(0, 3).map((split, i) => (
                     <tr key={i} className="border-b border-slate-700/50 last:border-0">
                       <td className="px-2 py-2 font-medium text-slate-200">{split.distanceLabel}</td>
                       <td className="px-2 py-2 font-mono">{formatDuration(split.timeSeconds)}</td>
                       <td className="px-2 py-2 font-mono text-teal-400">{split.pace}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             ) : (
                <p className="text-center text-xs text-slate-600 py-2">Run {settings.unit === 'imperial' ? '1 mile' : '1 km'} to see first split.</p>
             )}
           </div>

           <SplitsChart splits={runState.splits} />
        </div>
      </div>

      {/* Floating Controls */}
      <div className="absolute bottom-6 left-0 right-0 px-6 flex justify-center gap-4 z-20">
        <button 
          onClick={() => setRunState(prev => ({ ...prev, isPaused: !prev.isPaused }))}
          className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-all ${runState.isPaused ? 'bg-green-500 text-white' : 'bg-yellow-500 text-slate-900'}`}
        >
           {runState.isPaused ? (
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 ml-1"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" /></svg>
           ) : (
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
           )}
        </button>
        
        {runState.isPaused && (
          <button 
            onClick={handleStop}
            className="h-16 w-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg text-white hover:bg-red-600 transition-all animate-bounce-in"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" /></svg>
          </button>
        )}
      </div>
    </div>
  );

  const renderSummary = () => (
    <div className="h-full p-6 flex flex-col justify-center max-w-md mx-auto">
      <div className="bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
        <div className="w-16 h-16 bg-teal-500/20 text-teal-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        </div>
        <h2 className="text-3xl font-bold text-white mb-1">Run Complete!</h2>
        <p className="text-slate-400 text-sm mb-6">{new Date().toLocaleDateString()}</p>
        
        <div className="grid grid-cols-2 gap-6 mb-6">
           <div>
             <p className="text-xs uppercase text-slate-500 font-bold">Distance</p>
             <p className="text-2xl font-mono text-white">{displayDistance}</p>
             <p className="text-[10px] text-slate-600">{settings.unit === 'imperial' ? 'MILES' : 'KM'}</p>
           </div>
           <div>
             <p className="text-xs uppercase text-slate-500 font-bold">Time</p>
             <p className="text-2xl font-mono text-white">{formatDuration(runState.elapsedTime)}</p>
           </div>
        </div>

        <div className="border-t border-slate-700 pt-6 grid grid-cols-2 gap-6 mb-8">
           <div>
             <p className="text-xs uppercase text-slate-500 font-bold">Avg Pace</p>
             <p className="text-xl font-mono text-white">
                {calculatePace(runState.totalDistance > 0 ? runState.totalDistance / runState.elapsedTime : 0, settings.unit)}
             </p>
           </div>
           <div>
             <p className="text-xs uppercase text-slate-500 font-bold">Calories</p>
             <p className="text-xl font-mono text-orange-400">{Math.round(runState.caloriesBurned)}</p>
             <p className="text-[10px] text-slate-600">KCAL</p>
           </div>
        </div>

        {isSaving && <p className="text-sm text-teal-400 animate-pulse mb-4">Saving to cloud...</p>}

        <button 
          onClick={() => setView(AppView.SETUP)}
          className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold transition-all"
        >
          Back to Home
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-slate-900 min-h-screen text-slate-100 font-sans selection:bg-teal-500/30">
      {view === AppView.SETUP && renderSetup()}
      {view === AppView.RUNNING && renderRunning()}
      {view === AppView.SUMMARY && renderSummary()}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);