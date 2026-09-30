import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Context,Service} from '@deepseek-ai/cordis';
import SessionStore,{Session} from '@deepseek-ai/dsh-session';
import Registry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic';
import {LlmAdapter,createMessage,createUserMessage,createToolResultMessage,ToolCallId} from '@deepseek-ai/dsh-llm';
import {deriveTurnTokenUsage} from '@deepseek-ai/dsh-token-meter/client';
import {installSearchUsage,installSearchMeasurement} from '../lib/search-usage.js';
import {aggregateContextOf,auxiliaryUsageOf,addTurnUsage,mergeBuckets} from '../lib/search-accounting.js';
import adapterOff,{disableSearchMeasurement} from '../qa/issue-62/adapter-off.mjs';

import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Llm from '@deepseek-ai/dsh-llm';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collect,grokHarness,sseResponse,user} from './grok-fixture.mjs';

const u={inputTokens:5000,cacheReadTokens:330000,cacheWriteTokens:0,outputTokens:10,totalTokens:335010};
const record={requestId:'r1',provider:'relay',model:'gpt-search',usage:{inputTokens:20,cacheReadTokens:80,cacheWriteTokens:0,outputTokens:10,totalTokens:110}};
const toolCall=()=>({type:'tool/call',data:{turn:1,step:1,callId:ToolCallId('search-call'),name:'web_search',arguments:'{}'}});
const toolEvent=()=>({type:'tool/result',data:{turn:1,step:1,meta:{auxiliaryUsage:[record,record]},message:createToolResultMessage({callId:ToolCallId('search-call'),content:[],isError:false})}});
async function fixture(t){
 const ctx=new Context();
 const fibers=[];
 for(const p of [SessionStore,Registry,TokenMeter])fibers.push(await ctx.plugin(p));
 const baseline=ctx.tokenMeter.measure;
 const plugin=await ctx.plugin(installSearchUsage);fibers.push(plugin);
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose();});
 const session=ctx.sessions.create();
 session.append('request/header',{header:{config:{provider:'relay',model:'grok-test'},tools:[{name:'search',description:'search',parameters:{type:'object'}}]},reason:'initial'});
 session.append('request/context',{contextWindow:128000});
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'x'.repeat(40000)}]}),{surfaceOp:'append'});
 return{ctx,session,plugin,baseline};
}
function reply(s,scope='aggregate',turn=1,usage=u,metadata={}){
 s.append('turn/start',{turn});s.append('step/start',{turn,step:1});
 const block={type:'text',text:'answer'};
 const stream=[{type:'block-start',index:0,blockType:'text'},{type:'block-end',index:0,block},
 {type:'usage',usage},{type:'finish',reason:{kind:'stop'},replayState:{response:{lcxUsage:{version:1,inputTokenScope:scope,...metadata}}}}].map(chunk=>({type:'chunk',chunk,time:0}));
 s.append('assistant/message',{turn,step:1,usage,stream,message:createMessage({role:'assistant',source:{kind:'model',provider:'relay',model:'grok-test'},content:[block]})},{surfaceOp:'append'});
 s.append('step/end',{turn,step:1});s.append('turn/end',{turn,reason:{kind:'completed'}});
}
test('integration runs against the untouched official token-meter artifact',()=>{
 const digest=createHash('sha256').update(readFileSync(new URL('../node_modules/@deepseek-ai/dsh-token-meter/lib/index.js',import.meta.url))).digest('hex');
 assert.equal(digest,'39ed60a470b240f8bbc82befdb0bbbad1f409732e8ba8d12d41a1059de0dde05');
});
test('plugin-only aggregate pressure correction preserves exact billing and cold restore',async t=>{
 const{ctx,session}=await fixture(t);reply(session);
 const measure=ctx.tokenMeter.measure(session);
 assert.ok(measure.totalTokens<12000);assert.equal(measure.baseline.kind,'estimated');
 const values=ctx.sessionProjections.snapshot(session).values;
 assert.equal(values.tokenUsage.cacheReadTokens,330000);
 assert.equal(values.lcxSearchUsage.aggregateContext,true);
 const restored=Session.fromRestore(session.id,[...session.snapshotEvents()],session.header,session.inheritedEventCount,'shared-frozen');
 assert.equal(ctx.tokenMeter.measure(restored).totalTokens,measure.totalTokens);
 assert.deepEqual(ctx.sessionProjections.snapshot(restored).values,values);
 assert.equal('inputTokenScope' in u,false);
});
const contextMetadata={contextDetails:{input_tokens:5022,output_tokens:571},contextProvenance:'provider-context-details'};
const buildUsage={inputTokens:6003,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:711,totalTokens:6714};
test('complete provider context uses input only and official signed delta, even below the heuristic anchor',async t=>{
 const{ctx,session,baseline}=await fixture(t);
 reply(session,'aggregate',1,buildUsage,contextMetadata);
 const official=baseline.call(ctx.tokenMeter,session),measured=ctx.tokenMeter.measure(session);
 assert.equal(official.baseline.kind,'estimated','wire billing is smaller than the retained surface estimate');
 assert.equal(measured.baseline.kind,'estimated');
 assert.equal(measured.baseline.tokens,5022);
 assert.equal(measured.surfaceDeltaTokens,official.surfaceDeltaTokens);
 assert.equal(measured.totalTokens,Math.max(0,5022+official.surfaceDeltaTokens));
 const initial=ctx.sessionProjections.snapshot(session).values;
 assert.equal(initial.lcxSearchUsage.contextProvenance,'provider-context-details');
 assert.deepEqual(initial.lcxSearchUsage.contextDetails,contextMetadata.contextDetails);
 assert.deepEqual(initial.tokenUsage,{uncachedInputTokens:6003,outputTokens:711,cacheReadTokens:0,cacheWriteTokens:0});
 const events=[...session.snapshotEvents()];
 const requestEvents=structuredClone(events);
 requestEvents.find(e=>e.type==='assistant/message').data.stream.find(e=>e.chunk?.type==='finish').chunk.replayState.response.lcxUsage.inputTokenScope='request';
 const requestSession=Session.fromRestore(session.id,requestEvents,session.header,session.inheritedEventCount,'shared-frozen');
 assert.deepEqual(deriveTurnTokenUsage(events.filter(e=>e.data?.turn===1)),deriveTurnTokenUsage(requestEvents.filter(e=>e.data?.turn===1)));
 assert.deepEqual(ctx.tokenMeter.measure(requestSession),baseline.call(ctx.tokenMeter,requestSession));
 assert.deepEqual(events.find(e=>e.type==='assistant/message').data.usage,buildUsage);
 const assertCold=()=>{
  const cold=Session.fromRestore(session.id,[...session.snapshotEvents()],session.header,session.inheritedEventCount,'shared-frozen');
  const warmMeasure=ctx.tokenMeter.measure(session);
  assert.deepEqual({...ctx.tokenMeter.measure(cold),logRevision:warmMeasure.logRevision},warmMeasure);
  assert.deepEqual(ctx.sessionProjections.snapshot(cold).values,ctx.sessionProjections.snapshot(session).values);
  const checkpoint=ctx.sessionProjections.checkpoint(session);
  const restored=ctx.sessionProjections.restore(checkpoint,[...session.snapshotEvents()],0,session.header,session.inheritedEventCount);
  assert.deepEqual(restored.snapshot.values.lcxSearchUsage,ctx.sessionProjections.snapshot(session).values.lcxSearchUsage);
 };
 assertCold();
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'growth'.repeat(100)}]}),{surfaceOp:'append'});
 const grown=ctx.tokenMeter.measure(session);
 assert.ok(grown.surfaceDeltaTokens>0);
 assert.equal(grown.totalTokens,5022+baseline.call(ctx.tokenMeter,session).surfaceDeltaTokens);
 assertCold();
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'summary'}]}),
  {surfaceOp:{op:'replace',startSeq:grown.nodes[0].seq,endSeq:grown.nodes.at(-1).seq},sourceEventSeqs:grown.nodes.map(n=>n.seq)});
 const pruned=ctx.tokenMeter.measure(session);
 assert.ok(pruned.surfaceDeltaTokens<0);
 assert.equal(pruned.totalTokens,Math.max(0,5022+baseline.call(ctx.tokenMeter,session).surfaceDeltaTokens));
 assert.equal(pruned.totalTokens,0,'signed delta clamps at zero');
 assertCold();
 assert.deepEqual(ctx.sessionProjections.snapshot(session).values.tokenUsage,initial.tokenUsage);
 const switched={config:{provider:'other',model:'other'},tools:[]};
 assert.deepEqual(ctx.tokenMeter.measure(session,switched),baseline.call(ctx.tokenMeter,session,switched));
 // A later aggregate response without complete context must erase the old sample.
 reply(session,'aggregate',2,u);
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,ctx.tokenMeter.measure(session).surfaceTokens+Math.ceil(JSON.stringify(session.requestHeader().tools).length/4)+4);
 assert.equal(ctx.sessionProjections.snapshot(session).values.lcxSearchUsage.contextProvenance,undefined);
});
for(const details of [undefined,{}, {input_tokens:5022}, {output_tokens:571}, {input_tokens:-1,output_tokens:571},
 {input_tokens:1.5,output_tokens:571}, {input_tokens:'5022',output_tokens:571}, {input_tokens:5022,output_tokens:null},
 {input_tokens:5022,output_tokens:Number.MAX_SAFE_INTEGER+1}]) {
 test(`incomplete/invalid context retains the merged aggregate fallback: ${JSON.stringify(details)}`,async t=>{
  const{ctx,session}=await fixture(t);reply(session,'aggregate',1,u,{...(details===undefined?{}:{contextDetails:details}),contextProvenance:'provider-context-details'});
  const measured=ctx.tokenMeter.measure(session);
  assert.equal(measured.baseline.kind,'estimated');
  assert.equal(measured.surfaceDeltaTokens,0);
  assert.equal(measured.totalTokens,measured.surfaceTokens+Math.ceil(JSON.stringify(session.requestHeader().tools).length/4)+4);
  assert.equal(ctx.sessionProjections.snapshot(session).values.lcxSearchUsage.contextProvenance,undefined);
 });
}
test('zero complete context qualifies with a usage anchor and does not add output or tool tokens',async t=>{
 const{ctx,session,baseline}=await fixture(t);reply(session,'aggregate',1,u,{contextDetails:{input_tokens:0,output_tokens:571},contextProvenance:'provider-context-details'});
 assert.equal(baseline.call(ctx.tokenMeter,session).baseline.kind,'usage');
 assert.equal(ctx.tokenMeter.measure(session).baseline.tokens,0);
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,0);
});
test('native terminal event restores provider pressure through actual DSH settlement and retains exact Turn billing',async t=>{
 const{ctx,session,baseline}=await fixture(t);
 t.mock.method(globalThis,'fetch',async()=>sseResponse([{type:'response.completed',response:{
  id:'resp_context_integration',model:'grok-4.6',status:'completed',
  output:[{type:'message',id:'msg_context_integration',role:'assistant',status:'completed',content:[{type:'output_text',text:'done',annotations:[]}]}],
  usage:{input_tokens:6003,output_tokens:711,total_tokens:6714,context_details:{input_tokens:5022,output_tokens:571},num_server_side_tools_used:1},
 }}]));
 const h=grokHarness({nativeWeb:true});
 const chunks=await collect(h.stream({provider:'xai',model:'grok-4.6',sessionId:'context-fixture',messages:[user('fixture')],tools:[]},()=>{throw new Error('Unexpected adapter');}));
 const usage=chunks.find(c=>c.type==='usage').usage;
 assert.deepEqual(usage,buildUsage);
 session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1});
 session.append('assistant/message',{turn:1,step:1,usage,stream:chunks.map(chunk=>({type:'chunk',chunk,time:0})),
  message:createMessage({role:'assistant',source:{kind:'model',provider:'relay',model:'grok-test'},content:[{type:'text',text:'done'}]})},{surfaceOp:'append'});
 session.append('step/end',{turn:1,step:1});session.append('turn/end',{turn:1,reason:{kind:'completed'}});
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,5022+baseline.call(ctx.tokenMeter,session).surfaceDeltaTokens);
 const events=[...session.snapshotEvents()],cold=Session.fromRestore(session.id,events,session.header,session.inheritedEventCount,'shared-frozen');
 assert.equal(ctx.tokenMeter.measure(cold).totalTokens,ctx.tokenMeter.measure(session).totalTokens);
 assert.equal(ctx.sessionProjections.snapshot(cold).values.lcxSearchUsage.contextProvenance,'provider-context-details');
 const ordinary=structuredClone(events);
 delete ordinary.find(e=>e.type==='assistant/message').data.stream.find(e=>e.chunk?.type==='finish').chunk.replayState.response.lcxUsage;
 const ordinarySession=Session.fromRestore(session.id,ordinary,session.header,session.inheritedEventCount,'shared-frozen');
 assert.deepEqual(ctx.sessionProjections.snapshot(cold).values.tokenUsage,ctx.sessionProjections.snapshot(ordinarySession).values.tokenUsage);
 assert.deepEqual(deriveTurnTokenUsage(events.filter(e=>e.data?.turn===1)),deriveTurnTokenUsage(ordinary.filter(e=>e.data?.turn===1)));
 // Failed attempts do not replace the host measurement anchor with their sample.
 session.append('assistant/attempt',{turn:2,step:1,stream:[{type:'chunk',time:0,chunk:{type:'usage',usage:u}},
  {type:'chunk',time:0,chunk:{type:'finish',reason:{kind:'error',failure:{code:'fixture',message:'fixture'}},replayState:{response:{lcxUsage:{version:1,inputTokenScope:'aggregate',...contextMetadata}}}}}]});
 assert.equal(ctx.sessionProjections.snapshot(session).values.lcxSearchUsage.contextDetails,undefined);
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,baseline.call(ctx.tokenMeter,session).totalTokens);
});
test('Issue 62 aggregate Grok counters preserve DSH billing while pressure tracks retained context',async t=>{
 const{ctx,session,baseline}=await fixture(t);
 session.append('request/context',{contextWindow:262144});
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'p'.repeat(620000)}]}),{surfaceOp:'append'});
 const prior=ctx.tokenMeter.measure(session);
 assert.ok(prior.totalTokens>160000 && prior.totalTokens<170000,`prior context ${prior.totalTokens}`);
 const aggregate={inputTokens:5713,cacheReadTokens:334720,cacheWriteTokens:0,outputTokens:1352,totalTokens:341785};
 reply(session,'aggregate',1,aggregate);
 const official=baseline.call(ctx.tokenMeter,session),adapted=ctx.tokenMeter.measure(session);
 assert.equal(official.baseline.kind,'usage');
 assert.equal(official.baseline.tokens,341785);
 assert.equal(official.totalTokens,341785);
 assert.deepEqual(official.baseline.usage,aggregate);
 assert.equal(adapted.baseline.kind,'estimated');
 assert.equal(adapted.totalTokens,adapted.surfaceTokens+Math.ceil(JSON.stringify(session.requestHeader().tools).length/4)+4);
 assert.ok(adapted.totalTokens<262144);
 assert.ok(adapted.totalTokens>=prior.totalTokens);
 const before=ctx.sessionProjections.snapshot(session).values;
 for(const [key,value] of Object.entries({uncachedInputTokens:5713,outputTokens:1352,cacheReadTokens:334720,cacheWriteTokens:0}))
  assert.equal(before.tokenUsage[key],value,key);
 assert.equal(before.contextPressure.pressureTokens,340433);
 const turnEvents=[...session.snapshotEvents()].filter(event=>event.data?.turn===1);
 const turn=deriveTurnTokenUsage(turnEvents);
 for(const [key,value] of Object.entries({uncachedInputTokens:5713,outputTokens:1352,cacheReadTokens:334720,cacheWriteTokens:0,totalTokens:341785}))
  assert.equal(turn[key],value,key);
 assert.deepEqual(ctx.sessionProjections.snapshot(session).values.tokenUsage,before.tokenUsage);
 const cold=Session.fromRestore(session.id,[...session.snapshotEvents()],session.header,session.inheritedEventCount,'shared-frozen');
 const coldMeasure=ctx.tokenMeter.measure(cold);
 assert.deepEqual({...coldMeasure,logRevision:adapted.logRevision},adapted);
 assert.deepEqual(ctx.sessionProjections.snapshot(cold).values.tokenUsage,before.tokenUsage);
 const nodes=adapted.nodes;
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'retained summary'}]}),
  {surfaceOp:{op:'replace',startSeq:nodes[0].seq,endSeq:nodes.at(-1).seq},sourceEventSeqs:nodes.map(node=>node.seq)});
 const pruned=ctx.tokenMeter.measure(session);
 assert.equal(pruned.baseline.kind,'estimated');
 assert.ok(pruned.totalTokens<adapted.totalTokens/10);
 assert.deepEqual(ctx.sessionProjections.snapshot(session).values.tokenUsage,before.tokenUsage);
});
test('aggregate estimate retains official image, file and tool surface prices',async t=>{
 const{ctx,session,baseline}=await fixture(t);reply(session);
 const before=ctx.tokenMeter.measure(session);
 const image={attachmentId:'sha256:fixture',bytes:1000,mediaType:'image/png',width:1024,height:1024};
 const file={attachmentId:'sha256:file-fixture',name:'notes.txt',bytes:1000,mediaType:'text/plain'};
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'image',attachment:image},{type:'file',attachment:file}]}),{surfaceOp:'append'});
 const official=baseline.call(ctx.tokenMeter,session),adapted=ctx.tokenMeter.measure(session);
 assert.equal(adapted.baseline.kind,'estimated');
 assert.equal(adapted.surfaceTokens,official.surfaceTokens);
 assert.deepEqual(adapted.nodes,official.nodes);
 assert.ok(adapted.surfaceTokens>before.surfaceTokens);
 assert.equal(adapted.totalTokens,adapted.surfaceTokens+Math.ceil(JSON.stringify(session.requestHeader().tools).length/4)+4);
});
test('missing or corrupt scope marker leaves DSH usage baseline and billing intact',async t=>{
 const{ctx,session,baseline}=await fixture(t);reply(session);
 for(const marker of [undefined,{version:99,inputTokenScope:'aggregate'},{version:1,inputTokenScope:'broken'}]){
  const events=structuredClone([...session.snapshotEvents()]);
  const answer=events.find(event=>event.type==='assistant/message');
  const finish=answer.data.stream.find(item=>item.chunk?.type==='finish').chunk;
  finish.replayState={response:marker===undefined?{}:{lcxUsage:marker},grokNative:{kind:'xai-responses-native-search',version:3}};
  const restored=Session.fromRestore(session.id,events,session.header,session.inheritedEventCount,'shared-frozen');
  assert.deepEqual(ctx.tokenMeter.measure(restored),baseline.call(ctx.tokenMeter,restored));
  assert.equal(ctx.sessionProjections.snapshot(restored).values.lcxSearchUsage.aggregateContext,false);
  assert.equal(ctx.sessionProjections.snapshot(restored).values.tokenUsage.cacheReadTokens,u.cacheReadTokens);
  assert.equal(deriveTurnTokenUsage([...restored.snapshotEvents()].filter(event=>event.data?.turn===1)).totalTokens,u.totalTokens);
 }
});
test('context growth crosses threshold; real compaction surface replacement reduces it',async t=>{
 const{ctx,session}=await fixture(t);reply(session);
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'x'.repeat(520000)}]}),{surfaceOp:'append'});
 const before=ctx.tokenMeter.measure(session);assert.ok(before.totalTokens>128000);
 const start=before.nodes[0].seq,end=before.nodes.at(-1).seq;
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'summary'}]}),{surfaceOp:{op:'replace',startSeq:start,endSeq:end},sourceEventSeqs:before.nodes.map(n=>n.seq)});
 assert.ok(ctx.tokenMeter.measure(session).totalTokens<100);
});
test('ordinary calls and switched request envelopes retain official calibration',async t=>{
 const{ctx,session}=await fixture(t);reply(session,'request');
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,335010);
 reply(session,'aggregate',2);
 const header={config:{provider:'other',model:'deepseek-chat'},tools:[]};
 const value=ctx.tokenMeter.measure(session,header);
 assert.equal(value.baseline.kind,'estimated');
 reply(session,'request',3);
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,335010);
 assert.equal(ctx.sessionProjections.snapshot(session).values.lcxSearchUsage.aggregateContext,false);
});
test('owned auxiliary metadata is separate from prompt pressure and persists across projection cache restore',async t=>{
 const{ctx,session}=await fixture(t);reply(session,'request');
 const before=ctx.tokenMeter.measure(session).totalTokens;
 assert.equal(ctx.tokenMeter.estimateMessage(createToolResultMessage({callId:ToolCallId('search-call'),content:[],isError:false})),4);
 const call=toolCall();session.append(call.type,call.data);
 const e=toolEvent();session.append(e.type,e.data,{surfaceOp:'append'});
 const values=ctx.sessionProjections.snapshot(session).values;
 assert.equal(values.tokenUsage.uncachedInputTokens,5000);
 assert.deepEqual(values.lcxSearchUsage.auxiliary,{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0});
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,before+4);
 assert.equal(mergeBuckets(values.tokenUsage,values.lcxSearchUsage.auxiliary).cacheReadTokens,330080);
 const checkpoint=ctx.sessionProjections.checkpoint(session);
 const restored=ctx.sessionProjections.restore(checkpoint,[...session.snapshotEvents()],0,session.header,session.inheritedEventCount);
 assert.deepEqual(restored.snapshot.values.lcxSearchUsage,values.lcxSearchUsage);
});
test('media presentation metadata is token, context-pressure and compaction-input invariant',async t=>{
 const{ctx,session}=await fixture(t);reply(session,'request');
 const call=toolCall();session.append(call.type,call.data);
 const result=toolEvent();session.append(result.type,result.data,{surfaceOp:'append'});
 const baseEvents=[...session.snapshotEvents()];
 const mediaEvents=structuredClone(baseEvents);
 const mediaResult=mediaEvents.find(event=>event.type==='tool/result');
 mediaResult.data.meta.mediaCandidates=[{kind:'image',url:'https://images.example.com/full',sourceUrl:'https://example.com/source',structured:true}];
 const plain=Session.fromRestore(session.id,baseEvents,session.header,session.inheritedEventCount,'shared-frozen');
 const media=Session.fromRestore(session.id,mediaEvents,session.header,session.inheritedEventCount,'shared-frozen');
 const plainMeasure=ctx.tokenMeter.measure(plain),mediaMeasure=ctx.tokenMeter.measure(media);
 assert.deepEqual(mediaMeasure,plainMeasure,'Basic compaction receives the token-meter measurement');
 const plainValues=ctx.sessionProjections.snapshot(plain).values,mediaValues=ctx.sessionProjections.snapshot(media).values;
 for(const key of ['tokenUsage','contextPressure','contextBreakdown','lcxSearchUsage'])
  assert.deepEqual(mediaValues[key],plainValues[key],key);
 assert.equal(JSON.stringify(mediaResult.data.message),JSON.stringify(result.data.message),'model-facing tool output changed');
});

