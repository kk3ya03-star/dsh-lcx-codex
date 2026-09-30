import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDirectMediaLinks, extractDirectVideoLinks, mergeSearchMedia, SEARCH_MEDIA_LIMIT, structuredSearchMedia } from '../src/client/search-media.ts';
const img='https://example.com/a.jpg', vid='https://example.com/b.mp4';
const urls=text=>extractDirectVideoLinks(text).map(item=>item.url);
const tick=String.fromCharCode(96), fence=tick.repeat(3);

// Issue #102 ownership: DSH 0.2 owns Markdown images. LCX takes plain direct image links and
// direct video files from the answer text; pages and video sites stay ordinary links.
test('media: plain direct image links and direct videos are extracted in text order; pages stay links',()=>{
  const image='https://developer.mozilla.org/shared-assets/images/examples/flowers.jpg';
  const video='https://developer.mozilla.org/shared-assets/videos/flower.mp4';
  const all=text=>extractDirectMediaLinks(text).map(item=>item.kind+' '+item.url);
  assert.deepEqual(all('[Flowers]('+image+')\n[Flower]('+video+')'),['image '+image,'video '+video]);
  assert.deepEqual(all([image,'https://images.unsplash.com/photo-1?w=200','https://example.com/a.webp','https://example.com/b.PNG','https://example.com/c.gif?x=1'].join('\n')),
    ['image '+image,'image https://images.unsplash.com/photo-1?w=200','image https://example.com/a.webp','image https://example.com/b.PNG','image https://example.com/c.gif?x=1']);
  assert.deepEqual(all('https://example.com/page\nhttps://example.com/a.svg\nhttps://images.unsplash.com/x.svg\nhttps://youtube.com/watch?v=1\nhttps://example.com/a.html'),[],'pages, SVG and video sites stay links');
  assert.deepEqual(all(image+'\n'+image+'#frag\n[again]('+image+')'),['image '+image],'fragments deduplicate images');
  assert.deepEqual(urls('[Flowers]('+image+')\n[Flower]('+video+')'),[video],'extractDirectVideoLinks stays video-only');
  assert.equal(extractDirectMediaLinks(image)[0].structured,undefined,'prose images are never marked structured');
});
test('media: images DSH renders natively are never duplicated, even when also linked',()=>{
  const all=text=>extractDirectMediaLinks(text).map(item=>item.url);
  assert.deepEqual(all('![shown]('+img+')\n'+img+'\n[again]('+img+'#x)'),[]);
  assert.deepEqual(all('![shown][photo]\n'+img+'\n[photo]: '+img),[]);
  assert.deepEqual(all('![shown]('+img+')\nhttps://example.com/other.jpg'),['https://example.com/other.jpg']);
});
test('media: native Markdown images never become LCX media and do not leak their destination',()=>{
  assert.deepEqual(urls('![shown]('+img+')\n[duplicate]('+img+')\n[video]('+vid+')'),[vid]);
  assert.deepEqual(urls('![shown][photo]\n[duplicate]('+img+')\n[photo]: '+img+'\n[video]('+vid+')'),[vid]);
  assert.deepEqual(urls('![photo]\n[photo]: '+img+'\n'+vid),[vid]);
  assert.deepEqual(urls('![clip]('+vid+')'),[],'video syntax inside an image is a native image, not a link');
});
test('media: emoji before an image does not erase a following video',()=>{
  assert.deepEqual(urls('😀'.repeat(5)+' ![shown]('+img+')\n'+vid),[vid]);
});
test('media: fenced, unfinished, inline and indented code is excluded',()=>{
  for(const input of [fence+'txt\n'+vid+'\n'+fence,fence+'txt\n'+vid,fence+'txt\n'+fence+'not-a-close\n'+vid,tick+vid+tick,'    '+vid,'\t'+vid,'> '+fence+'\n> '+vid+'\n> '+fence])
    assert.deepEqual(urls(input),[],input);
  assert.deepEqual(urls(fence+'txt\n'+vid+'\n'+fence+'\n'+vid),[vid]);
});
test('media: Chinese punctuation stays outside media URLs',()=>{
  for(const input of ['[视频]('+vid+')。','“'+vid+'”','视频：'+vid+'。'])
    assert.deepEqual(urls(input),[vid],input);
});
test('media: identical video urls deduplicate but distinct fragments and queries stay separate',()=>{
  const first='https://EXAMPLE.COM/a.MP4?size=640#t=1';
  assert.deepEqual(urls(first+'\nhttps://example.com/a.MP4?size=640#t=1'),['https://example.com/a.MP4?size=640#t=1']);
  assert.deepEqual(urls(first+'\nhttps://example.com/a.MP4?size=640#t=2'),['https://example.com/a.MP4?size=640#t=1','https://example.com/a.MP4?size=640#t=2']);
});
test('media: only supported direct video formats get cards; video pages stay links',()=>{
  assert.deepEqual(urls('https://youtube.com/watch?v=abc\nhttps://vimeo.com/1\nhttps://x.com/u/status/1\nhttps://example.com/a.svg\nhttps://example.com/a.m3u8\nhttps://example.com/no-extension'),[]);
  assert.deepEqual(extractDirectVideoLinks('https://example.com/a.webp\nhttps://example.com/a.webm').map(x=>x.kind),['video']);
  assert.deepEqual(urls('https://example.com/a.mp4\nhttps://example.com/a.webm\nhttps://example.com/a.ogv'),['https://example.com/a.mp4','https://example.com/a.webm','https://example.com/a.ogv']);
});
test('media: credentials, local and private literal addresses are excluded',()=>{
  for(const input of ['https://user:secret@example.com/a.mp4','http://localhost/a.mp4','http://localhost./a.mp4','http://printer.local./a.mp4','http://127.1/a.mp4','http://2130706433/a.mp4','http://10.1.2.3/a.mp4','http://[::1]/a.mp4','http://[::ffff:127.0.0.1]/a.mp4','file:///C:/a.mp4','data:video/mp4;base64,AAAA'])
    assert.deepEqual(urls(input),[],input.replace('secret','REDACTED'));
});
test('media: unused definitions, HTML and scripts do not add cards',()=>{
  for(const input of ['[unused]: '+vid,'<video src="'+vid+'">','<a href="'+vid+'">link</a>','<script>'+vid+'</script>','<!-- '+vid+' -->'])
    assert.deepEqual(urls(input),[],input);
});
test('media: invalid link destinations do not leak nested URLs',()=>{
  assert.deepEqual(urls('[bad](javascript:alert("'+vid+'"))'),[]);
});
test('media: reference links resolve only used definitions',()=>{
  assert.deepEqual(urls('[clip][video]\n[unused]: '+vid.replace('b.mp4','c.mp4')+'\n[video]: '+vid),[vid]);
});
test('media: card count is bounded and source text is unchanged',()=>{
  const input=Array.from({length:SEARCH_MEDIA_LIMIT+5},(_,i)=>'https://example.com/'+i+'.mp4').join('\n');
  const before=input;assert.equal(extractDirectVideoLinks(input).length,SEARCH_MEDIA_LIMIT);assert.equal(input,before);
});

