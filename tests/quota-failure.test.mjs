import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchJsonWithRetry,fetchSseWithRetry} from '../lib/transport.js';
import {managedFailure} from '../lib/responses-stream.js';

test('structured quota errors override generic auth without retaining billing payload or retrying',async()=>{
 const original=globalThis.fetch;
 try{
  for(const request of [fetchJsonWithRetry,fetchSseWithRetry]){
   for(const status of [403,429]){
    for(const code of ['insufficient_user_quota','insufficient_quota']){
     let calls=0;
     globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code,message:'private account balance 12345 secret'}}),{status});};
     await assert.rejects(request('https://example.invalid/v1/responses',{}, {},undefined,1000,{maxAttempts:3}),e=>{
      const failure=managedFailure(e);
      assert.equal(failure.code,'INSUFFICIENT_QUOTA');assert.equal(failure.status,status);
      assert.doesNotMatch(JSON.stringify(failure)+String(e),/12345|secret/);
      return true;
     });assert.equal(calls,1);
    }
   }
  }
 }finally{globalThis.fetch=original;}
});

test('unknown or message-only 403 stays auth; quota text alone cannot reclassify',async()=>{
 const original=globalThis.fetch;
 try{
  for(const body of ['not JSON',JSON.stringify({error:{code:'invalid_api_key',message:'insufficient_quota'}}),JSON.stringify({error:{message:'quota exceeded'}})]){
   globalThis.fetch=async()=>new Response(body,{status:403});
   await assert.rejects(fetchSseWithRetry('https://example.invalid/v1/responses',{}, {},undefined,1000),e=>{assert.equal(managedFailure(e).code,'AUTH');return true;});
  }
 }finally{globalThis.fetch=original;}
});
