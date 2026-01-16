
import { BpmAnalysisResult, RunState, FuelData } from '../types';

// This URL comes from your AWS Amplify Environment Variable
// Cast import.meta to any to fix Property 'env' does not exist on type 'ImportMeta' error
const rawUrl = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000';
// Ensure no trailing slash
const API_URL = rawUrl.replace(/\/$/, '');

/**
 * Converts a Blob to a Base64 string.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data url prefix (e.g. "data:audio/webm;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Calls the Backend Lambda to analyze audio
 */
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

    if (!response.ok) {
      throw new Error(`Server Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Backend analysis failed:", error);
    throw error;
  }
};

/**
 * Calls the Backend Lambda to analyze food (Text or Image)
 */
export const analyzeFood = async (input: File | string): Promise<FuelData> => {
  try {
    let payload: any = {};
    
    if (typeof input === 'string') {
      payload = { type: 'text', data: input };
    } else {
      const base64Image = await blobToBase64(input);
      payload = { type: 'image', data: base64Image, mimeType: input.type };
    }

    const response = await fetch(`${API_URL}/analyze-food`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server Error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Food analysis failed:", error);
    throw error;
  }
};

/**
 * Calls the Backend Lambda to generate speech
 */
export const generateSpeech = async (text: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/generate-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      throw new Error(`Server Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.audioData; // returns base64 audio string
  } catch (error) {
    console.error("Backend TTS failed:", error);
    return "";
  }
};

/**
 * Saves the run to PostgreSQL via Lambda
 */
export const saveRunToDatabase = async (runState: RunState) => {
  try {
    const payload = {
      start_time: new Date(runState.startTime || Date.now()).toISOString(),
      duration_seconds: runState.elapsedTime,
      distance_meters: runState.totalDistance,
      calories_burned: runState.caloriesBurned,
      avg_heart_rate: runState.currentHeartRate, // Simplified: usually you'd calculate average of history
      route: JSON.stringify(runState.route),
      splits: runState.splits
    };

    const response = await fetch(`${API_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error("Failed to save run");
    }
    return await response.json();
  } catch (error) {
    console.error("Error saving run:", error);
  }
};
