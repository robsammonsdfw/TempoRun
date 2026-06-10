import pg from 'pg';
import crypto from 'crypto';
import { promisify } from 'util';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);

// --- CONNECTION POOL ---
export const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// PRIVATE HELPERS
// ============================================================

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return salt + ':' + derivedKey.toString('hex');
};

const comparePassword = async (password, storedHash) => {
  if (!storedHash) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
};

// ============================================================
// USER — AUTH & ACCOUNT
// ============================================================

export const findOrCreateUserByEmail = async (email) => {
  const client = await pool.connect();
  try {
    const normalized = email.toLowerCase().trim();
    await client.query(
      `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [normalized]
    );
    const res = await client.query(
      `SELECT id, email, first_name, shopify_customer_id FROM users WHERE email = $1`,
      [normalized]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
};

export const registerLocalUser = async (email, password, firstName, shopifyId) => {
  const client = await pool.connect();
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const hashed = await hashPassword(password);
    const res = await client.query(
      `INSERT INTO users (email, first_name, shopify_customer_id, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email)
       DO UPDATE SET
         first_name = EXCLUDED.first_name,
         shopify_customer_id = EXCLUDED.shopify_customer_id,
         password_hash = EXCLUDED.password_hash
       RETURNING id, email, first_name, shopify_customer_id`,
      [normalizedEmail, firstName, shopifyId, hashed]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
};

export const verifyUserPassword = async (email, password) => {
  const client = await pool.connect();
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const res = await client.query(
      `SELECT id, email, first_name, last_name, shopify_customer_id, password_hash
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = res.rows[0];
    if (!user || !user.password_hash) return null;
    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) return null;
    delete user.password_hash;
    return user;
  } finally {
    client.release();
  }
};

export const getUserByEmail = async (email) => {
  const client = await pool.connect();
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const res = await client.query(
      `SELECT id, email, first_name FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
};

export const updateLocalPassword = async (userId, newPassword) => {
  const client = await pool.connect();
  try {
    const hashed = await hashPassword(newPassword);
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashed, userId]);
    return true;
  } finally {
    client.release();
  }
};

// ============================================================
// USER — PROFILE
// ============================================================

/**
 * Returns the full public-safe profile for a user.
 * Strips all tokens and password fields before returning.
 */
export const getUserProfile = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         id,
         email,
         first_name,
         last_name,
         bio,
         privacy_mode,
         role,
         dashboard_prefs,
         intake_data,
         show_bodybuilding_poses,
         profile_image_url,
         created_at,
         fitbit_user_id,
         fitbit_last_sync,
         google_fit_last_sync
       FROM users
       WHERE id = $1`,
      [userId]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
};

/**
 * Updates editable profile fields.
 * Only the fields passed in the `fields` object are updated.
 * Allowed fields: first_name, last_name, bio, privacy_mode, dashboard_prefs, show_bodybuilding_poses, profile_image_url
 */
export const updateUserProfile = async (userId, fields) => {
  const allowed = ['first_name', 'last_name', 'bio', 'privacy_mode', 'dashboard_prefs', 'show_bodybuilding_poses', 'profile_image_url'];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      updates.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  if (updates.length === 0) return null;
  values.push(userId);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, first_name, last_name, bio, privacy_mode, dashboard_prefs, show_bodybuilding_poses, profile_image_url`,
      values
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
};

// ============================================================
// USER — INTEGRATIONS (Fitbit / Google Fit)
// ============================================================

export const getIntegrationStatus = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         fitbit_user_id,
         fitbit_last_sync,
         fitbit_token_expires,
         google_fit_last_sync
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!res.rows[0]) return { fitbitConnected: false, googleFitConnected: false };
    const row = res.rows[0];
    return {
      fitbitConnected: row.fitbit_user_id !== null,
      fitbitLastSync: row.fitbit_last_sync,
      fitbitTokenExpires: row.fitbit_token_expires,
      googleFitConnected: row.google_fit_last_sync !== null,
      googleFitLastSync: row.google_fit_last_sync,
    };
  } finally {
    client.release();
  }
};

export const saveFitbitTokens = async (userId, { accessToken, refreshToken, expiresAt, fitbitUserId }) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET
         fitbit_access_token = $1,
         fitbit_refresh_token = $2,
         fitbit_token_expires = $3,
         fitbit_user_id = $4
       WHERE id = $5`,
      [accessToken, refreshToken, expiresAt, fitbitUserId, userId]
    );
    return true;
  } finally {
    client.release();
  }
};

export const getFitbitTokens = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT fitbit_access_token, fitbit_refresh_token, fitbit_token_expires, fitbit_user_id
       FROM users WHERE id = $1`,
      [userId]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
};

export const updateFitbitSync = async (userId, accessToken, refreshToken, expiresAt) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET
         fitbit_access_token = $1,
         fitbit_refresh_token = $2,
         fitbit_token_expires = $3,
         fitbit_last_sync = NOW()
       WHERE id = $4`,
      [accessToken, refreshToken, expiresAt, userId]
    );
  } finally {
    client.release();
  }
};

