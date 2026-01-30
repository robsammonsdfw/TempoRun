
import { GoogleGenAI, Type, Modality } from "@google/genai";
import pg from 'pg';

const { Pool } = pg;

// --- Database Configuration ---
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
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path;
    const queryParams = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // --- GET: Fetch Run History ---
    if (path === '/runs' && method === 'GET') {
       const client = await pool.connect();
       try {
         // Limit to last 50 runs for performance
         const result = await client.query(`
           SELECT id, start_time, mode, distance_meters, duration_seconds, calories_burned 
           FROM runs 
           ORDER BY start_time DESC 
           LIMIT 50
         `);
         return {
           statusCode: 200,
           headers,
           body: JSON.stringify(result.rows)
         };
       } finally {
         client.release();
       }
    }

    // --- GET: Fetch Specific Run Details ---
    // Matches /runs/123
    const runIdMatch = path.match(/^\/runs\/(\d+)$/);
    if (runIdMatch && method === 'GET') {
       const runId = runIdMatch[1];
       const client = await pool.connect();
       try {
         // Get Run Data
         const runRes = await client.query('SELECT * FROM runs WHERE id = $1', [runId]);
         if (runRes.rows.length === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "Run not found" }) };
         }
         const run = runRes.rows[0];

         // Get Splits
         const splitsRes = await client.query('SELECT * FROM splits WHERE run_id = $1 ORDER BY id ASC', [runId]);
         
         // Get Intervals
         const intervalsRes = await client.query('SELECT * FROM intervals WHERE run_id = $1 ORDER BY id ASC', [runId]);

         return {
           statusCode: 200,
           headers,
           body: JSON.stringify({
             ...run,
             splits: splitsRes.rows,
             intervals: intervalsRes.rows
           })
         };
       } finally {
         client.release();
       }
    }

    // --- GET: Fetch Coach Interactions ---
    if (path === '/coach-interactions' && method === 'GET') {
       const runId = queryParams.runId;
       if (!runId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing runId" }) };

       const client = await pool.connect();
       try {
         const result = await client.query(`
           SELECT user_query, ai_response, created_at 
           FROM coach_interactions 
           WHERE run_id = $1 
           ORDER BY created_at DESC
         `, [runId]);
         
         return {
           statusCode: 200,
           headers,
           body: JSON.stringify(result.rows)
         };
       } finally {
         client.release();
       }
    }

    // --- POST: Analyze Food ---
    if (path === '/analyze-food' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { type, data, mimeType } = body;
      let prompt = "";
      let parts = [];

      if (type === 'image') {
        prompt = "Analyze this image of food. Identify the food item and estimate the TOTAL calories. Return a JSON object with 'calories' (number), 'description' (string, e.g. 'Slice of Pizza'), and 'macros' (object with protein, carbs, fats).";
        parts = [
           { inlineData: { mimeType: mimeType, data: data } },
           { text: prompt }
        ];
      } else {
        prompt = `Analyze this food description: "${data}". Estimate the TOTAL calories. Return a JSON object with 'calories' (number), 'description' (short name), and 'macros' (object with protein, carbs, fats).`;
        parts = [{ text: prompt }];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER },
              description: { type: Type.STRING },
              macros: {
                type: Type.OBJECT,
                properties: {
                  protein: { type: Type.NUMBER },
                  carbs: { type: Type.NUMBER },
                  fats: { type: Type.NUMBER }
                }
              }
            },
            required: ["calories", "description"]
          }
        }
      });

      return {
        statusCode: 200,
        headers,
        body: response.text
      };
    }

    // --- POST: Analyze Rhythm ---
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

    // --- POST: Generate Speech (TTS) ---
    if (path === '/generate-speech' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { text } = body;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
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

    // --- POST: Consult AI Coach ---
    if (path === '/consult-ai-coach' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      const { query, runStats, runId } = body;

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
        model: 'gemini-3-flash-preview',
        contents: prompt
      });

      const responseText = response.text || "I'm sorry, I couldn't generate a response at this time.";

      if (runId) {
        const client = await pool.connect();
        try {
          const insertQuery = `
            INSERT INTO coach_interactions (run_id, user_query, ai_response)
            VALUES ($1, $2, $3)
          `;
          await client.query(insertQuery, [runId, query, responseText]);
        } catch (dbErr) {
          console.error("Failed to save coach interaction:", dbErr);
        } finally {
          client.release();
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ text: responseText })
      };
    }

    // --- POST: Save Run ---
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
          INSERT INTO runs (start_time, mode, duration_seconds, distance_meters, calories_burned, avg_heart_rate, route_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `;
        const runRes = await client.query(runInsert, [
          run.start_time, run.mode, run.duration_seconds, run.distance_meters, 
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

        if (run.intervals && run.intervals.length > 0) {
          const intervalInsert = `
            INSERT INTO intervals (run_id, interval_type, duration, distance, avg_pace, avg_speed)
            VALUES ($1, $2, $3, $4, $5, $6)
          `;
          for (const int of run.intervals) {
            await client.query(intervalInsert, [
              runId, int.type, int.duration, int.distance, int.avgPace, int.avgSpeed
            ]);
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
