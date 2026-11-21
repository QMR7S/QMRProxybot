// Pure security decision: no sdk imports, no side effects.
// Authorization is bound to the actual callback sender and chat.
export function ownerCallbackAllowed(query, ownerPredicate) {
  const uid = Number(query?.from?.id);
  const chat = query?.message?.chat;
  return Number.isSafeInteger(uid) && uid > 0
    && typeof ownerPredicate === 'function'
    && ownerPredicate(uid) === true
    && chat?.type === 'private'
    && Number(chat.id) === uid;
}
