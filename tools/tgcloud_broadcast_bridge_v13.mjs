// Staging-only bridge between v13 fenced SQLite journal and Telegram sendMessage.
// NOT imported by any live handler. No auto-retry of ambiguous delivery.
// Require unique unpredictable token PER invocation supplied privately by caller.
export function createV13DispatchBridge(storage, sendMessage, now = () => Date.now()) {
  if (!storage || typeof sendMessage !== 'function') throw Error('missing dependencies');
  const leaseMs = 30000, minRemainingMs = 10000;
  const positive = n => Number.isSafeInteger(n) && n > 0;
  async function dispatch(id, token, options = {}) {
    const limit = options.limit ?? 15;
    if (!positive(id) || typeof token !== 'string' || token.length < 16 ||
        token.length > 128 || !positive(limit) || limit > 15) throw Error('invalid dispatch');
    const startedAt = now();
    const lease = await storage.claim(id,token,startedAt,leaseMs);
    if (!lease) return {status:'busy',sent:0,uncertain:0,blocked:0};
    let sent=0,uncertain=0,blocked=0,stopped='complete';
    const deadline=startedAt+leaseMs;
    try {
      for (let i=0; i<limit; i++) {
        // Refuse to begin an external send when insufficient lease time remains.
        if (now() >= deadline-minRemainingMs) {stopped='lease-near-expiry';break;}
        const recipient=await storage.nextPending(id,token,lease.fence,now());
        if (!recipient) break;
        if (!positive(recipient.userId)) throw Error('invalid recipient');
        if (await storage.isBlocked(recipient.userId)) {
          await storage.markBlocked(id,recipient.userId,token,lease.fence,now());blocked++;
          continue;
        }
        // Durable journal transition before any call to Telegram.
        await storage.markAttempt(id,recipient.userId,token,lease.fence,now());
        let delivered=false, retryAfter=null;
        try {
          await sendMessage(recipient.userId,lease.content);
          delivered=true;
        } catch(error) {
          const seconds = error?.parameters?.retry_after;
          // Bot API retry_after is in SECONDS; journal retry_after_ms is
          // an absolute Unix millisecond deadline, not a number of seconds.
          if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400) {
            retryAfter = now() + seconds * 1000;
          } else if (error?.code === 429 || error?.error_code === 429) {
            // 429 without a usable retry deadline: stop the entire batch.
            retryAfter = now() + 86400 * 1000;
          }
        }
        // If the lease expired mid-request, a stale worker cannot record success.
        // The persisted 'attempting' row stays for manual reconciliation.
        try {
          if (delivered) {
            await storage.markSent(id,recipient.userId,token,lease.fence,now());sent++;
          } else {
            await storage.markUnknown(id,recipient.userId,token,lease.fence,now(),retryAfter);
            uncertain++;
          }
        } catch(error) {
          stopped='lost-lease-or-db-error';
          // Never retry an ambiguous outcome automatically.
          break;
        }
        if (retryAfter!==null) {stopped='rate-limited';break;}
      }
      return {status:stopped,sent,uncertain,blocked};
    } finally {
      await storage.release(id,token,lease.fence);
    }
  }
  return {dispatch};
}