test('plugin disposal restores official measure and removes owned projection',async t=>{
 const{ctx,session,plugin,baseline}=await fixture(t);reply(session);
 assert.ok(ctx.tokenMeter.measure(session).totalTokens<12000);
 await plugin.dispose();
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,335010);
 assert.equal(ctx.sessionProjections.snapshot(session).values.lcxSearchUsage,undefined);
});
test('QA-only overlay toggles official measurement on the same product code and leaves billing fixed',async t=>{
 const{ctx,session}=await fixture(t);reply(session);
 const on=ctx.tokenMeter.measure(session),usage=ctx.sessionProjections.snapshot(session).values.tokenUsage;
 const restore=disableSearchMeasurement(ctx.tokenMeter),restoreAgain=disableSearchMeasurement(ctx.tokenMeter);
 restoreAgain();restoreAgain();
 assert.equal(ctx.tokenMeter.measure(session).baseline.kind,'usage');
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,u.totalTokens);
 assert.deepEqual(ctx.sessionProjections.snapshot(session).values.tokenUsage,usage);
 restore();
 assert.deepEqual(ctx.tokenMeter.measure(session),on);
});
test('usage readers reject foreign tools, invalid sums and unknown scope versions',()=>{
 assert.equal(auxiliaryUsageOf(toolEvent(),'web_search').length,1);
 assert.deepEqual(auxiliaryUsageOf(toolEvent(),'foreign'),[]);
 assert.deepEqual(auxiliaryUsageOf(toolEvent()),[]);
 const invalid=toolEvent();invalid.data.meta.auxiliaryUsage=[{...record,usage:{...record.usage,totalTokens:111}}];
 assert.deepEqual(auxiliaryUsageOf(invalid,'web_search'),[]);
 assert.equal(aggregateContextOf({type:'assistant/message',data:{usage:u,stream:[{type:'chunk',chunk:{type:'finish',replayState:{response:{lcxUsage:{version:99,inputTokenScope:'aggregate'}}}}}]}}),false);
});
test('per-turn merge adds search once while respecting missing main-call disclosures',()=>{
 const events=[{type:'turn/start',data:{turn:1}},{type:'step/start',data:{turn:1,step:1}},
 {type:'assistant/message',data:{turn:1,step:1,usage:u,stream:[],message:{source:{provider:'relay',model:'gpt-main'}}}},
 toolEvent(),{type:'step/end',data:{turn:1,step:1}},{type:'turn/end',data:{turn:1}}];
 const base=deriveTurnTokenUsage(events);assert.equal(base.totalTokens,335010);
 const result=addTurnUsage(base,auxiliaryUsageOf(toolEvent(),'web_search'));assert.equal(result.totalTokens,335120);assert.equal(result.cacheReadTokens,330080);assert.equal(result.routes.length,2);
 assert.equal(addTurnUsage(undefined,[record]),undefined);
});

