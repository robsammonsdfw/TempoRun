
import { BpmAnalysisResult, RunState, FuelData } from '../types';

// This URL comes from your AWS Amplify Environment Variable
const rawUrl = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000';
const API_URL = rawUrl.replace(/\/$/, '');

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- Fetching Data ---

export const fetchRunHistory = async () => {
  try {
    const response = await fetch(`${API_URL}/runs`);
    if (!response.ok) throw new Error("Failed to fetch history");
    return await response.json();
  } catch (error) {
    console.error("Fetch history error:", error);
    return [];
  }
};

export const fetchRunDetails = async (runId: number) => {
  try {
    const response = await fetch(`${API_URL}/runs/${runId}`);
    if (!response.ok) throw new Error("Failed to fetch run details");
    return await response.json();
  } catch (error) {
    console.error("Fetch details error:", error);
    throw error;
  }
};

export const fetchCoachInteractions = async (runId: number) => {
  try {
    const response = await fetch(`${API_URL}/coach-interactions?runId=${runId}`);
    if (!response.ok) throw new Error("Failed to fetch interactions");
    return await response.json();
  } catch (error) {
    console.error("Fetch interactions error:", error);
    return [];
  }
};

// --- Analysis & AI ---

export const analyzeMusicRhythm = async (audioBlob: Blob, currentPace: string): Promise<BpmAnalysisResult> => {
  try {
    const base64Audio = await blobToBase64(audioBlob);
    const response = await fetch(`${API_URL}/analyze-rhythm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: base64Audio,
        mimeType: audioBlob.type,
        currentPace
      })
    });
    if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error("Backend analysis failed:", error);
    throw error;
  }
};

export const analyzeFood = async (input: File | string, context?: { distance: number, unit: string, mode: string }): Promise<FuelData> => {
  try {
    let payload: any = {};
    if (typeof input === 'string') {
      payload = { type: 'text', data: input };
    } else {
      const base64Image = await blobToBase64(input);
      payload = { type: 'image', data: base64Image, mimeType: input.type };
    }
    
    // Pass run context if available
    if (context) {
      payload.context = context;
    }

    const response = await fetch(`${API_URL}/analyze-food`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error("Food analysis failed:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/generate-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
    const data = await response.json();
    return data.audioData;
  } catch (error) {
    console.error("Backend TTS failed:", error);
    return "";
  }
};

export const consultAiCoach = async (query: string, runStats: any, runId?: number): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/consult-ai-coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, runStats, runId })
    });
    if (!response.ok) throw new Error(`Server Error: ${response.statusText}`);
    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error("AI Consultation failed:", error);
    return "I encountered an error while consulting your digital coach. Please try again.";
  }
};

export const saveRunToDatabase = async (runState: RunState, mode: string) => {
  try {
    const payload = {
      start_time: new Date(runState.startTime || Date.now()).toISOString(),
      mode: mode,
      duration_seconds: runState.elapsedTime,
      distance_meters: runState.totalDistance,
      calories_burned: runState.caloriesBurned,
      avg_heart_rate: runState.currentHeartRate,
      route: JSON.stringify(runState.route),
      splits: runState.splits,
      intervals: runState.intervals
    };
    const response = await fetch(`${API_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (error) {
    console.error("Error saving run:", error);
  }
};
