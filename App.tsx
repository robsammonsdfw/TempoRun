
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import { MapTracker } from './components/MapTracker';
import { SplitsChart } from './components/SplitsChart';
import { MusicPacer } from './components/MusicPacer';
import { saveRunToDatabase } from './services/geminiService';
import { AppView, GeoPoint, RunSettings, RunState, Split } from './types';
import { 
  calculatePace, 
  formatDuration, 
  getDistanceFromLatLonInM, 
  METERS_TO_MILES, 
  METERS_TO_KM,
  LBS_TO_KG,
  calculateCaloriesPerSecondHR,
  calculateCaloriesPerSecondMETs,
  formatSpeed
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

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.SETUP);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [settings, setSettings] = useState<RunSettings>({
    targetDistance: 5000, 
    splitDistance: 1609.34, 
    unit: 'imperial',
    bodyProfile: { weight: 70, age: 30, gender: 'male' },
    devices: { fitbitConnected: false, glucoseMonitorConnected: false }
  });

  const [weightInput, setWeightInput] = useState<number>(155); 
  const [runState, setRunState] = useState<RunState>({
    isActive: false, isPaused: false, startTime: null, elapsedTime: 0,
    totalDistance: 0, currentSpeed: 0, route: [], splits: [],
    caloriesBurned: 0, currentHeartRate: 70, currentGlucose: null
  });

  const [manualHR, setManualHR] = useState<string>("");
  const [recentSpeeds, setRecentSpeeds] = useState<number[]>([]);

  const watchId = useRef<number | null>(null);
  const lastPosition = useRef<GeoPoint | null>(null);
  const accumulatedSplitDistance = useRef<number>(0);
  const splitStartTime = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- Voice Coach Logic ---
  const speakStatus = async (text: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly and encouragingly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
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

  // --- Geolocation Logic ---
  useEffect(() => {
    if (runState.isActive && !runState.isPaused) {
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, speed } = position.coords;
          const timestamp = position.timestamp;
          const newPoint: GeoPoint = { lat: latitude, lng: longitude, timestamp, speed };

          setRunState(prev => {
            let addedDist = 0;
            if (lastPosition.current) {
              addedDist = getDistanceFromLatLonInM(lastPosition.current.lat, lastPosition.current.lng, newPoint.lat, newPoint.lng);
            }
            if (addedDist > 50 && prev.route.length > 0) return prev; 

            const newTotalDistance = prev.totalDistance + addedDist;
            accumulatedSplitDistance.current += addedDist;
            let newSplits = [...prev.splits];
            
            if (accumulatedSplitDistance.current >= settings.splitDistance) {
               const splitTime = (timestamp - (splitStartTime.current || timestamp)) / 1000;
               const pace = calculatePace(settings.splitDistance / splitTime, settings.unit);
               const splitLabel = `${newSplits.length + 1} ${settings.unit === 'imperial' ? 'mile' : 'kilometer'}`;
               
               newSplits.push({
                 distanceLabel: splitLabel,
                 timeSeconds: splitTime,
                 cumulativeTime: prev.elapsedTime,
                 pace: pace
               });
               
               speakStatus(`Split ${newSplits.length} complete. Pace: ${pace}. Keep it up!`);
               accumulatedSplitDistance.current = 0;
               splitStartTime.current = timestamp;
            }

            lastPosition.current = newPoint;
            const currentSpeed = speed || 0;
            setRecentSpeeds(s => [...s.slice(-4), currentSpeed]);

            return {
              ...prev,
              totalDistance: newTotalDistance,
              currentSpeed: currentSpeed,
              route: [...prev.route, newPoint],
              splits: newSplits
            };
          });
        },
        (error) => console.error(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    }
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [runState.isActive, runState.isPaused, settings.splitDistance, settings.unit]);

  // --- Timer & Health Logic ---
  useEffect(() => {
    let interval: number;
    if (runState.isActive && !runState.isPaused) {
      interval = window.setInterval(() => {
        setRunState(prev => {
          let hr = prev.currentHeartRate;
          if (manualHR) {
            hr = parseInt(manualHR, 10) || prev.currentHeartRate;
          } else if (settings.devices.fitbitConnected) {
            const targetHR = 110 + (prev.currentSpeed * 12);
            hr = Math.max(60, Math.min(195, Math.round(targetHR + (Math.random() * 4 - 2))));
          } else {
            const estimated = 70 + (prev.currentSpeed * 15);
            hr = Math.round(prev.currentHeartRate * 0.9 + estimated * 0.1); 
          }

          let calsThisSecond = settings.devices.fitbitConnected || manualHR
            ? calculateCaloriesPerSecondHR(hr, settings.bodyProfile)
            : calculateCaloriesPerSecondMETs(prev.currentSpeed, settings.bodyProfile.weight);

          return {
            ...prev,
            elapsedTime: prev.elapsedTime + 1,
            caloriesBurned: prev.caloriesBurned + calsThisSecond,
            currentHeartRate: hr,
            currentGlucose: settings.devices.glucoseMonitorConnected ? (95 + Math.random() * 2) : null
          };
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runState.isActive, runState.isPaused, settings.devices, settings.bodyProfile, manualHR]);

  const handleStart = () => {
    const now = Date.now();
    const weightKg = settings.unit === 'imperial' ? weightInput * LBS_TO_KG : weightInput;
    setSettings(prev => ({ ...prev, bodyProfile: { ...prev.bodyProfile, weight: weightKg } }));
    setRunState({
      ...runState, isActive: true, startTime: now, isPaused: false, route: [], 
      totalDistance: 0, elapsedTime: 0, splits: [], caloriesBurned: 0, currentHeartRate: 75,
      currentGlucose: settings.devices.glucoseMonitorConnected ? 95 : null
    });
    splitStartTime.current = now;
    accumulatedSplitDistance.current = 0;
    lastPosition.current = null;
    setView(AppView.RUNNING);
    speakStatus("Starting your run. Track your arrival at the top. Let's go!");
  };

  const smoothedSpeed = useMemo(() => {
    if (recentSpeeds.length === 0) return runState.currentSpeed;
    return recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
  }, [recentSpeeds, runState.currentSpeed]);

  const displayDistance = useMemo(() => {
    const d = settings.unit === 'imperial' ? runState.totalDistance * METERS_TO_MILES : runState.totalDistance * METERS_TO_KM;
    return d.toFixed(2);
  }, [runState.totalDistance, settings.unit]);

  const displayPace = calculatePace(smoothedSpeed, settings.unit);
  const displaySpeed = formatSpeed(smoothedSpeed, settings.unit);
  const progressPercent = Math.min(100, (runState.totalDistance / settings.targetDistance) * 100);
  
  const estimatedArrival = useMemo(() => {
    if (smoothedSpeed < 0.5) return "Calculating...";
    const remainingDist = settings.targetDistance - runState.totalDistance;
    if (remainingDist <= 0) return "Arrived";
    const secondsRemaining = remainingDist / smoothedSpeed;
    const arrivalDate = new Date(Date.now() + secondsRemaining * 1000);
    return arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [smoothedSpeed, runState.totalDistance, settings.targetDistance]);

  const renderSetup = () => (
    <div className="flex flex-col h-full p-6 animate-fade-in max-w-md mx-auto w-full pb-12">
      <div className="flex-1 space-y-6">
        <div className="text-center mt-6 flex flex-col items-center">
          <img src="/logo.svg" alt="EmbraceHealth.ai" className="h-16 mb-2" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-2">Precision AI Running</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
          <div className="flex bg-slate-900 rounded-xl p-1 shadow-inner">
            <button onClick={() => setSettings(s => ({...s, unit: 'imperial'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'imperial' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Imperial</button>
            <button onClick={() => setSettings(s => ({...s, unit: 'metric'}))} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase transition-all ${settings.unit === 'metric' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Metric</button>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black text-slate-500 mb-2 block">Distance Goal</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <input type="number" className="w-full bg-slate-900 border-2 border-slate-700 text-white p-4 rounded-2xl font-bold text-xl focus:border-teal-500 outline-none transition-all" defaultValue={3.1} onChange={(e) => setSettings(prev => ({...prev, targetDistance: parseFloat(e.target.value) * (settings.unit === 'imperial' ? 1609.34 : 1000)}))} />
                <span className="absolute right-4 top-5 text-slate-500 font-black">{settings.unit === 'imperial' ? 'MI' : 'KM'}</span>
              </div>
              <select className="w-full bg-slate-900 border-2 border-slate-700 text-white p-4 rounded-2xl font-bold appearance-none" onChange={(e) => setSettings(prev => ({...prev, splitDistance: parseFloat(e.target.value)}))}>
                 <option value={settings.unit === 'imperial' ? 1609.34 : 1000}>Full Split</option>
                 <option value={settings.unit === 'imperial' ? 804.67 : 500}>Half Split</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-700/50">
             <button onClick={handleStart} className="w-full py-5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-2xl rounded-2xl shadow-[0_10px_40px_rgba(20,184,166,0.3)] transform active:scale-95 transition-all italic">
                GO RUN
             </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRunning = () => (
    <div className="flex flex-col h-screen bg-black overflow-hidden relative">
      <div className="bg-zinc-900/80 backdrop-blur-xl border-b border-white/5 p-6 z-10">
        <div className="flex justify-between items-center mb-2">
           <div className="flex items-center gap-3">
             <img src="/icon.svg" alt="EH" className="h-8 w-8" />
             <div>
                <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest block">Time</span>
                <h2 className="text-3xl font-black italic text-white leading-none tracking-tighter">{formatDuration(runState.elapsedTime)}</h2>
             </div>
           </div>
           <div className="text-right">
             <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Distance</span>
             <h2 className="text-4xl font-black italic text-teal-400 leading-none tracking-tighter">
               {displayDistance} <span className="text-lg text-zinc-600 not-italic">{settings.unit === 'imperial' ? 'mi' : 'km'}</span>
             </h2>
           </div>
        </div>
        <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48 scrollbar-hide">
        <div className="bg-gradient-to-br from-zinc-900 to-black p-8 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center relative shadow-2xl overflow-hidden">
          <div className="absolute top-4 left-6 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Speedometer</div>
          <div className="relative">
             <div className="text-[120px] font-black italic tracking-tighter text-white leading-none transform -skew-x-6">{displaySpeed}</div>
             <div className="absolute -bottom-2 right-0 text-xl font-black text-teal-500 italic uppercase">{settings.unit === 'imperial' ? 'MPH' : 'KPH'}</div>
          </div>
          <div className="mt-4 flex gap-8">
            <div className="text-center">
              <div className="text-[10px] font-black text-zinc-500 uppercase">Current Pace</div>
              <div className="text-2xl font-black text-white italic">{displayPace}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black text-zinc-500 uppercase">Target Arrival</div>
              <div className="text-2xl font-black text-amber-400 italic">{estimatedArrival}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
           <div className="bg-zinc-900/50 p-4 rounded-3xl border border-white/5 flex flex-col items-center">
              <div className="flex items-center gap-1 text-[10px] font-black text-red-500 uppercase mb-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></div> Heart Rate
              </div>
              <div className="text-3xl font-black italic text-white">{runState.currentHeartRate} <span className="text-xs not-italic text-zinc-600">BPM</span></div>
           </div>
           <div className="bg-zinc-900/50 p-4 rounded-3xl border border-white/5 flex flex-col items-center">
              <div className="text-[10px] font-black text-orange-500 uppercase mb-1">Burned</div>
              <div className="text-3xl font-black italic text-white">{Math.round(runState.caloriesBurned)} <span className="text-xs not-italic text-zinc-600">KCAL</span></div>
           </div>
        </div>

        <MapTracker route={runState.route} currentLocation={runState.route[runState.route.length - 1] || null} />
        <MusicPacer currentPace={displayPace} />
        
        <div className="bg-zinc-900/50 rounded-3xl border border-white/5 p-6">
           <h3 className="font-black italic uppercase text-zinc-400 mb-4 tracking-tighter">Split Breakdown</h3>
           {runState.splits.length > 0 ? (
              <div className="space-y-3">
                 {runState.splits.slice().reverse().map((split, i) => (
                   <div key={i} className="flex justify-between items-center bg-black/40 p-3 rounded-xl">
                      <span className="font-black text-zinc-500 italic">{split.distanceLabel}</span>
                      <span className="font-black text-white italic">{split.pace}</span>
                   </div>
                 ))}
              </div>
           ) : <p className="text-zinc-600 text-xs font-bold uppercase italic text-center py-4">Reach your first split to see data</p>}
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
                    <div className="text-[10px] font-black text-zinc-600 uppercase">Duration</div>
                    <div className="text-2xl font-black italic">{formatDuration(runState.elapsedTime)}</div>
                 </div>
              </div>
              <button onClick={() => setView(AppView.SETUP)} className="w-full py-5 bg-white text-black font-black uppercase italic rounded-2xl hover:bg-zinc-200 transition-all">Start New Run</button>
           </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);