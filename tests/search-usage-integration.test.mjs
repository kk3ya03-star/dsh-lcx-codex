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
 assert.equal(digest,'f91bdd543a161cfbeec3450f44fc0ce310f5354b1be61d83dbce773d62ab011a');
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
 const stop1=installSearchMeasurement(meter),stop2=installSearchMeasurement(meter);
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
test('public UI slots preserve original renderer, children and actions; merge billing and restore on disposal',()=>{
 const entries=new Map();
 const names=['conversation.composer.dock','conversation.composer.bar','conversation.chat.node'];
 for(const [i,name]of names.entries())entries.set(name,[{component:()=>{},options:i===0?{id:'stats'}:i===2?{key:'turn-tail'}:{},locale:'original',children:{},inject:()=>({})}]);
 const originals=names.map(n=>entries.get(n)[0]);
 const components=originals.map(e=>e.component);
 const slots={entriesOfSlot:n=>entries.get(n),inject(_n,setup){return setup();},register(o,c){const e={component:c,options:o};entries.get(o.name).unshift(e);return()=>entries.get(o.name).splice(entries.get(o.name).indexOf(e),1);}};
 const stop=ui.installUsageSlots(slots,(component,props)=>({component,props}));
 const extra={auxiliary:{uncachedInputTokens:20,outputTokens:10,cacheReadTokens:80,cacheWriteTokens:0},aggregateContext:true};
 const useProjection=k=>({lcxSearchUsage:extra,tokenUsage:{uncachedInputTokens:5000,outputTokens:10,cacheReadTokens:330000,cacheWriteTokens:0},contextPressure:{pressureTokens:335000,projectedTokens:335010,contextWindow:128000},contextBreakdown:{systemTokens:10,toolsTokens:20,messageTokens:10000}}[k]);
 const rendered=entries.get(names[0])[0].component({useProjection,action:'keep'});
 assert.equal(rendered.component,components[0]);assert.equal(rendered.props.action,'keep');assert.equal(rendered.props.useProjection('tokenUsage').cacheReadTokens,330080);
 const composer=entries.get(names[1])[0].component({useProjection});assert.equal(composer.props.useProjection('contextPressure').projectedTokens,10030);
 stop();assert.deepEqual(names.map(n=>entries.get(n)[0]),originals);assert.deepEqual(originals.map(e=>e.component),components);
});

test('alpha.2 usage adapter fails closed on ambiguous or immutable entry ownership',()=>{
 const original=()=>{},duplicate=()=>{},bar=Object.freeze({component:original,options:{}});
 const entries=new Map([
  ['conversation.composer.dock',[{component:original,options:{id:'stats'}},{component:duplicate,options:{id:'stats'}}]],
  ['conversation.composer.bar',[bar]],
  ['conversation.chat.node',[{component:'not-callable',options:{key:'turn-tail'}}]],
 ]);
 const before=structuredClone([...entries].map(([name,list])=>[name,list.map(entry=>({options:entry.options,children:entry.children,store:entry.store,inject:entry.inject}))]));
 const slots={entriesOfSlot:name=>entries.get(name),inject(_name,setup){return setup();},register(){throw new Error('must not replace slot owner')}};
 const stop=ui.installUsageSlots(slots,(component,props)=>({component,props}));
 assert.equal(entries.get('conversation.composer.dock')[0].component,original);
 assert.equal(entries.get('conversation.composer.dock')[1].component,duplicate);
 assert.equal(entries.get('conversation.composer.bar')[0].component,original);
 assert.equal(entries.get('conversation.chat.node')[0].component,'not-callable');
 stop();
 assert.deepEqual(structuredClone([...entries].map(([name,list])=>[name,list.map(entry=>({options:entry.options,children:entry.children,store:entry.store,inject:entry.inject}))])),before);
});