const compiled=await build({entryPoints:[new URL('../src/client/search-usage-ui.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const ui=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('official tool call identities resolve durable metadata and turn-tail data once',async t=>{
 const{ctx,session}=await fixture(t);
 const events=[{type:'turn/start',data:{turn:1}},toolCall(),toolEvent(),toolEvent(),{type:'turn/end',data:{turn:1}}];
 let state;
 for(const event of events){
  session.append(event.type,event.data,event.type==='tool/result'?{surfaceOp:'append'}:undefined);
  const match={event,...ui.searchUsageDefinition.match(event)};
  state=match.role==='start'?ui.searchUsageDefinition.start({},match):ui.searchUsageDefinition.update({state},match);
 }
 const projection=ctx.sessionProjections.snapshot(session).values.lcxSearchUsage;
 assert.equal(projection.auxiliary.cacheReadTokens,80);
 const data=ui.searchUsageDefinition.buildLocationData({state},'turn');
 assert.equal(data.value.length,1);assert.equal(data.value[0].usage.totalTokens,110);
 const oldCheckpoint=ctx.sessionProjections.checkpoint(session);
 const restored=ctx.sessionProjections.restore(oldCheckpoint,[...session.snapshotEvents()],0,session.header,session.inheritedEventCount);
 assert.deepEqual(restored.snapshot.values.lcxSearchUsage,projection);
});

test('meter correction is isolated between concurrent sessions and releases idempotently',async t=>{
 const{ctx,session}=await fixture(t);reply(session);
 const other=ctx.sessions.create();other.append('request/header',{header:session.requestHeader(),reason:'initial'});reply(other,'request');
 assert.equal(ctx.tokenMeter.measure(other).totalTokens,335010);
 assert.ok(ctx.tokenMeter.measure(session).totalTokens<12000);
 const meter=ctx.tokenMeter;
 const stop1=installSearchMeasurement(meter,ctx.sessionProjections),stop2=installSearchMeasurement(meter,ctx.sessionProjections);
 stop1();stop1();assert.ok(meter.measure(session).totalTokens<12000);
 stop2();stop2();assert.ok(meter.measure(session).totalTokens<12000);
});

test('official basic compaction skips aggregate billing and triggers after retained context grows',async t=>{
 const{ctx,session}=await fixture(t);reply(session);
 class ModelInfo extends Service {
  constructor(c){super(c,'llm');}
  imageRequestPricing(){return undefined;}
  async resolveModelInfo(){return{context:{contextWindow:128000}};}
 }
 let summaries=0;
 class SummaryEngine extends BasicCompaction {
  async summarize(){summaries++;return{summary:[{type:'text',text:'Remember the test facts.'}],provider:'relay',model:'grok-test'};}
 }
 const model=await ctx.plugin(ModelInfo),engine=await ctx.plugin(SummaryEngine,{auto:false,thresholdRatio:0.8,retainTokens:0});
 t.after(async()=>{await engine.dispose();await model.dispose();});
 const agent={session},signal=new AbortController().signal;
 session.append('turn/start',{turn:2});
 assert.equal(await ctx.compaction.compactIfNeeded(agent,'pressure',signal),null);
 assert.equal(summaries,0);
 session.append('turn/end',{turn:2,reason:{kind:'completed'}});
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'x'.repeat(520000)}]}),{surfaceOp:'append'});
 reply(session,'aggregate',3);
 session.append('turn/start',{turn:4});
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Continue.'}]}),{surfaceOp:'append'});
 const result=await ctx.compaction.compactIfNeeded(agent,'pressure',signal);
 assert.ok(result);assert.equal(summaries,1);
 assert.ok(ctx.tokenMeter.measure(session).totalTokens<1000);
 assert.equal(session.snapshotEvents().filter(e=>e.type==='compaction/end').length,1);
 assert.equal(ctx.sessionProjections.snapshot(session).values.tokenUsage.cacheReadTokens,660000);
});
test('usage UI registers additive LCX-owned list entries without reading DSH entries',()=>{
 const registrations=[];
 const injectCalls=[];
  const slots={
    entriesOfSlot(){throw new Error('legacy shadowing inspection is forbidden');},
    inject(name,setup){injectCalls.push(name);return setup();},
    register(options,component){const entry={options,component};registrations.push(entry);return()=>{const index=registrations.indexOf(entry);if(index>=0)registrations.splice(index,1);};},
  };
 const createElement=(type,props,...children)=>({type,props,children});
  const stop=ui.installUsageSlots(slots,createElement);
  assert.deepEqual(injectCalls,['conversation.chat.turnTail','conversation.composer.dock']);
  assert.deepEqual(registrations.map(entry=>entry.options),[
    {name:'conversation.chat.turnTail',id:'lcx-search-usage-turn',order:0,locale:'lcx-codex'},
    {name:'conversation.composer.dock',id:'lcx-search-usage-session',order:10,locale:'lcx-codex'},
  ]);
  assert.equal(registrations.some(entry=>entry.options.name==='conversation.composer.bar'),false);
  assert.equal(registrations.some(entry=>entry.options.name==='conversation.chat.node'),false);
 const turnEntry=registrations.find(entry=>entry.options.name==='conversation.chat.turnTail');
  const turnRendered=turnEntry.component({turn:{data:{get:()=>[record]}},seq:1,openFile:()=>{},t:key=>key==='usageTurn'?'Turn search usage':key});
  assert.equal(turnRendered.type,'span');
  assert.equal(turnRendered.props['data-lcx-search-usage'],'turn');
  assert.equal(turnRendered.children[0],'Turn search usage: 110');
 const dockEntry=registrations.find(entry=>entry.options.name==='conversation.composer.dock');
  const dockRendered=dockEntry.component({useProjection:key=>key==='lcxSearchUsage'?{auxiliary:{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0},aggregateContext:true}:undefined,t:key=>key==='usageSession'?'Session search usage':key});
  assert.equal(dockRendered.type,'span');
  assert.equal(dockRendered.props['data-lcx-search-usage'],'session');
  assert.equal(dockRendered.children[0],'Session search usage: 110');

 stop();
  assert.equal(registrations.length,0);






});

