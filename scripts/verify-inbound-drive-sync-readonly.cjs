const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const calls = { reads: 0, downloads: 0, transactions: 0 };
let authenticated = false, sameOrigin = true;
const token = 'a'.repeat(64);
const context = { incoming: [{}], cellPreview: { blockers: [] } };
const cache = new Map();
class ConfigError extends Error {}
const dependencies = {
  '@/lib/wms/parsed-file-cache': { cachedParsedFile: async (version, descriptor, parse, valid, fresh) => {
    const key = JSON.stringify([version, descriptor]);
    if (fresh || !cache.has(key)) cache.set(key, (await parse()).value);
    return cache.get(key);
  } },
  'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
  '@/lib/wms/google-drive-oauth-reader': {
    resolveDriveFolderPath: async () => { calls.reads++; return 'folder'; },
    listOAuthDriveFolderFiles: async () => [{ id: 'file', name: 'test.xlsx', size: '1', modifiedTime: 'today' }],
    downloadOAuthDriveFile: async () => { calls.downloads++; return Buffer.from('fixture'); },
  },
  '@/lib/wms/google-drive-oauth': { DriveOAuthNotConfiguredError: ConfigError, DriveOAuthNotConnectedError: ConfigError, DriveOAuthTokenInvalidError: ConfigError },
  '@/lib/wms/google-service-account': { WmsGoogleNotConfiguredError: ConfigError },
  '@/lib/wms/noidb-action-auth': { hasNoidbActionSession: () => authenticated, isSameOriginActionRequest: () => sameOrigin },
  '@/lib/wms/inbound-import-context': {
    readInboundWorkbook: async () => ({fingerprint:'a'.repeat(64),items:[]}), loadInboundImportContext: async () => context,
    inboundPreviewSummary: () => ({ previewToken: token, candidateEvents: 1 }),
  },
  '@/lib/wms/inbound-import-transaction': {
    InboundCommitUncertainError: class extends Error {},
    applyInboundTransaction: async (expected, fresh, store) => {
      calls.transactions++; assert.equal(expected, token); assert.equal(store, 'store');
      const before = calls.downloads; assert.equal((await fresh()), context);
      assert.equal(calls.downloads, before + 1, 'apply re-downloads cached files');
      return { applied: true, importedEvents: 1, changedCells: 2 };
    },
  },
  '@/lib/wms/inbound-import-store': { createInboundTransactionStore: () => 'store' },
};
const fixture = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/wms/inbound-drive-sync/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: fixture, exports: fixture.exports, Buffer, require(name) {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
} });
const post = body => fixture.exports.POST({ json: async () => body });
(async () => {
  const apply = { action: 'apply', confirmed: true, expectedPreviewToken: token };
  assert.equal((await post(apply)).status, 401);
  authenticated = true; sameOrigin = false;
  assert.equal((await post(apply)).status, 401);
  sameOrigin = true;
  assert.equal((await post({ ...apply, confirmed: false })).status, 400);
  assert.equal((await post({ ...apply, expectedPreviewToken: 'invalid' })).status, 400);
  assert.deepEqual(calls, { reads: 0, downloads: 0, transactions: 0 });
  const preview = await post({ action: 'preview' });
  assert.equal(preview.status, 200); assert.equal(preview.body.canApply, true);
  assert.equal(preview.body.applied, false); assert.equal(preview.body.backupCreated, false);
  await post({ action: 'preview' });
  assert.equal(calls.downloads, 1); assert.equal(calls.transactions, 0, 'preview never writes');
  assert.equal((await post(apply)).status, 200); assert.equal(calls.transactions, 1);
  console.log('Inbound route PASS: auth/origin/confirmation gates before reads, read-only preview, fresh apply files; no operating writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
