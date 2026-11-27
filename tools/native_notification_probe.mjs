// Run only with already-migrated, empty notification tables, before deploying
// notification handlers. This test never invokes sendMessage or a real admin action.
import {api} from 'sdk';
import {nativeDb as db} from 'lib/sdk_write_adapter';
import {makeBroadcastControl} from 'lib/broadcast_control';
const tables=['qmr_notify_optin_v13','qmr_notify_jobs_v13','qmr_notify_delivery_v13'];
const marker='QMR_SDK_PROBE_20261127';
const mid=2147483647, second=2147483646, fakeOwner=9007199254740990;
export default async function(){
 const me=await api.getMe();
 if(me.id!==9239734904)throw Error('wrong bot');
 for(const table of tables){
   if((await db.get('SELECT COUNT(*) AS n FROM '+table)).n!==0)throw Error('STOP: notification tables not empty');
 }
 if(await db.get("SELECT id FROM qmr_board_audit_v14 WHERE action='sdk_probe' AND target=:tag",{':tag':marker}))throw Error('STOP: existing probe audit');
 let sends=0;
 const ctl=makeBroadcastControl(db,async(uid,content)=>{
   if(uid!==fakeOwner||content!==marker)throw Error('wrong simulated recipient');
   sends++;return {message_id:1,chat:{id:uid}};
 },fakeOwner);
 let stage='start';
 try {
   stage='draft';const j=await ctl.create(fakeOwner,mid,marker,'canary');
   if(j.total!==1||j.state!=='draft')throw Error('draft mismatch');
   stage='confirm';await ctl.confirm(fakeOwner,j.id);
   if(sends!==0)throw Error('confirmation sent');
   stage='claim-and-settle';const d=await ctl.step(fakeOwner,j.id,0);
   if(d.state!=='done'||d.counts.sent!==1||d.stepSeq!==1||sends!==1)throw Error('atomic delivery mismatch');
   stage='replay';await ctl.step(fakeOwner,j.id,0);
   if(sends!==1)throw Error('repeated send');
   stage='empty-optin';const empty=await ctl.create(fakeOwner,second,marker,'optin');
   if(empty.total!==0||empty.state!=='cancelled')throw Error('unexpected opt-in snapshot');
   stage='audit-insert';const a=await db.insertAudit({actor:fakeOwner,action:'sdk_probe',target:marker,createdAt:Math.floor(Date.now()/1000),state:'pending'});
   if(!Number.isSafeInteger(a?.id)||a.id<=0)throw Error('audit insert mismatch');
   stage='audit-update';const u=await db.updateOne('audit',{state:'applied'},"id=:id AND state='pending'",{':id':a.id});
   if(u?.id!==a.id)throw Error('audit update mismatch');
   stage='zero-match';if(await db.updateOne('audit',{state:'applied'},"id=:id AND state='pending'",{':id':a.id})!==null)throw Error('zero-match mismatch');
 }catch(e){throw Error('PROBE '+stage+': '+String(e?.message||e));}
 finally{
   // Delete ONLY this test's rows, identified by fixed markers. No table reset.
   await db.run("DELETE FROM qmr_notify_delivery_v13 WHERE job_id IN (SELECT id FROM qmr_notify_jobs_v13 WHERE message_id IN (:a,:b) AND content=:tag)",{':a':mid,':b':second,':tag':marker});
   await db.run("DELETE FROM qmr_notify_jobs_v13 WHERE message_id IN (:a,:b) AND content=:tag",{':a':mid,':b':second,':tag':marker});
   await db.run("DELETE FROM qmr_board_audit_v14 WHERE actor=:actor AND action='sdk_probe' AND target=:tag",{':actor':fakeOwner,':tag':marker});
 }
 for(const table of tables){
   if((await db.get('SELECT COUNT(*) AS n FROM '+table)).n!==0)throw Error('probe cleanup not verified');
 }
 if(await db.get("SELECT id FROM qmr_board_audit_v14 WHERE actor=:actor AND action='sdk_probe' AND target=:tag",{':actor':fakeOwner,':tag':marker}))throw Error('audit cleanup not verified');
 return {native_sql_preflight:true,simulated_sends:sends,actual_messages:0,cleanup:true};
}
