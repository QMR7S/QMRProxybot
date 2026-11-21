// Isolated reference implementation for migration review. NOT wired to the live bot.
// Storage adapter MUST implement atomic compare-and-swap in persistent storage.
// "unknown" is a deliberate manual-reconciliation state: Telegram sendMessage
// does not offer an idempotency key, so automatic retry can duplicate delivery.
export function createBroadcastDispatcher(storage, send, now = () => Date.now()) {
  const leaseMs = 30000;
  const valid = x => Number.isSafeInteger(x) && x > 0;
  async function dispatch(broadcastId, ownerToken, maxItems = 15) {
    if (!valid(broadcastId) || typeof ownerToken !== 'string' || !ownerToken) throw Error('invalid dispatch');
    if (!valid(maxItems) || maxItems > 15) throw Error('invalid batch limit');
    // Atomic claim: one owner per broadcast. The adapter must reject stale claims.
    const lease = await storage.claim(broadcastId, ownerToken, now(), leaseMs);
    if (!lease) return { status: 'busy', sent: 0, uncertain: 0 };
    let sent = 0, uncertain = 0, blocked = 0;
    try {
      for (let i = 0; i < maxItems; i++) {
        const recipient = await storage.nextPending(broadcastId, ownerToken, now());
        if (!recipient) break;
        if (!valid(recipient.userId)) throw Error('invalid user ID');
        if (await storage.isBlocked(recipient.userId)) {
          await storage.markBlocked(broadcastId, recipient.userId, ownerToken, now());
          blocked++;
          continue;
        }
        // Persist the attempt *before* external I/O. If the process crashes here
        // or after send before acknowledgement, the result is ambiguous and is
        // NEVER retried automatically. An operator must reconcile it.
        await storage.markAttempt(broadcastId, recipient.userId, ownerToken, now());
        try {
          await send(recipient.userId, lease.content);
          await storage.markSent(broadcastId, recipient.userId, ownerToken, now());
          sent++;
        } catch (error) {
          // The send might have succeeded remotely despite an exception/time-out.
          // Preserve uncertainty and allow *manual* investigation; do not advance
          // as a confirmed delivery, and do not automatically retry.
          await storage.markUnknown(broadcastId, recipient.userId, ownerToken, now(),
            error?.retry_after ?? null);
          uncertain++;
        }
      }
      return { status: 'processed', sent, uncertain, blocked };
    } finally {
      await storage.release(broadcastId, ownerToken);
    }
  }
  return { dispatch };
}
