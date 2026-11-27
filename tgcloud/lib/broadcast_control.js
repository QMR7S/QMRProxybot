// V13 controlled replacement. A durable per-recipient claim is never retried.
// No timers, raw sockets, or automatic sending. One recipient per explicit step.
// The owner-only canary must pass before opt-in campaigns are available.
export function makeBroadcastControl(db,send,ownerId,now=Date.now) {
  const pos=x=>Number.isSafeInteger(x)&&x>0;
  const owner=uid=>{if(uid!==ownerId)throw Error('OWNER_ONLY');};
  const get=(sql,args={})=>db.get(sql,args);
  const all=(sql,args={})=>db.all(sql,args);
  const run=(sql,args={})=>db.run(sql,args);
  const job=id=>get('SELECT id,scope,state,content,created_ms,step_seq FROM qmr_notify_jobs_v13 WHERE id=:id',{':id':id});
  const unlocked=async()=>!!(await get("SELECT id FROM qmr_notify_jobs_v13 WHERE scope='canary' AND state='done' LIMIT 1"));
  async function preference(uid,on) {
    if(!pos(uid)||typeof on!=='boolean')throw Error('INVALID_PREFERENCE');
    if(on) {
      await run("INSERT INTO qmr_notify_optin_v13(user_id,enabled_at) SELECT user_id,:t FROM qmr_users_v6 WHERE user_id=:uid AND blocked=0 ON CONFLICT(user_id) DO UPDATE SET enabled_at=excluded.enabled_at",{':uid':uid,':t':now()});
      const row=await get("SELECT o.user_id FROM qmr_notify_optin_v13 o JOIN qmr_users_v6 u ON u.user_id=o.user_id WHERE o.user_id=:uid AND u.blocked=0",{':uid':uid});
      if(row?.user_id!==uid)throw Error('NOT_ELIGIBLE');
    }else await run('DELETE FROM qmr_notify_optin_v13 WHERE user_id=:uid',{':uid':uid});
    return on;
  }
  async function forget(uid) {
    if(!pos(uid))throw Error('INVALID_USER');
    await preference(uid,false);
    // Keep an in-flight claim until the send resolves; do not unlock another
    // worker while an external send may be in progress. No new claim is allowed.
    await run("DELETE FROM qmr_notify_delivery_v13 WHERE user_id=:uid AND state!='attempting'",{':uid':uid});
    const pending=await get("SELECT COUNT(*) AS n FROM qmr_notify_delivery_v13 WHERE user_id=:uid AND state='attempting'",{':uid':uid});
    if(pending.n!==0)throw Error('IN_FLIGHT_TRY_LATER');
  }
  async function summary(uid,id) {
    owner(uid);if(!pos(id))throw Error('INVALID_ID');
    const j=await job(id);if(!j)throw Error('NOT_FOUND');
    const counts={pending:0,attempting:0,sent:0,unknown:0,skipped:0};
    for(const r of await all('SELECT state,COUNT(*) AS n FROM qmr_notify_delivery_v13 WHERE job_id=:id GROUP BY state',{':id':id})) {
      if(!Object.hasOwn(counts,r.state)||!Number.isSafeInteger(r.n)||r.n<0)throw Error('INVALID_JOURNAL');
      counts[r.state]=r.n;
    }
    return {id:j.id,scope:j.scope,state:j.state,stepSeq:j.step_seq,counts,total:Object.values(counts).reduce((a,b)=>a+b,0)};
  }
  async function create(uid,messageId,content,scope='optin') {
    owner(uid);
    if(!pos(messageId)||!['optin','canary'].includes(scope)||typeof content!=='string'||!content.trim()||content.length>3000)throw Error('INVALID_DRAFT');
    if(scope==='optin'&&!await unlocked())throw Error('CANARY_REQUIRED');
    // Replayed Telegram updates use the same private owner message ID.
    await run("INSERT INTO qmr_notify_jobs_v13(message_id,scope,content,state,created_ms) VALUES(:mid,:scope,:content,'preparing',:t) ON CONFLICT(message_id) DO NOTHING",{':mid':messageId,':scope':scope,':content':content,':t':now()});
    const j=await get('SELECT id,scope,content FROM qmr_notify_jobs_v13 WHERE message_id=:mid',{':mid':messageId});
    if(!pos(j?.id))throw Error('DRAFT_UNCERTAIN');
    if(j.scope!==undefined&&(j.scope!==scope||j.content!==content))throw Error('DRAFT_CONFLICT');
    const args={':id':j.id,':owner':ownerId};
    if(scope==='canary'){
      await run("INSERT OR IGNORE INTO qmr_notify_delivery_v13(job_id,user_id,state) SELECT id,:owner,'pending' FROM qmr_notify_jobs_v13 WHERE id=:id AND state='preparing' AND scope='canary'",args);
    }else{
      // One SQL statement captures the current audience; a repeated invocation
      // cannot add more once the job becomes a draft. More than 1000 requires
      // a separately reviewed larger-audience workflow, not silent truncation.
      await run("INSERT OR IGNORE INTO qmr_notify_delivery_v13(job_id,user_id,state) SELECT j.id,u.user_id,'pending' FROM qmr_notify_jobs_v13 j JOIN qmr_notify_optin_v13 o JOIN qmr_users_v6 u ON u.user_id=o.user_id WHERE j.id=:id AND j.state='preparing' AND j.scope='optin' AND u.blocked=0 AND u.user_id!=:owner ORDER BY u.user_id LIMIT 1001",args);
    }
    await run("UPDATE qmr_notify_jobs_v13 SET state=CASE WHEN (SELECT COUNT(*) FROM qmr_notify_delivery_v13 WHERE job_id=:id) BETWEEN 1 AND 1000 THEN 'draft' ELSE 'cancelled' END WHERE id=:id AND state='preparing'",{':id':j.id});
    return summary(uid,j.id);
  }
  async function confirm(uid,id) {
    owner(uid);if(!pos(id))throw Error('INVALID_ID');
    await run("UPDATE qmr_notify_jobs_v13 SET state='sending' WHERE id=:id AND state='draft' AND EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 WHERE job_id=:id AND state='pending')",{':id':id});
    return summary(uid,id); // confirmation itself sends nothing
  }
  async function step(uid,id,expectedSeq) {
    owner(uid);if(!pos(id))throw Error('INVALID_ID');
    const j=await job(id);if(!j)throw Error('NOT_FOUND');
    if(j.state!=='sending'||!Number.isSafeInteger(expectedSeq)||expectedSeq<0||j.step_seq!==expectedSeq)return summary(uid,id);
    if(j.scope==='optin'&&!await unlocked())throw Error('CANARY_REQUIRED');
    // Recheck opt-in and block status at the time of claim, not just snapshot.
    await run("UPDATE qmr_notify_delivery_v13 SET state='skipped' WHERE job_id=:id AND state='pending' AND EXISTS(SELECT 1 FROM qmr_notify_jobs_v13 WHERE id=:id AND state='sending' AND scope='optin') AND NOT EXISTS(SELECT 1 FROM qmr_notify_optin_v13 o JOIN qmr_users_v6 u ON u.user_id=o.user_id WHERE o.user_id=qmr_notify_delivery_v13.user_id AND u.blocked=0)",{':id':id});
    // A single atomic statement claims ONE row. An ambiguous attempt blocks
    // this campaign; an in-flight attempt in any campaign blocks other sends.
    // No lease expiry requeues an uncertain send.
    const claimTime=now();
    const claimed=await db.updateOne('delivery',{state:'attempting',attemptedMs:claimTime},
      "job_id=:id AND user_id=(SELECT user_id FROM qmr_notify_delivery_v13 WHERE job_id=:id AND state='pending' ORDER BY user_id LIMIT 1) AND state='pending' AND EXISTS(SELECT 1 FROM qmr_notify_jobs_v13 WHERE id=:id AND state='sending' AND step_seq=:seq) AND NOT EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 d WHERE d.state='attempting' OR (d.job_id=:id AND d.state='unknown') OR d.retry_after_ms>:t) AND EXISTS(SELECT 1 FROM qmr_notify_jobs_v13 x WHERE x.id=:id AND ((x.scope='canary' AND qmr_notify_delivery_v13.user_id=:owner) OR (x.scope='optin' AND qmr_notify_delivery_v13.user_id!=:owner AND EXISTS(SELECT 1 FROM qmr_notify_optin_v13 o JOIN qmr_users_v6 u ON u.user_id=o.user_id WHERE o.user_id=qmr_notify_delivery_v13.user_id AND u.blocked=0))))",{':id':id,':t':claimTime,':owner':ownerId,':seq':expectedSeq});
    // updateOne must return the actual row from the same atomic write.
    if(claimed){
      if(!pos(claimed.user_id))throw Error('INVALID_RECIPIENT');
      const consumed=await db.updateOne('jobs',{stepSeq:expectedSeq+1},"id=:id AND state='sending' AND step_seq=:seq",{':id':id,':seq':expectedSeq});
      if(consumed?.id!==id)throw Error('DELIVERY_UNCERTAIN');
      let state='unknown',retryAfter=null;
      try{
        const result=await send(claimed.user_id,j.content);
        if(!pos(result?.message_id)||Number(result?.chat?.id)!==claimed.user_id)throw Error('AMBIGUOUS_SEND');
        state='sent';
      }catch(e){if(e?.code===429||e?.error_code===429){const s=e?.parameters?.retry_after;retryAfter=now()+1000*(Number.isSafeInteger(s)&&s>0?Math.min(s,86400):86400);} /* Never retry this recipient. */}
      const settled=await db.updateOne('delivery',{state,resolvedMs:now(),retryAfterMs:retryAfter},"job_id=:id AND user_id=:uid AND state='attempting'",{':id':id,':uid':claimed.user_id});
      if(settled?.user_id!==claimed.user_id)throw Error('DELIVERY_UNCERTAIN');
    }
    await run("UPDATE qmr_notify_jobs_v13 SET state='done' WHERE id=:id AND state='sending' AND EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 WHERE job_id=:id) AND NOT EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 WHERE job_id=:id AND state IN ('pending','attempting','unknown')) AND (scope!='canary' OR EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 WHERE job_id=:id AND user_id=:owner AND state='sent'))",{':id':id,':owner':ownerId});
    return summary(uid,id);
  }
  async function cancel(uid,id) {
    owner(uid);if(!pos(id))throw Error('INVALID_ID');
    // Cancel is intentionally not an automatic retry or a resolution claim.
    await run("UPDATE qmr_notify_jobs_v13 SET state='cancelled' WHERE id=:id AND state IN ('preparing','draft','sending') AND NOT EXISTS(SELECT 1 FROM qmr_notify_delivery_v13 WHERE job_id=:id AND state='attempting')",{':id':id});
    return summary(uid,id);
  }
  async function abandon(uid,id) {
    owner(uid);if(!pos(id))throw Error('INVALID_ID');
    // Explicit owner reconciliation, never repeat a send. Five minutes is an
    // operational cooling period, not proof the external request did not land.
    await run("UPDATE qmr_notify_delivery_v13 SET state='unknown',resolved_ms=:t WHERE job_id=:id AND state='attempting' AND attempted_ms<=:cut",{':id':id,':t':now(),':cut':now()-300000});
    return cancel(uid,id);
  }
  return {preference,forget,summary,create,confirm,step,cancel,abandon,unlocked};
}
