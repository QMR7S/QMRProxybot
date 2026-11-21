import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerCallbackAllowed} from '../tgcloud/lib/owner_callback_guard.js';
const owner=6246913670;
const good={from:{id:owner},message:{chat:{id:owner,type:'private'}}};
const isOwner=uid=>uid===owner;
test('real owner in matching private chat permitted',()=>{
  assert.equal(ownerCallbackAllowed(good,isOwner),true);
});
test('same owner from group and supergroup denied',()=>{
  for(const type of ['group','supergroup','channel']){
    const q={...good,message:{chat:{id:-100123,type}}};
    assert.equal(ownerCallbackAllowed(q,isOwner),false,type);
  }
});
test('group callback forging owner chat ID denied',()=>{
  assert.equal(ownerCallbackAllowed({...good,message:{chat:{id:owner,type:'group'}}},isOwner),false);
});
test('forged owner callback in another private chat denied',()=>{
  assert.equal(ownerCallbackAllowed({...good,message:{chat:{id:owner+1,type:'private'}}},isOwner),false);
});
test('non-owner is denied even from their own private chat',()=>{
  const q={from:{id:123},message:{chat:{id:123,type:'private'}}};
  assert.equal(ownerCallbackAllowed(q,isOwner),false);
});
test('missing/malformed callback fields denied',()=>{
  for(const q of [null,{}, {from:{id:owner}}, {...good,message:{chat:{type:'private'}}},
    {...good,from:{id:'not-an-id'}}, {...good,message:{chat:{id:owner,type:null}}}])
    assert.equal(ownerCallbackAllowed(q,isOwner),false);
});
test('missing or broken owner predicate denied',()=>{
  assert.equal(ownerCallbackAllowed(good,null),false);
  assert.equal(ownerCallbackAllowed(good,()=>1),false);
});
