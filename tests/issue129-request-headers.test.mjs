import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm, { attributionHeaders } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { collect, loadSource } from './issue119-source.mjs'

const route = await loadSource('route')
const {managedResponsesStream} = await loadSource('index','managedResponsesStream')
const baseURL = 'https://fixture.invalid/v1'
const config = {provider:'openai',model:'gpt-5.4',api:'openai-responses',baseURL,apiKeyEnv:'FIXTURE_KEY',cacheRetention:'short',headers:{'x-profile':'one'},portableReplayMaxChars:200000}
const options = {provider:'openai',model:'gpt-5.4',sessionId:'sid-headers',purpose:'auto-review',messages:[{role:'user',content:[{type:'text',text:'review'}]}]}
function context() {
  const ctx = new Context()
  ctx.provide('credentials',{resolve:async()=>({value:'synthetic-key'})},true)
  return ctx
}
const headers = (ctx,cfg=config) => route.authenticatedHeaders(ctx,cfg,'sid-headers','correlation',{},'sid-headers',options)

test('profile waterfall has ordered synchronous contributors; ownership applies afterwards',async()=>{
  const ctx=context(), order=[]
  ctx.on('llm-pi-ai/request-headers',(request,h,next)=>{
    order.push('first'); assert.ok(Object.isFrozen(request))
    assert.deepEqual(request,{provider:'openai',model:'gpt-5.4',baseURL,sessionId:'sid-headers',purpose:'auto-review'})
    assert.equal(h.get('authorization'),null);assert.equal(h.get('session_id'),null)
    assert.equal(h.get('x-profile'),'one');h.set('x-added','first')
    h.set('authorization','listener');h.set('session_id','listener')
    for(const name of Object.keys(attributionHeaders()))h.set(name,'listener')
    return next()
  })
  ctx.on('llm-pi-ai/request-headers',(_request,h,next)=>{order.push('second');assert.equal(h.get('x-added'),'first');h.set('x-added','second');return next()})
  const actual=await headers(ctx)
  assert.deepEqual(order,['first','second']);assert.equal(actual['x-added'],'second')
  assert.equal(actual.authorization,'Bearer synthetic-key');assert.equal(actual.session_id,'sid-headers')
  for(const [name,value] of Object.entries(attributionHeaders()))assert.equal(new Headers(actual).get(name),value)
})

test('the profile own headers still win over credentials and affinity, contributors do not',async()=>{
  const ctx=context()
  ctx.on('llm-pi-ai/request-headers',(_r,h,next)=>{h.set('authorization','listener');h.set('session_id','listener');return next()})
  const actual=await headers(ctx,{...config,headers:{'x-profile':'one',Authorization:'Bearer profile-key',session_id:'profile-sid'}})
  assert.equal(new Headers(actual).get('authorization'),'Bearer profile-key')
  assert.equal(new Headers(actual).get('session_id'),'profile-sid')
  for(const [name,value] of Object.entries(attributionHeaders()))assert.equal(new Headers(actual).get(name),value)
})

test('contributors may change or delete ordinary profile headers, as on the host',async()=>{
  const ctx=context()
  ctx.on('llm-pi-ai/request-headers',(_r,h,next)=>{h.set('x-profile','changed-by-contributor');h.delete('x-drop');return next()})
  const actual=new Headers(await headers(ctx,{...config,headers:{'x-profile':'one','x-drop':'gone'}}))
  assert.equal(actual.get('x-profile'),'changed-by-contributor')
  assert.equal(actual.get('x-drop'),null)
})

test('a missing credential fails before any contributor runs, as on the host',async()=>{
  const ctx=new Context(); let ran=0
  ctx.provide('credentials',{resolve:async()=>undefined},true)
  ctx.on('llm-pi-ai/request-headers',(_r,_h,next)=>{ran+=1;return next()})
  await assert.rejects(headers(ctx))
  assert.equal(ran,0)
})

test('per-request Headers are isolated under concurrency and the next config is fresh',async()=>{
 const ctx=context(), seen=[]
 ctx.on('llm-pi-ai/request-headers',(_r,h,next)=>{seen.push(h);h.set('x-counter',String(seen.length));return next()})
 const [a,b]=await Promise.all([headers(ctx),headers(ctx)])
 assert.notEqual(seen[0],seen[1]);assert.equal(a['x-counter'],'1');assert.equal(b['x-counter'],'2')
 const changed=await headers(ctx,{...config,headers:{'x-profile':'two'}})
 assert.equal(changed['x-profile'],'two');assert.equal(a['x-profile'],'one')
})

for(const [label,error,diagnostic] of [
 ['TypeError',new TypeError('synthetic-private-value'),'TypeError during header preparation; check the contributing plugin\'s header names, values, and configuration'],
 ['non-Error','synthetic-private-value','the contributing plugin threw a non-Error value; throw an Error with a safe diagnostic'],
 ['Error',new Error('safe contributor diagnostic'),'safe contributor diagnostic'],
]) test(`header contributor ${label} mirrors the host diagnostic and REQUEST_HEADERS code`,async t=>{
 const ctx=context();ctx.on('llm-pi-ai/request-headers',()=>{throw error})
 assert.throws(()=>route.prepareRequestHeaders(ctx,config,options),e=>e.code==='REQUEST_HEADERS'&&e.message===`pi-ai request header preparation failed for provider "openai": ${diagnostic}`)
 t.mock.method(globalThis,'fetch',()=>assert.fail('no network after header failure'))
 const chunks=await collect(managedResponsesStream(options,config,ctx));const reason=chunks.at(-1).reason
 assert.equal(reason.failure.code,'REQUEST_HEADERS');assert.match(reason.failure.message,new RegExp(label==='Error'?'safe contributor diagnostic':label))
 assert.doesNotMatch(reason.failure.message,/synthetic-private-value/)
})

test('real host model discovery never invokes request-header contributors; unsized defaults follow host',async()=>{
 const ctx=context();ctx.plugin(Llm);ctx.plugin(PiAi,{providers:{fixture:{api:'openai-responses',baseURL,apiKeyEnv:'FIXTURE_KEY',models:[{id:'gpt-unsized'}]}}})
 await new Promise(r=>setTimeout(r,800));let invoked=0
 ctx.on('llm-pi-ai/request-headers',(_r,_h,next)=>{invoked++;return next()})
 assert.ok((await ctx.llm.listModels('fixture')).length)
 assert.ok((await ctx.llm.discoverModels('llm-pi-ai',{provider:'openai'})).length)
 const info=await ctx.llm.resolveModelInfo('fixture','gpt-unsized')
 assert.equal(info.context.contextWindow,1000000);assert.equal(PiAi.Config({providers:{fixture:{}}}).providers.get().fixture.defaultMaxTokens,128000)
 assert.equal(invoked,0)
})

test('image count policy reads the host profile and defaults its quantum to min(10, max)',()=>{
 for(const [policy,max,quantum] of [[{},50,10],[{maxRequestImages:3},3,3],[{maxRequestImages:7,imageOffloadCountQuantum:2},7,2]]) {
  const ctx={llm:{listConfigurableProviders:()=>[{provider:'openai',settingsNs:'llm-pi-ai',settingsPath:['providers','openai']}]},settings:{describe:()=>[{ns:'llm-pi-ai',value:{providers:{openai:{baseURL,apiKeyEnv:'FIXTURE_KEY',...policy}}}}]}}
  const resolved=route.resolveResponsesRouteConfig(ctx,{provider:'openai',model:'gpt-5.4'}, {})
  assert.equal(resolved.maxRequestImages,max);assert.equal(resolved.imageOffloadCountQuantum,quantum)
 }
})
