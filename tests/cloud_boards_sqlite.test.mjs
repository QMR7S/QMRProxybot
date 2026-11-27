import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBoards,OWNER_ID} from '../tgcloud/lib/cloud_boards_core.js';
const now=()=>1700000000000;
const ctx={initData:{user:{id:OWNER_ID},auth_date:1700000000}};
test('actual SQLite raw queries, persistent audit, maintenance and ban',async()=>{
 const raw=new DatabaseSync(':memory:');
 try{
  raw.exec("CREATE TABLE qmr_users_v6(user_id INTEGER PRIMARY KEY,first_seen INTEGER,last_seen INTEGER,requests INTEGER,blocked INTEGER);CREATE TABLE qmr_broadcasts_v6(id INTEGER PRIMARY KEY,status TEXT);CREATE TABLE qmr_board_audit_v14(id INTEGER PRIMARY KEY AUTOINCREMENT,actor INTEGER,action TEXT,target TEXT,created_at INTEGER,state TEXT);CREATE TABLE qmr_settings_v6(key TEXT PRIMARY KEY,value TEXT);INSERT INTO qmr_users_v6 VALUES(123,1,1700000000,4,0);INSERT INTO qmr_broadcasts_v6 VALUES(1,'draft');");
  const db={get:async(sql,params={})=>raw.prepare(sql).get(params),all:async(sql,params={})=>raw.prepare(sql).all(params)};
  const boards=createBoards({db,api:{getMe:async()=>({id:9239734904,username:'QMRProxybot'})},getNodes:async()=>({nodes:[{}],updated_at:'2026-11-27',from:'remote'}),getSetting:async(key,def)=>raw.prepare('SELECT value FROM qmr_settings_v6 WHERE key=?').get(key)?.value??def,setSetting:async(key,value)=>raw.prepare('INSERT INTO qmr_settings_v6 VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value),setBlocked:async(id,blocked)=>raw.prepare('UPDATE qmr_users_v6 SET blocked=? WHERE user_id=?').run(Number(blocked),id),now});
  const first=await boards.admin({op:'summary'},ctx);
  assert.equal(first.activity.users,1);assert.equal(first.activity.requests,4);assert.equal(first.broadcasts.draft,1);
  assert.equal(first.maintenance,false);assert.equal(first.users[0].uid,123);
  await boards.admin({op:'action',action:'maintenance',enabled:true,confirm:'CONFIRM'},ctx);
  await boards.admin({op:'action',action:'ban',uid:123,confirm:'CONFIRM'},ctx);
  const last=await boards.admin({op:'summary'},ctx);
  assert.equal(last.maintenance,true);assert.equal(last.activity.blocked,1);
  assert.deepEqual(last.events.map(x=>[x.action,x.target,x.state]),[['ban','123','applied'],['maintenance','on','applied']]);
  assert.equal((await boards.ops({},ctx)).webhook.inbox.dead,null);
 }finally{raw.close();}
});