test('additive usage registrations cleanly unload with slot declarations and the LCX fiber',()=>{
 const registrations=[];
  const declarationDisposers=new Map();
  let registerDisposals=0;
  const slots={
    inject(name,setup){
      const dispose=setup();
      const stop=()=>{if(typeof dispose==='function')dispose();};
      declarationDisposers.set(name,stop);
      return stop;
    },
    register(options,component){
      const entry={options,component};registrations.push(entry);
      let live=true;
      return()=>{if(!live)return;live=false;registerDisposals++;const index=registrations.indexOf(entry);if(index>=0)registrations.splice(index,1);};
    },
  };
  const stop=ui.installUsageSlots(slots,(type,props,...children)=>({type,props,children}));
  assert.equal(registrations.length,2);
  declarationDisposers.get('conversation.chat.turnTail')();
  assert.equal(registrations.length,1);
  declarationDisposers.get('conversation.composer.dock')();
  assert.equal(registrations.length,0);
  stop();stop();
  assert.equal(registerDisposals,2);
  assert.equal(registrations.length,0);
 });

for (const evidence of ['none', 'item', 'counter', 'failed-output']) {
 test(`error finish scope follows current response evidence: ${evidence}`,async t=>{
  const {ctx,session,baseline}=await fixture(t);
  const tool={type:'web_search_call',id:'ws_error',status:'completed'};
  t.mock.method(globalThis,'fetch',async()=>sseResponse([
   ...(evidence==='item'?[{type:'response.output_item.added',output_index:0,item:tool}]:[]),
   {type:'response.failed',response:{id:'resp_error',model:'grok-4.6',status:'failed',
    output:evidence==='failed-output'?[tool]:[],error:{code:'fixture_error',message:'synthetic failure'},
    usage:{input_tokens:5000,input_tokens_details:{cached_tokens:330000},output_tokens:10,total_tokens:335010,
     ...(evidence==='counter'?{server_side_tool_usage_details:{x_search_calls:1}}:{})}}},
  ]));
  const h=grokHarness({nativeWeb:true});
  const chunks=await collect(h.stream({provider:'xai',model:'grok-4.6',sessionId:'error-fixture',
   messages:[user('fixture')],tools:[]},()=>{throw new Error('Unexpected adapter');}));
  const finish=chunks.at(-1);
  assert.equal(finish.reason.kind,'error');
  assert.equal(finish.replayState?.response?.lcxUsage?.inputTokenScope,evidence==='none'?undefined:'aggregate');
  // Use a large persisted usage sample to make the host's baseline choice observable.
  const stream=chunks.map(chunk=>({type:'chunk',chunk,time:0}));
  session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1});
  session.append('assistant/message',{turn:1,step:1,usage:u,stream,
   message:createMessage({role:'assistant',source:{kind:'model',provider:'relay',model:'grok-test'},content:[]})},{surfaceOp:'append'});
  session.append('step/end',{turn:1,step:1});session.append('turn/end',{turn:1,reason:{kind:'error'}});
  assert.equal(ctx.tokenMeter.measure(session).baseline.kind,evidence==='none'?'usage':'estimated');
  if(evidence==='none')assert.deepEqual(ctx.tokenMeter.measure(session),baseline.call(ctx.tokenMeter,session));
  assert.equal(aggregateContextOf({type:'assistant/attempt',data:{usage:u,stream}}),evidence!=='none');
 });
}

