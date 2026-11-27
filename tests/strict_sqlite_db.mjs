// Emulate the SDK's strict read/write split, with real SQLite atomic writes.
export function strictSqliteDb(raw) {
 const tables={jobs:'qmr_notify_jobs_v13',delivery:'qmr_notify_delivery_v13',audit:'qmr_board_audit_v14'};
 const cols={attemptedMs:'attempted_ms',stepSeq:'step_seq',resolvedMs:'resolved_ms',retryAfterMs:'retry_after_ms',createdAt:'created_at'};
 const col=k=>cols[k]??k;
 const read=s=>{if(!/^\s*SELECT\b/i.test(s))throw Error('Read query looks like a write one');};
 return {
   get:async(s,p={})=>{read(s);return raw.prepare(s).get(p);},
   all:async(s,p={})=>{read(s);return raw.prepare(s).all(p);},
   run:async(s,p={})=>{if(!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(s))throw Error('not a write');return raw.prepare(s).run(p);},
   updateOne:async(kind,values,where,params)=>{
     const entries=Object.entries(values),set=entries.map(([k],i)=>col(k)+'=:v'+i).join(',');
     const args={...params};entries.forEach(([,v],i)=>args[':v'+i]=v);
     const rows=raw.prepare('UPDATE '+tables[kind]+' SET '+set+' WHERE '+where+' RETURNING *').all(args);
     if(rows.length>1)throw Error('UNVERIFIED_WRITE_RESULT');
     return rows[0]??null;
   },
   insertAudit:async(values)=>{
     const entries=Object.entries(values),args={};
     entries.forEach(([,v],i)=>args[':v'+i]=v);
     return raw.prepare('INSERT INTO qmr_board_audit_v14('+entries.map(([k])=>col(k)).join(',')+') VALUES('+entries.map((_,i)=>':v'+i).join(',')+') RETURNING *').get(args);
   }
 };
}
