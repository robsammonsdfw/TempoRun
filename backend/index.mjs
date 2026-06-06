import { GoogleGenAI, Type, Modality } from '@google/genai';
import {
  getUserProfile,
  updateUserProfile,
  getIntegrationStatus,
  saveRun,
  getRunHistory,
  getRunById,
  saveCoachInteraction,
  getCoachInteractions,
} from './databaseService.mjs';

// --- Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ok = (body, status = 200) => ({
  statusCode: status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const err = (message, status = 400) => ({
  statusCode: status,
  body: JSON.stringify({ error: message }),
});

// ============================================================
// AUTH HELPERS
// ============================================================

const getUserId = (event) => {
  const raw =
    event.requestContext?.authorizer?.jwt?.claims?.sub ||
    event.headers?.['x-user-id'] ||
    event.headers?.['X-User-Id'];
  const id = parseInt(raw, 10);
  return id && !isNaN(id) ? id : null;
};

const parseBody = (event) => {
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return null;
  }
};

// ============================================================
// LAMBDA HANDLER
// ============================================================

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path;
  const query = event.queryStringParameters || {};


  try {

    // ----------------------------------------------------------
    // USER PROFILE
    // GET  /user/profile        → fetch profile
    // PUT  /user/profile        → update profile fields
    // ----------------------------------------------------------

    if (path === '/user/profile' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const profile = await getUserProfile(userId);
      if (!profile) return err('User not found', 404);
      return ok(profile);
    }

    if (path === '/user/profile' && method === 'PUT') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const updated = await updateUserProfile(userId, body);
      if (!updated) return err('No valid fields to update or user not found');
      return ok(updated);
    }

    // ----------------------------------------------------------
    // INTEGRATIONS
    // GET  /integrations/status
    // ----------------------------------------------------------

    if (path === '/integrations/status' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const status = await getIntegrationStatus(userId);
      return ok(status);
    }

    // ----------------------------------------------------------
    // RUNS
    // GET  /runs                → history (last 50)
    // POST /runs                → save new run
    // GET  /runs/:id            → single run detail
    // ----------------------------------------------------------

    if (path === '/runs' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const history = await getRunHistory(userId);
      return ok(history);
    }

    if (path === '/runs' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const run = parseBody(event);
      if (!run) return err('Invalid JSON body');

      const result = await saveRun(userId, run);
      return ok({ success: true, id: result.id }, 201);
    }

    const runIdMatch = path.match(/^\/runs\/(\d+)$/);
    if (runIdMatch && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const run = await getRunById(parseInt(runIdMatch[1], 10), userId);
      if (!run) return err('Run not found or access denied', 404);
      return ok(run);
    }

    // ----------------------------------------------------------
    // COACH INTERACTIONS
    // GET  /coach-interactions?runId=X
    // ----------------------------------------------------------

    if (path === '/coach-interactions' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      if (!query.runId) return err('Missing runId');

      const interactions = await getCoachInteractions(parseInt(query.runId, 10), userId);
      return ok(interactions);
    }

    // ----------------------------------------------------------
    // AI — FOOD ANALYSIS
    // POST /analyze-food
    // ----------------------------------------------------------

    if (path === '/analyze-food' && method === 'POST') {
      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const { type, data, mimeType, context } = body;
      const contextString = context
        ? `The user is about to perform a ${context.distance} ${context.unit} run in "${context.mode}" mode.`
        : '';

      const instruction = `
        Analyze this food.
        1. Estimate the TOTAL calories.
        2. Return JSON with: calories (number), description (string), macros (object: protein, carbs, fats).
        3. opinion: max 3 sentences on suitability for the run below. Mention carb vs fat/protein energy source.
        Context: ${contextString}
      `;

      const parts = type === 'image'
        ? [{ inlineData: { mimeType, data } }, { text: instruction }]
        : [{ text: `${instruction}\n\nFood: "${data}"` }];

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
              opinion: { type: Type.STRING },
              macros: {
                type: Type.OBJECT,
                properties: {
                  protein: { type: Type.NUMBER },
                  carbs: { type: Type.NUMBER },
                  fats: { type: Type.NUMBER },
                },
              },
            },
            required: ['calories', 'description', 'opinion'],
          },
        },
      });

      return ok(response.text);
    }

    // ----------------------------------------------------------
    // AI — RHYTHM ANALYSIS
    // POST /analyze-rhythm
    // ----------------------------------------------------------

    if (path === '/analyze-rhythm' && method === 'POST') {
      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const { audioData, mimeType, currentPace } = body;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: mimeType || 'audio/webm', data: audioData } },
            { text: `Detect BPM, identify genre, give 1-sentence advice for a runner at pace ${currentPace}. Return JSON.` },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bpm: { type: Type.NUMBER },
              genre: { type: Type.STRING },
              advice: { type: Type.STRING },
            },
            required: ['bpm', 'genre', 'advice'],
          },
        },
      });

      return ok(response.text);
    }

    // ----------------------------------------------------------
    // AI — TEXT-TO-SPEECH
    // POST /generate-speech
    // ----------------------------------------------------------

    if (path === '/generate-speech' && method === 'POST') {
      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [{ text: `Say clearly and encouragingly: ${body.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return ok({ audioData });
    }

    // ----------------------------------------------------------
    // AI — COACH CONSULTATION
    // POST /consult-ai-coach
    // ----------------------------------------------------------

    if (path === '/consult-ai-coach' && method === 'POST') {
      const userId = getUserId(event);
      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const { query, runStats, runId } = body;

      const prompt = `
        You are an expert running coach.
        Run stats: Distance ${runStats.distance} ${runStats.unit}, Duration ${runStats.duration},
        Avg speed ${runStats.avgSpeed}, Calories ${runStats.calories}, Mode ${runStats.mode}.
        User question: "${query}"
        Be supportive and concise. Always end with:
        "Disclaimer: This is general fitness guidance only, not medical advice. Consult a healthcare professional for persistent pain or health concerns."
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const text = response.text || 'Unable to generate a response at this time.';

      if (runId && userId) {
        await saveCoachInteraction(runId, userId, query, text);
      }

      return ok({ text });
    }

    // ----------------------------------------------------------
    // 404
    // ----------------------------------------------------------
    return err('Not found', 404);

  } catch (error) {
    console.error('Handler error:', error);
    return err(error.message || 'Internal server error', 500);
  }
};