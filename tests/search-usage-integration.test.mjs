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
import {createMessage,createUserMessage,createToolResultMessage,ToolCallId} from '@deepseek-ai/dsh-llm';
import {deriveTurnTokenUsage} from '@deepseek-ai/dsh-token-meter/client';
import {installSearchUsage,installSearchMeasurement} from '../lib/search-usage.js';
import {aggregateContextOf,auxiliaryUsageOf,addTurnUsage,mergeBuckets} from '../lib/search-accounting.js';

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
function reply(s,scope='aggregate',turn=1){
 s.append('turn/start',{turn});s.append('step/start',{turn,step:1});
 const block={type:'text',text:'answer'};
 const stream=[{type:'block-start',index:0,blockType:'text'},{type:'block-end',index:0,block},
 {type:'usage',usage:u},{type:'finish',reason:{kind:'stop'},replayState:{response:{lcxUsage:{version:1,inputTokenScope:scope}}}}].map(chunk=>({type:'chunk',chunk,time:0}));
 s.append('assistant/message',{turn,step:1,usage:u,stream,message:createMessage({role:'assistant',source:{kind:'model',provider:'relay',model:'grok-test'},content:[block]})},{surfaceOp:'append'});
 s.append('step/end',{turn,step:1});s.append('turn/end',{turn,reason:{kind:'completed'}});
}
test('integration runs against the untouched official token-meter artifact',()=>{
 const digest=createHash('sha256').update(readFileSync(new URL('../node_modules/@deepseek-ai/dsh-token-meter/lib/index.js',import.meta.url))).digest('hex');
 assert.equal(digest,'873372167705d3821fdc23b2a64f5e4c284039f313217728c37e509c59d134cc');
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
 const call=toolCall();session.append(call.type,call.data);
 const e=toolEvent();session.append(e.type,e.data,{surfaceOp:'append'});
 const values=ctx.sessionProjections.snapshot(session).values;
 assert.equal(values.tokenUsage.uncachedInputTokens,5000);
 assert.deepEqual(values.lcxSearchUsage.auxiliary,{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0});
 assert.equal(ctx.tokenMeter.measure(session).totalTokens,before+8);
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