export const saveGoogleFitTokens = async (userId, { accessToken, refreshToken }) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET
         google_fit_access_token = $1,
         google_fit_refresh_token = $2,
         google_fit_last_sync = NOW()
       WHERE id = $3`,
      [accessToken, refreshToken, userId]
    );
    return true;
  } finally {
    client.release();
  }
};

// ============================================================
// RUNS
// ============================================================

export const saveRun = async (userId, run) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const runRes = await client.query(
      `INSERT INTO runs (user_id, start_time, mode, duration_seconds, distance_meters, calories_burned, avg_heart_rate, elevation_gain, route_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [userId, run.start_time, run.mode, run.duration_seconds, run.distance_meters,
       run.calories_burned, run.avg_heart_rate, run.elevation_gain ?? 0, run.route]
    );
    const runId = runRes.rows[0].id;

    if (run.splits?.length > 0) {
      for (const split of run.splits) {
        await client.query(
          `INSERT INTO splits (run_id, distance_label, time_seconds, pace_label) VALUES ($1, $2, $3, $4)`,
          [runId, split.distanceLabel, split.timeSeconds, split.pace]
        );
      }
    }

    if (run.intervals?.length > 0) {
      for (const interval of run.intervals) {
        await client.query(
          `INSERT INTO intervals (run_id, interval_type, duration, distance, avg_pace, avg_speed) VALUES ($1, $2, $3, $4, $5, $6)`,
          [runId, interval.type, interval.duration, interval.distance, interval.avgPace, interval.avgSpeed]
        );
      }
    }

    await client.query('COMMIT');
    return { id: runId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

export const getRunHistory = async (userId, limit = 50) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, start_time, mode, distance_meters, duration_seconds, calories_burned
       FROM runs
       WHERE user_id = $1
       ORDER BY start_time DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  } finally {
    client.release();
  }
};

export const getRunById = async (runId, userId) => {
  const client = await pool.connect();
  try {
    const runRes = await client.query(
      `SELECT * FROM runs WHERE id = $1 AND user_id = $2`,
      [runId, userId]
    );
    if (runRes.rows.length === 0) return null;

    const splitsRes = await client.query(
      `SELECT * FROM splits WHERE run_id = $1 ORDER BY id ASC`, [runId]
    );
    const intervalsRes = await client.query(
      `SELECT * FROM intervals WHERE run_id = $1 ORDER BY id ASC`, [runId]
    );

    return { ...runRes.rows[0], splits: splitsRes.rows, intervals: intervalsRes.rows };
  } finally {
    client.release();
  }
};

// ============================================================
// COACH INTERACTIONS
// ============================================================

export const saveCoachInteraction = async (runId, userId, query, response) => {
  const client = await pool.connect();
  try {
    // Verify run ownership before saving
    const check = await client.query(
      `SELECT id FROM runs WHERE id = $1 AND user_id = $2`, [runId, userId]
    );
    if (check.rows.length === 0) return null;

    await client.query(
      `INSERT INTO coach_interactions (run_id, user_query, ai_response) VALUES ($1, $2, $3)`,
      [runId, query, response]
    );
    return true;
  } finally {
    client.release();
  }
};

export const getCoachInteractions = async (runId, userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT ci.user_query, ci.ai_response, ci.created_at
       FROM coach_interactions ci
       JOIN runs r ON ci.run_id = r.id
       WHERE ci.run_id = $1 AND r.user_id = $2
       ORDER BY ci.created_at DESC`,
      [runId, userId]
    );
    return res.rows;
  } finally {
    client.release();
  }
};
// ============================================================
// GOALS
// ============================================================

export const getGoals = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         g.id, g.title, g.type, g.frequency, g.target_value, g.sport_type,
         g.start_date, g.end_date, g.is_private,
         COALESCE(gp.current_value, 0) AS current_value,
         gp.period_start, gp.period_end, gp.is_completed
       FROM goals g
       LEFT JOIN goal_periods gp
         ON gp.goal_id = g.id AND NOW() BETWEEN gp.period_start AND gp.period_end
       WHERE g.user_id = $1 AND g.is_active = true
       ORDER BY g.sport_type ASC`,
      [userId]
    );
    return res.rows;
  } finally { client.release(); }
};

export const createGoal = async (userId, goal) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const goalRes = await client.query(
      `INSERT INTO goals (user_id, title, type, frequency, target_value, sport_type, start_date, end_date, is_private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [userId, goal.title || null, goal.type, goal.frequency, goal.target_value,
       goal.sport_type, goal.start_date, goal.end_date, goal.is_private ?? true]
    );
    const newGoal = goalRes.rows[0];
    const periodBounds = getInitialPeriodBounds(goal.frequency, goal.start_date);
    await client.query(
      `INSERT INTO goal_periods (goal_id, period_start, period_end) VALUES ($1, $2, $3)`,
      [newGoal.id, periodBounds.start, periodBounds.end]
    );
    await client.query('COMMIT');
    return newGoal;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
};

export const deleteGoal = async (goalId, userId) => {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE goals SET is_active = false WHERE id = $1 AND user_id = $2`, [goalId, userId]);
    return true;
  } finally { client.release(); }
};

