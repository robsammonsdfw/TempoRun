
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { analyzeMusicRhythm } from '../services/geminiService';
import { BpmAnalysisResult } from '../types';
import { formatDuration, RACE_DISTANCES, MPS_TO_MPH, METERS_TO_MILES } from '../constants';

interface MusicPacerProps {
  currentPace: string;
  targetSpeedMps: number | null;
  onTargetSpeedChange: (mps: number) => void;
}

export const MusicPacer: React.FC<MusicPacerProps> = ({ currentPace, targetSpeedMps, onTargetSpeedChange }) => {
  const [activeTab, setActiveTab] = useState<'calculator' | 'detector'>('calculator');

  // Initialize input state from props if available
  const initialMph = targetSpeedMps ? (targetSpeedMps * MPS_TO_MPH).toFixed(1) : "6.0";
  
  // --- Calculator State ---
  // We keep everything in string format for inputs to allow decimals easily
  const [inputMph, setInputMph] = useState<string>(initialMph);
  const [inputPaceMin, setInputPaceMin] = useState<string>("10");
  const [inputPaceSec, setInputPaceSec] = useState<string>("00");
  const [inputCadence, setInputCadence] = useState<string>("160");
  const [inputStride, setInputStride] = useState<string>("1.00"); // Meters

  // Sync prop changes to local state (if changed externally)
  useEffect(() => {
    if (targetSpeedMps) {
      const mph = targetSpeedMps * MPS_TO_MPH;
      // Only update if significantly different to avoid typing jitter
      if (Math.abs(mph - parseFloat(inputMph)) > 0.1) {
         setInputMph(mph.toFixed(1));
         // Trigger recalculation of other fields
         const minPerMile = 60 / mph;
         const mins = Math.floor(minPerMile);
         const secs = Math.round((minPerMile - mins) * 60);
         setInputPaceMin(mins.toString());
         setInputPaceSec(secs < 10 ? `0${secs}` : secs.toString());
      }
    }
  }, [targetSpeedMps]);

  // Helper: Convert string inputs to numbers safely
  const getValues = () => ({
    mph: parseFloat(inputMph) || 0,
    stride: parseFloat(inputStride) || 1,
    cadence: parseFloat(inputCadence) || 0
  });

  // --- Handlers for Bidirectional Logic ---

  // 1. User changes SPEED (MPH) -> Recalculate Pace & Cadence
  const handleSpeedChange = (val: string) => {
    setInputMph(val);
    const mph = parseFloat(val);
    if (!isNaN(mph) && mph > 0) {
      // Update Parent
      onTargetSpeedChange(mph / MPS_TO_MPH);

      // Pace
      const minPerMile = 60 / mph;
      const mins = Math.floor(minPerMile);
      const secs = Math.round((minPerMile - mins) * 60);
      setInputPaceMin(mins.toString());
      setInputPaceSec(secs < 10 ? `0${secs}` : secs.toString());

      // Cadence (SPM) = Speed (m/min) / Stride (m)
      // Speed (m/min) = MPH * 26.8224
      const mPerMin = mph * 26.8224;
      const stride = parseFloat(inputStride) || 1;
      const spm = Math.round(mPerMin / stride);
      setInputCadence(spm.toString());
    }
  };

  // 2. User changes PACE -> Recalculate Speed & Cadence
  const handlePaceChange = (minStr: string, secStr: string) => {
    setInputPaceMin(minStr);
    setInputPaceSec(secStr);
    
    const min = parseFloat(minStr) || 0;
    const sec = parseFloat(secStr) || 0;
    const totalMin = min + (sec / 60);

    if (totalMin > 0) {
      // Speed
      const mph = 60 / totalMin;
      setInputMph(mph.toFixed(2));
      onTargetSpeedChange(mph / MPS_TO_MPH);

      // Cadence
      const mPerMin = mph * 26.8224;
      const stride = parseFloat(inputStride) || 1;
      const spm = Math.round(mPerMin / stride);
      setInputCadence(spm.toString());
    }
  };

  // 3. User changes CADENCE -> Recalculate Speed & Pace (Using Stride)
  const handleCadenceChange = (val: string) => {
    setInputCadence(val);
    const spm = parseFloat(val);
    const stride = parseFloat(inputStride) || 1;

    if (!isNaN(spm) && spm > 0) {
      // Speed (m/min) = SPM * Stride
      const mPerMin = spm * stride;
      // MPH = mPerMin / 26.8224
      const mph = mPerMin / 26.8224;
      
      setInputMph(mph.toFixed(2));
      onTargetSpeedChange(mph / MPS_TO_MPH);
      
      // Pace
      const minPerMile = 60 / mph;
      const mins = Math.floor(minPerMile);
      const secs = Math.round((minPerMile - mins) * 60);
      setInputPaceMin(mins.toString());
      setInputPaceSec(secs < 10 ? `0${secs}` : secs.toString());
    }
  };

  // 4. User changes STRIDE -> Recalculate Speed (Keeping Cadence constant)
  // Usually when tweaking stride, you want to see how it affects your speed at your current rhythm.
  const handleStrideChange = (val: string) => {
    setInputStride(val);
    const stride = parseFloat(val);
    const spm = parseFloat(inputCadence) || 0;

    if (!isNaN(stride) && stride > 0 && spm > 0) {
       const mPerMin = spm * stride;
       const mph = mPerMin / 26.8224;
       
       setInputMph(mph.toFixed(2));
       onTargetSpeedChange(mph / MPS_TO_MPH);

       // Pace
       const minPerMile = 60 / mph;
       const mins = Math.floor(minPerMile);
       const secs = Math.round((minPerMile - mins) * 60);
       setInputPaceMin(mins.toString());
       setInputPaceSec(secs < 10 ? `0${secs}` : secs.toString());
    }
  };

  // --- Derived Stats for Display ---
  const { mph } = getValues();
  const speedMps = mph / MPS_TO_MPH;
  const stepsPerSec = (parseFloat(inputCadence) || 0) / 60;

  // --- Race Predictions ---
  const renderRaceTable = (distances: typeof RACE_DISTANCES.ENDURANCE) => {
    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {distances.map((d, i) => {
          // Time = Distance (m) / Speed (m/s)
          const seconds = speedMps > 0 ? d.meters / speedMps : 0;
          return (
            <div key={i} className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{d.label}</span>
              <span className="text-sm font-black text-white font-mono">{formatDuration(seconds)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // --- Detector State (Old Logic) ---
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<BpmAnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startAnalysis = async () => {
    try {
      setResult(null);
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        setIsAnalyzing(true);
        try {
          const analysis = await analyzeMusicRhythm(blob, currentPace);
          setResult(analysis);
          // Auto-set the calculator cadence if detected
          if(analysis.bpm) handleCadenceChange(analysis.bpm.toString());
        } catch (err) {
          setErrorMessage('Could not reach server.');
        } finally {
          setIsAnalyzing(false);
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
      setTimeout(() => { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); setIsRecording(false); }, 5000);
    } catch (err) { setErrorMessage("Microphone access denied."); }
  };

  return (
    <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700 mt-4 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-indigo-400">
            Performance Lab
          </h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Calculator & Target Pacer
          </p>
        </div>
        <div className="flex bg-slate-900 rounded-lg p-1">
          <button onClick={() => setActiveTab('calculator')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded ${activeTab === 'calculator' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Calc</button>
          <button onClick={() => setActiveTab('detector')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded ${activeTab === 'detector' ? 'bg-teal-500 text-slate-900' : 'text-slate-500'}`}>Mic</button>
        </div>
      </div>

      {activeTab === 'calculator' ? (
        <div className="animate-fade-in space-y-4">
           {/* Row 1: Speed & Stride */}
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5 relative">
                 <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Target MPH</label>
                 <input 
                   type="number" 
                   value={inputMph} 
                   onChange={(e) => handleSpeedChange(e.target.value)}
                   className="w-full bg-transparent text-2xl font-black italic text-white outline-none placeholder-slate-700" 
                   placeholder="0.0"
                 />
                 <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></div>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5">
                 <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Stride (Meters)</label>
                 <input 
                   type="number" 
                   value={inputStride}
                   step="0.01" 
                   onChange={(e) => handleStrideChange(e.target.value)}
                   className="w-full bg-transparent text-2xl font-black italic text-teal-400 outline-none placeholder-slate-700" 
                 />
              </div>
           </div>

           {/* Row 2: Pace */}
           <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5 flex items-center justify-between">
              <label className="text-[9px] text-slate-400 font-bold uppercase">Pace / Mi</label>
              <div className="flex items-baseline gap-1">
                 <input 
                   type="number" 
                   value={inputPaceMin}
                   onChange={(e) => handlePaceChange(e.target.value, inputPaceSec)}
                   className="w-12 bg-transparent text-2xl font-black italic text-white text-right outline-none" 
                 />
                 <span className="text-slate-500 font-bold">:</span>
                 <input 
                   type="number" 
                   value={inputPaceSec}
                   onChange={(e) => handlePaceChange(inputPaceMin, e.target.value)}
                   className="w-12 bg-transparent text-2xl font-black italic text-white outline-none" 
                 />
              </div>
           </div>

           {/* Row 3: Cadence */}
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5">
                 <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Cadence (BPM)</label>
                 <input 
                   type="number" 
                   value={inputCadence}
                   onChange={(e) => handleCadenceChange(e.target.value)}
                   className="w-full bg-transparent text-2xl font-black italic text-indigo-400 outline-none" 
                 />
              </div>
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5 flex flex-col justify-center">
                 <label className="text-[9px] text-slate-400 font-bold uppercase block">Steps / Sec</label>
                 <div className="text-xl font-black italic text-slate-300">{stepsPerSec.toFixed(2)}</div>
              </div>
           </div>

           {/* Race Table */}
           <div className="mt-4">
              <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 border-b border-slate-700 pb-1">Predictions at Target</h4>
              <div className="space-y-4">
                 <div>
                    <span className="text-[9px] text-indigo-400 font-bold uppercase mb-1 block">Endurance</span>
                    {renderRaceTable(RACE_DISTANCES.ENDURANCE)}
                 </div>
                 <div>
                    <span className="text-[9px] text-teal-400 font-bold uppercase mb-1 block">Sprints</span>
                    {renderRaceTable(RACE_DISTANCES.SPRINT)}
                 </div>
              </div>
           </div>
        </div>
      ) : (
        <div className="animate-fade-in">
           {/* Mic Logic */}
           {!isAnalyzing && !isRecording ? (
            <button
              onClick={startAnalysis}
              className="w-full py-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl font-black italic uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 mb-4"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
              Tap to Find Rhythm
            </button>
          ) : (
            <div className="w-full py-6 bg-slate-700 rounded-2xl flex items-center justify-center gap-3 mb-4">
              {isRecording && <span className="text-white font-bold text-sm uppercase animate-pulse">Listening...</span>}
              {isAnalyzing && <span className="text-purple-300 font-bold text-sm uppercase animate-pulse">Analyzing...</span>}
            </div>
          )}
          {errorMessage && <div className="text-red-400 text-xs font-bold text-center mb-4">{errorMessage}</div>}
          {result && (
            <div className="bg-slate-700/30 p-4 rounded-xl border border-white/5">
              <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">Detected</span>
                  <span className="text-xl font-black text-white">{result.bpm} <span className="text-xs text-slate-500">BPM</span></span>
              </div>
              <p className="text-sm text-slate-200 italic">"{result.advice}"</p>
              <button onClick={() => { setInputCadence(result.bpm.toString()); handleCadenceChange(result.bpm.toString()); setActiveTab('calculator'); }} className="w-full mt-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold uppercase">Use this BPM</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
