import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore from '@deepseek-ai/dsh-session';
import Registry from '@deepseek-ai/dsh-session-projection';
import ProjectionCache from '@deepseek-ai/dsh-session-projection-cache';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import {snapshotJsonValue} from '@deepseek-ai/dsh-util-values';
import {createMessage,createUserMessage,createToolResultMessage,ToolCallId} from '@deepseek-ai/dsh-llm';
import {installSearchUsage,searchUsageProjection} from '../lib/search-usage.js';

// Issue 117: DSH's projection cache refuses a checkpoint whose unit state is not lossless plain JSON,
// and `snapshotJsonValue` treats a key whose value is `undefined` as a violation. These tests use the
// real DSH registry, the real storage stack and the real `dsh-session-projection-cache` service.

const usage={inputTokens:5000,cacheReadTokens:330000,cacheWriteTokens:0,outputTokens:10,totalTokens:335010};
const contextMetadata={contextDetails:{input_tokens:5022,output_tokens:571},contextProvenance:'provider-context-details'};
const auxRecord={requestId:'r1',provider:'relay',model:'gpt-search',usage:{inputTokens:20,cacheReadTokens:80,cacheWriteTokens:0,outputTokens:10,totalTokens:110}};
const header=(model='grok-test')=>({config:{provider:'relay',model},tools:[{name:'search',description:'search',parameters:{type:'object'}}]});

async function fixture(t,{cache=false}={}){
 const ctx=new Context();
 const fibers=[];
 const root=await mkdtemp(join(tmpdir(),'lcx-117-'));
 const plugins=[[SessionStore],[Registry],[TokenMeter]];
 if(cache)plugins.unshift([Storage],[StorageJson,{root}],[StorageDomain,{backend:'json'}]);
 for(const[p,c]of plugins)fibers.push(await ctx.plugin(p,c));
 fibers.push(await ctx.plugin(installSearchUsage));
 // Throttles are set high so only the mandatory points (create, turn/end, dispose) write on their own.
 if(cache)fibers.push(await ctx.plugin(ProjectionCache,{writeEveryEvents:100000,writeIntervalMs:3600000}));
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose();await rm(root,{recursive:true,force:true});});
 const session=ctx.sessions.create();
 session.append('request/header',{header:header(),reason:'initial'});
 session.append('request/context',{contextWindow:128000});
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'x'.repeat(40000)}]}),{surfaceOp:'append'});
 return{ctx,session};
}
function stream(metadata){
 const block={type:'text',text:'answer'};
 return{block,chunks:[{type:'block-start',index:0,blockType:'text'},{type:'block-end',index:0,block},{type:'usage',usage},
  {type:'finish',reason:{kind:'stop'},replayState:{response:{lcxUsage:{version:1,inputTokenScope:'aggregate',...metadata}}}}].map(chunk=>({type:'chunk',chunk,time:0}))};
}
function reply(s,turn,metadata={}){
 s.append('turn/start',{turn});s.append('step/start',{turn,step:1});
 const{block,chunks}=stream(metadata);
 s.append('assistant/message',{turn,step:1,usage,stream:chunks,
  message:createMessage({role:'assistant',source:{kind:'model',provider:'relay',model:'grok-test'},content:[block]})},{surfaceOp:'append'});
 s.append('step/end',{turn,step:1});s.append('turn/end',{turn,reason:{kind:'completed'}});
}
const rejected=value=>snapshotJsonValue(value)===undefined;
/** Every fold step must leave the unit state, and the whole registry cut, losslessly serializable. */
function assertPlainJson(ctx,session,label){
 const state=ctx.sessionProjections.stateOf(session,'lcxSearchUsage');
 assert.ok(state,`${label}: unit state exists`);
 assert.ok(!rejected(state),`${label}: lcxSearchUsage state is not plain JSON: ${JSON.stringify(Object.entries(state).filter(([,v])=>v===undefined).map(([k])=>k))}`);
 assert.ok(!rejected(ctx.sessionProjections.checkpoint(session)),`${label}: projection checkpoint is not plain JSON`);
 assert.ok(!Object.values(state).includes(undefined),`${label}: no key may hold undefined`);
 return state;
}

test('the validator DSH uses rejects an explicit undefined key (contract this fix relies on)',()=>{
 assert.ok(rejected({a:1,b:undefined}));
 assert.ok(!rejected({a:1}));
});