export const recalculateGoalPeriods = async (userId, sportType, startTime, metricValue) => {
  const client = await pool.connect();
  try {
    const periods = await client.query(
      `SELECT gp.id, gp.goal_id, g.type, g.target_value
       FROM goal_periods gp JOIN goals g ON gp.goal_id = g.id
       WHERE g.user_id = $1 AND g.sport_type = $2 AND g.is_active = true
         AND $3 BETWEEN gp.period_start AND gp.period_end`,
      [userId, sportType, startTime]
    );
    for (const period of periods.rows) {
      await client.query(
        `UPDATE goal_periods SET current_value = current_value + $1, last_calculated = NOW(),
         is_completed = (current_value + $1 >= $2) WHERE id = $3`,
        [metricValue, period.target_value, period.id]
      );
    }
  } finally { client.release(); }
};

const getInitialPeriodBounds = (frequency, startDate) => {
  const start = new Date(startDate);
  if (frequency === 'weekly') {
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999);
    return { start, end };
  }
  if (frequency === 'monthly') {
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 0, 23,59,59,999) };
  }
  return { start, end: new Date(start.getFullYear(), 11, 31, 23,59,59,999) };
};

// ============================================================
// SOCIAL — FRIENDSHIPS
// ============================================================

/**
 * Send a friend request.
 */
export const sendFriendRequest = async (requesterId, receiverId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO friendships (requester_id, receiver_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_id, receiver_id) DO NOTHING
       RETURNING *`,
      [requesterId, receiverId]
    );
    return res.rows[0] || null;
  } finally { client.release(); }
};

/**
 * Accept or decline a friend request.
 * Only the receiver can update the status.
 */
export const updateFriendshipStatus = async (friendshipId, receiverId, status, tierId = null) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE friendships
       SET status = $1, tier_id = COALESCE($2, tier_id)
       WHERE id = $3 AND receiver_id = $4
       RETURNING *`,
      [status, tierId, friendshipId, receiverId]
    );
    return res.rows[0] || null;
  } finally { client.release(); }
};

/**
 * Returns all accepted friends for a user with their tier info.
 */
