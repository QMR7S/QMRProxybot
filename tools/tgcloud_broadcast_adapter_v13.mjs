// Telegram Serverless v13 broadcast journal adapter (staging, NOT enabled).
// Uses the documented async db.get/db.all raw SQL methods, injected so the
// module can be tested without cloud credentials. Never imports Bot API.
// Schema prerequisite: tools/broadcast_v13_review_schema.sql.
// All mutations use a fenced lease; ambiguous Telegram sends are never
// automatically returned to 'pending'.
export function makeBroadcastV13Adapter(db) {
  if (!db || typeof db.get !== 'function' || typeof db.all !== 'function') {
    throw Error('async SDK db.get/db.all interface required');
  }
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const owner = value => typeof value === 'string' && value.length >= 16 && value.length <= 128;
  function validJob(id) { if (!positive(id)) throw Error('invalid broadcast ID'); }
  function validLease(token, fence, now) {
    if (!owner(token) || !positive(fence) || !Number.isSafeInteger(now) || now < 0) {
      throw Error('invalid lease');
    }
  }
  async function claim(id, token, now, duration) {
    validJob(id);
    if (!owner(token) || !Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(duration) || duration < 1000 || duration > 300000)
      throw Error('invalid claim');
    const row = await db.get(
      `UPDATE qmr_broadcast_jobs_v13
       SET owner_token=:token, lease_until_ms=:until, fence=fence+1
       WHERE id=:id AND state='sending'
         AND (owner_token IS NULL OR lease_until_ms<=:now)
       RETURNING content, fence`,
      { ':id':id, ':token':token, ':until':now+duration, ':now':now });
    return row ? { content:row.content, fence:Number(row.fence) } : null;
  }
  async function nextPending(id, token, fence, now) {
    validJob(id); validLease(token,fence,now);
    const row = await db.get(
      `SELECT user_id AS userId FROM qmr_broadcast_delivery_v13
       WHERE broadcast_id=:id AND state='pending'
         AND EXISTS (SELECT 1 FROM qmr_broadcast_jobs_v13
           WHERE id=:id AND state='sending' AND owner_token=:token
             AND fence=:fence AND lease_until_ms>:now)
       ORDER BY user_id ASC LIMIT 1`,
      { ':id':id, ':token':token, ':fence':fence, ':now':now });
    return row || null;
  }
  async function transition(id, userId, from, to, token, fence, now, extra = {}) {
    validJob(id); validLease(token,fence,now);
    if (!positive(userId)) throw Error('invalid recipient');
    if (!['pending','attempting'].includes(from) ||
        !['attempting','sent','unknown','blocked'].includes(to)) throw Error('invalid transition');
    const attempt = to === 'attempting';
    const row = await db.get(
      `UPDATE qmr_broadcast_delivery_v13
       SET state=:to,
           attempts=attempts + :inc,
           attempted_ms=CASE WHEN :inc=1 THEN :now ELSE attempted_ms END,
           resolved_ms=CASE WHEN :inc=1 THEN resolved_ms ELSE :now END,
           retry_after_ms=:retry
       WHERE broadcast_id=:id AND user_id=:uid AND state=:from
         AND EXISTS (SELECT 1 FROM qmr_broadcast_jobs_v13
           WHERE id=:id AND state='sending' AND owner_token=:token
             AND fence=:fence AND lease_until_ms>:now)
       RETURNING user_id AS userId`,
      { ':id':id, ':uid':userId, ':from':from, ':to':to,
        ':inc':attempt ? 1 : 0, ':now':now, ':token':token,
        ':fence':fence, ':retry':extra.retryAfter ?? null });
    if (!row) throw Error('stale lease, cancelled broadcast, or invalid delivery state');
  }
  async function release(id, token, fence) {
    validJob(id);
    if (!owner(token) || !positive(fence)) throw Error('invalid release');
    // A stale worker cannot release its successor's lease.
    await db.get(
      `UPDATE qmr_broadcast_jobs_v13
       SET owner_token=NULL,lease_until_ms=0
       WHERE id=:id AND owner_token=:token AND fence=:fence
       RETURNING id`,
      { ':id':id, ':token':token, ':fence':fence });
  }
  return {
    claim, nextPending, release,
    async isBlocked(userId) {
      if (!positive(userId)) throw Error('invalid recipient');
      // Existing v6 user table. Missing schema must fail closed, never bypass blocks.
      const user = await db.get(
        'SELECT blocked FROM qmr_users_v6 WHERE user_id=:uid',
        { ':uid':userId });
      // No matching user must NOT default to eligible: migration may be incomplete.
      if (!user || ![0,1].includes(Number(user.blocked))) {
        throw Error('recipient absent from verified user table');
      }
      return Number(user.blocked) === 1;
    },
    markAttempt: (id,uid,token,fence,now) =>
      transition(id,uid,'pending','attempting',token,fence,now),
    markSent: (id,uid,token,fence,now) =>
      transition(id,uid,'attempting','sent',token,fence,now),
    markUnknown: (id,uid,token,fence,now,retryAfter) =>
      transition(id,uid,'attempting','unknown',token,fence,now,{retryAfter}),
    markBlocked: (id,uid,token,fence,now) =>
      transition(id,uid,'pending','blocked',token,fence,now),
    // Read-only aggregate for admin/manual reconciliation; never expose content.
    async counts(id) {
      validJob(id);
      return db.all(
        `SELECT state, COUNT(*) AS count FROM qmr_broadcast_delivery_v13
         WHERE broadcast_id=:id GROUP BY state ORDER BY state`,
        { ':id':id });
    }
  };
}
