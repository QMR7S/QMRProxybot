// Minimal privacy-preserving database access. No message bodies or usernames tracked.
import { db } from 'sdk';
import { eq, gt, asc, sql } from 'sdk/db';
import { qmrUsers, qmrSettings, qmrBroadcasts } from '../schema.js';

const unix = () => Math.floor(Date.now()/1000);

export async function trackUser(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) return;
  const t = unix();
  await db.insert(qmrUsers).values({userId, firstSeen:t, lastSeen:t, requests:1, blocked:0})
    .onConflictDoUpdate({target:qmrUsers.userId, set:{lastSeen:t, requests:sql`${qmrUsers.requests} + 1`}}).run();
}
export async function isBlocked(userId) {
  const u = await db.select().from(qmrUsers).where(eq(qmrUsers.userId,userId)).get();
  return !!u?.blocked;
}
export async function setBlocked(userId, blocked) {
  const t=unix();
  await db.insert(qmrUsers).values({userId,firstSeen:t,lastSeen:t,requests:0,blocked:blocked?1:0})
    .onConflictDoUpdate({target:qmrUsers.userId,set:{blocked:blocked?1:0}}).run();
}
export async function getSetting(key, fallback='0') {
  const row=await db.select().from(qmrSettings).where(eq(qmrSettings.key,key)).get();
  return row?.value ?? fallback;
}
export async function setSetting(key,value) {
  await db.insert(qmrSettings).values({key, value:String(value)})
    .onConflictDoUpdate({target:qmrSettings.key,set:{value:String(value)}}).run();
}
export async function getStats() {
  const sevenDaysAgo=unix()-7*86400;
  const [total,active,blocked] = await Promise.all([
    db.$count(qmrUsers),db.$count(qmrUsers,gt(qmrUsers.lastSeen,sevenDaysAgo)),
    db.$count(qmrUsers,eq(qmrUsers.blocked,1))
  ]);
  return {total,active,blocked};
}
export async function forgetUser(userId) {
  await db.delete(qmrUsers).where(eq(qmrUsers.userId,userId)).run();
}
export async function newBroadcast(content) {
  const results=await db.insert(qmrBroadcasts).values({content,status:'draft',createdAt:unix()}).returning().run();
  if (!results?.[0]?.id) throw Error('No draft ID returned');
  return results[0];
}
export async function broadcastById(id) {
  return db.select().from(qmrBroadcasts).where(eq(qmrBroadcasts.id,id)).get();
}
export async function cancelBroadcast(id) {
  await db.update(qmrBroadcasts).set({status:'cancelled'}).where(eq(qmrBroadcasts.id,id)).run();
}
export async function broadcastBatch(id, api) {
  let b=await broadcastById(id);
  if (!b || !['draft','sending'].includes(b.status)) return null;
  if (b.status==='draft') {
    await db.update(qmrBroadcasts).set({status:'sending'}).where(eq(qmrBroadcasts.id,id)).run();
    b.status='sending';
  }
  const people=await db.select({userId:qmrUsers.userId}).from(qmrUsers)
    .where(gt(qmrUsers.userId,b.cursorId)).orderBy(asc(qmrUsers.userId)).limit(15).all();
  let sent=b.sent,failed=b.failed,cursorId=b.cursorId;
  for (const u of people) {
    cursorId=u.userId;
    // Persist BEFORE sending to prevent duplicate deliveries on interrupted requests.
    await db.update(qmrBroadcasts).set({cursorId}).where(eq(qmrBroadcasts.id,id)).run();
    try {
      if (!(await isBlocked(u.userId))) {
        await api.sendMessage({chat_id:u.userId,text:'📣 إشعار QMR Proxy\n\n'+b.content,
          link_preview_options:{is_disabled:true}});
        sent++;
      }
    } catch (_){ failed++; }
  }
  const done=people.length<15;
  await db.update(qmrBroadcasts).set({sent,failed,cursorId,status:done?'done':'sending'})
    .where(eq(qmrBroadcasts.id,id)).run();
  return {id,sent,failed,done,cursorId};
}