export const getFriends = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         f.id            AS friendship_id,
         f.status,
         f.tier_id,
         ft.name         AS tier_name,
         f.created_at,
         CASE WHEN f.requester_id = $1 THEN f.receiver_id
              ELSE f.requester_id END AS friend_id,
         u.first_name,
         u.last_name,
         u.email,
         u.profile_image_url
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1
                                   THEN f.receiver_id ELSE f.requester_id END
       LEFT JOIN friend_tiers ft ON ft.id = f.tier_id
       WHERE (f.requester_id = $1 OR f.receiver_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.first_name ASC`,
      [userId]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Returns pending friend requests received by the user.
 */
export const getPendingRequests = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         f.id AS friendship_id,
         f.created_at,
         u.id AS requester_id,
         u.first_name,
         u.last_name,
         u.email,
         u.profile_image_url
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.receiver_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Returns users whose profiles are public — for the People to Follow widget.
 * Excludes the current user and anyone already connected.
 */
export const getDiscoverableUsers = async (userId, limit = 20) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.email, u.profile_image_url, u.bio
       FROM users u
       WHERE u.id != $1
         AND u.privacy_mode = 'public'
         AND u.id NOT IN (
           SELECT CASE WHEN requester_id = $1 THEN receiver_id ELSE requester_id END
           FROM friendships
           WHERE requester_id = $1 OR receiver_id = $1
         )
       ORDER BY u.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  } finally { client.release(); }
};

// ============================================================
// SOCIAL — FEED
// ============================================================

/**
 * Returns the activity feed for a user.
 * Shows runs from accepted friends who have shared their runs
 * with a tier the viewing user belongs to, OR from the user
 * themselves. Ordered most recent first.
 *
 * Visibility rule: viewer's tier_id <= feature_sharing.tier_id
 * feature name = 'runs'
 */
export const getFeed = async (userId, limit = 50, offset = 0) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         r.id,
         r.start_time,
         r.mode,
         r.distance_meters,
         r.duration_seconds,
         r.calories_burned,
         r.avg_heart_rate,
         r.elevation_gain,
         r.route_json,
         -- Author info
         u.id            AS author_id,
         u.first_name,
         u.last_name,
         u.profile_image_url,
         -- Friendship context
         f.tier_id       AS viewer_tier_id,
         -- Kudos
         COUNT(k.id)                                           AS kudos_count,
         BOOL_OR(k.user_id = $1)                              AS viewer_gave_kudos
       FROM runs r
       JOIN users u ON u.id = r.user_id
       -- The viewer's friendship with the author
       LEFT JOIN friendships f
         ON f.status = 'accepted'
         AND (
           (f.requester_id = $1 AND f.receiver_id = r.user_id)
           OR
           (f.receiver_id = $1 AND f.requester_id = r.user_id)
         )
       -- Kudos
       LEFT JOIN public.kudos k ON k.run_id = r.id
       -- Feature sharing: author must have shared 'runs' with
       -- a tier >= viewer's tier (lower number = more exclusive)
       WHERE (
         -- Always show the user's own runs
         r.user_id = $1
         OR (
           -- Friend's run AND viewer's tier <= shared tier
           f.id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM feature_sharing fs
             JOIN features feat ON feat.id = fs.feature_id
             WHERE fs.user_id  = r.user_id
               AND feat.name   = 'runs'
               AND f.tier_id  <= fs.tier_id
           )
         )
       )
       GROUP BY r.id, u.id, f.tier_id
       ORDER BY r.start_time DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Returns the user's own runs for their profile page feed.
 */
export const getUserFeed = async (profileUserId, viewerId, limit = 30) => {
  const client = await pool.connect();
  try {
    // Determine if viewer is a friend and what tier
    const friendRes = await client.query(
      `SELECT tier_id FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND receiver_id = $2)
           OR (receiver_id = $1 AND requester_id = $2))`,
      [viewerId, profileUserId]
    );
    const viewerTierId = friendRes.rows[0]?.tier_id ?? null;
    const isOwner = viewerId === profileUserId;

    // If not owner and not a friend, only show if privacy is public
    // and they've shared runs at tier 3
    const res = await client.query(
      `SELECT
         r.id, r.start_time, r.mode, r.distance_meters,
         r.duration_seconds, r.calories_burned, r.elevation_gain
       FROM runs r
       WHERE r.user_id = $1
         AND (
           $2 = true  -- is owner
           OR (
             $3::integer IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM feature_sharing fs
               JOIN features feat ON feat.id = fs.feature_id
               WHERE fs.user_id = $1 AND feat.name = 'runs'
                 AND $3 <= fs.tier_id
             )
           )
         )
       ORDER BY r.start_time DESC
       LIMIT $4`,
      [profileUserId, isOwner, viewerTierId, limit]
    );
    return res.rows;
  } finally { client.release(); }
};

// ============================================================
// SOCIAL — FEATURE SHARING SETTINGS
// ============================================================

/**
 * Returns current sharing settings for a user.
 */
export const getFeatureSharingSettings = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         fs.id, fs.tier_id, fs.group_id,
         ft.name AS tier_name,
         f.name  AS feature_name
       FROM feature_sharing fs
       JOIN features f  ON f.id  = fs.feature_id
       JOIN friend_tiers ft ON ft.id = fs.tier_id
       WHERE fs.user_id = $1
       ORDER BY f.name ASC, fs.tier_id ASC`,
      [userId]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Creates or updates a feature sharing rule.
 */
export const setFeatureSharing = async (userId, featureName, tierId, groupId = null) => {
  const client = await pool.connect();
  try {
    const featureRes = await client.query(
      `SELECT id FROM features WHERE name = $1`, [featureName]
    );
    if (!featureRes.rows[0]) throw new Error(`Unknown feature: ${featureName}`);
    const featureId = featureRes.rows[0].id;

    const res = await client.query(
      `INSERT INTO feature_sharing (user_id, feature_id, tier_id, group_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, featureId, tierId, groupId]
    );
    return res.rows[0];
  } finally { client.release(); }
};

/**
 * Removes a feature sharing rule by id.
 */
export const removeFeatureSharing = async (sharingId, userId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM feature_sharing WHERE id = $1 AND user_id = $2`,
      [sharingId, userId]
    );
    return true;
  } finally { client.release(); }
};

// ============================================================
// ROUTES
// ============================================================

/**
 * Computes bounding box from a path array of {lat, lng} points.
 */
const computeBBox = (path) => {
  if (!path?.length) return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  let minLat = path[0].lat, maxLat = path[0].lat;
  let minLng = path[0].lng, maxLng = path[0].lng;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
};

export const saveRoute = async (userId, route) => {
  const client = await pool.connect();
  try {
    const path   = route.path_json   || [];
    const bbox   = computeBBox(path);
    const profile = route.elevation_profile || [];
    const startElev = profile.length > 0 ? profile[0].altitude_meters : null;
    const endElev   = profile.length > 0 ? profile[profile.length - 1].altitude_meters : null;

    const res = await client.query(
      `INSERT INTO routes
         (user_id, name, description, distance_meters, elevation_gain,
          start_elevation, end_elevation, surface_type, paved_percent,
          path_json, elevation_profile,
          bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
          is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, name, distance_meters, elevation_gain, created_at`,
      [
        userId,
        route.name || null,
        route.description || null,
        route.distance_meters,
        route.elevation_gain || 0,
        startElev,
        endElev,
        route.surface_type || 'unknown',
        route.paved_percent || 0,
        JSON.stringify(path),
        JSON.stringify(profile),
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
        route.is_public ?? true,
      ]
    );
    return res.rows[0];
  } finally { client.release(); }
};

