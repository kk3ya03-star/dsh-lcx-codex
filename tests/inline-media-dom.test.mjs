import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {inlineMediaCss,installInlineMedia,supportsInlineMediaDom} from '../src/client/inline-media.ts';
import {extractSearchMedia} from '../src/client/search-media.ts';

const photo='https://example.com/photo.jpg', video='https://example.com/video.mp4';
const labels={image:'Enlarge image',video:'Play video',close:'Close',source:'Open source',more:'Show {count} more',less:'Show fewer',previous:'Previous image',next:'Next image'};
function fixture(body,kind='assistant-step') {
 const {window,document}=parseHTML(`<html><body><div data-chat-flow><div data-chat-flow-kind="${kind}" data-chat-turn="3">${body}</div><div data-chat-flow-kind="lcx-search-media" data-chat-turn="3"><span id="marker"></span></div></div></body></html>`);
 const observers=[],frames=new Map(),canceled=[];let nextFrame=0;
 class InstrumentedMutationObserver {
  constructor(callback){this.callback=callback;this.actual=new window.MutationObserver(callback);this.disconnectCount=0;observers.push(this)}
  observe(target,options){this.target=target;this.options=options;this.actual.observe(target,options)}
  disconnect(){this.disconnectCount++;this.actual.disconnect()}
  trigger(){this.callback([],this)}
 }
 const requestAnimationFrame=fn=>{const id=++nextFrame;frames.set(id,fn);queueMicrotask(()=>{const pending=frames.get(id);if(pending){frames.delete(id);pending()}});return id};
 const cancelAnimationFrame=id=>{canceled.push(id);frames.delete(id)};
 const saved={}; const globals={HTMLElement:window.HTMLElement,HTMLImageElement:window.HTMLImageElement,
   HTMLVideoElement:class {static [Symbol.hasInstance](value){return value?.tagName==='VIDEO'}},
   MutationObserver:InstrumentedMutationObserver,requestAnimationFrame,cancelAnimationFrame};
 for(const [key,value] of Object.entries(globals)){saved[key]=globalThis[key];globalThis[key]=value}
 const create=document.createElement.bind(document); const played=[];
 document.createElement=name=>{const el=create(name);if(name==='dialog')el.showModal=()=>{el.open=true};if(name==='video'){el.play=()=>{played.push(el);return Promise.resolve()};el.pause=()=>{el.paused=true};el.load=()=>{el.loaded=true}}return el};
 const marker=document.getElementById('marker');
 let stop;
 const dispose=()=>{stop?.();stop=undefined};
 return {document,window,played,observers,frames,canceled,start(items){stop=installInlineMedia(marker,items,labels)},dispose,cleanup(){dispose();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}
const tick=async()=>{await new Promise(resolve=>setImmediate(resolve))};
test('native list rows stay visible while only plugin previews fold',async()=>{
 const urls=Array.from({length:6},(_,i)=>`https://example.com/list-${i}.jpg`);
 const f=fixture('<ol>'+urls.map((url,i)=>`<li><p><a href="${url}"><strong>Photo ${i+1}</strong></a></p></li>`).join('')+'</ol>');
 try{
  f.start(urls.map(url=>({kind:'image',url})));
  const rows=[...f.document.querySelectorAll('li')], previews=[...f.document.querySelectorAll('.lcx-inline-media')];
  assert.equal(f.document.querySelector('[data-lcx-media-collapsed]'),null);
  assert.deepEqual(previews.map(preview=>preview.hidden),[false,false,false,false,true,true]);
  assert.deepEqual(rows.map(row=>row.querySelector('a').textContent),urls.map((_,i)=>`Photo ${i+1}`));
  assert.equal(rows.every(row=>!row.hidden&&!row.hasAttribute('data-lcx-media-collapsed')),true);
  const toggle=f.document.querySelector('.lcx-media-toggle');toggle.onclick();await tick();
  assert.equal(previews.every(preview=>!preview.hidden),true);
  toggle.onclick();await tick();assert.equal(previews[5].hidden,true);
  rows[0].querySelector('img').onerror();await tick();assert.equal(previews[4].hidden,false);
  assert.equal(rows.every(row=>!row.hidden),true);
 }finally{f.cleanup()}
 assert.equal(f.document.querySelectorAll('li a').length,6);
});

test('prose, source links, nested lists and edited rows are never mutated',async()=>{
 const urls=Array.from({length:8},(_,i)=>`https://example.com/mixed-${i}.jpg`);
 const link=i=>`<a href="${urls[i]}">Photo</a>`;
 const f=fixture('<ol>'+urls.slice(0,4).map((_,i)=>`<li>${link(i)}</li>`).join('')+
  `<li>${link(4)} Keep this explanation.</li><li>${link(5)} <a href="https://example.com/source">Source</a></li><li>${link(6)}<ul><li>Nested explanation</li></ul></li><li id="editable">${link(7)}</li></ol>`);
 try{
  const before=[...f.document.querySelectorAll('ol a')].map(anchor=>anchor.outerHTML);
  f.start(urls.map(url=>({kind:'image',url})));
  const edited=f.document.getElementById('editable');edited.append(' New explanation');await tick();
  assert.equal(f.document.querySelector('[data-lcx-media-collapsed]'),null);
  assert.deepEqual([...f.document.querySelectorAll('ol a')].map(anchor=>anchor.outerHTML),before);
  assert.equal([...f.document.querySelectorAll('li')].every(row=>!row.hidden),true);
 }finally{f.cleanup()}
});

test('direct media is placed after its link without mutating any native anchor',async()=>{
 const f=fixture(`<p><a href="${photo}" rel="author">Photo</a> explanation</p><p><a href="${video}">Video</a></p><a href="https://x.com/u/status/1">Source</a><a href="${photo}">Duplicate</a>`);
 try{
  f.start([{kind:'image',url:photo},{kind:'video',url:video}]);
  const doc=f.document,anchor=doc.querySelector('a');
  assert.equal(anchor.parentElement.lastElementChild.className,'lcx-media-strip');
  assert.equal(anchor.nextSibling.textContent,' explanation');
  assert.equal(doc.querySelectorAll('.lcx-inline-media').length,2);
  assert.equal(doc.querySelectorAll('video').length,0);
  const image=doc.querySelector('img'); assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
  image.onload(); assert.equal(image.parentElement.style.visibility,'');
  assert.equal(doc.querySelector('a[href^="https://x.com"]').hasAttribute('target'),false);
  assert.equal(anchor.getAttribute('rel'),'author');assert.equal(anchor.hasAttribute('target'),false);
  assert.equal(anchor.textContent,'Photo');assert.match(anchor.parentNode.textContent,/explanation/);
  await tick();assert.equal(doc.querySelectorAll('.lcx-inline-media').length,2);
 }finally{f.cleanup()}
 assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,0);
 assert.equal(f.document.querySelector('a').getAttribute('rel'),'author');
});
test('broken image removes its preview permanently, preserving source and following text',async()=>{
 const f=fixture(`<a href="${photo}">Photo</a> description`);
 try{f.start([{kind:'image',url:photo}]); f.document.querySelector('img').onerror();await tick();assert.equal(f.document.querySelector('.lcx-inline-media'),null);assert.equal(f.document.querySelector('a').href,photo);assert.match(f.document.body.textContent,/description/)}finally{f.cleanup()}
});
test('one dialog/player at a time; close/error/disposal releases media and leaves source links',async()=>{
 const f=fixture(`<a href="${photo}">Photo</a><a href="${video}">Video</a>`);
 try{
  f.start([{kind:'image',url:photo},{kind:'video',url:video}]);
  const [imageButton,videoButton]=f.document.querySelectorAll('.lcx-media-thumb');
  imageButton.onclick();assert.equal(f.document.querySelectorAll('dialog').length,1);
  videoButton.onclick();assert.equal(f.document.querySelectorAll('dialog').length,1);
  const player=f.document.querySelector('video');assert.equal(player.controls,true);assert.equal(player.preload,'none');assert.equal(f.played.length,1);
  f.document.querySelector('.lcx-media-close').onclick();assert.equal(player.paused,true);assert.equal(player.hasAttribute('src'),false);
  videoButton.onclick();f.document.querySelector('video').onerror();await tick();
  assert.equal(f.document.querySelector('dialog'),null);assert.equal(f.document.querySelector('a[href="'+video+'"]').href,video);
  imageButton.onclick();
 }finally{f.cleanup()}
 assert.equal(f.document.querySelector('dialog'),null);
});
test('wrong owner, foreign turn, code links and ordinary platform URLs do not create previews',()=>{
 for(const kind of ['user','tool-call']){
  const f=fixture(`<a href="${photo}">Photo</a>`,kind);try{f.start([{kind:'image',url:photo}]);assert.equal(f.document.querySelector('img'),null)}finally{f.cleanup()}
 }
 const f=fixture(`<pre><a href="${photo}">code</a></pre><a href="https://x.com/u/status/1">X video</a>`);
 try{f.start([{kind:'image',url:photo}]);assert.equal(f.document.querySelector('.lcx-inline-media'),null)}finally{f.cleanup()}
});
test('React replacing an original link removes stale preview and decorates replacement once',async()=>{
 const f=fixture(`<a href="${photo}">Photo</a>`);
 try{
  f.start([{kind:'image',url:photo}]);const old=f.document.querySelector('a');const fresh=old.cloneNode(true);old.replaceWith(fresh);await tick();
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,1);assert.equal(fresh.nextElementSibling.className,'lcx-media-strip');
 }finally{f.cleanup()}
});