test('apply() omits absent keys, drops stale ones, and keeps stateSchema/view valid',()=>{
 const apply=(state,event)=>searchUsageProjection.apply(state,event);
 const init=searchUsageProjection.init();
 assert.ok(!rejected(init));
 // request/header: present header sets the key; an absent header removes the old one instead of writing undefined.
 const withHeader=apply(init,{type:'request/header',data:{header:header()}});
 assert.equal(typeof withHeader.headerKey,'string');
 const cleared=apply(withHeader,{type:'request/header',data:{header:undefined}});
 assert.equal(Object.hasOwn(cleared,'headerKey'),false);
 assert.ok(!rejected(cleared));
 // assistant/message with then without provider context.
 const message=metadata=>({type:'assistant/message',data:{turn:1,step:1,usage,stream:stream(metadata).chunks}});
 const sampled=apply(withHeader,message(contextMetadata));
 assert.deepEqual(sampled.contextDetails,contextMetadata.contextDetails);
 assert.equal(sampled.contextProvenance,'provider-context-details');
 assert.equal(sampled.sampleHeaderKey,withHeader.headerKey);
 assert.ok(!rejected(sampled));
 const erased=apply(sampled,message({}));
 for(const key of['contextDetails','contextProvenance','sampleHeaderKey'])assert.equal(Object.hasOwn(erased,key),false,key);
 assert.equal(erased.headerKey,withHeader.headerKey,'the current header key survives; only the sample is erased');
 assert.ok(!rejected(erased));
 // Sample while no header is known: sampleHeaderKey is omitted, not undefined.
 const noHeader=apply(init,message(contextMetadata));
 assert.equal(Object.hasOwn(noHeader,'sampleHeaderKey'),false);
 assert.ok(!rejected(noHeader));
 // The persisted-state schema and the wire view accept every produced shape.
 for(const state of[init,withHeader,cleared,sampled,erased,noHeader]){
  searchUsageProjection.stateSchema.parse(state);
  const view=searchUsageProjection.wire.view(state);
  searchUsageProjection.wire.viewSchema.parse(view);
  assert.ok(!rejected(view));
  assert.deepEqual(Object.keys(view).sort(),['aggregateContext','auxiliary',...(state.contextDetails?['contextDetails','contextProvenance']:[])].sort());
 }
});

test('every step of a real event sequence leaves a plain-JSON unit state and checkpoint',async t=>{
 const{ctx,session}=await fixture(t);
 let state=assertPlainJson(ctx,session,'request/header');
 assert.equal(typeof state.headerKey,'string');
 reply(session,1);
 state=assertPlainJson(ctx,session,'assistant/message without provider context');
 for(const key of['contextDetails','contextProvenance','sampleHeaderKey'])assert.equal(Object.hasOwn(state,key),false,key);
 reply(session,2,contextMetadata);
 state=assertPlainJson(ctx,session,'assistant/message with provider context');
 assert.deepEqual(state.contextDetails,contextMetadata.contextDetails);
 assert.equal(state.contextProvenance,'provider-context-details');
 assert.equal(state.sampleHeaderKey,state.headerKey);
 session.append('tool/call',{turn:3,step:1,callId:ToolCallId('search-call'),name:'web_search',arguments:'{}'});
 state=assertPlainJson(ctx,session,'tool/call');
 assert.deepEqual(Object.keys(state.pending),['search-call']);
 session.append('tool/result',{turn:3,step:1,meta:{auxiliaryUsage:[auxRecord,auxRecord]},
  message:createToolResultMessage({callId:ToolCallId('search-call'),content:[],isError:false})},{surfaceOp:'append'});
 state=assertPlainJson(ctx,session,'tool/result');
 assert.deepEqual(state.pending,{});
 assert.deepEqual(state.auxiliary,{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0},'duplicate auxiliary record is counted once');
 session.append('turn/end',{turn:3,reason:{kind:'completed'}});
 assertPlainJson(ctx,session,'turn/end');
 // A later header switch keeps the old sample, but it no longer matches the new header key.
 session.append('request/header',{header:header('other'),reason:'model-switch'});
 state=assertPlainJson(ctx,session,'request/header after a sample');
 assert.notEqual(state.sampleHeaderKey,state.headerKey);
 // Failed attempts never carry a sample: the previous one is replaced by nothing.
 session.append('assistant/attempt',{turn:4,step:1,stream:[{type:'chunk',time:0,chunk:{type:'usage',usage}},
  {type:'chunk',time:0,chunk:{type:'finish',reason:{kind:'error',failure:{code:'fixture',message:'fixture'}},replayState:{response:{lcxUsage:{version:1,inputTokenScope:'aggregate',...contextMetadata}}}}}]});
 state=assertPlainJson(ctx,session,'assistant/attempt');
 for(const key of['contextDetails','contextProvenance','sampleHeaderKey'])assert.equal(Object.hasOwn(state,key),false,key);
 // A cold fold of the whole log reaches the identical plain-JSON state.
 const restored=ctx.sessionProjections.restore({},[...session.snapshotEvents()],0,session.header,session.inheritedEventCount);
 assert.ok(!rejected(restored.checkpoint));
 assert.deepEqual(restored.snapshot.values.lcxSearchUsage,ctx.sessionProjections.snapshot(session).values.lcxSearchUsage);
});

