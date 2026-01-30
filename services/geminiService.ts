
import { BpmAnalysisResult, RunState, FuelData } from '../types';
import { GoogleGenAI } from "@google/genai";

// This URL comes from your AWS Amplify Environment Variable
const rawUrl = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000';
const API_URL = rawUrl.replace(/\/$/, '');

const ai = new GoogleGenAI({ apiKey: (process.env.API_KEY as string) });

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

export const consultAiCoach = async (query: string, runStats: any): Promise<string> => {
  try {
    const model = 'gemini-3-flash-preview';
    const prompt = `
      You are an expert running coach. 
      The user just finished a run with these stats:
      - Total Distance: ${runStats.distance} ${runStats.unit}
      - Total Duration: ${runStats.duration}
      - Average Speed: ${runStats.avgSpeed} ${runStats.unit === 'imperial' ? 'mph' : 'kph'}
      - Max Speed: ${runStats.maxSpeed}
      - Min Speed: ${runStats.minSpeed}
      - Calories Burned: ${runStats.calories}
      - Training Mode: ${runStats.mode}

      The user has a question or comment: "${query}"

      Provide supportive, constructive, and knowledgeable advice. 
      ALWAYS include a medical disclaimer: "Disclaimer: This digital entity provides general fitness opinions only. This is NOT medical advice. If you experience persistent or severe pain, consult a licensed healthcare professional."
      Keep the response concise and motivating.
    `;

    const response = await ai.models.generateContent({
      model,
      contents: prompt
    });

    return response.text || "I'm sorry, I couldn't generate a response at this time.";
  } catch (error) {
    console.error("AI Consultation failed:", error);
    return "I encountered an error while consulting your digital coach. Please try again.";
  }
};

export const saveRunToDatabase = async (runState: RunState) => {
  try {
    const payload = {
      start_time: new Date(runState.startTime || Date.now()).toISOString(),
      duration_seconds: runState.elapsedTime,
      distance_meters: runState.totalDistance,
      calories_burned: runState.caloriesBurned,
      avg_heart_rate: runState.currentHeartRate,
      route: JSON.stringify(runState.route),
      splits: runState.splits
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