export const getRoutes = async (userId, limit = 20) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         r.id, r.name, r.distance_meters, r.elevation_gain,
         r.start_elevation, r.end_elevation, r.surface_type,
         r.paved_percent, r.is_public, r.star_count, r.run_count,
         r.created_at,
         CASE WHEN rs.id IS NOT NULL THEN true ELSE false END AS is_starred
       FROM routes r
       LEFT JOIN route_stars rs ON rs.route_id = r.id AND rs.user_id = $1
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  } finally { client.release(); }
};

export const getRouteById = async (routeId, userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         r.*,
         CASE WHEN rs.id IS NOT NULL THEN true ELSE false END AS is_starred
       FROM routes r
       LEFT JOIN route_stars rs ON rs.route_id = r.id AND rs.user_id = $2
       WHERE r.id = $1
         AND (r.user_id = $2 OR r.is_public = true)`,
      [routeId, userId]
    );
    return res.rows[0] || null;
  } finally { client.release(); }
};

export const starRoute = async (routeId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO route_stars (route_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [routeId, userId]
    );
    await client.query(
      `UPDATE routes SET star_count = star_count + 1 WHERE id = $1`,
      [routeId]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
};

export const unstarRoute = async (routeId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `DELETE FROM route_stars WHERE route_id = $1 AND user_id = $2`,
      [routeId, userId]
    );
    if (res.rowCount > 0) {
      await client.query(
        `UPDATE routes SET star_count = GREATEST(0, star_count - 1) WHERE id = $1`,
        [routeId]
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
};

// ============================================================
// SEGMENTS
// ============================================================

export const createSegment = async (userId, segment) => {
  const client = await pool.connect();
  try {
    const path  = segment.path_json || [];
    const bbox  = computeBBox(path);

    const res = await client.query(
      `INSERT INTO segments
         (created_by, name, description, sport_type,
          start_lat, start_lng, end_lat, end_lng,
          path_json, distance_meters, elevation_gain,
          avg_grade, max_grade, start_elevation, end_elevation,
          elevation_profile,
          bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
          detection_radius, is_private, is_system_suggested)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        userId,
        segment.name,
        segment.description || null,
        segment.sport_type || 'run',
        segment.start_lat, segment.start_lng,
        segment.end_lat,   segment.end_lng,
        JSON.stringify(path),
        segment.distance_meters || 0,
        segment.elevation_gain  || 0,
        segment.avg_grade       || 0,
        segment.max_grade       || 0,
        segment.start_elevation || null,
        segment.end_elevation   || null,
        JSON.stringify(segment.elevation_profile || []),
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
        segment.detection_radius || 20,
        segment.is_private ?? false,
        segment.is_system_suggested ?? false,
      ]
    );
    return res.rows[0];
  } finally { client.release(); }
};

export const getSegmentsNearBBox = async (minLat, maxLat, minLng, maxLng, sportType = null) => {
  const client = await pool.connect();
  try {
    const params = [minLat, maxLat, minLng, maxLng];
    let sportFilter = '';
    if (sportType) {
      params.push(sportType);
      sportFilter = `AND (sport_type = $5 OR sport_type IN ('all_run','all_ride'))`;
    }
    const res = await client.query(
      `SELECT id, name, sport_type, start_lat, start_lng, end_lat, end_lng,
              distance_meters, elevation_gain, effort_count, athlete_count,
              kom_time_seconds, qom_time_seconds, detection_radius
       FROM segments
       WHERE is_private = false
         AND bbox_min_lat <= $2 AND bbox_max_lat >= $1
         AND bbox_min_lng <= $4 AND bbox_max_lng >= $3
         ${sportFilter}
       ORDER BY effort_count DESC`,
      params
    );
    return res.rows;
  } finally { client.release(); }
};

export const getSegmentById = async (segmentId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT s.*,
              u.first_name AS kom_first_name, u.last_name AS kom_last_name,
              uq.first_name AS qom_first_name, uq.last_name AS qom_last_name
       FROM segments s
       LEFT JOIN users u  ON u.id  = s.kom_user_id
       LEFT JOIN users uq ON uq.id = s.qom_user_id
       WHERE s.id = $1`,
      [segmentId]
    );
    return res.rows[0] || null;
  } finally { client.release(); }
};

export const getSegmentLeaderboard = async (segmentId, limit = 10) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         se.id, se.elapsed_seconds, se.start_time, se.is_pr,
         se.avg_heart_rate, se.avg_speed_mps,
         u.id AS user_id, u.first_name, u.last_name, u.profile_image_url,
         RANK() OVER (ORDER BY se.elapsed_seconds ASC) AS rank
       FROM segment_efforts se
       JOIN users u ON u.id = se.user_id
       WHERE se.segment_id = $1
       ORDER BY se.elapsed_seconds ASC
       LIMIT $2`,
      [segmentId, limit]
    );
    return res.rows;
  } finally { client.release(); }
};

