import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {TILE_ASPECT_MAX,TILE_ASPECT_MIN,inlineMediaCss,nativeMarkdownImageCss,installInlineMedia,supportsInlineMediaDom} from '../src/client/inline-media.ts';
import {extractDirectMediaLinks,extractDirectVideoLinks} from '../src/client/search-media.ts';

// Issue #102 ownership: DSH owns Markdown/native images; LCX owns structured provider images and direct video only.
const photo='https://example.com/photo.jpg', video='https://example.com/video.mp4';
const labels={image:'Enlarge image',video:'Play video',close:'Close',source:'Open source',failed:'Image failed to load',videoFailed:'Video cannot be played',heading:'Search images',previous:'Previous images',next:'Next images',dialog:'Video preview',imageDialog:'Image preview'};
const structured=(url,extra={})=>({kind:'image',url,structured:true,...extra});
function fixture(body,kind='assistant-step') {
 const {window,document}=parseHTML(`<html><body><div data-chat-flow>
 <div data-chat-flow-kind="user" data-chat-turn="3"></div>
 <div data-chat-flow-kind="turn-process" data-chat-turn="3"></div>
 <div data-chat-group-key='["process","tool-3",null]' data-chat-turn="3" data-step-process><div data-step-process-content data-chat-flow hidden="until-found"></div></div>
 <div data-chat-flow-kind="${kind}" data-chat-group-part="response" data-turn-process-answer="true" data-chat-turn="3">${body}</div>
 <div data-chat-group-key='["process","media-3",null]' data-chat-turn="3" data-step-process><div data-step-process-content data-chat-flow hidden="until-found"><div data-chat-flow-kind="lcx-search-media" data-chat-turn="3"><span id="marker"></span></div></div></div>
 <div data-chat-flow-kind="turn-tail" data-chat-turn="3"></div>
 </div></body></html>`);
 const observers=[],frames=new Map(),canceled=[];let nextFrame=0;
 class InstrumentedMutationObserver {
  constructor(callback){this.callback=callback;this.actual=new window.MutationObserver(callback);this.disconnectCount=0;observers.push(this)}
  observe(target,options){this.target=target;this.options=options;this.actual.observe(target,options)}
  disconnect(){this.disconnectCount++;this.actual.disconnect()}
  trigger(){this.callback([],this)}
 }
 const requestAnimationFrame=fn=>{const id=++nextFrame;frames.set(id,fn);queueMicrotask(()=>{const pending=frames.get(id);if(pending){frames.delete(id);pending()}});return id};
 const cancelAnimationFrame=id=>{canceled.push(id);frames.delete(id)};
 const saved={}; const globals={HTMLElement:window.HTMLElement,MutationObserver:InstrumentedMutationObserver,requestAnimationFrame,cancelAnimationFrame};
 for(const [key,value] of Object.entries(globals)){saved[key]=globalThis[key];globalThis[key]=value}
 const create=document.createElement.bind(document); const played=[];
 document.createElement=name=>{const el=create(name);if(name==='dialog')el.showModal=()=>{el.open=true};if(name==='video'){el.play=()=>{played.push(el);return Promise.resolve()};el.pause=()=>{el.paused=true};el.load=()=>{el.loaded=true}}return el};
 const marker=document.getElementById('marker');
 let stop;
 const dispose=()=>{stop?.();stop=undefined};
 return {document,window,played,observers,frames,canceled,answer:document.querySelector('[data-chat-group-part="response"]'),
  start(items,host){stop=installInlineMedia(marker,items,labels,host)},dispose,
  cleanup(){dispose();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}
const tick=async()=>{await new Promise(resolve=>setImmediate(resolve))};
const cards=doc=>[...doc.querySelectorAll('.lcx-media-tile')];
const cssRule=selector=>{const start=inlineMediaCss.indexOf(selector+'{');assert.notEqual(start,-1,`CSS rule ${selector}`);return inlineMediaCss.slice(start,inlineMediaCss.indexOf('}',start)+1)};

test('ownership: pages never render; prose image links join the rail after provider images, prose untouched',async()=>{
 const f=fixture(`<p><a href="${photo}">Photo</a> and <a href="https://x.com/u/status/1">Source</a></p>`);
 try{
  const before=f.answer.innerHTML;
  f.start([{kind:'page',url:'https://example.com/page'}]);
  assert.equal(f.document.querySelector('.lcx-media'),null,'a page link alone renders nothing');
  assert.equal(f.observers.length,0);
  f.dispose();
  f.start([{kind:'image',url:photo},structured('https://images.example.com/provider.jpg',{sourceUrl:'https://example.com/a'})]);
  assert.deepEqual(cards(f.document).map(tile=>tile.dataset.url),['https://images.example.com/provider.jpg',photo],'provider candidates first, prose links after');
  const prose=cards(f.document)[1];
  assert.equal(prose.querySelector('a.lcx-media-chip'),null);assert.equal(prose.querySelector('span.lcx-media-chip').textContent,'example.com');
  assert.equal(f.answer.innerHTML.startsWith(before),true,'React-owned prose and links are untouched');
 }finally{f.cleanup()}
});

test('a prose image that fails to load leaves the rail; the block hides when nothing remains',()=>{
 const f=fixture('<p>x</p>');
 try{
  f.start([{kind:'image',url:photo},{kind:'image',url:'https://example.com/b.png'},structured('https://images.example.com/p.jpg')]);
  const rail=f.document.querySelector('.lcx-media-rail');assert.equal(rail.dataset.count,'3');
  const prose=cards(f.document).find(tile=>tile.dataset.url===photo);prose.querySelector('img').onerror();
  assert.equal(prose.isConnected,false);assert.equal(cards(f.document).length,2);assert.equal(rail.dataset.count,'2');
  const provider=cards(f.document).find(tile=>tile.dataset.url==='https://images.example.com/p.jpg');provider.querySelector('img').onerror();
  assert.equal(provider.dataset.state,'failed','provider candidates keep their quiet placeholder');
 }finally{f.cleanup()}
 const g=fixture('<p>x</p>');
 try{
  g.start([{kind:'image',url:photo}]);
  g.document.querySelector('.lcx-media-open img').onerror();
  assert.equal(g.document.querySelector('.lcx-media-rail'),null);
  assert.equal(g.document.querySelector('.lcx-media').hidden,true);
  assert.match(inlineMediaCss,/\.lcx-media\[hidden\]\{display:none\}/);
 }finally{g.cleanup()}
 const h=fixture('<p>x</p>');
 try{
  h.start([{kind:'image',url:photo},{kind:'video',url:video}]);
  h.document.querySelector('.lcx-media-open img').onerror();
  assert.equal(h.document.querySelector('.lcx-media').hidden,false,'videos keep the block visible');
 }finally{h.cleanup()}
});

test('ownership: prose extraction yields direct videos only and video pages stay links',()=>{
 const text=`![native](${photo})\n[image link](${photo})\n${photo}\n[clip](${video})\nhttps://youtube.com/watch?v=abc\nhttps://vimeo.com/123`;
 assert.deepEqual(extractDirectVideoLinks(text),[{kind:'video',url:video}]);
});

test('structured images render as one borderless rail under the response without touching answer prose',async()=>{
 const full='https://images.example.com/full',thumb='https://images.example.com/thumb',source='https://www.example.com/article';
 const f=fixture('<p>Answer prose remains unchanged.</p>');
 try{
  const before=f.answer.innerHTML;
  f.start([structured(full,{previewUrl:thumb,sourceUrl:source,caption:'Structured image'})]);
  assert.equal(f.document.querySelectorAll('.lcx-media').length,1);
  assert.equal(f.answer.lastElementChild.className,'lcx-media');
  assert.equal(f.answer.firstElementChild.outerHTML,'<p>Answer prose remains unchanged.</p>');
  assert.equal(f.answer.innerHTML.startsWith(before),true);
  const rail=f.document.querySelector('.lcx-media-rail'),track=rail.querySelector('ul.lcx-media-track');
  assert.equal(rail.dataset.count,'1','a single image gets the larger row height');
  assert.equal(track.getAttribute('role'),'list');assert.equal(track.getAttribute('aria-label'),'Search images · 1');
  const [tile]=cards(f.document),image=tile.querySelector('img'),button=tile.querySelector('button.lcx-media-open');
  assert.equal(tile.dataset.state,'loading');
  assert.equal(image.src,thumb);assert.equal(image.alt,'');assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
  assert.equal(image.referrerPolicy,'no-referrer');
  assert.equal(button.getAttribute('aria-label'),'Enlarge image · Structured image');assert.equal(button.title,'Structured image');
  // Attribution is an overlay chip linking to the source page; no caption/meta rows under the image.
  const chip=tile.querySelector('a.lcx-media-chip');
  assert.equal(chip.href,source);assert.equal(chip.textContent,'example.com');assert.equal(chip.target,'_blank');assert.equal(chip.rel,'noopener noreferrer');
  assert.equal(chip.title,'Structured image · example.com');
  assert.equal(f.document.querySelector('.lcx-media-caption, .lcx-media-meta, .lcx-media-heading'),null);
  Object.defineProperty(image,'naturalWidth',{value:1600});Object.defineProperty(image,'naturalHeight',{value:900});
  image.onload();assert.equal(tile.dataset.state,'loaded');
  assert.equal(tile.style.getPropertyValue('--lcx-ar'),String(1600/900),'tile follows the natural proportions');
 }finally{f.cleanup()}
 assert.equal(f.document.querySelector('.lcx-media'),null);
});

test('tiles reserve a shared row height before load and clamp extreme proportions',()=>{
 const urls=Array.from({length:5},(_,i)=>`https://images.example.com/${i}.jpg`);
 const f=fixture('<p>Answer</p>');
 try{
  f.start(urls.map(url=>structured(url)));
  assert.equal(cards(f.document).length,5);
  assert.equal(f.document.querySelector('.lcx-media-rail').dataset.count,'3');
  const snapshot=f.document.querySelector('.lcx-media').outerHTML;
  const images=[...f.document.querySelectorAll('img')];
  const sizes=[[4000,500],[300,2000],[640,480]];
  for(const [index,[w,h]] of sizes.entries()){Object.defineProperty(images[index],'naturalWidth',{value:w});Object.defineProperty(images[index],'naturalHeight',{value:h});images[index].onload()}
  assert.equal(cards(f.document)[0].style.getPropertyValue('--lcx-ar'),String(TILE_ASPECT_MAX));
  assert.equal(cards(f.document)[1].style.getPropertyValue('--lcx-ar'),String(TILE_ASPECT_MIN));
  assert.equal(cards(f.document)[2].style.getPropertyValue('--lcx-ar'),String(640/480));
  assert.deepEqual(cards(f.document).slice(0,3).map(tile=>tile.dataset.fit),['contain','contain',undefined],'clamped images are shown whole, in-range ones fill the tile');
  assert.match(inlineMediaCss,/\.lcx-media-tile\[data-fit="contain"\] \.lcx-media-open img\{object-fit:contain\}/);
  images[3].onload();assert.equal(cards(f.document)[3].style.getPropertyValue('--lcx-ar'),'','unknown dimensions keep the reserved 4:3 slot');
  assert.equal(cards(f.document).length,5);
  assert.equal(snapshot.includes('lcx-media-fail'),false);
  // Geometry lives in CSS: fixed row height per count, reserved 4:3 default, cover inside the proportional tile.
  assert.match(cssRule('.lcx-media-tile'),/height:var\(--lcx-h\)/);
  assert.match(cssRule('.lcx-media-tile'),/aspect-ratio:var\(--lcx-ar,4\/3\)/);
  assert.match(cssRule('.lcx-media-open img'),/object-fit:cover/);
  assert.match(cssRule('.lcx-media-rail[data-count="1"]'),/--lcx-h:220px/);
  assert.match(cssRule('.lcx-media-rail[data-count="2"]'),/--lcx-h:176px/);
  assert.doesNotMatch(inlineMediaCss,/lcx-media-strip|data-collapsed|lcx-media-less/,'no +N tile or collapse control remains');
 }finally{f.cleanup()}
});

test('thumbnail failure falls back to the full image once, then keeps a quiet placeholder and the source chip',()=>{
 const full='https://images.example.com/full.png',thumb='https://images.example.com/thumb.png',source='https://example.com/a';
 const f=fixture('<p>Answer</p>');
 try{
  f.start([structured(full,{previewUrl:thumb,sourceUrl:source,caption:'Broken'}),structured('https://images.example.com/ok.png')]);
  const [broken]=cards(f.document),image=broken.querySelector('img');
  image.onerror();assert.equal(image.src,full);assert.equal(broken.dataset.state,'loading');
  image.onerror();
  assert.equal(broken.dataset.state,'failed');assert.equal(cards(f.document).length,2);
  const button=broken.querySelector('button');
  assert.equal(button.disabled,true);assert.equal(broken.querySelector('img'),null);
  assert.ok(broken.querySelector('.lcx-media-fail svg'));
  assert.equal(button.getAttribute('aria-label'),'Image failed to load · Broken');assert.equal(button.title,'Image failed to load');
  assert.equal(broken.querySelector('a.lcx-media-chip').href,source);
  button.onclick?.();assert.equal(f.document.querySelector('dialog'),null);
 }finally{f.cleanup()}
});

test('overflow scrolls horizontally: edge fades and arrow buttons follow the real scroll position',()=>{
 const urls=Array.from({length:9},(_,i)=>`https://images.example.com/${i}.jpg`);
 const f=fixture('<p>Answer</p>');
 try{
  f.start(urls.map(url=>structured(url)));
  const rail=f.document.querySelector('.lcx-media-rail'),track=rail.querySelector('.lcx-media-track');
  const [prev,next]=rail.querySelectorAll('button.lcx-media-nav');
  assert.equal(cards(f.document).length,9,'every image is present from first render');
  assert.equal(prev.dataset.dir,'prev');assert.equal(next.dataset.dir,'next');
  assert.equal(prev.getAttribute('aria-label'),'Previous images');assert.equal(next.getAttribute('aria-label'),'Next images');
  assert.equal(prev.hidden,true);assert.equal(next.hidden,true);assert.equal(prev.tabIndex,-1);
  let scrolled=[];
  Object.defineProperties(track,{scrollWidth:{configurable:true,value:1800},clientWidth:{configurable:true,value:600},scrollLeft:{configurable:true,writable:true,value:0}});
  track.scrollBy=options=>{scrolled.push(options.left)};
  track.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(prev.hidden,true);assert.equal(next.hidden,false);
  assert.equal(rail.hasAttribute('data-more-left'),false);assert.equal(rail.hasAttribute('data-more-right'),true);
  next.onclick();assert.deepEqual(scrolled,[480]);
  track.scrollLeft=600;track.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(prev.hidden,false);assert.equal(next.hidden,false);
  prev.onclick();assert.deepEqual(scrolled,[480,-480]);
  track.scrollLeft=1200;track.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(next.hidden,true);assert.equal(rail.hasAttribute('data-more-right'),false);assert.equal(rail.hasAttribute('data-more-left'),true);
  for(const image of f.document.querySelectorAll('img'))image.onerror();
  assert.equal(cards(f.document).length,9,'failures never change the tile count');
  assert.match(cssRule('.lcx-media-track'),/overflow-x:auto/);
  assert.match(cssRule('.lcx-media-track'),/mask-image:linear-gradient/);
 }finally{f.cleanup()}
 assert.equal(f.document.querySelector('.lcx-media'),null);
});

test('structured deduplication ignores fragments only and never merges distinct signed or CDN urls',()=>{
 const f=fixture('<p>Answer</p>');
 try{
  f.start([structured('https://cdn.example.com/a.jpg?sig=1#one'),structured('https://cdn.example.com/a.jpg?sig=1#two'),
   structured('https://cdn.example.com/a.jpg?sig=2'),structured('https://cdn2.example.com/a.jpg?sig=1')]);
  assert.equal(cards(f.document).length,3);
  assert.deepEqual(cards(f.document).map(card=>card.dataset.url),['https://cdn.example.com/a.jpg?sig=1#one','https://cdn.example.com/a.jpg?sig=2','https://cdn2.example.com/a.jpg?sig=1']);
 }finally{f.cleanup()}
});

test('direct video renders a user-initiated card that expands into an inline player; nothing loads before click',()=>{
 const f=fixture('<p>See the clip.</p>');
 try{
  f.start([{kind:'video',url:video,poster:undefined}]);
  const card=f.document.querySelector('button.lcx-media-video');
  assert.equal(card.getAttribute('aria-label'),'Play video · video.mp4');
  assert.equal(card.querySelector('.lcx-media-video-title').textContent,'video.mp4');
  assert.equal(card.querySelector('.lcx-media-video-sub').textContent,'example.com · MP4');
  assert.ok(card.querySelector('.lcx-media-play svg'),'visible play affordance');
  assert.equal(f.document.querySelectorAll('video').length,0);assert.equal(f.document.querySelectorAll('dialog').length,0);
  assert.equal(f.played.length,0);
  let focused=0;card.focus=()=>{focused++};
  card.onclick();
  const player=f.document.querySelector('.lcx-media-player'),media=player.querySelector('video');
  assert.equal(card.isConnected,false,'the card is replaced in place by the player');
  assert.equal(f.document.querySelectorAll('dialog').length,0,'no modal for video');
  assert.equal(player.getAttribute('role'),'group');assert.equal(player.getAttribute('aria-label'),'Video preview · video.mp4');
  assert.equal(media.controls,true);assert.equal(media.preload,'none');assert.equal(Boolean(media.autoplay),false);
  assert.equal(media.src,video);assert.equal(f.played.length,1);
  const close=player.querySelector('.lcx-media-player-close');assert.equal(close.getAttribute('aria-label'),'Close');
  // Escape collapses back to the card, releases the media and restores focus.
  let prevented=false;player.onkeydown({key:'Escape',preventDefault(){prevented=true}});
  assert.equal(prevented,true);assert.equal(player.isConnected,false);assert.equal(card.isConnected,true);
  assert.equal(media.paused,true);assert.equal(media.hasAttribute('src'),false);assert.equal(focused,1);
  card.onclick();f.document.querySelector('.lcx-media-player-close').onclick();
  assert.equal(f.document.querySelector('.lcx-media-player'),null);assert.equal(focused,2);
 }finally{f.cleanup()}
});

test('video: equivalent-source fallback is bounded and the final failure stays readable inline',()=>{
 const webm='https://example.com/video.webm';
 const f=fixture('<p>x</p>');
 try{
  f.start([{kind:'video',url:webm},{kind:'video',url:video}]);
  assert.equal(f.document.querySelectorAll('button.lcx-media-video').length,1,'alternate encodings share one card');
  assert.equal(f.document.querySelector('.lcx-media-video-sub').textContent,'example.com · MP4 / WEBM');
  f.document.querySelector('button.lcx-media-video').onclick();
  const media=f.document.querySelector('video');assert.equal(media.src,video);
  media.onerror();assert.equal(media.src,webm);assert.equal(f.played.length,2);
  media.onerror();
  assert.equal(f.document.querySelector('video'),null);
  const fail=f.document.querySelector('.lcx-media-player-fail');
  assert.equal(fail.querySelector('span').textContent,'Video cannot be played');
  assert.equal(fail.querySelector('a').href,video);assert.equal(fail.querySelector('a').textContent,'Open source');
  f.document.querySelector('.lcx-media-player-close').onclick();assert.equal(f.document.querySelector('.lcx-media-player'),null);
  assert.ok(f.document.querySelector('button.lcx-media-video'));
 }finally{f.cleanup()}
});

test('different hosts, directories, query identities and time fragments remain separate video cards',()=>{
 const urls=[video,'https://other.example/video.webm','https://example.com/other/video.webm',video+'?id=2',video+'#t=1,2',video+'#t=3,4'];
 const items=extractDirectVideoLinks(urls.map((url,i)=>`[Video ${i}](${url})`).join('\n'));
 assert.equal(items.length,urls.length);
 const f=fixture('<p>x</p>');
 try{f.start(items);assert.equal(f.document.querySelectorAll('button.lcx-media-video').length,urls.length)}finally{f.cleanup()}
});

test("DSH's public ImageLightbox is used for structured images when the host supplies it",()=>{
 const f=fixture('<p>x</p>');
 const opened=[];let disposed=0;
 const host={openImage(options){opened.push(options);return()=>{disposed++}}};
 try{
  f.start([structured('https://images.example.com/full.jpg',{caption:'Caption',sourceUrl:'https://example.com/s'})],host);
  const button=cards(f.document)[0].querySelector('button');let focused=0;button.focus=()=>{focused++};
  button.onclick();
  assert.equal(f.document.querySelector('dialog'),null,'no LCX dialog when native lightbox is available');
  assert.equal(opened.length,1);
  assert.deepEqual({src:opened[0].src,alt:opened[0].alt,labels:opened[0].labels},{src:'https://images.example.com/full.jpg',alt:'Caption',labels:{dialog:'Image preview',close:'Close'}});
  opened[0].onClose();opened[0].onClose();
  assert.equal(disposed,1);assert.equal(focused,1);
  button.onclick();assert.equal(opened.length,2);
  f.dispose();assert.equal(disposed,2,'unmount closes an open native lightbox');
 }finally{f.cleanup()}
});

test('image dialog fallback is LCX-owned, contained, traps focus and fails visibly when the lightbox host is unavailable',()=>{
 for(const host of [undefined,{openImage:()=>null}]){
  const f=fixture('<p>x</p>');
  try{
   f.start([structured('https://images.example.com/full.jpg',{caption:'Caption',sourceUrl:'https://example.com/s'}),structured('https://images.example.com/two.jpg')],host);
   const [one,two]=cards(f.document).map(tile=>tile.querySelector('button'));
   one.onclick();two.onclick();assert.equal(f.document.querySelectorAll('dialog').length,1,'one dialog at a time');
   one.onclick();
   const dialog=f.document.querySelector('dialog'),image=dialog.querySelector('img');
   assert.equal(dialog.dataset.kind,'image');assert.equal(dialog.getAttribute('aria-label'),'Image preview');assert.equal(image.src,'https://images.example.com/full.jpg');assert.equal(image.alt,'Caption');
   assert.equal(dialog.querySelector('a').href,'https://example.com/s');assert.equal(dialog.querySelector('a').textContent,'Open source');
   dialog.onclick({target:image});assert.equal(f.document.querySelectorAll('dialog').length,1,'clicks inside the panel do not dismiss');
   const focusables=[...dialog.querySelectorAll('button:not([disabled]),a[href]')];
   Object.defineProperty(f.document,'activeElement',{configurable:true,get:()=>focusables.at(-1)});
   let moved=0,prevented=false;focusables[0].focus=()=>{moved++};
   dialog.onkeydown({key:'Tab',shiftKey:false,preventDefault(){prevented=true}});
   assert.equal(prevented,true);assert.equal(moved,1);
   image.onerror();
   assert.equal(f.document.querySelector('.lcx-media-dialog-fail').textContent,'Image failed to load');
   dialog.onclick({target:dialog});assert.equal(f.document.querySelector('dialog'),null);
   two.onclick();let cancelled=false;f.document.querySelector('dialog').oncancel({preventDefault(){cancelled=true}});
   assert.equal(cancelled,true);assert.equal(f.document.querySelector('dialog'),null);
   two.onclick();f.document.querySelector('.lcx-media-close').onclick();assert.equal(f.document.querySelector('dialog'),null);
  }finally{f.cleanup()}
 }
});

test('rerender and reinstall keep exactly one block per response; the older instance cannot fight the newer one',async()=>{
 const f=fixture('<p>x</p>');
 let stopSecond;
 try{
  const marker=f.document.getElementById('marker');
  f.start([structured('https://images.example.com/a.jpg')]);
  const first=f.document.querySelector('.lcx-media');
  stopSecond=installInlineMedia(marker,[structured('https://images.example.com/b.jpg')],labels);
  assert.equal(f.document.querySelectorAll('.lcx-media').length,1);
  assert.equal(first.isConnected,false);
  assert.equal(f.document.querySelector('.lcx-media-tile').dataset.url,'https://images.example.com/b.jpg');
  f.dispose();assert.equal(f.document.querySelectorAll('.lcx-media').length,1,'disposing the older instance keeps the newer block');
  // React appends a later child: the LCX block moves back to the end; if the subtree is replaced it is re-attached.
  const second=f.document.querySelector('.lcx-media');
  f.answer.insertAdjacentHTML('beforeend','<p id="late">late</p>');
  f.observers.at(-1).trigger();await tick();
  assert.equal(f.answer.lastElementChild,second);assert.equal(f.document.getElementById('late').nextElementSibling,second);
  second.remove();f.observers.at(-1).trigger();await tick();
  assert.equal(f.answer.lastElementChild,second);assert.equal(f.document.querySelectorAll('.lcx-media').length,1);
  f.observers.at(-1).trigger();f.observers.at(-1).trigger();await tick();
  assert.equal(f.document.querySelectorAll('.lcx-media').length,1);
  stopSecond();stopSecond=undefined;
  assert.equal(f.document.querySelectorAll('.lcx-media').length,0);assert.equal(f.answer.hasAttribute('data-lcx-media-owner'),false);
 }finally{stopSecond?.();f.cleanup()}
});

test('unmount disconnects the observer, cancels pending work, clears every handler and removes only LCX nodes',()=>{
 const f=fixture('<p id="prose">Answer <a href="https://example.com/a.mp4">link</a></p>');
 try{
  const before=f.answer.querySelector('#prose').outerHTML;
  f.start([structured('https://images.example.com/a.jpg'),structured('https://images.example.com/b.jpg',{sourceUrl:'https://example.com/b'}),{kind:'video',url:video}]);
  const observer=f.observers[0];
  const opens=[...f.document.querySelectorAll('.lcx-media-open')],navs=[...f.document.querySelectorAll('.lcx-media-nav')],images=[...f.document.querySelectorAll('.lcx-media-open img')];
  const card=f.document.querySelector('.lcx-media-video');card.onclick();
  const player=f.document.querySelector('.lcx-media-player'),close=player.querySelector('.lcx-media-player-close'),media=player.querySelector('video');
  let focused=0;card.focus=()=>{focused++};
  observer.trigger();assert.equal(f.frames.size,1);
  f.dispose();f.dispose();
  assert.equal(observer.disconnectCount,1);assert.deepEqual(f.canceled,[1]);assert.equal(f.frames.size,0);
  assert.equal(opens.every(button=>button.onclick===null&&button.onfocus===null),true);
  assert.equal(navs.every(button=>button.onclick===null),true);
  assert.equal(card.onclick,null);
  assert.equal(images.every(image=>image.onload===null&&image.onerror===null),true);
  assert.equal(close.onclick,null);assert.equal(player.onkeydown,null);
  assert.equal(media.onerror,null);assert.equal(media.paused,true);assert.equal(media.hasAttribute('src'),false);assert.equal(media.loaded,true);
  assert.equal(focused,0,'unmount never steals focus');
  assert.equal(f.document.querySelector('dialog'),null);assert.equal(f.document.querySelector('.lcx-media'),null);
  assert.equal(f.answer.querySelector('#prose').outerHTML,before,'React-owned prose and links are untouched');
 }finally{f.cleanup()}
});

test('wrong owner, foreign turn and unknown renderers fail closed',()=>{
 for(const kind of ['user','tool-call']){
  const f=fixture('<p>x</p>',kind);try{f.start([structured('https://images.example.com/a.jpg')]);assert.equal(f.document.querySelector('.lcx-media'),null)}finally{f.cleanup()}
 }
 const f=fixture('<p>x</p>');
 try{
  const marker=f.document.getElementById('marker');assert.equal(supportsInlineMediaDom(marker),true);
  marker.parentElement.dataset.chatTurn='4';assert.equal(supportsInlineMediaDom(marker),false);
  marker.parentElement.dataset.chatTurn='3';
  marker.closest('[data-chat-group-key]').dataset.chatTurn='4';assert.equal(supportsInlineMediaDom(marker),false);
  f.start([structured('https://images.example.com/a.jpg')]);assert.equal(f.document.querySelector('.lcx-media'),null);
 }finally{f.cleanup()}
 const {document}=parseHTML(`<html><body><div data-chat-flow><div data-chat-flow-kind="assistant-step" data-chat-turn="3"><p>x</p></div><div data-chat-flow-kind="lcx-search-media" data-chat-turn="3"><span id="marker"></span></div></div></body></html>`);
 assert.equal(supportsInlineMediaDom(document.getElementById('marker')),false);
});

test('DSH 0.2 process groups place two turns of media under their own answers and clean up independently',()=>{
 const f=fixture('<p id="answer-3">First</p>');
 let stopSecond;
 try{
  const column=f.document.querySelector('[data-chat-flow]');
  column.insertAdjacentHTML('beforeend',`
   <div data-chat-flow-kind="user" data-chat-turn="4"></div>
   <div data-chat-group-key='["process","tool-4",null]' data-chat-turn="4" data-step-process><div data-step-process-content data-chat-flow hidden="until-found"></div></div>
   <div data-chat-flow-kind="assistant-step" data-chat-group-part="response" data-turn-process-answer="true" data-chat-turn="4"><p id="answer-4">Second</p></div>
   <div data-chat-group-key='["process","media-4",null]' data-chat-turn="4" data-step-process><div data-step-process-content data-chat-flow hidden="until-found"><div data-chat-flow-kind="lcx-search-media" data-chat-turn="4"><span id="marker-4"></span></div></div></div>
   <div data-chat-flow-kind="turn-tail" data-chat-turn="4"></div>`);
  const marker4=f.document.getElementById('marker-4');
  assert.equal(supportsInlineMediaDom(marker4),true);
  f.start([structured('https://images.example.com/first.jpg')]);
  stopSecond=installInlineMedia(marker4,[structured('https://images.example.com/second.jpg')],labels);
  assert.equal(f.document.querySelector('[data-chat-turn="3"] .lcx-media-tile')?.dataset.url,'https://images.example.com/first.jpg');
  assert.equal(f.document.querySelector('[data-chat-turn="4"][data-chat-group-part="response"] .lcx-media-tile')?.dataset.url,'https://images.example.com/second.jpg');
  assert.equal(f.document.querySelectorAll('[data-step-process-content] .lcx-media').length,0);
  stopSecond();stopSecond=undefined;
  assert.equal(f.document.querySelectorAll('.lcx-media').length,1);
  f.dispose();assert.equal(f.document.querySelectorAll('.lcx-media').length,0);
 }finally{stopSecond?.();f.cleanup()}
});

test('active image dialogs are scoped per document',()=>{
 const f1=fixture('<p>one</p>'),f2=fixture('<p>two</p>');
 try{
  f1.start([structured(photo)]);f2.start([structured(photo)]);
  cards(f1.document)[0].querySelector('button').onclick();cards(f2.document)[0].querySelector('button').onclick();
  assert.equal(f1.document.querySelectorAll('dialog').length,1);assert.equal(f2.document.querySelectorAll('dialog').length,1);
  f1.document.querySelector('.lcx-media-close').onclick();assert.equal(f1.document.querySelector('dialog'),null);assert.equal(f2.document.querySelectorAll('dialog').length,1);
 }finally{f2.cleanup();f1.cleanup()}
});

test('theme: chrome uses DSH light/dark tokens, no dark-only colours, reduced motion, touch and responsive rules exist',()=>{
 for(const token of ['--dsw-alias-border-l2','--dsw-alias-border-l3','--dsw-alias-bg-skeleton','--dsw-alias-bg-layer-1','--dsw-alias-interactive-bg-hover','--dsw-alias-label-primary','--dsw-alias-label-primary-foreground','--dsw-alias-label-secondary','--dsw-alias-label-tertiary','--dsw-alias-bg-mask-1','--dsw-mask-blur','--dsw-radius-md','--dsw-alias-link','--dsw-focus-ring-width','--dsw-elevation-prominent'])
  assert.ok(inlineMediaCss.includes(token),token);
 assert.match(cssRule('.lcx-media-dialog'),/background:var\(--dsw-alias-bg-mask-1/);
 // Fixed colours are only allowed on overlays drawn over media (chip, player chrome), never on page chrome.
 for(const legacy of ['#15171b','#080b12','#c6d7ff','color:#fff;font:12px','--dsw-specific-input-major'])assert.equal(inlineMediaCss.includes(legacy),false,legacy);
 assert.match(inlineMediaCss,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(inlineMediaCss,/@media\(max-width:520px\)/);
 assert.match(inlineMediaCss,/@media\(hover:none\)\{\.lcx-media-chip\{opacity:1;transform:none\}\.lcx-media-nav\{display:none\}\}/);
 assert.doesNotMatch(inlineMediaCss,/max-width:144px/);
 assert.match(inlineMediaCss,/--dsw-focus-ring-color/);
});

test('native Markdown images in assistant responses start their own line; the rule is structural and scoped',()=>{
 const rule=nativeMarkdownImageCss.trim();
 assert.equal(rule,'[data-chat-flow-kind="assistant-step"] p>button:has(>img:only-child){display:block;width:fit-content;max-width:100%;margin:4px 0 8px}');
 assert.doesNotMatch(rule,/_[a-zA-Z]+_[0-9a-z]{5}_[0-9]+/,'never depends on hashed DSH class names');
 const {document}=parseHTML(`<html><body><div data-chat-flow-kind="assistant-step"><p><button><img src="${photo}"></button>
<a href="https://example.com/">link</a></p><p><button><img src="${photo}"><span>x</span></button></p></div><div data-chat-flow-kind="user"><p><button><img src="${photo}"></button></p></div></body></html>`);
 const selector=rule.slice(0,rule.indexOf('{'));
 const matched=[...document.querySelectorAll(selector.replace(':has(>img:only-child)',''))].filter(button=>button.children.length===1&&button.firstElementChild.tagName==='IMG');
 assert.equal(matched.length,1,'only an assistant-response image wrapper whose only child is the image');
});
