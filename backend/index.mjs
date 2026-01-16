
import { GoogleGenAI, Type, Modality } from "@google/genai";
import pg from 'pg';

const { Pool } = pg;

// --- Database Configuration ---
// Ensure we handle cases where environment variables might be missing gracefully during init
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// --- Gemini Configuration ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Main Lambda Handler
 */
export const handler = async (event) => {
  // CORS Headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
  };

  try {
    // Determine HTTP Method (Handle v1 and v2 payloads)
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path;

    // Handle Preflight OPTIONS request
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // --- Route: Analyze Rhythm ---
    if (path === '/analyze-rhythm' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { audioData, mimeType, currentPace } = body;

      const prompt = `
        Listen to this audio clip. 
        1. Determine the tempo in Beats Per Minute (BPM).
        2. Identify the genre.
        3. The runner's current pace is ${currentPace}. Give 1 sentence advice.
        Return JSON.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: mimeType || 'audio/webm', data: audioData } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bpm: { type: Type.NUMBER },
              genre: { type: Type.STRING },
              advice: { type: Type.STRING }
            },
            required: ["bpm", "genre", "advice"]
          }
        }
      });

      return {
        statusCode: 200,
        headers,
        body: response.text
      };
    }

    // --- Route: Generate Speech (TTS) ---
    if (path === '/generate-speech' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { text } = body;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly and encouragingly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ audioData: base64Audio })
      };
    }

    // --- Route: Save Run ---
    if (path === '/runs' && method === 'POST') {
      let run;
      try {
        run = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const runInsert = `
          INSERT INTO runs (start_time, duration_seconds, distance_meters, calories_burned, avg_heart_rate, route_json)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `;
        const runRes = await client.query(runInsert, [
          run.start_time, run.duration_seconds, run.distance_meters, 
          run.calories_burned, run.avg_heart_rate, run.route
        ]);
        const runId = runRes.rows[0].id;

        if (run.splits && run.splits.length > 0) {
          const splitInsert = `
            INSERT INTO splits (run_id, distance_label, time_seconds, pace_label)
            VALUES ($1, $2, $3, $4)
          `;
          for (const split of run.splits) {
            await client.query(splitInsert, [runId, split.distanceLabel, split.timeSeconds, split.pace]);
          }
        }

        await client.query('COMMIT');
        return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: runId }) };
      } catch (e) {
        await client.query('ROLLBACK');
        console.error("DB Error", e);
        throw e;
      } finally {
        client.release();
      }
    }

    return { statusCode: 404, headers, body: JSON.stringify({ message: "Not Found" }) };

  } catch (error) {
    console.error("Lambda Handler Error:", error);
    // Important: Return CORS headers even on error
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};