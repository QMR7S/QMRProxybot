// Pure injectable core. Only server-verified ctx.initData authorizes access.
export const OWNER_ID=6246913670;
export function authorizeOwner(ctx,now=Date.now()) {
  const d=ctx?.initData;
  const uid=d?.user?.id;
  if (!Number.isSafeInteger(uid)||uid!==OWNER_ID) throw Error('OWNER_ONLY');
  // Telegram may serialize an auth_date query field as a decimal string.
  // Read ONLY the server-verified context. Never accept a client input value.
  const raw=d?.auth_date;
  if(raw===undefined||raw===null)throw Error('AUTH_DATE_MISSING');
  const auth=typeof raw==='string'&&/^[1-9][0-9]{0,10}$/.test(raw)?Number(raw):raw;
  if(!Number.isSafeInteger(auth)||auth<=0)throw Error('AUTH_DATE_FORMAT');
  const current=Math.floor(now/1000);
  if(!Number.isSafeInteger(current))throw Error('AUTH_DATE_FORMAT');
  if(auth>current+60)throw Error('AUTH_DATE_FUTURE');
  if(current-auth>3600)throw Error('REOPEN_TELEGRAM');
  return uid;
}
export function parseAction(input) {
  if (!input||typeof input!=='object'||Array.isArray(input)||input.confirm!=='CONFIRM') throw Error('CONFIRM_REQUIRED');
  if(input.action==='maintenance'&&typeof input.enabled==='boolean')
    return {action:'maintenance',target:input.enabled?'on':'off',enabled:input.enabled};
  if(['ban','unban'].includes(input.action)&&Number.isSafeInteger(input.uid)&&input.uid>0&&input.uid!==OWNER_ID)
    return {action:input.action,target:String(input.uid),uid:input.uid};
  throw Error('INVALID_ACTION');
}
const int=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_COUNT');return n;};
export function createBoards({db,api,getNodes,getSetting,setSetting,setBlocked,now=Date.now}) {
  async function overview() {
    const t=Math.floor(now()/1000);
    const a=await db.get('SELECT COUNT(*) AS users, COALESCE(SUM(CASE WHEN last_seen>=:cut THEN 1 ELSE 0 END),0) AS active_7d, COALESCE(SUM(blocked),0) AS blocked, COALESCE(SUM(requests),0) AS requests FROM qmr_users_v6',{':cut':t-7*86400});
    const rows=await db.all('SELECT status, COUNT(*) AS n FROM qmr_broadcasts_v6 GROUP BY status');
    const broadcasts={draft:0,sending:0,done:0,cancelled:0};
    for(const r of rows) if(Object.hasOwn(broadcasts,r.status)) broadcasts[r.status]=int(r.n);
    // Controlled opt-in campaigns are separate from legacy V6; exclude canaries.
    const notify=await db.all("SELECT state, COUNT(*) AS n FROM qmr_notify_jobs_v13 WHERE scope='optin' GROUP BY state");
    for(const r of notify){const status=r.state==='preparing'?'draft':r.state;if(Object.hasOwn(broadcasts,status))broadcasts[status]+=int(r.n);}
    let receiver='unverified';
    try {const me=await api.getMe();if(me?.id===9239734904&&String(me.username).toLowerCase()==='qmrproxybot')receiver='bot_api_verified';}catch(_){}
    let source={count:null,checked_at:null,origin:'unavailable'};
    try {const r=await getNodes();source={count:int(r.nodes.length),checked_at:r.updated_at,origin:r.from};}catch(_){}
    return {updated_at:t,activity:{users:int(a.users),active_7d:int(a.active_7d),blocked:int(a.blocked),requests:int(a.requests)},broadcasts,source,
      webhook:{mode:'telegram_serverless',receiver,inbox:{pending:null,processing:null,done:null,dead:null}},
      limitations:{queue:'not_exposed_by_sdk',quality:'no_independent_mtproto_probe',broadcast:'owner_confirmed_optin_only'}};
  }
  async function ops(input,ctx) {authorizeOwner(ctx,now());return overview();}
  async function admin(input,ctx) {
    const actor=authorizeOwner(ctx,now());
    if(input?.op==='summary') {
      const d=await overview();
      const users=await db.all('SELECT user_id AS uid, first_seen, last_seen, requests, blocked FROM qmr_users_v6 ORDER BY last_seen DESC,user_id ASC LIMIT 25');
      const events=await db.all('SELECT action,target,created_at,state FROM qmr_board_audit_v14 ORDER BY id DESC LIMIT 20');
      return {...d,maintenance:(await getSetting('maintenance','0'))==='1',users,events};
    }
    if(input?.op!=='action')throw Error('INVALID_ACTION');
    const a=parseAction(input);
    // Persist intent BEFORE mutation. There is no assumed multi-statement transaction.
    // Interrupted work stays 'pending' and requires reconciliation, never automatic retry.
    const row=await db.insertAudit({actor,action:a.action,target:a.target,createdAt:Math.floor(now()/1000),state:'pending'});
    if(!Number.isSafeInteger(row?.id)||row.id<=0)throw Error('AUDIT_UNAVAILABLE');
    try {
      if(a.action==='maintenance') await setSetting('maintenance',a.enabled?'1':'0');
      else await setBlocked(a.uid,a.action==='ban');
      const updated=await db.updateOne('audit',{state:'applied'},"id=:id AND state='pending'",{':id':row.id});
      if(updated?.id!==row.id)throw Error('AUDIT_UNCERTAIN');
    }catch(_) {throw Error('ACTION_UNCERTAIN_RELOAD');}
    return {ok:true};
  }
  return {admin,ops};
}