test('filtered attribute observation rescans links when streaming guards are removed without duplicates',async()=>{
 const f=fixture(`<p data-streaming><a href="${photo}">Photo</a></p><p data-turn-process-inline><a href="${video}">Video</a></p>`);
 try{
  f.start([{kind:'image',url:photo},{kind:'video',url:video}]);
  assert.deepEqual(f.observers[0].options,{attributes:true,attributeFilter:['data-streaming','data-turn-process-inline','href'],childList:true,subtree:true});
  assert.equal(f.document.querySelector('.lcx-inline-media'),null);
  f.document.querySelector('[data-streaming]').removeAttribute('data-streaming');
  f.document.querySelector('[data-turn-process-inline]').removeAttribute('data-turn-process-inline');
  await tick();
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,2);
  f.observers[0].trigger();f.observers[0].trigger();await tick();
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,2);
 }finally{f.cleanup()}
});

test('href-only changes refresh the preview on the existing anchor',async()=>{
 const f=fixture(`<p><a href="${photo}">Media</a></p>`);
 try{
  f.start([{kind:'image',url:photo},{kind:'video',url:video}]);
  const anchor=f.document.querySelector('a'),oldPreview=f.document.querySelector('.lcx-inline-media'),oldButton=oldPreview.querySelector('button'),oldImage=oldPreview.querySelector('img');
  anchor.setAttribute('href',video);await tick();
  assert.equal(f.document.querySelector('a'),anchor);
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,1);
  assert.equal(f.document.querySelector('.lcx-inline-media').dataset.url,video);
  assert.equal(f.document.querySelector('.lcx-media-thumb').hasAttribute('data-video'),true);
  assert.equal(oldButton.onclick,null);assert.equal(oldImage.onload,null);assert.equal(oldImage.onerror,null);
 }finally{f.cleanup()}
});

