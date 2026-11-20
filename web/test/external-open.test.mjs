// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import '../external-open.js';
import { attachExternalLinks } from '../external-links.mjs';
const { validate, workerController } = globalThis.TouchHLEExternal;
const session = '11111111-1111-4111-8111-111111111111';
const url = 'https://example.invalid/path?q=%22%3C%26&x=1#fragment';
function admission() { let time = 100; const messages = []; const controller = workerController(session, x => messages.push(x), () => time); return { controller, messages, advance(n) { time += n; } }; }
test('HTTP(S) full data preserved, malformed/unsupported/control/oversize refused', () => {
  for (const s of [url, 'http://example.invalid/', 'HTTPS://example.invalid/é?a=1&b=2']) assert.equal(validate(s), s);
  for (const s of [null, '', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/foo', 'httpx://x', 'mailto:a@b', '//example.invalid', 'https://', 'https://x/\0tail', 'https://x/\ntail', 'https://x/ space', 'https://x/' + 'a'.repeat(8192)]) assert.throws(() => validate(s));
});
test('queued bool, bounded one pending, per-frame identical calls do not flood', () => {
  const { controller: c, messages } = admission();
  for (let i = 0; i < 10000; i++) assert.equal(c.request(url), true);
  assert.equal(messages.length, 1); assert.equal(messages[0].url, url);
  assert.equal(c.request('https://other.invalid'), false); assert.equal(messages.length, 2);
  for (let i = 0; i < 10000; i++) assert.equal(c.request('javascript:alert(1)'), false);
  assert.equal(messages.length, 2);
});
test('dismiss identity, cooldown, bounded recent history and rate gate', () => {
  const { controller: c, messages, advance } = admission();
  assert(c.request(url)); c.handle({ type: 'external-dismiss', session: 'wrong', id: 1 });
  advance(1000); assert.equal(c.request('https://new.invalid'), false);
  c.handle({ type: 'external-dismiss', session, id: 1 }); assert.equal(c.request(url), false);
  advance(30000); assert(c.request(url));
  for (let i = 0; i < 40; i++) { c.handle({ type: 'external-dismiss', session, id: messages.findLast(x => x.type === 'external-open').id }); advance(1000); assert(c.request(`https://x.invalid/${i}`)); }
  c.handle({ type: 'external-dismiss', session, id: messages.findLast(x => x.type === 'external-open').id });
  assert.equal(c.request('https://new.invalid'), false); advance(1000); assert(c.request('https://new.invalid'));
});
test('Stop, absent session and failed post return false without throwing', () => {
  const { controller: c } = admission(); assert(c.request(url)); c.handle({ type: 'save-stop' }); assert.equal(c.request(url), false);
  assert.equal(workerController(undefined, () => { throw Error('no send'); }).request(url), false);
  assert.equal(workerController(session, () => { throw Error('send failed'); }).request(url), false);
});
function page() {
  class Element { constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; } setAttribute(k, v) { this.attributes[k] = v; } removeAttribute(k) { delete this[k]; } append(...nodes) { this.children.push(...nodes); for (const n of nodes) if (typeof n === 'object') n.parent = this; } remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); } }
  const document = { body: new Element('body'), createElement: tag => new Element(tag) };
  const worker = Object.assign(new EventTarget(), { posts: [], postMessage(m) { this.posts.push(m); } });
  const opens = []; let blocked = false, throws = false;
  const tab = { opener: 'original', location: { replace(value) { assert.equal(tab.opener, null); if (throws) throw Error('navigation failed'); opens.push(value); } }, close() { this.closed = true; } };
  const window = { open(...args) { opens.push(args); return blocked ? null : tab; } };
  const bridge = attachExternalLinks(worker, { document, window, session });
  const emit = data => worker.dispatchEvent(new MessageEvent('message', { data }));
  const prompt = () => document.body.children[0];
  const elements = () => { const p = prompt(); return { message: p.children[0], button: p.children[1], link: p.children[3], dismiss: p.children[5] }; };
  return { worker, document, bridge, emit, prompt, elements, opens, tab, block() { blocked = true; }, fail() { throws = true; } };
}
test('worker generation and ordered IDs gate requests; no automatic navigation', () => {
  const p = page(); p.emit({ type: 'external-open', session: 'stale', id: 1, url }); assert.equal(p.prompt(), undefined);
  p.emit({ type: 'external-open', session, id: 1, url }); assert(p.prompt()); assert.equal(p.opens.length, 0);
  const { link, button } = p.elements(); assert.equal(link.href, url); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  p.emit({ type: 'external-open', session, id: 1, url: 'https://stale.invalid' }); assert.equal(link.href, url);
  button.onclick(); assert.deepEqual(p.opens, [['about:blank', '_blank'], url]); assert.equal(p.tab.opener, null);
  assert.match(p.elements().message.textContent, /requested/);
});
test('blocked or failed popup retains safe clickable fallback; no page navigation', () => {
  for (const failure of ['block', 'fail']) { const p = page(); p.emit({ type: 'external-open', session, id: 1, url }); p[failure](); const e = p.elements(); e.button.onclick(); assert.equal(e.link.href, url); assert.equal(e.link.hidden, false); assert.match(e.message.textContent, /blocked|Could not open/); assert.equal(p.worker.posts.length, 0); }
});
test('page independently rejects unsafe URL and signals dismissal', () => {
  const p = page(); p.emit({ type: 'external-open', session, id: 1, url: 'javascript:alert(1)' }); assert.match(p.elements().message.textContent, /rejected/); assert.equal(p.opens.length, 0); assert.equal(p.elements().link.hidden, true); assert.deepEqual(p.worker.posts, [{ type: 'external-dismiss', session, id: 1 }]);
});
test('dismiss and Stop dispose remove stale link capabilities', () => {
  const p = page(); p.emit({ type: 'external-open', session, id: 1, url }); p.elements().dismiss.onclick(); assert.equal(p.prompt(), undefined); assert.equal(p.worker.posts[0].id, 1);
  p.emit({ type: 'external-open', session, id: 2, url }); const e = p.elements(), lateClick = e.button.onclick; p.bridge.dispose(); lateClick(); p.emit({ type: 'external-open', session, id: 3, url }); assert.equal(p.prompt(), undefined); assert.equal(e.link.href, undefined); assert.equal(e.button.disabled, true); assert.equal(p.opens.length, 0);
});
test('library passes exact UTF8 length and rejects NUL/invalid bounds visibly', () => {
  let library; const bytes = new TextEncoder().encode(url), memory = new Uint8Array(40000); memory.set(bytes, 10);
  const calls = [], context = { addToLibrary: l => { library = l; }, HEAPU8: memory, Module: { requestExternalURL: s => { calls.push(s); return s === url; } }, UTF8ArrayToString: (heap, ptr, len) => new TextDecoder().decode(heap.slice(ptr, ptr + len)) };
  runInNewContext(readFileSync(new URL('../emscripten-scheduler.js', import.meta.url), 'utf8'), context);
  assert.equal(library.touchhle_web_open_url(10, bytes.length), 1); assert.equal(calls[0], url);
  memory[12] = 0; assert.equal(library.touchhle_web_open_url(10, bytes.length), 0); assert.equal(calls.at(-1), null);
  for (const [ptr, len] of [[0, 0], [0, 32769], [-1, 1], [39999, 2]]) assert.equal(library.touchhle_web_open_url(ptr, len), 0);
  context.Module.requestExternalURL = () => { throw Error('bridge failed'); }; assert.equal(library.touchhle_web_open_url(20, 2), 0);
});

