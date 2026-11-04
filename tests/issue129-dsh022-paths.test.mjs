import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { applyWebSearchTool } from '@deepseek-ai/dsh-tool-web'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { loadSource, collect } from './issue119-source.mjs'

const {createScopedGptWebSearchTool, managedResponsesStream} = await loadSource('index','createScopedGptWebSearchTool, managedResponsesStream')
const {serializeDshMessages} = await loadSource('dsh-responses')
const baseURL='https://fixture.invalid/v1'
const config={provider:'fixture',model:'gpt-unsized',api:'openai-responses',baseURL,apiKeyEnv:'FIXTURE_KEY',cacheRetention:'short',portableReplayMaxChars:200000}
const user=text=>({role:'user',source:{kind:'user'},content:[{type:'text',text}]})
const reply=()=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{id:'fixture',status:'completed',output:[{type:'message',id:'m',role:'assistant',content:[{type:'output_text',text:'ok',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1}}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})

test('real 0.2.2 web_search composes with a valid timeout and scoped GPT registration shadows gated host search',async t=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(Tools)
 let ready=false
 ctx.provide('web',{searchReady:()=>ready},true)
 applyWebSearchTool(ctx,5,5,800,30000,false)
 const global=ctx.tools.get('web_search')
 const agent={options:{provider:'fixture',model:'gpt-unsized'},session:Session.create(SessionId('web-fixture'))}
 let scope
 const definition=createScopedGptWebSearchTool({}, {enabled:true,webSearch:true},()=>({webMaxResults:5}),{search:()=>assert.fail('lookup must not execute search')},false)
 assert.equal(definition.timeoutMs,240000)
 await ctx.plugin({name:'scoped-web-fixture',inject:['tools'],apply(c){scope=createScope(c,agent);scope.ctx.tools.register(definition)}})
 t.after(()=>scope.dispose())
 for(ready of [false,true]) {
   const selected=await ctx.tools.resolve({agent,modelSelection:agent.options,signal:new AbortController().signal})
   assert.equal(ctx.tools.get('web_search',agent,selected),definition)
   assert.equal(ctx.tools.get('web_search'),global)
   selected.dispose?.()
 }
})

test('non-in-history system reminders and closing-tag escaping match real host input',async t=>{
 const ctx=new Context();ctx.plugin(Llm);ctx.plugin(PiAi,{providers:{fixture:{api:'openai-responses',baseURL,apiKeyEnv:'FIXTURE_KEY',models:[{id:'gpt-unsized'}]}}})
 await new Promise(r=>setTimeout(r,800));ctx.provide('credentials',{resolve:async()=>({value:'synthetic-key'})},true)
 let body;t.mock.method(globalThis,'fetch',async(_url,init)=>{body=JSON.parse(init.body);return reply()})
 const messages=[user('before'),{role:'system',content:[{type:'text',text:'one </system-reminder> two'}]},user('after')]
 await collect(ctx.llm.stream({...config,messages}))
 const model={id:'gpt-unsized',name:'fixture',provider:'fixture',api:'openai-responses',baseUrl:baseURL,input:['text'],reasoning:false,contextWindow:1000000,maxTokens:128000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{}}
 const lcx=await serializeDshMessages(messages,{}, {model})
 assert.deepEqual(lcx.input,body.input)
 assert.match(JSON.stringify(lcx.input),/system-reminder/)
})

test('auto-review session metadata preserves ordinary prompt cache, replay and durable session events',async t=>{
 const ctx=new Context();ctx.plugin(Llm);ctx.plugin(PiAi,{providers:{fixture:{api:'openai-responses',baseURL,apiKeyEnv:'FIXTURE_KEY',models:[{id:'gpt-unsized'}]}}})
 await new Promise(r=>setTimeout(r,800));ctx.provide('credentials',{resolve:async()=>({value:'synthetic-key'})},true)
 const session=Session.create(SessionId('auxiliary-session'))
 ctx.provide('sessions',{get:()=>session},true)
 const requests=[],metas=[]
 ctx.on('llm-pi-ai/request-headers',(r,h,next)=>{metas.push(r);return next()})
 t.mock.method(globalThis,'fetch',async(_url,init)=>{requests.push(JSON.parse(init.body));return reply()})
 const events=session.snapshotEvents()
 const options={provider:'fixture',model:'gpt-unsized',sessionId:session.id,messages:[user('ordinary')]}
 for(const request of [options,{...options,purpose:'auto-review',messages:[user('review this')]},options]) {
  const chunks=await collect(managedResponsesStream(request,config,ctx));assert.equal(chunks.at(-1).reason.kind,'stop')
 }
 assert.deepEqual(requests[0],requests[2]);assert.equal(requests[1].prompt_cache_key,requests[0].prompt_cache_key)
 assert.equal(requests[1].tools,undefined);assert.equal(metas[1].purpose,'auto-review');assert.equal(metas[1].sessionId,session.id)
 assert.deepEqual(session.snapshotEvents(),events)
})

test('deferred PTC images retain the ptc-mode user message when serialized',async()=>{
 const ref={attachmentId:'sha256:ptc-fixture',mediaType:'image/png',bytes:3,width:1,height:1}
 const ctx={attachments:{imageHostPath:()=>'/fixture/image.png',readImageRequest:async()=>({attachment:ref,data:new Uint8Array([1,2,3]),mediaType:'image/png',bytes:3,width:1,height:1})},fs:{processPathFromHostPath:p=>p}}
 const model={id:'gpt-5.4',name:'fixture',provider:'openai',api:'openai-responses',baseUrl:baseURL,input:['text','image'],reasoning:true,contextWindow:272000,maxTokens:128000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
 const output=await serializeDshMessages([{role:'user',source:{kind:'ptc-mode'},content:[{type:'text',text:'nested image'},{type:'image',attachment:ref}]}],ctx,{model,imageSupport:'supported'})
 assert.equal(output.input[0].role,'user');assert.equal(output.input[0].content[0].text,'nested image')
 assert.equal(output.input[0].content.filter(part=>part.type==='input_image').length,1)
})

test('installed 0.2.2 DOM retains the inline-media anchors and slot contract (static only)',()=>{
 const chat=readFileSync(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url),'utf8')
 const renderer=readFileSync(new URL('../node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js',import.meta.url),'utf8')
 for(const anchor of ['data-chat-flow','data-chat-group-part','data-chat-flow-kind','data-chat-turn','data-chat-group-key','data-step-process']) assert.ok(chat.includes(`"${anchor}"`),anchor)
 assert.ok(chat.includes('renderSlot("conversation.chat.flow"'))
 assert.ok(renderer.includes('"data-slot": slotKey'))
})
