// db.get/all are READ only. Returning writes use the documented builder.
// Predicates are fixed internal SQL; every parameter is bound by the SDK.
import {db} from 'sdk';
import {sql} from 'sdk/db';
import {qmrNotifyJobs,qmrNotifyDelivery,qmrBoardAudit} from 'schema';
export function boundPredicate(predicate,params) {
  const tokens=predicate.split(/(:[a-zA-Z_][a-zA-Z_0-9]*)/g);
  let result=sql.raw('');
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(i%2){
      if(!Object.hasOwn(params,t))throw Error('MISSING_SQL_PARAM');
      result=sql`${result}${params[t]}`;
    }else result=sql`${result}${sql.raw(t)}`;
  }
  return result;
}
function one(rows) {
  if(!Array.isArray(rows)||rows.length>1)throw Error('UNVERIFIED_WRITE_RESULT');
  return rows[0]??null;
}
const tables={jobs:qmrNotifyJobs,delivery:qmrNotifyDelivery,audit:qmrBoardAudit};
export const nativeDb={
 get:(statement,params={})=>db.get(statement,params),
 all:(statement,params={})=>db.all(statement,params),
 run:(statement,params={})=>db.run(statement,params),
 async updateOne(kind,values,predicate,params) {
   if(!Object.hasOwn(tables,kind))throw Error('INVALID_WRITE_TABLE');
   const row=one(await db.update(tables[kind]).set(values)
     .where(boundPredicate(predicate,params)).returning().run());
   return row&&kind==='delivery'?{user_id:row.userId}:row;
 },
 async insertAudit(values) {
   return one(await db.insert(qmrBoardAudit).values(values).returning().run());
 }
};
