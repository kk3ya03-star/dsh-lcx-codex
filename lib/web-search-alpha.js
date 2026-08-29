import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { outputDomains, outputLineRange, outputLinks, outputPdfRefs, parseWebRunOutput } from './web-run-output.js'

export const ALPHA_ACTIONS = ['search_query','image_query','open','find','click','screenshot','finance','weather','sports','time']
const LEAGUES = ['nba','wnba','nfl','nhl','mlb','epl','ncaamb','ncaawb','ipl']
const ASSET_TYPES = ['equity','fund','crypto','index']
const RESPONSE_LENGTHS = ['short','medium','long']
export const ALPHA_SEARCH_PARAMETERS = { type: 'object', properties: { action: { type: 'string', enum: ALPHA_ACTIONS }, query: { type: 'string' }, domains: { type: 'array', items: { type: 'string' } }, recency: { type: 'integer' }, refId: { type: 'string' }, lineNumber: { type: 'integer' }, linkId: { type: 'integer' }, pattern: { type: 'string' }, pageNumber: { type: 'integer' }, ticker: { type: 'string' }, assetType: { type: 'string', enum: ASSET_TYPES }, market: { type: 'string' }, location: { type: 'string' }, start: { type: 'string' }, duration: { type: 'integer' }, fn: { type: 'string', enum: ['schedule','standings'] }, league: { type: 'string', enum: LEAGUES }, team: { type: 'string' }, opponent: { type: 'string' }, dateFrom: { type: 'string' }, dateTo: { type: 'string' }, numberOfGames: { type: 'integer' }, locale: { type: 'string' }, utcOffset: { type: 'string' }, responseLength: { type: 'string', enum: RESPONSE_LENGTHS } }, required: ['action'], additionalProperties: false }
export const ALPHA_SEARCH_OUTPUT = { type: 'object', properties: { mode: { type:'string' }, action: { type:'string' }, capability:{type:'string'}, emulation:{type:'string'}, content:{type:'string'}, results:{type:'array',items:{type:'object'}}, refs:{type:'array',items:{type:'string'}}, sources:{type:'array',items:{type:'object'}}, citations:{type:'array',items:{type:'object'}}, outputBlocks:{type:'array',items:{type:'object'}}, links:{type:'array',items:{type:'object'}}, pdfRefs:{type:'array',items:{type:'string'}}, domains:{type:'array',items:{type:'string'}}, lineRange:{type:'object'}, requestId:{type:'string'}, responseId:{type:'string'}, retrievedAt:{type:'string'}, warnings:{type:'array',items:{type:'string'}} }, required:['mode','action','capability','emulation','content','results','refs','sources','citations','outputBlocks','links','pdfRefs','domains','requestId','retrievedAt','warnings'], additionalProperties:false }
export const ALPHA_SCHEMA_FINGERPRINT = createHash('sha256').update(JSON.stringify(ALPHA_SEARCH_PARAMETERS)).digest('hex')
export const ALPHA_PROBE_VERSION = 11
function failure(message, code='WEB_INVALID_REQUEST') { const e=new Error(message); e.code=code; return e }
function isObject(v){ return v!==null && typeof v==='object' && !Array.isArray(v) }
function text(value,field,max=1000){ if(typeof value!=='string'||!value.trim()||value.trim().length>max) throw failure(`websearch_alpha.${field} is invalid`); return value.trim() }
function integer(value,field,min=0,max=10000){ if(!Number.isSafeInteger(value)||value<min||value>max) throw failure(`websearch_alpha.${field} is invalid`); return value }
function date(value,field){ const normalized=text(value,field,10); if(!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)||Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw failure(`websearch_alpha.${field} must use YYYY-MM-DD`); return normalized }
function normalizeDomains(value){ if(!Array.isArray(value)||!value.length||value.length>100) throw failure('websearch_alpha.domains is invalid'); return value.map((item)=>{ const d=text(item,'domains',253).toLowerCase(); if(d.includes('/')||d.includes(':')||!d.includes('.')) throw failure('websearch_alpha.domains contains an invalid domain'); return d }) }
const FIELDS={search_query:['query','domains','recency'],image_query:['query','domains','recency'],open:['refId','lineNumber'],find:['refId','pattern'],click:['refId','linkId'],screenshot:['refId','pageNumber'],finance:['ticker','assetType','market'],weather:['location','start','duration'],sports:['fn','league','team','opponent','dateFrom','dateTo','numberOfGames','locale'],time:['utcOffset']}
export function normalizeAlphaSearchArgs(args){ if(!isObject(args)||!ALPHA_ACTIONS.includes(args.action)) throw failure('websearch_alpha.action is invalid'); const allowed=new Set(['action','responseLength',...FIELDS[args.action]]); if(Object.keys(args).some((k)=>!allowed.has(k))) throw failure(`websearch_alpha.${args.action} received an unrelated field`); const result={action:args.action}; if(args.responseLength!==undefined){ if(!RESPONSE_LENGTHS.includes(args.responseLength)) throw failure('websearch_alpha.responseLength is invalid'); result.responseLength=args.responseLength } switch(args.action){ case 'search_query': case 'image_query': result.query=text(args.query,'query',16000); if(args.domains!==undefined) result.domains=normalizeDomains(args.domains); if(args.recency!==undefined) result.recency=integer(args.recency,'recency',0,3650); break; case 'open': result.refId=text(args.refId,'refId'); if(args.lineNumber!==undefined) result.lineNumber=integer(args.lineNumber,'lineNumber'); break; case 'find': result.refId=text(args.refId,'refId'); result.pattern=text(args.pattern,'pattern'); break; case 'click': result.refId=text(args.refId,'refId'); if(isAlphaHttpUrl(result.refId)) throw failure('websearch_alpha.click requires an opaque stored ref','LCX_ALPHA_REF_REQUIRED'); result.linkId=integer(args.linkId,'linkId'); break; case 'screenshot': result.refId=text(args.refId,'refId'); result.pageNumber=integer(args.pageNumber,'pageNumber'); break; case 'finance': result.ticker=text(args.ticker,'ticker',40); if(!ASSET_TYPES.includes(args.assetType)) throw failure('websearch_alpha.assetType is invalid'); result.assetType=args.assetType; if(args.market!==undefined) result.market=text(args.market,'market',20); break; case 'weather': result.location=text(args.location,'location',500); if(args.start!==undefined) result.start=date(args.start,'start'); if(args.duration!==undefined) result.duration=integer(args.duration,'duration',1,14); break; case 'sports': if(!['schedule','standings'].includes(args.fn)||!LEAGUES.includes(args.league)) throw failure('websearch_alpha sports args are invalid'); result.fn=args.fn; result.league=args.league; for(const f of ['team','opponent','locale']) if(args[f]!==undefined) result[f]=text(args[f],f,100); if(args.dateFrom!==undefined) result.dateFrom=date(args.dateFrom,'dateFrom'); if(args.dateTo!==undefined) result.dateTo=date(args.dateTo,'dateTo'); if(args.numberOfGames!==undefined) result.numberOfGames=integer(args.numberOfGames,'numberOfGames',1,100); break; case 'time': result.utcOffset=text(args.utcOffset,'utcOffset',6); if(!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/u.test(result.utcOffset)) throw failure('websearch_alpha.utcOffset is invalid'); break } return result }
export function alphaActionCommand(args){ let value; switch(args.action){ case 'search_query': case 'image_query': value={q:args.query,...(args.recency!==undefined?{recency:args.recency}:{}),...(args.domains?{domains:args.domains}:{})}; break; case 'open': value={ref_id:args.refId,...(args.lineNumber!==undefined?{lineno:args.lineNumber}:{})}; break; case 'find': value={ref_id:args.refId,pattern:args.pattern}; break; case 'click': if(isAlphaHttpUrl(args.refId)) throw failure('websearch_alpha.click requires an opaque stored ref','LCX_ALPHA_REF_REQUIRED'); value={ref_id:args.refId,id:args.linkId}; break; case 'screenshot': value={ref_id:args.refId,pageno:args.pageNumber}; break; case 'finance': value={ticker:args.ticker,type:args.assetType,...(args.market?{market:args.market}:{})}; break; case 'weather': value={location:args.location,...(args.start?{start:args.start}:{}),...(args.duration!==undefined?{duration:args.duration}:{})}; break; case 'sports': value={tool:'sports',fn:args.fn,league:args.league,...(args.team?{team:args.team}:{}),...(args.opponent?{opponent:args.opponent}:{}),...(args.dateFrom?{date_from:args.dateFrom}:{}),...(args.dateTo?{date_to:args.dateTo}:{}),...(args.numberOfGames!==undefined?{num_games:args.numberOfGames}:{}),...(args.locale?{locale:args.locale}:{})}; break; case 'time': value={utc_offset:args.utcOffset}; break; default: throw failure('websearch_alpha.action is invalid') } return {[args.action]:[value],...(args.responseLength?{response_length:args.responseLength}:{})} }
function actionInput(args){ return args.query??(args.refId?`${args.action}: ${args.refId}`:args.ticker?`${args.action}: ${args.ticker}`:args.location?`${args.action}: ${args.location}`:args.utcOffset?`${args.action}: ${args.utcOffset}`:`${args.action}: ${args.league??''}`.trim()) }
export function buildAlphaSearchBody(args,model,sessionId,externalWebAccess=true,maxOutputTokens=2500){ if(typeof sessionId!=='string'||!sessionId) throw failure('websearch_alpha requires a DSH session','LCX_ALPHA_SESSION_REQUIRED'); return {id:sessionId,model,input:[{role:'user',content:[{type:'input_text',text:actionInput(args)}]}],commands:alphaActionCommand(args),settings:{allowed_callers:['direct'],external_web_access:externalWebAccess},max_output_tokens:maxOutputTokens} }
function ipv4Octets(hostname) {
  const octets = hostname.split('.').map((part) => Number(part))
  return octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : undefined
}