test('the real projection cache persists the checkpoint and reads it back identically',async t=>{
 const{ctx,session}=await fixture(t,{cache:true});
 assert.ok(ctx.sessionProjectionCache,'real session projection cache service is mounted');
 // Provider-context sample present at the cut.
 reply(session,1,contextMetadata);
 await ctx.sessionProjectionCache.write(session); // not fail-soft: rejects on a non-JSON unit state
 let cached=ctx.sessionProjectionCache.cachedSnapshot(session.header,['lcxSearchUsage']);
 assert.ok(cached,'checkpoint row was persisted');
 let live=ctx.sessionProjections.snapshot(session).values.lcxSearchUsage;
 assert.deepEqual(cached.values.lcxSearchUsage,live);
 assert.equal(cached.values.lcxSearchUsage.contextProvenance,'provider-context-details');
 // Sample erased by the next reply, plus a search tool round-trip.
 reply(session,2);
 session.append('tool/call',{turn:3,step:1,callId:ToolCallId('search-call'),name:'web_search',arguments:'{}'});
 session.append('tool/result',{turn:3,step:1,meta:{auxiliaryUsage:[auxRecord]},
  message:createToolResultMessage({callId:ToolCallId('search-call'),content:[],isError:false})},{surfaceOp:'append'});
 session.append('turn/end',{turn:3,reason:{kind:'completed'}});
 await ctx.sessionProjectionCache.write(session);
 cached=ctx.sessionProjectionCache.cachedSnapshot(session.header,['lcxSearchUsage']);
 live=ctx.sessionProjections.snapshot(session).values.lcxSearchUsage;
 assert.deepEqual(cached.values.lcxSearchUsage,live);
 assert.equal(cached.values.lcxSearchUsage.contextDetails,undefined);
 assert.deepEqual(cached.values.lcxSearchUsage.auxiliary,{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0});
 // The cold path seeds from the persisted row (identity-checked) and agrees with a fold from scratch.
 const events=[...session.snapshotEvents()];
 const record=ctx.sessionProjectionCache.recordFor(session.id,{formatVersion:session.header.version,createdAt:session.header.createdAt,
  ...(session.header.cwd===undefined?{}:{cwd:session.header.cwd}),isSeeded:session.header.isSeeded,inheritedEventCount:session.inheritedEventCount});
 assert.ok(record?.rows.lcxSearchUsage,'row is present for the lcxSearchUsage unit');
 assert.equal(record.rows.lcxSearchUsage.ver,searchUsageProjection.stateVersion);
 const cold=ctx.sessionProjectionCache.coldSnapshot(session.header,session.inheritedEventCount,events);
 assert.deepEqual(cold.values.lcxSearchUsage,live);
});

test('the automatic write points (create, turn/end) persist without a warning',async t=>{
 const{ctx,session}=await fixture(t,{cache:true});
 reply(session,1);
 const seq=session.snapshotEvents().at(-1).seq;
 const deadline=Date.now()+5000;
 let cached;
 // turn/end triggers a fail-soft background write; poll until its row covers the final event.
 while(Date.now()<deadline){
  cached=ctx.sessionProjectionCache.cachedSnapshot(session.header,['lcxSearchUsage']);
  if(cached&&cached.asOfSeq>=seq)break;
  await new Promise(r=>setTimeout(r,20));
 }
 assert.ok(cached&&cached.asOfSeq>=seq,`turn/end checkpoint reached seq ${seq}, got ${cached?.asOfSeq}`);
 assert.deepEqual(cached.values.lcxSearchUsage,ctx.sessionProjections.snapshot(session).values.lcxSearchUsage);
});