export const getUserSegmentEfforts = async (segmentId, userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT se.*, r.start_time AS run_date
       FROM segment_efforts se
       JOIN runs r ON r.id = se.run_id
       WHERE se.segment_id = $1 AND se.user_id = $2
       ORDER BY se.elapsed_seconds ASC`,
      [segmentId, userId]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Records a segment effort after a run is completed.
 * Updates KOM/QOM and PR flags automatically.
 * Called by the segment detection engine after a run is saved.
 */
export const recordSegmentEffort = async (segmentId, runId, userId, effortData) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current segment KOM/QOM
    const segRes = await client.query(
      `SELECT kom_time_seconds, qom_time_seconds FROM segments WHERE id = $1`,
      [segmentId]
    );
    const seg = segRes.rows[0];
    if (!seg) { await client.query('ROLLBACK'); return null; }

    // Get user's current PR for this segment
    const prRes = await client.query(
      `SELECT MIN(elapsed_seconds) AS pr FROM segment_efforts
       WHERE segment_id = $1 AND user_id = $2`,
      [segmentId, userId]
    );
    const currentPR = prRes.rows[0]?.pr ?? null;
    const elapsed   = effortData.elapsed_seconds;

    const isPR  = currentPR === null || elapsed < currentPR;
    const isKOM = seg.kom_time_seconds === null || elapsed < seg.kom_time_seconds;
    const isQOM = seg.qom_time_seconds === null || elapsed < seg.qom_time_seconds;

    // Insert effort
    const effortRes = await client.query(
      `INSERT INTO segment_efforts
         (segment_id, run_id, user_id, start_time, end_time,
          elapsed_seconds, avg_speed_mps, avg_heart_rate, avg_cadence,
          is_pr, is_kom, is_qom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (segment_id, run_id) DO NOTHING
       RETURNING *`,
      [
        segmentId, runId, userId,
        effortData.start_time, effortData.end_time, elapsed,
        effortData.avg_speed_mps   || null,
        effortData.avg_heart_rate  || null,
        effortData.avg_cadence     || null,
        isPR, isKOM, isQOM,
      ]
    );

    if (effortRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // Update segment denormalized stats
    const updates = [
      `effort_count  = effort_count + 1`,
      `updated_at    = NOW()`,
    ];
    const vals = [segmentId];
    let vi = 2;

    if (isKOM) {
      updates.push(`kom_time_seconds = $${vi++}`, `kom_user_id = $${vi++}`);
      vals.push(elapsed, userId);
    }
    if (isQOM) {
      updates.push(`qom_time_seconds = $${vi++}`, `qom_user_id = $${vi++}`);
      vals.push(elapsed, userId);
    }

    await client.query(
      `UPDATE segments SET ${updates.join(', ')} WHERE id = $1`, vals
    );

    // Recalculate athlete_count
    await client.query(
      `UPDATE segments SET athlete_count = (
         SELECT COUNT(DISTINCT user_id) FROM segment_efforts WHERE segment_id = $1
       ) WHERE id = $1`,
      [segmentId]
    );

    await client.query('COMMIT');
    return { ...effortRes.rows[0], isPR, isKOM, isQOM };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
};

/**
 * Detects which segments a run's GPS path passes through.
 * Uses bounding box pre-filter then 20-meter point proximity check.
 * Returns array of matched segment IDs with timing data.
 *
 * @param {Array} routePoints - array of {lat, lng, timestamp} from the run
 * @param {string} sportType  - run mode to filter matching segments
 */
export const detectSegmentsInRun = async (routePoints, sportType) => {
  if (!routePoints?.length) return [];
  const client = await pool.connect();

  try {
    // 1. Compute run bounding box for fast pre-filter
    const bbox = computeBBox(routePoints);

    // 2. Fetch candidate segments whose bbox overlaps the run bbox
    const candidates = await client.query(
      `SELECT id, name, start_lat, start_lng, end_lat, end_lng,
              detection_radius, path_json
       FROM segments
       WHERE is_private = false
         AND bbox_min_lat <= $2 AND bbox_max_lat >= $1
         AND bbox_min_lng <= $4 AND bbox_max_lng >= $3
         AND (sport_type = $5 OR sport_type IN ('all_run','all_ride'))`,
      [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, sportType]
    );

    const matched = [];

    for (const seg of candidates.rows) {
      const radius = seg.detection_radius;

      // 3. Find the route point closest to segment start
      let startIdx = -1;
      let minStartDist = Infinity;

      for (let i = 0; i < routePoints.length; i++) {
        const d = haversineMeters(
          routePoints[i].lat, routePoints[i].lng,
          seg.start_lat, seg.start_lng
        );
        if (d < minStartDist) { minStartDist = d; startIdx = i; }
      }

      if (minStartDist > radius) continue; // didn't pass near start

      // 4. From startIdx onward, find point closest to segment end
      let endIdx = -1;
      let minEndDist = Infinity;

      for (let i = startIdx; i < routePoints.length; i++) {
        const d = haversineMeters(
          routePoints[i].lat, routePoints[i].lng,
          seg.end_lat, seg.end_lng
        );
        if (d < minEndDist) { minEndDist = d; endIdx = i; }
        // Stop searching if we've gone far past the end
        if (i > startIdx + 5 && d > minEndDist + 50) break;
      }

      if (minEndDist > radius || endIdx <= startIdx) continue;

      // 5. We have a valid effort — compute elapsed time
      const startPoint = routePoints[startIdx];
      const endPoint   = routePoints[endIdx];
      const startTs    = startPoint.timestamp ? new Date(startPoint.timestamp) : null;
      const endTs      = endPoint.timestamp   ? new Date(endPoint.timestamp)   : null;
      const elapsed    = startTs && endTs
        ? Math.round((endTs - startTs) / 1000)
        : null;

      if (!elapsed || elapsed <= 0) continue;

      // Avg speed over segment
      const segPoints  = routePoints.slice(startIdx, endIdx + 1);
      const speeds     = segPoints.map(p => p.speed || 0).filter(s => s > 0);
      const avgSpeed   = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
      const avgHR      = segPoints.map(p => p.heartRate || 0).filter(h => h > 0);
      const avgHRVal   = avgHR.length ? Math.round(avgHR.reduce((a, b) => a + b, 0) / avgHR.length) : null;

      matched.push({
        segment_id:     seg.id,
        segment_name:   seg.name,
        start_time:     startTs,
        end_time:       endTs,
        elapsed_seconds: elapsed,
        avg_speed_mps:  avgSpeed,
        avg_heart_rate: avgHRVal,
      });
    }

    return matched;
  } finally { client.release(); }
};

// ---- Haversine distance in meters (no PostGIS needed) ----
const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ============================================================
// WIDGET VALUES (Fitbit / Google Fit / Apple Health data)
// Read-only — data is written by the main app (app.embracehealth.ai)
//
// widget_values schema: id, user_id, widget_id, service_id, value, recorded_at
// widgets_index schema:  id, widget_key, label, category
// services_index:        1=Google Fit, 2=Fitbit, 3=Vision Sync
// ============================================================

/**
 * Returns the latest value for each widget for a user on a given date.
 * Since syncs are cumulative daily totals, latest per day = correct value.
 */
export const getLatestWidgetValuesForDate = async (userId, date) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT DISTINCT ON (wi.widget_key)
         wi.widget_key,
         wi.label,
         wi.category,
         wv.value,
         wv.recorded_at,
         wv.service_id
       FROM widget_values wv
       JOIN widgets_index wi ON wi.id = wv.widget_id
       WHERE wv.user_id = $1
         AND DATE(wv.recorded_at) = $2
       ORDER BY wi.widget_key, wv.recorded_at DESC`,
      [userId, date]
    );
    // Return as a key→value map for easy lookup
    return res.rows.reduce((acc, row) => {
      acc[row.widget_key] = {
        value: parseFloat(row.value) || row.value,
        label: row.label,
        category: row.category,
        recordedAt: row.recorded_at,
        serviceId: row.service_id,
      };
      return acc;
    }, {});
  } finally { client.release(); }
};

