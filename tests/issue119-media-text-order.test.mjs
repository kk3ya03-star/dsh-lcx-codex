import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDirectMediaLinks, SEARCH_MEDIA_LIMIT } from '../src/client/search-media.ts'

// Issue 119 item 8: direct media links were emitted grouped by syntax (inline links, then reference
// links, then bare URLs) instead of in the order they appear in the answer, so the rail order and, past
// the limit, the choice of which links survive depended on how a link happened to be written.

const base = 'https://example.com/'
const urls = (text) => extractDirectMediaLinks(text).map((item) => item.url.replace(base, ''))

test('inline, reference and bare links come out in text order', () => {
  assert.deepEqual(urls(`${base}a.jpg [b](${base}b.jpg)`), ['a.jpg', 'b.jpg'])
  assert.deepEqual(
    urls(`see ${base}a.jpg then [r][1] and [c](${base}c.jpg) and ${base}d.jpg\n\n[1]: ${base}r.jpg`),
    ['a.jpg', 'r.jpg', 'c.jpg', 'd.jpg'],
  )
  assert.deepEqual(urls(`[x][1] ${base}z.jpg [y](${base}y.jpg)\n\n[1]: ${base}x.jpg`), ['x.jpg', 'z.jpg', 'y.jpg'])
})

test('the limit keeps the first links in the text, whatever their syntax', () => {
  const bare = Array.from({ length: SEARCH_MEDIA_LIMIT }, (_, i) => `${base}bare${i}.jpg`).join(' ')
  const linked = Array.from({ length: SEARCH_MEDIA_LIMIT }, (_, i) => `[m${i}](${base}md${i}.jpg)`).join(' ')
  const kept = urls(`${bare} ${linked}`)
  assert.equal(kept.length, SEARCH_MEDIA_LIMIT)
  assert.deepEqual(kept, Array.from({ length: SEARCH_MEDIA_LIMIT }, (_, i) => `bare${i}.jpg`))
  assert.deepEqual(urls(`${linked} ${bare}`), Array.from({ length: SEARCH_MEDIA_LIMIT }, (_, i) => `md${i}.jpg`))
})

test('ownership rules are unchanged: native Markdown images skipped, duplicates collapsed, videos kept', () => {
  assert.deepEqual(urls(`![shown](${base}n.jpg)\n${base}n.jpg\n${base}k.jpg\n[v](${base}clip.mp4) ${base}k.jpg`), ['k.jpg', 'clip.mp4'])
})

test('a reference definition in the middle of the text does not shift the order of later links', () => {
  assert.deepEqual(
    urls(`[1]: ${base}ref.jpg\n\nfirst ${base}one.jpg and [r][1] then ${base}two.jpg`),
    ['one.jpg', 'ref.jpg', 'two.jpg'],
  )
  assert.deepEqual(
    urls(`${base}a.jpg\n[1]: ${base}ref.jpg\n${base}b.jpg [r][1] ${base}c.jpg`),
    ['a.jpg', 'b.jpg', 'ref.jpg', 'c.jpg'],
  )
})