test('href-only changes elect the first matching anchor without retaining a later duplicate',async()=>{
 const other='https://example.com/ordinary';
 const f=fixture(`<p><a href="${other}">Earlier</a> <a href="${photo}">Later</a></p>`);
 try{
  f.start([{kind:'image',url:photo}]);
  const [earlier,later]=f.document.querySelectorAll('a');
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,1);
  earlier.setAttribute('href',photo);await tick();
  assert.equal(f.document.querySelectorAll('.lcx-inline-media').length,1);
  assert.match(f.document.querySelector('.lcx-media-thumb').getAttribute('aria-label'),/Earlier$/);
  assert.equal(earlier.textContent,'Earlier');assert.equal(later.textContent,'Later');
 }finally{f.cleanup()}
});

test('disposal disconnects and cancels work while releasing every retained handler and player',()=>{
 const urls=Array.from({length:4},(_,i)=>`https://example.com/cleanup-${i}.mp4`);
 const f=fixture(`<p><a href="${photo}">Image</a> `+urls.map(url=>`<a href="${url}">Video</a>`).join(' ')+'</p>');
 try{
  f.start([{kind:'image',url:photo},...urls.map(url=>({kind:'video',url,poster:photo}))]);
  const observer=f.observers[0],buttons=[...f.document.querySelectorAll('.lcx-media-thumb')],images=buttons.map(button=>button.querySelector('img'));
  const toggle=f.document.querySelector('.lcx-media-toggle');buttons[0].onclick();
  const imageDialog=f.document.querySelector('dialog'),navButtons=[...imageDialog.querySelectorAll('.lcx-media-nav button')];
  images[1].onerror();assert.equal(images[1].isConnected,false);buttons[1].onclick();
  const dialog=f.document.querySelector('dialog'),close=dialog.querySelector('.lcx-media-close'),player=dialog.querySelector('video');
  assert.equal(navButtons.every(button=>button.onclick===null),true);
  observer.trigger();assert.equal(f.frames.size,1);
  f.dispose();f.dispose();
  assert.equal(observer.disconnectCount,1);assert.deepEqual(f.canceled,[1]);assert.equal(f.frames.size,0);
  assert.equal(toggle.onclick,null);assert.equal(buttons.every(button=>button.onclick===null),true);
  assert.equal(images.every(image=>image.onload===null&&image.onerror===null),true);
  assert.equal(close.onclick,null);assert.equal(dialog.oncancel,null);assert.equal(dialog.onclick,null);assert.equal(dialog.onkeydown,null);
  assert.equal(player.onerror,null);assert.equal(player.paused,true);assert.equal(player.hasAttribute('src'),false);assert.equal(player.loaded,true);
  assert.equal(f.document.querySelector('dialog'),null);assert.equal(f.document.querySelector('.lcx-inline-media'),null);
 }finally{f.cleanup()}
});