test('QA overlay disables live agent-scoped meters at creation and pre-step and restores on disposal',async t=>{
 const {ctx,session}=await fixture(t);reply(session);
 const root=await mkdtemp(join(tmpdir(),'issue62-overlay-'));
 const fibers=[];
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose();await rm(root,{recursive:true,force:true});});
 for(const p of [Llm,Tools,SystemPrompt,Agents,AgentLoop])fibers.push(await ctx.plugin(p));
 fibers.push(await ctx.plugin(Jsonl,{root}));
 // Model metadata only; no model stream/provider calls are permitted in this fixture.
 class NoCalls extends LlmAdapter {
  async resolveModel(){return {provider:'relay',id:'grok-test',context:{contextWindow:128000}};}
  stream(){throw new Error('No provider calls allowed');}
 }
 ctx.llm.registerAdapter(['relay'],new NoCalls());
 const existing=await ctx.agents.create({sessionId:'overlay-existing-agent',meta:{cwd:root},agentOptions:{provider:'relay',model:'grok-test'}});
 const existingMeter=existing.agent.ctx.get('tokenMeter');
 existing.agent.session.append('request/header',{header:session.requestHeader(),reason:'initial'});
 reply(existing.agent.session);
 assert.equal(Object.hasOwn(existingMeter,'measure'),true);
 const overlay=await ctx.plugin(adapterOff);
 await existing.agent.dispatch.waterfall('agent/pre-step',{},()=>({kind:'enter',messages:[]}));
 assert.equal(Object.hasOwn(existingMeter,'measure'),false);
 assert.equal(existingMeter.measure(existing.agent.session).baseline.kind,'usage');
 const handle=await ctx.agents.create({sessionId:'overlay-live-agent',meta:{cwd:root},agentOptions:{provider:'relay',model:'grok-test'}});
 const agent=handle.agent,meter=agent.ctx.get('tokenMeter');
 assert.ok(meter);assert.notEqual(meter,ctx.tokenMeter);
 agent.session.append('request/header',{header:session.requestHeader(),reason:'initial'});
 reply(agent.session);
 assert.equal(Object.hasOwn(ctx.tokenMeter,'measure'),false);
 assert.equal(Object.hasOwn(meter,'measure'),false);
 assert.equal(meter.measure(agent.session).baseline.kind,'usage');
 // Repeated lifecycle hooks must be harmless, including a scope first seen at pre-step.
 await agent.dispatch.waterfall('agent/pre-step',{},()=>({kind:'enter',messages:[]}));
 await agent.dispatch.waterfall('agent/pre-step',{},()=>({kind:'enter',messages:[]}));
 assert.equal(Object.hasOwn(meter,'measure'),false);
 await overlay.dispose();await overlay.dispose();
 assert.equal(Object.hasOwn(ctx.tokenMeter,'measure'),true);
 assert.equal(Object.hasOwn(meter,'measure'),true);
 assert.equal(meter.measure(agent.session).baseline.kind,'estimated');
 assert.equal(Object.hasOwn(existingMeter,'measure'),true);
 assert.equal(existingMeter.measure(existing.agent.session).baseline.kind,'estimated');
 await handle.dispose();await existing.dispose();
});
