
import React, { useState, useRef } from 'react';
import { analyzeMusicRhythm } from '../services/geminiService';
import { BpmAnalysisResult } from '../types';

interface MusicPacerProps {
  currentPace: string;
}

export const MusicPacer: React.FC<MusicPacerProps> = ({ currentPace }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<BpmAnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

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
        setErrorMessage("Microphone access denied. Please allow microphone permissions in your browser settings (usually near the URL bar).");
      } else {
        setErrorMessage("Could not access microphone. " + err.message);
      }
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
          Rhythm Sync
        </h3>
        <span className="text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded">Powered by Gemini</span>
      </div>
      
      <p className="text-sm text-slate-300 mb-4">
        Play music on Amazon Music (or any app) and we'll listen via microphone to match your pace.
      </p>

      {!result && !isAnalyzing && !isRecording && (
        <>
          <button
            onClick={startAnalysis}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            Listen & Sync Pace
          </button>
          {errorMessage && (
            <div className="mt-3 p-3 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200 text-xs">
              <strong>Error:</strong> {errorMessage}
            </div>
          )}
        </>
      )}

      {isRecording && (
        <div className="flex flex-col items-center justify-center py-2 animate-pulse">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-2">
             <div className="w-4 h-4 rounded-full bg-red-500"></div>
          </div>
          <span className="text-red-400 font-mono text-sm">Listening to beat...</span>
        </div>
      )}

      {isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-2">
           <svg className="animate-spin h-8 w-8 text-purple-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
           <span className="text-purple-300 text-sm">Analyzing Rhythm...</span>
        </div>
      )}

      {result && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex justify-between items-end border-b border-slate-700 pb-2">
            <div>
              <p className="text-xs text-slate-400">Detected BPM</p>
              <p className="text-3xl font-bold text-white">{result.bpm}</p>
            </div>
            <div className="text-right">
               <p className="text-xs text-slate-400">Genre</p>
               <p className="text-sm font-medium text-pink-300">{result.genre}</p>
            </div>
          </div>
          <div className="bg-slate-700/50 p-3 rounded-lg border border-slate-600">
             <p className="text-sm italic text-slate-200">"{result.advice}"</p>
          </div>
          <button 
            onClick={startAnalysis}
            className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-sm rounded text-slate-200 transition-colors"
          >
            Check Again
          </button>
        </div>
      )}
    </div>
  );
};