test('two video formats share one strip below intact parenthetical text and clean up on failure',async()=>{
 const webm='https://example.com/video.webm';
 const f=fixture(`<p><a href="${video}">MP4</a> (also <a href="${webm}">WebM</a>)</p>`);
 try{
  f.start([{kind:'video',url:video},{kind:'video',url:webm}]);
  const p=f.document.querySelector('p'),strip=p.lastElementChild;
  assert.equal(strip.className,'lcx-media-strip');assert.equal(strip.children.length,1);
  assert.equal(p.childNodes[3].textContent,')');
  assert.deepEqual([...strip.querySelectorAll('.lcx-media-format')].map(x=>x.textContent),['MP4 / WEBM']);
  strip.querySelector('button').onclick();
  const player=f.document.querySelector('video');assert.equal(player.src,video);
  player.onerror();assert.equal(player.src,webm);assert.equal(f.document.querySelector('dialog a').href,webm);
  assert.equal(f.document.querySelectorAll('dialog').length,1);assert.equal(f.played.length,2);
  player.onerror();
  await tick();assert.equal(p.textContent,'MP4 (also WebM)');assert.equal(p.querySelector('.lcx-media-strip'),null);
 }finally{f.cleanup()}
});

test('MP4 is preferred even when WebM appears first; closing stops pending fallback',()=>{
 const webm=video.replace('.mp4','.webm');const f=fixture(`<p><a href="${webm}">WebM</a> <a href="${video}">MP4</a></p>`);
 try{
  f.start([{kind:'video',url:webm},{kind:'video',url:video}]);
  assert.equal(f.document.querySelectorAll('.lcx-media-thumb').length,1);
  f.document.querySelector('button').onclick();const player=f.document.querySelector('video');
  assert.equal(player.src,video);const lateError=player.onerror;
  f.document.querySelector('.lcx-media-close').onclick();lateError();
  assert.equal(f.document.querySelector('dialog'),null);assert.equal(f.played.length,1);
 }finally{f.cleanup()}
});

test('different hosts, directories, query identities and time fragments remain separate',()=>{
 const urls=[video,'https://other.example/video.webm','https://example.com/other/video.webm',video+'?id=2',video+'#t=1,2',video+'#t=3,4'];
 const items=extractSearchMedia(urls.map((url,i)=>`[Video ${i}](${url})`).join('\n'));
 assert.equal(items.length,urls.length);
 const f=fixture('<p>'+urls.map(url=>`<a href="${url}">Video</a>`).join(' ')+'</p>');
 try{f.start(items);assert.equal(f.document.querySelectorAll('.lcx-media-thumb').length,urls.length)}finally{f.cleanup()}
});

test('answer-wide limit keeps links, defers hidden image requests and expands/collapses without duplicate controls',async()=>{
 const urls=Array.from({length:7},(_,i)=>`https://example.com/image-${i}.jpg`);
 const f=fixture(urls.map(url=>`<p><a href="${url}">Image</a></p>`).join(''));
 try{
  f.start(urls.map(url=>({kind:'image',url})));
  const previews=[...f.document.querySelectorAll('.lcx-inline-media')];
  assert.equal(previews.filter(p=>!p.hidden).length,4);
  assert.equal(f.document.querySelectorAll('a').length,7);
  assert.equal(previews[4].querySelector('img').hasAttribute('src'),false);
  const toggle=f.document.querySelector('.lcx-media-toggle');assert.equal(toggle.textContent,'Show 3 more');
  toggle.onclick();await tick();
  assert.equal(previews.filter(p=>!p.hidden).length,7);assert.equal(previews[6].querySelector('img').src,urls[6]);
  toggle.onclick();await tick();assert.equal(previews.filter(p=>!p.hidden).length,4);
  previews[0].querySelector('img').onerror();await tick();
  assert.equal(previews[4].hidden,false);assert.equal(toggle.textContent,'Show 2 more');
  assert.equal(f.document.querySelectorAll('.lcx-media-toggle').length,1);
 }finally{f.cleanup()}
 assert.equal(f.document.querySelector('.lcx-media-toggle'),null);
});