function isPublicIpv4(hostname) {
  const octets = ipv4Octets(hostname)
  if (!octets) return false
  const [first, second, third] = octets
  return first !== 0 && first !== 10 && first !== 127 &&
    !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 169 && second === 254) &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 0 && third === 0) &&
    !(first === 192 && second === 0 && third === 2) &&
    !(first === 192 && second === 88 && third === 99) &&
    !(first === 192 && second === 168) &&
    !(first === 198 && second >= 18 && second <= 19) &&
    !(first === 198 && second === 51 && third === 100) &&
    !(first === 203 && second === 0 && third === 113) &&
    first < 224
}

function ipv6Groups(hostname) {
  const segments = hostname.replace(/^\[|\]$/gu, '').toLowerCase().split('::')
  if (segments.length > 2) return undefined
  const left = segments[0] ? segments[0].split(':') : []
  const right = segments.length === 2 && segments[1] ? segments[1].split(':') : []
  const missing = segments.length === 2 ? 8 - left.length - right.length : 0
  const values = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
  if (values.length !== 8 || (segments.length === 2 && missing < 1) || values.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return undefined
  return values.map((part) => Number.parseInt(part, 16))
}

function isPublicIpv6(hostname) {
  const groups = ipv6Groups(hostname)
  if (!groups) return false
  const [first, second] = groups
  if ((first & 0xe000) !== 0x2000) return false
  if (first === 0x3fff && (second & 0xf000) === 0) return false
  if (first === 0x0100 && second === 0) return false
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00) return false
  if (first === 0x2001 && (second === 0 || second === 0x0002 || (second >= 0x0010 && second <= 0x002f) || second === 0x0db8)) return false
  if (first === 0x0064 && second === 0xff9b && groups[2] === 0x0001) return false
  return first !== 0x2002
}

