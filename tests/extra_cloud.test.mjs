import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIPv4,selectExtra,selectSnapshot,extraPage,qualityUnavailable,getExtraNodes} from '../tgcloud/lib/extra_cloud.js';
const now=Date.parse('2026-11-27T12:00:00Z'),stamp=new Date(now-3600000).toISOString();
const nodes=Array.from({length:20},(_,i)=>({server:'8.8.8.'+(i+1),ip:'8.8.8.'+(i+1),port:443,secret:'abcdef1234567890'.repeat(2),rtt_ms:20+i,uptime:.99,checks:100,asn:Math.floor(i/4),country:'US'}));
test('private and special addresses excluded',()=>{for(const x of ['127.0.0.1','10.1.1.1','192.168.1.1','100.64.0.1','198.18.1.1','203.0.113.1','192.0.2.1','224.1.1.1','001.2.3.4'])assert.equal(publicIPv4(x),false);assert.equal(publicIPv4('8.8.8.8'),true);});
test('fresh source filters invalid data and deduplicates',()=>{const r=selectExtra([...nodes,{...nodes[0],ip:'127.0.0.1'},{...nodes[0],port:0}],nodes,stamp,now);assert.equal(r.nodes.length,20);assert.equal(r.stale,false);assert.equal(selectExtra(nodes,[],new Date(now-100*3600000).toISOString(),now),null);});
test('fallback snapshot clearly reports stale and clamps page',()=>{const r=selectSnapshot({schema:'qmr-extra-v1',nodes,updated_at:'2026-11-16T00:00:00Z'},now);assert.equal(r.stale,true);assert.match(extraPage(r,2.9).text,/2\/2/);assert.match(extraPage(r,Infinity).text,/1\/2/);assert.match(extraPage(r,1).text,/قديمة/);});
test('source outage leaves empty fallback, not fake quality',async()=>{const r=await getExtraNodes(async()=>{throw Error('offline')},now);assert.equal(r.nodes.length,0);assert.match(qualityUnavailable().text,/لا يوجد قياس/);});
