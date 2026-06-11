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
  getGoals,
  createGoal,
  deleteGoal,
  recalculateGoalPeriods,
  getFeed,
  sendFriendRequest,
  updateFriendshipStatus,
  getFriends,
  getPendingRequests,
  getDiscoverableUsers,
  getFeatureSharingSettings,
  setFeatureSharing,
  removeFeatureSharing,
  saveRoute,
  getRoutes,
  getRouteById,
  starRoute,
  unstarRoute,
  createSegment,
  getSegmentsNearBBox,
  getSegmentById,
  getSegmentLeaderboard,
  getUserSegmentEfforts,
  recordSegmentEffort,
  detectSegmentsInRun,
  giveKudos,
  removeKudos,
  getChallenges,
  getChallengeLeaderboard,
  joinChallenge,
  leaveChallenge,
  submitManualProgress,
  updateChallengeProgressFromRun,
  createChallenge,
  getWeeklyWidgetSummary,
  getTodayVitals,
  getLatestWidgetValuesForDate,
  getWidgetHistory,
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

      // Recalculate goal progress for the sport type of this run
      const sportType = run.mode === 'cycling' ? 'ride'
                      : run.mode === 'walking'  ? 'walk'
                      : run.mode === 'hiking'   ? 'hike'
                      : 'run';
      await recalculateGoalPeriods(
        userId,
        sportType,
        run.start_time,
        run.distance_meters   // distance goals use meters; we store target in meters too
      ).catch(e => console.error('recalculateGoalPeriods error:', e));

      // Update challenge progress in background
      updateChallengeProgressFromRun(userId, {
        ...run,
        id: result.id,
        sport_type: sportType,
      }).catch(e => console.error('updateChallengeProgressFromRun error:', e));

      // Detect segments in background — never blocks the run save response
      if (run.route && Array.isArray(run.route)) {
        detectSegmentsInRun(run.route, sportType)
          .then(async matched => {
            for (const effort of matched) {
              await recordSegmentEffort(
                effort.segment_id, result.id, userId, effort
              ).catch(e => console.error('recordSegmentEffort error:', e));
            }
          })
          .catch(e => console.error('detectSegmentsInRun error:', e));
      }

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
    // GOALS
    // GET  /goals           → fetch all active goals with current period
    // POST /goals           → create a new goal
    // DELETE /goals/:id     → deactivate a goal
    // ----------------------------------------------------------

    if (path === '/goals' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const goals = await getGoals(userId);
      return ok(goals);
    }

    if (path === '/goals' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const body = parseBody(event);
      if (!body) return err('Invalid JSON body');

      const required = ['type', 'frequency', 'target_value', 'sport_type', 'start_date', 'end_date'];
      const missing = required.filter(f => body[f] === undefined || body[f] === null);
      if (missing.length > 0) return err(`Missing required fields: ${missing.join(', ')}`);

      const goal = await createGoal(userId, body);
      return ok(goal, 201);
    }

    const goalIdMatch = path.match(/^\/goals\/([a-f0-9-]{36})$/);
    if (goalIdMatch && method === 'DELETE') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      await deleteGoal(goalIdMatch[1], userId);
      return ok({ success: true });
    }

    // ----------------------------------------------------------
    // FEED
    // GET  /feed            → activity feed for current user
    // ----------------------------------------------------------

    if (path === '/feed' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);

      const limit  = parseInt(query.limit  || '50', 10);
      const offset = parseInt(query.offset || '0',  10);
      const feed   = await getFeed(userId, limit, offset);
      return ok(feed);
    }

    // ----------------------------------------------------------
    // FRIENDSHIPS
    // GET    /friends              → accepted friends list
    // GET    /friends/pending      → pending requests
    // GET    /friends/discover     → discoverable public users
    // POST   /friends              → send friend request
    // PUT    /friends/:id          → accept / decline / assign tier
    // ----------------------------------------------------------

    if (path === '/friends' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getFriends(userId));
    }

    if (path === '/friends/pending' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getPendingRequests(userId));
    }

    if (path === '/friends/discover' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getDiscoverableUsers(userId));
    }

    if (path === '/friends' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.receiver_id) return err('Missing receiver_id');
      const result = await sendFriendRequest(userId, body.receiver_id);
      if (!result) return err('Friend request already exists', 409);
      return ok(result, 201);
    }

    const friendIdMatch = path.match(/^\/friends\/(\d+)$/);
    if (friendIdMatch && method === 'PUT') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.status) return err('Missing status');
      const result = await updateFriendshipStatus(
        parseInt(friendIdMatch[1], 10), userId, body.status, body.tier_id ?? null
      );
      if (!result) return err('Friendship not found or not authorized', 404);
      return ok(result);
    }

    // ----------------------------------------------------------
    // FEATURE SHARING
    // GET    /sharing          → current sharing settings
    // POST   /sharing          → add a sharing rule
    // DELETE /sharing/:id      → remove a sharing rule
    // ----------------------------------------------------------

    if (path === '/sharing' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getFeatureSharingSettings(userId));
    }

    if (path === '/sharing' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.feature_name || !body?.tier_id) return err('Missing feature_name or tier_id');
      const result = await setFeatureSharing(userId, body.feature_name, body.tier_id, body.group_id ?? null);
      return ok(result, 201);
    }

    const sharingIdMatch = path.match(/^\/sharing\/(\d+)$/);
    if (sharingIdMatch && method === 'DELETE') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      await removeFeatureSharing(parseInt(sharingIdMatch[1], 10), userId);
      return ok({ success: true });
    }

    // ----------------------------------------------------------
    // ROUTES
    // GET  /routes           → user's saved routes
    // POST /routes           → save a new route
    // GET  /routes/:id       → single route with full path
    // POST /routes/:id/star  → star a route
    // DELETE /routes/:id/star → unstar a route
    // ----------------------------------------------------------

    if (path === '/routes' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getRoutes(userId));
    }

    if (path === '/routes' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.distance_meters) return err('Missing distance_meters');
      const route = await saveRoute(userId, body);
      return ok(route, 201);
    }

    const routeIdMatch = path.match(/^\/routes\/(\d+)$/);
    if (routeIdMatch && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const route = await getRouteById(parseInt(routeIdMatch[1], 10), userId);
      if (!route) return err('Route not found', 404);
      return ok(route);
    }

    const routeStarMatch = path.match(/^\/routes\/(\d+)\/star$/);
    if (routeStarMatch && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      await starRoute(parseInt(routeStarMatch[1], 10), userId);
      return ok({ success: true });
    }
    if (routeStarMatch && method === 'DELETE') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      await unstarRoute(parseInt(routeStarMatch[1], 10), userId);
      return ok({ success: true });
    }

    // ----------------------------------------------------------
    // SEGMENTS
    // GET  /segments?minLat&maxLat&minLng&maxLng&sport → map view
    // POST /segments                → create user-defined segment
    // GET  /segments/:id            → segment detail
    // GET  /segments/:id/leaderboard
    // GET  /segments/:id/efforts    → current user's efforts
    // ----------------------------------------------------------

    if (path === '/segments' && method === 'GET') {
      const { minLat, maxLat, minLng, maxLng, sport } = query;
      if (!minLat || !maxLat || !minLng || !maxLng) return err('Missing bbox params');
      const segs = await getSegmentsNearBBox(
        parseFloat(minLat), parseFloat(maxLat),
        parseFloat(minLng), parseFloat(maxLng),
        sport || null
      );
      return ok(segs);
    }

    if (path === '/segments' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.name || !body?.start_lat || !body?.start_lng || !body?.end_lat || !body?.end_lng) {
        return err('Missing required segment fields');
      }
      const seg = await createSegment(userId, body);
      return ok(seg, 201);
    }

    const segIdMatch = path.match(/^\/segments\/(\d+)$/);
    if (segIdMatch && method === 'GET') {
      const seg = await getSegmentById(parseInt(segIdMatch[1], 10));
      if (!seg) return err('Segment not found', 404);
      return ok(seg);
    }

    const segLeaderMatch = path.match(/^\/segments\/(\d+)\/leaderboard$/);
    if (segLeaderMatch && method === 'GET') {
      const lb = await getSegmentLeaderboard(parseInt(segLeaderMatch[1], 10));
      return ok(lb);
    }

    const segEffortsMatch = path.match(/^\/segments\/(\d+)\/efforts$/);
    if (segEffortsMatch && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const efforts = await getUserSegmentEfforts(parseInt(segEffortsMatch[1], 10), userId);
      return ok(efforts);
    }

    // ----------------------------------------------------------
    // CHALLENGES
    // GET    /challenges                    → list visible challenges
    // POST   /challenges                    → create user challenge
    // GET    /challenges/:id/leaderboard    → leaderboard
    // POST   /challenges/:id/join           → join
    // DELETE /challenges/:id/join           → leave
    // POST   /challenges/:id/progress       → manual progress update
    // ----------------------------------------------------------

    if (path === '/challenges' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      return ok(await getChallenges(userId));
    }

    if (path === '/challenges' && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.title || !body?.challenge_type || !body?.target_value ||
          !body?.start_date || !body?.end_date) {
        return err('Missing required fields');
      }
      const challenge = await createChallenge(userId, body);
      return ok(challenge, 201);
    }

    const challengeIdMatch = path.match(/^\/challenges\/(\d+)\/leaderboard$/);
    if (challengeIdMatch && method === 'GET') {
      const lb = await getChallengeLeaderboard(parseInt(challengeIdMatch[1], 10));
      return ok(lb);
    }

    const challengeJoinMatch = path.match(/^\/challenges\/(\d+)\/join$/);
    if (challengeJoinMatch && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      await joinChallenge(parseInt(challengeJoinMatch[1], 10), userId);
      return ok({ success: true });
    }
    if (challengeJoinMatch && method === 'DELETE') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      await leaveChallenge(parseInt(challengeJoinMatch[1], 10), userId);
      return ok({ success: true });
    }

    const challengeProgressMatch = path.match(/^\/challenges\/(\d+)\/progress$/);
    if (challengeProgressMatch && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const body = parseBody(event);
      if (!body?.value || !body?.note) return err('Missing value or note');
      const result = await submitManualProgress(
        parseInt(challengeProgressMatch[1], 10),
        userId,
        body.value,
        body.note,
        body.proof_image_url || null
      );
      return ok(result);
    }

    // ----------------------------------------------------------
    // KUDOS
    // POST   /kudos/:runId   → give kudos
    // DELETE /kudos/:runId   → remove kudos
    // ----------------------------------------------------------

    const kudosMatch = path.match(/^\/kudos\/(\d+)$/);
    if (kudosMatch && method === 'POST') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const result = await giveKudos(parseInt(kudosMatch[1], 10), userId);
      return ok(result);
    }
    if (kudosMatch && method === 'DELETE') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const result = await removeKudos(parseInt(kudosMatch[1], 10), userId);
      return ok(result);
    }

    // ----------------------------------------------------------
    // WIDGET DATA (Fitbit / Google Fit read-only)
    // GET /widgets/weekly-summary  → this week's steps, distance, calories, HR
    // GET /widgets/today-vitals    → today's HR, SpO2, sleep score, weight
    // GET /widgets/history?key=steps&start=YYYY-MM-DD&end=YYYY-MM-DD
    // ----------------------------------------------------------

    if (path === '/widgets/weekly-summary' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const summary = await getWeeklyWidgetSummary(userId);
      return ok(summary);
    }

    if (path === '/widgets/today-vitals' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const vitals = await getTodayVitals(userId);
      return ok(vitals);
    }

    if (path === '/widgets/history' && method === 'GET') {
      const userId = getUserId(event);
      if (!userId) return err('Unauthorized', 401);
      const { key, start, end } = query;
      if (!key || !start || !end) return err('Missing key, start, or end params');
      const history = await getWidgetHistory(userId, key, start, end);
      return ok(history);
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