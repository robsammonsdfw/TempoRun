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
      `INSERT INTO runs (user_id, start_time, mode, duration_seconds, distance_meters, calories_burned, avg_heart_rate, route_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, run.start_time, run.mode, run.duration_seconds, run.distance_meters,
       run.calories_burned, run.avg_heart_rate, run.route]
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

/**
 * Returns all active goals for a user, each joined with its
 * current period so the frontend knows current_value vs target.
 */
export const getGoals = async (userId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         g.id,
         g.title,
         g.type,
         g.frequency,
         g.target_value,
         g.sport_type,
         g.start_date,
         g.end_date,
         g.is_private,
         COALESCE(gp.current_value, 0) AS current_value,
         gp.period_start,
         gp.period_end,
         gp.is_completed
       FROM goals g
       LEFT JOIN goal_periods gp
         ON gp.goal_id = g.id
         AND NOW() BETWEEN gp.period_start AND gp.period_end
       WHERE g.user_id = $1
         AND g.is_active = true
       ORDER BY g.sport_type ASC`,
      [userId]
    );
    return res.rows;
  } finally {
    client.release();
  }
};

/**
 * Creates a new goal and immediately opens its first period window.
 */
export const createGoal = async (userId, goal) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const goalRes = await client.query(
      `INSERT INTO goals
         (user_id, title, type, frequency, target_value, sport_type, start_date, end_date, is_private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        goal.title || null,
        goal.type,
        goal.frequency,
        goal.target_value,
        goal.sport_type,
        goal.start_date,
        goal.end_date,
        goal.is_private ?? true,
      ]
    );
    const newGoal = goalRes.rows[0];

    // Open the first period window immediately
    const periodBounds = getInitialPeriodBounds(goal.frequency, goal.start_date);
    await client.query(
      `INSERT INTO goal_periods (goal_id, period_start, period_end)
       VALUES ($1, $2, $3)`,
      [newGoal.id, periodBounds.start, periodBounds.end]
    );

    await client.query('COMMIT');
    return newGoal;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Deactivates a goal (soft delete).
 */
export const deleteGoal = async (goalId, userId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE goals SET is_active = false
       WHERE id = $1 AND user_id = $2`,
      [goalId, userId]
    );
    return true;
  } finally {
    client.release();
  }
};

/**
 * Recalculates current_value for all active goal periods that
 * match a run's sport_type and time window.
 * Called after every run is saved.
 */
export const recalculateGoalPeriods = async (userId, sportType, startTime, metricValue) => {
  const client = await pool.connect();
  try {
    // Find all active periods for matching goals
    const periods = await client.query(
      `SELECT gp.id, gp.goal_id, g.type, g.target_value
       FROM goal_periods gp
       JOIN goals g ON gp.goal_id = g.id
       WHERE g.user_id = $1
         AND g.sport_type = $2
         AND g.is_active = true
         AND $3 BETWEEN gp.period_start AND gp.period_end`,
      [userId, sportType, startTime]
    );

    for (const period of periods.rows) {
      await client.query(
        `UPDATE goal_periods
         SET current_value    = current_value + $1,
             last_calculated  = NOW(),
             is_completed     = (current_value + $1 >= $2)
         WHERE id = $3`,
        [metricValue, period.target_value, period.id]
      );
    }
  } finally {
    client.release();
  }
};

// ---- Private helper ----

const getInitialPeriodBounds = (frequency, startDate) => {
  const start = new Date(startDate);

  if (frequency === 'weekly') {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (frequency === 'monthly') {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  // yearly
  const end = new Date(start.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
};