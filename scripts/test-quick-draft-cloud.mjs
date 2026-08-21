import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-generator/quick-draft-cloud.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const uploadCalls = [];
const module = { exports: {} };
vm.runInNewContext(`(function(exports,module,require){${compiled}\n})(module.exports,module,require)`, {
  module,
  require: path => {
    if (path === "@vercel/blob/client") return { upload: async (...args) => { uploadCalls.push(args); return { pathname: args[0] }; } };
    throw new Error(`Unexpected test module: ${path}`);
  },
  crypto: globalThis.crypto,
  Blob,
  Response,
  URLSearchParams,
  atob,
  btoa,
  fetch,
});

const {
  encodeQuickDraftForCloud,
  hydrateQuickDraftManifest,
  mergeCloudSummaries,
  saveCloudQuickDraft,
  deleteCloudQuickDraft,
  getQuickDraftCloudStatus,
} = module.exports;

const imageA = `data:image/jpeg;base64,${Buffer.from("same-image").toString("base64")}`;
const imageB = `data:image/png;base64,${Buffer.from("other-image").toString("base64")}`;
const draft = {
  id: "quick-test-1",
  savedAt: "2026-08-13T01:02:03.000Z",
  modelName: "mr0001",
  source: `data:image/jpeg;base64,${Buffer.from("very-long-source-is-not-stored").toString("base64")}`,
  sourceName: "mr0001.jpg",
  headerUrl: "/노이드비-상단이미지.jpg",
  headerName: "노이드비-상단이미지.jpg",
  footerUrl: imageB,
  footerName: "footer.png",
  style: "clean",
  originalSections: [{ id: "one", dataUrl: imageA, kind: "product" }],
  editedSections: [{ id: "one", dataUrl: imageB, kind: "product" }],
  finalSections: [{ id: "one", dataUrl: imageB, kind: "product" }],
  sectionActions: { one: "edit" },
  result: { dataUrl: `data:image/jpeg;base64,${Buffer.from("long-result-is-not-stored").toString("base64")}`, sectionCount: 1, width: 780, height: 1900 },
  scanSummary: { found: 2, kept: 1, excluded: 1 },
  preview: imageB,
};

const encoded = await encodeQuickDraftForCloud(draft);
assert.equal(encoded.assets.length, 2, "repeated section, footer and preview images should be deduplicated");
assert.equal(encoded.manifest.header.kind, "url");
assert.equal(encoded.manifest.footer.kind, "asset");
assert.equal(encoded.manifest.complete, true);
assert.equal(encoded.manifest.resultMeta.height, 1900);
assert.equal(Object.hasOwn(encoded.manifest, "source"), false, "long source must be omitted");
assert.equal(Object.hasOwn(encoded.manifest, "result"), false, "composed result must be omitted");
const serialized = JSON.stringify(encoded.manifest);
assert.equal(serialized.includes("data:image"), false, "manifest must not contain embedded image data");
assert.ok(encoded.assets.every(asset => asset.pathname.startsWith("quick-detail-drafts/v1/quick-test-1/assets/")));

const assetBytes = new Map(encoded.assets.map(asset => [asset.pathname, asset.blob]));
const hydrated = await hydrateQuickDraftManifest(encoded.manifest, "2468", {
  fetch: async url => {
    const path = new URL(String(url), "https://example.test").searchParams.get("path");
    const blob = assetBytes.get(path);
    return blob ? new Response(blob, { headers: { "content-type": blob.type } }) : new Response("missing", { status: 404 });
  },
  recompose: async (_header, sections) => ({ dataUrl: imageA, sectionCount: sections.length, width: 780, height: 1900 }),
});
assert.equal(hydrated.source, "", "source is intentionally omitted from cloud drafts");
assert.equal(hydrated.originalSections[0].dataUrl, imageA);
assert.equal(hydrated.finalSections[0].dataUrl, imageB);
assert.equal(hydrated.footerUrl, imageB);
assert.equal(hydrated.result.sectionCount, 1, "completed drafts can be recomposed during hydration");
assert.equal(hydrated.cloud.complete, true);

const merged = mergeCloudSummaries(
  [draft],
  [
    { ...encoded.manifest.summary, savedAt: "2026-08-12T00:00:00.000Z" },
    { ...encoded.manifest.summary, id: "cloud-only", savedAt: "2026-08-14T00:00:00.000Z" },
  ],
);
assert.equal(merged[0].id, "cloud-only");
assert.equal(merged.find(item => item.id === draft.id).location, "both");
assert.equal(merged.find(item => item.id === draft.id).savedAt, draft.savedAt, "newer local draft should win display fields");

const requestCalls = [];
const cloudFetch = async (_url, init = {}) => {
  requestCalls.push(init);
  const body = init.body ? JSON.parse(init.body) : null;
  if (body?.action === "prepare") return Response.json({ missingPathnames: [encoded.assets[0].pathname] });
  if (body?.action === "save") {
    assert.equal(body.manifest.draft.schema, "noidb.quick-detail-draft");
    assert.equal(JSON.stringify(body.manifest.assetPathnames), JSON.stringify(encoded.assets.map(asset => asset.pathname)));
    return Response.json({ configured: true, saved: true });
  }
  if (init.method === "DELETE") return Response.json({ deleted: true });
  return Response.json({ configured: true });
};
uploadCalls.length = 0;
await saveCloudQuickDraft(draft, "2468", { fetch: cloudFetch });
assert.equal(uploadCalls.length, 1, "only assets reported missing should upload");
assert.equal(uploadCalls[0][2].access, "private");
assert.equal(uploadCalls[0][2].headers["x-quick-draft-code"], "2468");
assert.deepEqual(JSON.parse(uploadCalls[0][2].clientPayload), { code: "2468", draftId: draft.id });
assert.equal(requestCalls[0].headers["x-quick-draft-code"], "2468");
assert.equal(JSON.parse(requestCalls.at(-1).body).action, "save");

await deleteCloudQuickDraft(draft.id, "2468", { fetch: cloudFetch });
assert.equal(requestCalls.at(-1).method, "DELETE");
const status = await getQuickDraftCloudStatus("2468", { fetch: cloudFetch });
assert.equal(status.configured, true);

console.log("quick draft cloud codec tests: 20 checks passed");