/**
 * Returns daily totals for a specific widget over a date range.
 * Each day returns the latest (highest) value for that day.
 * Used for weekly/monthly aggregations.
 */
export const getWidgetHistory = async (userId, widgetKey, startDate, endDate) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         DATE(wv.recorded_at) AS date,
         MAX(wv.value::numeric) AS value
       FROM widget_values wv
       JOIN widgets_index wi ON wi.id = wv.widget_id
       WHERE wv.user_id = $1
         AND wi.widget_key = $2
         AND DATE(wv.recorded_at) BETWEEN $3 AND $4
       GROUP BY DATE(wv.recorded_at)
       ORDER BY date ASC`,
      [userId, widgetKey, startDate, endDate]
    );
    return res.rows;
  } finally { client.release(); }
};

/**
 * Returns this week's summary for the UserDash widget panel.
 * Aggregates steps, distance, active calories, active zone minutes,
 * and resting heart rate for Mon–today.
 *
 * Returns:
 * {
 *   totalSteps, totalDistanceMeters, totalActiveCalories,
 *   totalActiveZoneMinutes, avgRestingHR,
 *   dailySteps: [{date, value}]  ← for the 7-day dot calendar
 * }
 */
export const getWeeklyWidgetSummary = async (userId) => {
  const client = await pool.connect();
  try {
    // Get Monday of current week
    const now = new Date();
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split('T')[0];
    const todayStr  = now.toISOString().split('T')[0];

    // Get latest value per day per widget for the week
    const res = await client.query(
      `SELECT
         wi.widget_key,
         DATE(wv.recorded_at) AS date,
         MAX(wv.value::numeric) AS value
       FROM widget_values wv
       JOIN widgets_index wi ON wi.id = wv.widget_id
       WHERE wv.user_id = $1
         AND DATE(wv.recorded_at) BETWEEN $2 AND $3
         AND wi.widget_key IN (
           'steps', 'distanceMiles', 'activeCalories',
           'activeZoneMinutes', 'restingHeartRate'
         )
       GROUP BY wi.widget_key, DATE(wv.recorded_at)
       ORDER BY wi.widget_key, date ASC`,
      [userId, mondayStr, todayStr]
    );

    // Aggregate
    let totalSteps = 0;
    let totalDistanceMeters = 0;
    let totalActiveCalories = 0;
    let totalActiveZoneMinutes = 0;
    const dailySteps = {};
    const restingHRValues = [];

    for (const row of res.rows) {
      const val = parseFloat(row.value) || 0;
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().split('T')[0]
        : String(row.date).split('T')[0];

      switch (row.widget_key) {
        case 'steps':
          totalSteps += val;
          dailySteps[dateStr] = val;
          break;
        case 'distanceMiles':
          // Convert miles to meters
          totalDistanceMeters += val * 1609.34;
          break;
        case 'activeCalories':
          totalActiveCalories += val;
          break;
        case 'activeZoneMinutes':
          totalActiveZoneMinutes += val;
          break;
        case 'restingHeartRate':
          if (val > 0) restingHRValues.push(val);
          break;
      }
    }

    const avgRestingHR = restingHRValues.length
      ? Math.round(restingHRValues.reduce((a, b) => a + b, 0) / restingHRValues.length)
      : null;

    // Build 7-day array for the dot calendar
    const dailyStepsArray = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dStr = d.toISOString().split('T')[0];
      dailyStepsArray.push({
        date: dStr,
        steps: dailySteps[dStr] || 0,
        hasActivity: (dailySteps[dStr] || 0) > 0,
      });
    }

    return {
      totalSteps: Math.round(totalSteps),
      totalDistanceMeters: Math.round(totalDistanceMeters),
      totalActiveCalories: Math.round(totalActiveCalories),
      totalActiveZoneMinutes: Math.round(totalActiveZoneMinutes),
      avgRestingHR,
      dailySteps: dailyStepsArray,
    };
  } finally { client.release(); }
};

/**
 * Returns today's vitals snapshot for the profile/dashboard.
 * Heart rate, SpO2, resting HR, sleep score, vo2Max.
 */
export const getTodayVitals = async (userId) => {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await client.query(
      `SELECT DISTINCT ON (wi.widget_key)
         wi.widget_key,
         wv.value,
         wv.recorded_at
       FROM widget_values wv
       JOIN widgets_index wi ON wi.id = wv.widget_id
       WHERE wv.user_id = $1
         AND DATE(wv.recorded_at) = $2
         AND wi.widget_key IN (
           'heartRate', 'restingHeartRate', 'spo2',
           'vo2Max', 'sleepScore', 'weight', 'bmi'
         )
       ORDER BY wi.widget_key, wv.recorded_at DESC`,
      [userId, today]
    );
    return res.rows.reduce((acc, row) => {
      acc[row.widget_key] = parseFloat(row.value) || row.value;
      return acc;
    }, {});
  } finally { client.release(); }
};

/**
 * Returns goal progress for walking based on daily steps.
 * Converts steps to approximate distance in meters.
 * (avg step length ~0.762m)
 */
export const getStepsThisWeek = async (userId) => {
  const summary = await getWeeklyWidgetSummary(userId);
  return {
    totalSteps: summary.totalSteps,
    // Approximate distance from steps using avg stride length
    estimatedDistanceMeters: Math.round(summary.totalSteps * 0.762),
    dailySteps: summary.dailySteps,
  };
};

// ============================================================
// KUDOS
// ============================================================

export const giveKudos = async (runId, userId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO kudos (run_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (run_id, user_id) DO NOTHING`,
      [runId, userId]
    );
    const res = await client.query(
      `SELECT COUNT(*) AS count FROM kudos WHERE run_id = $1`,
      [runId]
    );
    return { kudos_count: parseInt(res.rows[0].count, 10) };
  } finally { client.release(); }
};

export const removeKudos = async (runId, userId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM kudos WHERE run_id = $1 AND user_id = $2`,
      [runId, userId]
    );
    const res = await client.query(
      `SELECT COUNT(*) AS count FROM kudos WHERE run_id = $1`,
      [runId]
    );
    return { kudos_count: parseInt(res.rows[0].count, 10) };
  } finally { client.release(); }
};