test('image viewer navigates across collapsed images, updates sources, skips failed images and stops after close',()=>{
 const urls=Array.from({length:6},(_,i)=>`https://example.com/image-${i}.jpg`);
 const f=fixture('<p>'+urls.map(url=>`<a href="${url}">Image</a>`).join(' ')+'</p>');
 try{
  f.start(urls.map(url=>({kind:'image',url})));
  f.document.querySelector('.lcx-media-thumb').onclick();
  const dialog=f.document.querySelector('dialog'), next=dialog.querySelector('[aria-label="Next image"]');
  assert.equal(dialog.querySelector('[aria-label="Previous image"]').disabled,true);
  for(let i=0;i<4;i++)next.onclick();
  assert.equal(dialog.querySelector('img').src,urls[4]);assert.equal(dialog.querySelector('a').href,urls[4]);
  assert.equal(dialog.querySelector('[aria-live]').textContent,'5 / 6');
  const stale=dialog.querySelector('img').onerror;
  dialog.onkeydown({key:'ArrowRight',preventDefault(){}});stale();
  assert.equal(dialog.querySelector('img').src,urls[5]);assert.equal(next.disabled,true);
  dialog.querySelector('img').onerror();
  assert.equal(dialog.querySelector('img').src,urls[4]);assert.equal(dialog.querySelector('[aria-live]').textContent,'5 / 5');
  const lateKey=dialog.onkeydown, lateError=dialog.querySelector('img').onerror;
  dialog.querySelector('.lcx-media-close').onclick();lateKey({key:'ArrowLeft',preventDefault(){}});lateError();
  assert.equal(f.document.querySelector('dialog'),null);
 }finally{f.cleanup()}
});

test('structured image metadata renders without a prose link and preserves provenance',()=>{
 const full='https://images.example.com/full',thumb='https://images.example.com/thumb',source='https://example.com/article';
 const f=fixture('<p>Answer prose remains unchanged.</p>');
 try{
  f.start([{kind:'image',url:full,previewUrl:thumb,sourceUrl:source,caption:'Structured image',structured:true}]);
  const preview=f.document.querySelector('.lcx-inline-media[data-structured]'), image=preview.querySelector('img');
  assert.ok(preview);assert.equal(image.src,thumb);assert.equal(f.document.querySelector('[data-chat-flow-kind="assistant-step"] p').textContent,'Answer prose remains unchanged.');
  image.onload();preview.querySelector('button').onclick();
  const dialog=f.document.querySelector('dialog');assert.equal(dialog.querySelector('img').src,full);assert.equal(dialog.querySelector('a').href,source);
 }finally{f.cleanup()}
});

test('DSH chat DOM capability guard fails closed and thumbnail CSS preserves aspect ratio',()=>{
 const f=fixture(`<a href="${photo}">Photo</a>`);
 try{
  const marker=f.document.getElementById('marker');assert.equal(supportsInlineMediaDom(marker),true);
  marker.parentElement.dataset.chatTurn='4';assert.equal(supportsInlineMediaDom(marker),false);
  f.start([{kind:'image',url:photo}]);assert.equal(f.document.querySelector('.lcx-inline-media'),null);
  assert.match(inlineMediaCss,/max-width:144px/);assert.match(inlineMediaCss,/max-height:144px/);assert.doesNotMatch(inlineMediaCss,/object-fit:cover/);
 }finally{f.cleanup()}
});

test('active media dialogs are scoped per document',()=>{
 const f1=fixture(`<a href="${video}">Video one</a>`),f2=fixture(`<a href="${video}">Video two</a>`);
 try{
  f1.start([{kind:'video',url:video}]);f2.start([{kind:'video',url:video}]);
  f1.document.querySelector('.lcx-media-thumb').onclick();f2.document.querySelector('.lcx-media-thumb').onclick();
  assert.equal(f1.document.querySelectorAll('dialog').length,1);assert.equal(f2.document.querySelectorAll('dialog').length,1);
  f1.document.querySelector('.lcx-media-close').onclick();assert.equal(f1.document.querySelector('dialog'),null);assert.equal(f2.document.querySelectorAll('dialog').length,1);
 }finally{f2.cleanup();f1.cleanup()}
});
