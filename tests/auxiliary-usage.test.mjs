import test from 'node:test';
import assert from 'node:assert/strict';
import {withAuxiliaryUsage, recordHostedUsage} from '../lib/auxiliary-usage.js';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import {ToolCallId} from '@deepseek-ai/dsh-llm';
const response = cached => ({usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:cached}}});
function tool(execute) {
 return withAuxiliaryUsage({name:'fixture',description:'fixture',parameters:{type:'object'},
  output:{schema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
   render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}],
   presentationMeta:()=>({kind:'web',sources:[]})},execute});
}
test('auxiliary billing survives JSON snapshots and does not enter model content',async()=>{
 const definition=tool(async()=>{recordHostedUsage(response(80),'r1','relay','gpt-test');return{text:'answer'};});
 const value=JSON.parse(JSON.stringify(await definition.execute({},{})));
 assert.deepEqual(definition.output.render({},value),[{type:'text',text:'{"text":"answer"}'}]);
 const meta=definition.output.presentationMeta({},value);
 assert.equal(meta.kind,'web');
 assert.deepEqual(meta.auxiliaryUsage,[{requestId:'r1',provider:'relay',model:'gpt-test',usage:{inputTokens:20,outputTokens:10,totalTokens:110,cacheReadTokens:80,cacheWriteTokens:0}}]);
});
test('parallel tool calls own distinct billing collectors; queries within one call aggregate',async()=>{
 const definition=tool(async({id})=>{
  await Promise.all([0,1].map(async n=>{await new Promise(r=>setImmediate(r));recordHostedUsage(response(n*10),id+n,'p','gpt-test');}));
  return{text:id};
 });
 const values=await Promise.all(['a','b'].map(id=>definition.execute({id},{})));
 assert.deepEqual(values.map(v=>v.auxiliaryUsage.map(u=>u.requestId)),[['a0','a1'],['b0','b1']]);
});
test('missing or contradictory provider counters are not invented',async()=>{
 const definition=tool(async()=>{
  for(const r of [{usage:{}},response(101),{usage:{...response(10).usage,total_tokens:111}},response(-1)]) recordHostedUsage(r,'bad','p','gpt-test');
  return{text:'answer'};
 });
 const value=await definition.execute({},{});
 assert.deepEqual(value,{text:'answer'});
 assert.deepEqual(definition.output.presentationMeta({},value),{kind:'web',sources:[]});
});
test('real DSH ToolRuntime validates, persists billing metadata, and keeps rendered content clean',async t=>{
 const ctx=new Context();
 const fibers=[await ctx.plugin(SystemPrompt),await ctx.plugin(ToolRuntime)];
 t.after(()=>{for(const fiber of fibers.reverse()) fiber.dispose();});
 ctx.tools.register(tool(async()=>{recordHostedUsage(response(50),'real-1','relay','gpt-test');return{text:'answer'};}));
 const result=await ctx.tools.execute({toolCallId:ToolCallId('usage-fixture'),name:'fixture',arguments:{},signal:new AbortController().signal});
 assert.equal(result.isError,false,JSON.stringify(result));
 assert.equal(result.meta.auxiliaryUsage[0].usage.cacheReadTokens,50);
 assert.deepEqual(result.content,[{type:'text',text:'{"text":"answer"}'}]);
 assert.equal(JSON.stringify(ctx.tools.schemas()).includes('auxiliaryUsage'),false);
});
