import test from 'node:test';
import assert from 'node:assert/strict';
import { installSettingsCompat, readSettingsCompat } from '../lib/settings-compat.js';
import { Config } from '../lib/index.js';

test('legacy sections retain their stored values and live change hooks', () => {
  let source, change, enabled;
  const saved = { enabled: true };
  const ctx = { settings: { get: () => saved, installSection(owner, ns, schema, defaults, hooks) {
    assert.equal(owner, ctx); assert.equal(ns, 'lcx-codex');
    hooks.setSource(() => saved); change = hooks.onChange;
  } }, on() { throw Error('legacy path must not register forms listeners'); } };
  installSettingsCompat(ctx, 'lcx-codex', {}, { enabled: false }, {
    setSource(fn) { source = fn; }, onChange() { enabled = source().enabled; },
  });
  change(); assert.equal(enabled, true);
  saved.enabled = false; change(); assert.equal(enabled, false);
  assert.equal(readSettingsCompat(ctx.settings, 'llm-pi-ai'), saved);
});

test('profile forms load persisted settings and react only to their own namespace', () => {
  let source, listener, count = 0, value = { enabled: true, webSearch: true };
  const owner = {};
  const ctx = { fiber: owner, settings: {
    configure(options, fiber) { assert.deepEqual(options, { auto: false }); assert.equal(fiber, owner); },
    describe() { return [{ ns: 'lcx-codex', value }, { ns: 'llm-pi-ai', value: { providers: { test: {} } } }]; },
  }, on(event, fn) { assert.equal(event, 'settings/document-updated'); listener = fn; } };
  installSettingsCompat(ctx, 'lcx-codex', {}, { enabled: false, webSearch: false }, {
    setSource(fn) { source = fn; }, onChange() { count++; },
  });
  assert.equal(source().enabled, true); assert.equal(count, 1);
  value = { enabled: false }; listener('lcx-codex');
  assert.deepEqual(source(), { enabled: false, webSearch: false });
  listener('other'); assert.equal(count, 2);
  assert.deepEqual(readSettingsCompat(ctx.settings, 'llm-pi-ai'), { providers: { test: {} } });
  assert.equal(readSettingsCompat(ctx.settings, 'missing'), undefined);
});

test('profile settings absent during loader startup default off and refresh after migration', () => {
  let source, listener, rows = [];
  const ctx = { settings: { configure() {}, describe: () => rows }, on(_event, fn) { listener = fn; } };
  installSettingsCompat(ctx, 'lcx-codex', {}, { enabled: false }, { setSource(fn) { source = fn; }, onChange() {} });
  assert.equal(source().enabled, false);
  rows = [{ ns: 'lcx-codex', value: { enabled: true } }]; listener('lcx-codex');
  assert.equal(source().enabled, true);
});

test('only user toggles are declared live on the plugin config', () => {
  for (const key of ['enabled', 'webSearch', 'advancedHostedSearch', 'alphaSearch', 'grokNativeWebSearch', 'grokNativeXSearch', 'searchMediaPreview']) {
    assert.equal(Config.dict[key].meta.volatile, true, key);
    assert.equal(Config.dict[key].meta.default, false, key);
  }
  assert.notEqual(Config.dict.timeoutMs.meta.volatile, true);
});
