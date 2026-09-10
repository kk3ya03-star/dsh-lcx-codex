import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { addTurnUsage, auxiliaryUsageOf, isSearchTool, mergeBuckets, object, type SearchUsage } from '../search-accounting.js';

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'lcx-search-usage': readonly SearchUsage[] }
}
/** A turn-local data contribution; it adds no transcript rows and keeps built-in actions. */
export const searchUsageDefinition: ConversationNodeDefinition<{turn:number;records:SearchUsage[];pending:Record<string,string>;complete:boolean}> = {
  kind:'lcx-search-usage',
  match(event) {
    if (event.type==='turn/start') return {id:String(event.data.turn),role:'start'};
    if (event.type==='turn/end' || event.type==='tool/result' || event.type==='tool/call') return {id:String(event.data.turn),role:'update'};
    return null;
  },
  start(_context,match) {
    if (match.event.type!=='turn/start') throw new Error('LCX billing requires a complete turn');
    return {turn:match.event.data.turn,records:[],pending:{},complete:false};
  },
  update(context,match) {
    const event=match.event,state=context.state,pending={...state.pending};
    if(event.type==='tool/call' && isSearchTool(event.data.name)) pending[event.data.callId]=event.data.name;
    const callId=event.type==='tool/result'?event.data.message.source.callId:undefined;
    const extra=auxiliaryUsageOf(event,callId?pending[callId]:undefined);
    if(callId)delete pending[callId];
    return {...state,pending,records:[...state.records,...extra],complete:event.type==='turn/end'};
  },
  publication:match=>match.event.type==='turn/end'?'immediate':'none',
  buildLocationData(context,scope) {
    const s=context.state;
    return scope==='turn' && s?.complete ? {kind:'turn',turn:s.turn,key:'lcx-search-usage',value:s.records}:null;
  },
};
type Entry = {component:unknown; options?:{id?:string;key?:string;order?:number;priority?:number}; locale?:string; children?:unknown; inject?:unknown; store?:unknown};
type Slots = {entriesOfSlot(name:string):readonly Entry[]; inject(name:string,callback:()=>unknown):unknown; register(options:unknown,component:unknown):unknown};
type CreateElement = (type:any,props:any,...children:any[])=>any;

/** Decorate the elected alpha.2 entry while preserving every non-component owner. */
export function installUsageSlots(slots:Slots,createElement:CreateElement):()=>void {
  const cleanups:(()=>void)[]=[];
  for (const [name,key] of [
    ['conversation.composer.dock','stats'],['conversation.composer.bar',''],['conversation.chat.node','turn-tail'],
  ] as const) {
    let effect: unknown;
    try {
      effect=slots.inject(name,()=>{
        let entries: readonly Entry[];
        try { entries=slots.entriesOfSlot(name); } catch { return; }
        if (!Array.isArray(entries) || entries.length===0) return;
        const candidates=key==='' ? [entries[0]] : entries.filter(e=>e?.options?.id===key||e?.options?.key===key);
        if (candidates.length!==1) return;
        const base=candidates[0], original=base?.component;
        if (!base || typeof original!=='function' || !base.options || typeof base.options!=='object') return;
        const descriptor=Object.getOwnPropertyDescriptor(base,'component');
        if (descriptor && descriptor.set===undefined && descriptor.writable===false) return;
        function WithSearchUsage(props:any):unknown {
          if (key==='turn-tail') {
            const location=props?.node?.location;
            const records=(location?.kind==='turn'||location?.kind==='step') && location.turn?.data?.get
              ? location.turn.data.get('lcx-search-usage') : undefined;
            if (!records?.length) return createElement(original,props);
            return createElement(original,{...props,node:{...props.node,data:{...props.node.data,tokenUsage:addTurnUsage(props.node.data.tokenUsage,records)}}});
          }
          if (typeof props?.useProjection!=='function') return createElement(original,props);
          // Always call the same hooks, including while projections are loading.
          const extra=props.useProjection('lcxSearchUsage');
          const breakdown=props.useProjection('contextBreakdown');
          const useProjection=(projection:string)=>{
            const value=props.useProjection(projection);
            if (projection==='tokenUsage' && extra?.auxiliary) return mergeBuckets(value,extra.auxiliary);
            if (projection==='contextPressure' && extra?.aggregateContext && object(breakdown)) {
              const tokens=breakdown.systemTokens+breakdown.toolsTokens+breakdown.messageTokens;
              if (Number.isSafeInteger(tokens) && tokens>=0 && object(value)) return {...value,pressureTokens:tokens,projectedTokens:tokens};
            }
            return value;
          };
          return createElement(original,{...props,useProjection});
        }
        // Alpha.2 exposes the elected StoredEntry. Mutate only its component field.
        try { base.component=WithSearchUsage; } catch { return; }
        if (base.component!==WithSearchUsage) return;
        return ()=>{if(base.component===WithSearchUsage)base.component=original;};
      });
    } catch { continue; }
    if (typeof effect==='function') cleanups.push(effect as ()=>void);
  }
  return ()=>{for(const dispose of cleanups.reverse())dispose();};
}