const RESERVED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.home.arpa', '.internal', '.test', '.example', '.invalid', '.onion', '.alt']
const RESERVED_DNS_SUFFIXES = ['ipv4only.arpa', 'in-addr.arpa', 'ip6.arpa']

function isPublicHostname(hostname) {
  return hostname.includes('.') && !RESERVED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) && !RESERVED_DNS_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

export function isPublicAlphaTarget(url) {
  const hostname = String(url?.hostname ?? '').replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase()
  if (!hostname) return false
  const family = isIP(hostname)
  if (family === 4) return isPublicIpv4(hostname)
  if (family === 6) return isPublicIpv6(hostname)
  return isPublicHostname(hostname)
}

export function isAlphaHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function isAlphaContinuationUrl(value){ if(typeof value!=='string'||!value.trim()||value!==value.trim()) return false; try{ const url=new URL(value); return ['http:','https:'].includes(url.protocol)&&Boolean(url.hostname)&&!url.username&&!url.password&&isPublicAlphaTarget(url) }catch{return false} }
export function alphaRefRequiresStore(action,refId){ return action==='click'||(['open','find','screenshot'].includes(action)&&!isAlphaContinuationUrl(refId)) }
function httpUrl(value){ return isAlphaContinuationUrl(value)?new URL(value).toString():undefined }
function safeResult(value,seen=new Set()){ if(value===null||typeof value!=='object') return value; if(seen.has(value)) return undefined; seen.add(value); if(Array.isArray(value)) return value.map((x)=>safeResult(x,seen)).filter((x)=>x!==undefined); const result={}; for(const [key,item] of Object.entries(value)){ if(key==='encrypted_output'||key==='encrypted_content') continue; if(['url','source_url','source_website_url','image_url','thumbnail_url'].includes(key)){ const u=httpUrl(item); if(u) result[key]=u; continue } const safe=safeResult(item,seen); if(safe!==undefined) result[key]=safe } return result }
function artifacts(results){ const refs=[],refRecords=[],sources=[],seenRefs=new Set(),seenSources=new Set(); const visit=(value)=>{ if(!value||typeof value!=='object') return; if(Array.isArray(value)){ value.forEach(visit); return } const candidate=typeof value.ref_id==='string'&&value.ref_id?value.ref_id:typeof value.id==='string'&&/^turn[\w-]+$/u.test(value.id)?value.id:undefined; const refId=isAlphaHttpUrl(candidate)?undefined:candidate; const url=httpUrl(value.url??value.source_url??value.source_website_url??candidate); if(refId&&!seenRefs.has(refId)){seenRefs.add(refId);refs.push(refId);refRecords.push({refId,...(url?{url}:{})})} if(url&&!seenSources.has(url)){seenSources.add(url);sources.push({url,...(typeof value.title==='string'?{title:value.title}:{}),...(typeof value.snippet==='string'?{snippet:value.snippet}:{}),...(refId?{refId}:{})})} Object.values(value).forEach(visit) }; visit(results); return {refs,refRecords,sources} }
const ACTION_ERROR=/^\s*(?:Error parsing function call\b|Invalid function_name=|Invalid function call\b)/iu
const ALPHA_SEMANTIC_FAILURE=/^\s*(?:reference(?: id)?\s+(?:is\s+)?(?:invalid|unavailable)\b|unable to access requested content\b|service unavailable\b)/iu
const ALPHA_COMMAND_ERROR_ENVELOPE=/^\s*Internal Error\s*\([^\r\n)]*\)\s*(?:\r?\n[ \t]*)+(?:\uE200cite\uE202[^\uE201\r\n]+\uE201[ \t]*(?:\[wordlim:\s*\d+\][ \t]*)?)?Unable to resolve (open|find|click|screenshot) call\s*:/iu
function alphaCommandErrorEnvelope(output,action){ const match=String(output??'').match(ALPHA_COMMAND_ERROR_ENVELOPE); return match?.[1]?.toLowerCase()===action }
export function parseAlphaSearchResponse(response,options){ if(!isObject(response)||typeof response.output!=='string'||(response.results!==undefined&&!Array.isArray(response.results))) throw failure('LCX Alpha Web Search returned an invalid response','LCX_ALPHA_INVALID_RESPONSE'); if(ACTION_ERROR.test(response.output)||(['open','find','click','screenshot'].includes(options.action)&&(ALPHA_SEMANTIC_FAILURE.test(response.output)||alphaCommandErrorEnvelope(response.output,options.action)))) throw failure('LCX Alpha Web Search could not execute the requested action','LCX_ALPHA_ACTION_FAILED'); const results=safeResult(response.results??[]); const a=artifacts(results); const outputBlocks=parseWebRunOutput(response.output); for(const block of outputBlocks) if(block.url){ const url=httpUrl(block.url); if(url) block.url=url; else delete block.url } for(const block of outputBlocks) for(const ref of block.references??[]){ if(isAlphaHttpUrl(ref)) continue; if(!a.refs.includes(ref)) a.refs.push(ref); if(!a.refRecords.some((item)=>item.refId===ref)) a.refRecords.push({refId:ref,...(block.url?{url:block.url}:{})}) } for(const source of outputBlocks.flatMap((b)=>b.url?[{url:b.url,...(b.title?{title:b.title}:{})}]:[])) if(!a.sources.some((x)=>x.url===source.url)) a.sources.push(source); return {mode:'alpha',action:options.action,capability:options.capability,emulation:options.capability==='native'?'native':'unknown',content:response.output,results,refs:a.refs,sources:a.sources,citations:a.sources.map((s)=>({...s})),outputBlocks,links:outputLinks(outputBlocks),pdfRefs:outputPdfRefs(outputBlocks),domains:outputDomains(outputBlocks),...(outputLineRange(outputBlocks)?{lineRange:outputLineRange(outputBlocks)}:{}),requestId:options.requestId,...(typeof response.id==='string'&&response.id?{responseId:response.id}:{}),retrievedAt:options.retrievedAt??new Date().toISOString(),warnings:options.capability==='command-capable'?['Alpha command behavior is verified, but trusted native backend provenance is unavailable.']:[],refRecords:a.refRecords} }
export function renderAlphaSearchResult(value){ const parts=[value.content]; if(value.sources?.length) parts.push(`来源：\n${value.sources.map((s)=>`- [${s.title??s.url}](${s.url})`).join('\n')}`); if(value.warnings?.length) parts.push(value.warnings.map((w)=>`警告：${w}`).join('\n')); parts.push(`检索时间：${value.retrievedAt}`); return [{type:'text',text:parts.filter(Boolean).join('\n\n')}] }
function probeFailureState(error){ if([404,405].includes(error?.status)||['LCX_ALPHA_ACTION_UNAVAILABLE','LCX_ALPHA_ACTION_FAILED'].includes(error?.code)||/channel does not support|unsupported action|not implemented/iu.test(String(error?.message??''))) return 'unsupported'; return 'unknown' }
function alphaProbeStructuredResult(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value)) return false
  seen.add(value)
  if(Array.isArray(value)) return value.some((item)=>alphaProbeStructuredResult(item,seen))
  const refId=typeof value.ref_id==='string'&&value.ref_id?value.ref_id:typeof value.id==='string'&&/^turn[\w-]+$/u.test(value.id)?value.id:undefined
  if(refId&&!isAlphaHttpUrl(refId)) return true
  if(['line','line_number','page','page_number','pageno'].some((field)=>Number.isSafeInteger(value[field]))) return true
  return Object.values(value).some((item)=>alphaProbeStructuredResult(item,seen))
}
function alphaProbeStructuredBlock(block){
  if(!isObject(block)) return false
  if((block.references??[]).some((ref)=>typeof ref==='string'&&ref&&!isAlphaHttpUrl(ref))) return true
  if((block.links??[]).some((link)=>Number.isSafeInteger(link?.id))) return true
  if((block.metadata??[]).some((item)=>item==='HTML'||item==='PDF'||/^\d+ (?:lines|pages)$/u.test(String(item)))) return true
  return (block.lines??[]).some((line)=>Number.isSafeInteger(line?.line)||Number.isSafeInteger(line?.page))
}
const ALPHA_PROBE_SEMANTIC_FAILURE=/\breference(?: id)?\s+(?:is\s+)?(?:invalid|unavailable)\b/iu
function alphaProbeResultHasEvidence(action,value){
  if(alphaCommandErrorEnvelope(value?.content,action)) return false
  if(ALPHA_PROBE_SEMANTIC_FAILURE.test(String(value?.content??''))&&!(Array.isArray(value?.results)&&value.results.length)) return false
  const refs=Array.isArray(value?.refs)&&value.refs.some((ref)=>typeof ref==='string'&&ref&&!isAlphaHttpUrl(ref))
  const links=Array.isArray(value?.links)&&value.links.some((link)=>Number.isSafeInteger(link?.id))
  const pdfRefs=Array.isArray(value?.pdfRefs)&&value.pdfRefs.some((ref)=>typeof ref==='string'&&ref&&!isAlphaHttpUrl(ref))
  const structuredResults=Array.isArray(value?.results)&&value.results.some((item)=>alphaProbeStructuredResult(item))
  const structuredBlocks=Array.isArray(value?.outputBlocks)&&value.outputBlocks.some(alphaProbeStructuredBlock)
  if(action==='find') return Boolean(refs||structuredResults||structuredBlocks)
  if(action==='click'||action==='screenshot') return Boolean(refs||pdfRefs||structuredResults||structuredBlocks)
  return Boolean(refs||links||pdfRefs||structuredResults||structuredBlocks)
}
export async function probeAlphaCapabilities({invoke,schemaFingerprint,trustedNativeProvenance=false,actionProbes={},clickProbeRef,screenshotProbeRef}){
  const actions=Object.fromEntries(ALPHA_ACTIONS.map((action)=>[action,'unknown']))
  const result={classification:'unsupported',actions,probedAt:new Date().toISOString(),schemaFingerprint,probeVersion:ALPHA_PROBE_VERSION,provenance:trustedNativeProvenance?'trusted-native':'unavailable'}
  let search
  try{ search=await invoke({action:'search_query',query:'OpenAI official documentation',responseLength:'short'}); actions.search_query='supported' }
  catch(error){ actions.search_query=probeFailureState(error); result.classification=actions.search_query==='unsupported'?'unsupported':'unknown'; return result }
  const searchUrl=search?.sources?.map((source)=>httpUrl(source?.url)).find(Boolean)
  const searchRef=search?.refs?.[0]
  const continuationTarget=searchUrl??searchRef
  if(!continuationTarget){ result.classification='emulated-search-only'; actions.open='unsupported'; actions.find='unsupported'; actions.click='unsupported'; return result }
  let opened
  try{
    opened=await invoke({action:'open',refId:continuationTarget,responseLength:'short'})
    if(!alphaProbeResultHasEvidence('open',opened)){ actions.open='unsupported'; result.classification='emulated-search-only'; return result }
    actions.open='supported'
  }catch(error){ actions.open=probeFailureState(error); result.classification=actions.open==='unsupported'?'emulated-search-only':'unknown'; return result }
  const findTarget=searchUrl??opened?.sources?.map((source)=>httpUrl(source?.url)).find(Boolean)??opened?.refs?.[0]??continuationTarget
  try{
    const found=await invoke({action:'find',refId:findTarget,pattern:'OpenAI',responseLength:'short'})
    actions.find=alphaProbeResultHasEvidence('find',found)?'supported':'unsupported'
  }catch(error){ actions.find=probeFailureState(error) }
  let clickPage=opened, clickProbeUsed=false
  if(!(clickPage?.links?.length>0)&&clickProbeRef){ clickProbeUsed=true; try{clickPage=await invoke({action:'open',refId:clickProbeRef,responseLength:'short'})}catch(error){actions.click=probeFailureState(error)} }
  const clickRef=clickPage?.refs?.[0], linkId=clickPage?.links?.[0]?.id
  if(clickRef&&Number.isSafeInteger(linkId)){
    try{const clicked=await invoke({action:'click',refId:clickRef,linkId,responseLength:'short'});actions.click=alphaProbeResultHasEvidence('click',clicked)?'supported':'unsupported'}catch(error){actions.click=probeFailureState(error)}
  }
  if(actions.find==='supported'||(actions.click==='supported'&&!clickProbeUsed)) result.classification=trustedNativeProvenance?'native':'command-capable'
  else if(actions.find==='unsupported'&&actions.click==='unsupported') result.classification='emulated-search-only'
  else result.classification='unknown'
  if(screenshotProbeRef){
    try{const pdf=await invoke({action:'open',refId:screenshotProbeRef,responseLength:'short'});const pdfRef=pdf?.pdfRefs?.[0];if(pdfRef){const shot=await invoke({action:'screenshot',refId:pdfRef,pageNumber:0,responseLength:'short'});actions.screenshot=alphaProbeResultHasEvidence('screenshot',shot)?'supported':'unsupported'}}catch(error){actions.screenshot=probeFailureState(error)}
  }
  for(const [action,args] of Object.entries(actionProbes)){ if(!['image_query','finance','weather','sports','time'].includes(action)) continue; try{const value=await invoke({action,...args,responseLength:'short'});actions[action]=alphaProbeResultHasEvidence(action,value)?'supported':'unknown'}catch(error){actions[action]=probeFailureState(error)} }
  return result
}
