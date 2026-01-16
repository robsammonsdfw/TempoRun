
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeMusicRhythm } from '../services/geminiService';
import { BpmAnalysisResult } from '../types';
import { formatDuration } from '../constants';

interface MusicPacerProps {
  currentPace: string;
}

// Average stride length in meters. 
// 0.95m is a reasonable average for recreational runners.
const AVG_STRIDE_LENGTH_M = 0.95; 

export const MusicPacer: React.FC<MusicPacerProps> = ({ currentPace }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<BpmAnalysisResult | null>(null);
  const [manualBpm, setManualBpm] = useState<number>(120);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Update manual BPM if analysis returns a result
  useEffect(() => {
    if (result?.bpm) {
      setManualBpm(result.bpm);
    }
  }, [result]);

  const activeBpm = manualBpm;

  const startAnalysis = async () => {
    try {
      setResult(null);
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // Stop all tracks to release mic
        stream.getTracks().forEach(track => track.stop());
        
        setIsAnalyzing(true);
        try {
          const analysis = await analyzeMusicRhythm(blob, currentPace);
          setResult(analysis);
        } catch (err) {
          console.error(err);
          setErrorMessage('Could not reach server. Check connection.');
        } finally {
          setIsAnalyzing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Record for 5 seconds
      setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
          setIsRecording(false);
        }
      }, 5000);

    } catch (err: any) {
      console.error("Mic access denied:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage("Microphone access denied. Please allow microphone permissions in your browser settings.");
      } else {
        setErrorMessage("Could not access microphone. " + err.message);
      }
    }
  };

  // --- Grid Calculation Logic ---
  const scenarios = useMemo(() => {
    // We calculate scenarios for:
    // 2:1 (Double Time) - 2 steps per beat
    // 1:1 (Synced)      - 1 step per beat
    // 1:2 (Half Time)   - 1 step per 2 beats
    
    const strategies = [
      { name: "Double Time", ratio: 2, desc: "2 Steps / Beat" },
      { name: "Synced", ratio: 1, desc: "1 Step / Beat" },
      { name: "Half Time", ratio: 0.5, desc: "1 Step / 2 Beats" },
    ];

    return strategies.map(strat => {
      const spm = Math.round(activeBpm * strat.ratio);
      
      // Speed (m/min) = SPM * Stride (m)
      const speedMetersPerMin = spm * AVG_STRIDE_LENGTH_M;
      
      // MPH = (m/min * 60) / 1609.34
      const speedMph = (speedMetersPerMin * 60) / 1609.34;
      
      // Mile Time (seconds) = 3600 / MPH
      const mileTimeSeconds = speedMph > 0 ? (3600 / speedMph) : 0;
      
      // "Viable" range for running: 130 - 190 SPM
      // "Viable" range for walking: 60 - 130 SPM
      let viability = 'impractical';
      if (spm >= 130 && spm <= 200) viability = 'running';
      else if (spm >= 60 && spm < 130) viability = 'walking';
      else if (spm > 200) viability = 'sprinting';

      return {
        ...strat,
        spm,
        speedMph: speedMph.toFixed(1),
        mileTime: speedMph > 0 ? formatDuration(mileTimeSeconds) : "-:--",
        viability
      };
    });
  }, [activeBpm]);

  return (
    <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700 mt-4 relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl -z-10 pointer-events-none"></div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            Rhythm Dashboard
          </h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            BPM to Pace Converter
          </p>
        </div>
        <div className="text-right">
           <div className="text-4xl font-black text-white italic tracking-tighter">{activeBpm}</div>
           <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Target BPM</div>
        </div>
      </div>

      {/* Manual BPM Slider */}
      <div className="mb-6 bg-slate-900/50 p-4 rounded-2xl border border-white/5">
        <div className="flex justify-between text-xs text-slate-400 font-bold uppercase mb-2">
          <span>60 BPM</span>
          <span>Set Music Tempo</span>
          <span>200 BPM</span>
        </div>
        <input 
          type="range" 
          min="60" 
          max="200" 
          value={activeBpm} 
          onChange={(e) => setManualBpm(parseInt(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
        />
      </div>

      {/* Microphone Control */}
      {!isAnalyzing && !isRecording ? (
        <button
          onClick={startAnalysis}
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl font-black italic uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 mb-6"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
          Detect Song BPM
        </button>
      ) : (
        <div className="w-full py-4 bg-slate-700 rounded-2xl flex items-center justify-center gap-3 mb-6">
          {isRecording && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span className="text-white font-bold text-sm uppercase">Listening...</span>
            </>
          )}
          {isAnalyzing && <span className="text-purple-300 font-bold text-sm uppercase animate-pulse">Analyzing Pattern...</span>}
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold text-center">
          {errorMessage}
        </div>
      )}

      {/* Result Display (Genre/Advice) */}
      {result && !isAnalyzing && (
        <div className="mb-6 animate-fade-in">
          <div className="bg-slate-700/30 p-4 rounded-xl border border-white/5">
            <div className="flex justify-between items-center mb-2">
               <span className="text-xs font-bold text-slate-400 uppercase">Genre Detected</span>
               <span className="text-xs font-black text-pink-400 uppercase">{result.genre}</span>
            </div>
            <p className="text-sm text-slate-200 italic">"{result.advice}"</p>
          </div>
        </div>
      )}

      {/* The Requested Grid */}
      <div className="bg-black/40 rounded-xl overflow-hidden border border-white/10">
        <div className="grid grid-cols-4 bg-white/5 p-3 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">
          <div className="text-left">Strategy</div>
          <div>Cadence</div>
          <div>Speed</div>
          <div>Mile Pace</div>
        </div>

        {scenarios.map((s, i) => {
          // Highlight row logic
          const isOptimalRunning = s.viability === 'running';
          const isWalking = s.viability === 'walking';
          
          return (
            <div 
              key={i} 
              className={`grid grid-cols-4 p-4 items-center text-center border-t border-white/5 transition-colors
                ${isOptimalRunning ? 'bg-teal-500/20' : ''}
                ${isWalking ? 'bg-amber-500/10' : ''}
              `}
            >
              <div className="text-left">
                <div className={`text-xs font-black uppercase ${isOptimalRunning ? 'text-teal-400' : isWalking ? 'text-amber-400' : 'text-slate-400'}`}>
                  {s.name}
                </div>
                <div className="text-[9px] text-slate-500 font-bold">{s.desc}</div>
              </div>
              
              <div>
                <div className="text-lg font-black text-white italic leading-none">{s.spm}</div>
                <div className="text-[8px] text-slate-500 uppercase font-bold">SPM</div>
              </div>

              <div>
                <div className="text-lg font-black text-white italic leading-none">{s.speedMph}</div>
                <div className="text-[8px] text-slate-500 uppercase font-bold">MPH</div>
              </div>

              <div>
                <div className={`text-lg font-black italic leading-none ${isOptimalRunning ? 'text-teal-400' : 'text-white'}`}>
                  {s.mileTime}
                </div>
                <div className="text-[8px] text-slate-500 uppercase font-bold">/ MILE</div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-3 flex gap-4 justify-center">
         <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-teal-500"></div>
            <span className="text-[9px] text-slate-400 font-bold uppercase">Run Zone</span>
         </div>
         <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <span className="text-[9px] text-slate-400 font-bold uppercase">Walk Zone</span>
         </div>
      </div>

    </div>
  );
};