test('exact URL and cooldown boundaries; C0 and DEL rejection', () => {
  const prefix = 'https://x/';
  assert.equal(validate(prefix + 'a'.repeat(8192 - prefix.length)).length, 8192);
  assert.equal(validate(prefix + 'é'.repeat(8192 - prefix.length)).length, 8192);
  for (let c = 0; c <= 32; c++) assert.throws(() => validate(prefix + String.fromCharCode(c)));
  assert.throws(() => validate(prefix + '\x7f'));
  const a = admission(); assert(a.controller.request(url)); a.controller.handle({ type: 'external-dismiss', session, id: 1 });
  a.advance(999); assert.equal(a.controller.request('https://other.invalid'), false);
  a.advance(1); assert.equal(a.controller.request('https://other.invalid'), true);
  a.controller.handle({ type: 'external-dismiss', session, id: 2 });
  a.advance(28999); assert.equal(a.controller.request(url), false);
  a.advance(1); assert.equal(a.controller.request(url), true);
});
test('valid then invalid clears prior URL and later valid request recovers safely', () => {
  const p = page(); p.emit({ type: 'external-open', session, id: 1, url });
  const old = p.elements(), click = old.button.onclick;
  assert.equal(old.link.textContent, url);
  p.emit({ type: 'external-open', session, id: 2, url: 'data:text/html,<script>1</script>' });
  assert.equal(old.link.href, undefined); assert.equal(old.link.hidden, true); click(); assert.equal(p.opens.length, 0);
  const literal = 'https://example.invalid/?markup=<img>&quote="yes"';
  p.emit({ type: 'external-open', session, id: 3, url: literal });
  assert.equal(old.link.textContent, literal); assert.equal(old.link.href, literal); assert.equal(old.link.hidden, false);
});