test('media: structured metadata accepts extensionless images, rejects unsafe URLs and merges with direct videos',()=>{
  const structured=structuredSearchMedia({lcxHostedMedia:{version:1,tool:'web_search',candidates:[
    {kind:'image',url:'https://images.example.com/full',previewUrl:'https://images.example.com/thumb',sourceUrl:'https://example.com/article',caption:' Result ',structured:true},
    {kind:'image',url:'http://127.0.0.1/private',structured:true},
    {kind:'video',url:'https://user:secret@example.com/video.mp4',structured:true},
    {kind:'image',url:'https://images.example.com/unowned',structured:false},
  ]}},'web_search');
  assert.deepEqual(structured,[{kind:'image',url:'https://images.example.com/full',previewUrl:'https://images.example.com/thumb',sourceUrl:'https://example.com/article',caption:'Result',structured:true}]);
  // Structured images stay; the prose fallback can only add direct videos and never re-adds the same url.
  assert.deepEqual(mergeSearchMedia(structured,[{kind:'image',url:'https://images.example.com/full'},{kind:'video',url:vid}]),[
    structured[0],{kind:'video',url:vid},
  ]);
  assert.deepEqual(structuredSearchMedia({lcxHostedMedia:{version:1,tool:'web_search',candidates:[]}},'websearch_gpt_advanced'),[]);
  assert.deepEqual(mergeSearchMedia([], [{kind:'video',url:vid+'#t=1'},{kind:'video',url:vid+'#t=5'}]).map(item=>item.url),[vid+'#t=1',vid+'#t=5']);
});
test('media: structured deduplication does not merge unrelated signed or CDN urls',()=>{
  const candidate=url=>({kind:'image',url,structured:true});
  const items=structuredSearchMedia({lcxHostedMedia:{version:1,tool:'web_search',candidates:[
    candidate('https://cdn.example.com/a.jpg?sig=1'),candidate('https://cdn.example.com/a.jpg?sig=2'),candidate('https://cdn2.example.com/a.jpg?sig=1'),candidate('https://cdn.example.com/a.jpg?sig=1'),
  ]}},'web_search');
  assert.deepEqual(items.map(item=>item.url),['https://cdn.example.com/a.jpg?sig=1','https://cdn.example.com/a.jpg?sig=2','https://cdn2.example.com/a.jpg?sig=1']);
});
