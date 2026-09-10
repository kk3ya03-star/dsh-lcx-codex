import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSearchMedia, mergeSearchMedia, SEARCH_MEDIA_LIMIT, structuredSearchMedia } from '../src/client/search-media.ts';
const img='https://example.com/a.jpg', vid='https://example.com/b.mp4';
const urls=text=>extractSearchMedia(text).map(item=>item.url);
const tick=String.fromCharCode(96), fence=tick.repeat(3);

test('media: actual MDN ordinary links retain their image/video addresses',()=>{
  const image='https://developer.mozilla.org/shared-assets/images/examples/flowers.jpg';
  const video='https://developer.mozilla.org/shared-assets/videos/flower.mp4';
  assert.deepEqual(extractSearchMedia('[Flowers]('+image+')\n[Flower]('+video+')'),[
    {kind:'image',url:image},{kind:'video',url:video},
  ]);
});
test('media: native inline and reference images are not previewed again',()=>{
  assert.deepEqual(urls('![shown]('+img+')\n[duplicate]('+img+')\n[video]('+vid+')'),[vid]);
  assert.deepEqual(urls('![shown][photo]\n[duplicate]('+img+')\n[photo]: '+img+'\n[video]('+vid+')'),[vid]);
  assert.deepEqual(urls('![photo]\n[photo]: '+img+'\n'+vid),[vid]);
});
test('media: emoji before an image does not erase a following video',()=>{
  assert.deepEqual(urls('😀'.repeat(5)+' ![shown]('+img+')\n'+vid),[vid]);
});
test('media: fenced, unfinished, inline and indented code is excluded',()=>{
  for(const input of [fence+'txt\n'+img+'\n'+fence,fence+'txt\n'+img,fence+'txt\n'+fence+'not-a-close\n'+img,tick+img+tick,'    '+img,'\t'+img,'> '+fence+'\n> '+img+'\n> '+fence])
    assert.deepEqual(urls(input),[],input);
  assert.deepEqual(urls(fence+'txt\n'+img+'\n'+fence+'\n'+vid),[vid]);
});
test('media: Chinese punctuation stays outside media URLs',()=>{
  for(const input of ['[图片]('+img+')。','“'+img+'”','图片：'+img+'。'])
    assert.deepEqual(urls(input),[img],input);
});
test('media: fragments deduplicate without changing query or path',()=>{
  const first='https://EXAMPLE.COM/a.JPG?size=640#first';
  assert.deepEqual(urls(first+'\nhttps://example.com/a.JPG?size=640#second'),['https://example.com/a.JPG?size=640#first']);
});
test('media: only supported direct formats get cards',()=>{
  assert.deepEqual(urls('https://youtube.com/watch?v=abc\nhttps://x.com/u/status/1\nhttps://example.com/a.svg\nhttps://example.com/a.m3u8\nhttps://example.com/no-extension'),[]);
  assert.deepEqual(extractSearchMedia('https://example.com/a.webp\nhttps://example.com/a.webm').map(x=>x.kind),['image','video']);
});
test('media: credentials, local and private literal addresses are excluded',()=>{
  for(const input of ['https://user:secret@example.com/a.jpg','http://localhost/a.jpg','http://localhost./a.jpg','http://printer.local./a.jpg','http://127.1/a.jpg','http://2130706433/a.jpg','http://10.1.2.3/a.jpg','http://[::1]/a.jpg','http://[::ffff:127.0.0.1]/a.jpg','file:///C:/a.jpg','data:image/png;base64,AAAA'])
    assert.deepEqual(urls(input),[],input.replace('secret','REDACTED'));
});
test('media: unused definitions, HTML and scripts do not add cards',()=>{
  for(const input of ['[unused]: '+img,'<img src="'+img+'">','<a href="'+img+'">link</a>','<script>'+img+'</script>','<!-- '+img+' -->'])
    assert.deepEqual(urls(input),[],input);
});
test('media: invalid link destinations do not leak nested URLs',()=>{
  assert.deepEqual(urls('[bad](javascript:alert("'+img+'"))'),[]);
});
test('media: reference links resolve only used definitions',()=>{
  assert.deepEqual(urls('[clip][video]\n[unused]: '+img+'\n[video]: '+vid),[vid]);
});
test('media: card count is bounded and source text is unchanged',()=>{
  const input=Array.from({length:SEARCH_MEDIA_LIMIT+5},(_,i)=>'https://example.com/'+i+'.png').join('\n');
  const before=input;assert.equal(extractSearchMedia(input).length,SEARCH_MEDIA_LIMIT);assert.equal(input,before);
});

test('media: structured metadata accepts extensionless images, rejects unsafe URLs and stays primary',()=>{
  const structured=structuredSearchMedia({lcxHostedMedia:{version:1,tool:'web_search',candidates:[
    {kind:'image',url:'https://images.example.com/full',previewUrl:'https://images.example.com/thumb',sourceUrl:'https://example.com/article',caption:' Result ',structured:true},
    {kind:'image',url:'http://127.0.0.1/private',structured:true},
    {kind:'video',url:'https://user:secret@example.com/video.mp4',structured:true},
    {kind:'image',url:'https://images.example.com/unowned',structured:false},
  ]}},'web_search');
  assert.deepEqual(structured,[{kind:'image',url:'https://images.example.com/full',previewUrl:'https://images.example.com/thumb',sourceUrl:'https://example.com/article',caption:'Result',structured:true}]);
  assert.deepEqual(mergeSearchMedia(structured,[{kind:'image',url:'https://images.example.com/full'},{kind:'image',url:img}]),[
    structured[0],{kind:'image',url:img},
  ]);
  assert.deepEqual(structuredSearchMedia({lcxHostedMedia:{version:1,tool:'web_search',candidates:[]}},'websearch_gpt_advanced'),[]);
  assert.deepEqual(mergeSearchMedia([], [{kind:'video',url:vid+'#t=1'},{kind:'video',url:vid+'#t=5'}]).map(item=>item.url),[vid+'#t=1',vid+'#t=5']);
});
