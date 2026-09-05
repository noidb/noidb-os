const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const JSZip = require("jszip");

async function runCase({ failBuild = false, failSave = false, sameOrigin = true } = {}) {
  const saves = [];
  const dependencies = {
    "next/server": { NextResponse: class {
      constructor(body, init) { this.body = body; this.headers = init.headers; this.status = init.status || 200; }
      static json(body, init={}) { return { body, status:init.status || 200 }; }
    } },
    jszip: JSZip,
    "@/lib/wms/inbound-results": { getInboundDateResults: async () => [{ actualDate:"2026-09-04",nameConflicts:[],couponItems:[{skuId:"1"}],missingItems:[{skuId:"1",productLink:"https://example.test/1"}] }] },
    "@/lib/wms/inbound-output-files": {
      buildCouponWorkbook: async () => Buffer.from("coupon fixture"),
      buildMissingWorkbook: async () => { if (failBuild) throw new Error("missing build failed"); return Buffer.from("missing fixture with product link"); },
    },
    "@/lib/wms/google-drive-oauth-writer": { generatedDriveSaveHeaders: async (buffer,name,mime,folder) => {
      saves.push({buffer,name,mime,folder});
      if (failSave && name.startsWith("미입고")) return {"X-NOIDB-Drive-Saved":"false"};
      return {"X-NOIDB-Drive-Saved":"true","X-NOIDB-Drive-File-Name":encodeURIComponent(name.replace(".xlsx","_02.xlsx"))};
    } },
    "@/lib/wms/noidb-action-auth": { isSameOriginActionRequest: () => sameOrigin },
  };
  const module = { exports:{} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("app/api/wms/inbound-results/route.ts","utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, {
    module,exports:module.exports,Buffer,console,require(name) { assert(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`); return dependencies[name]; },
  });
  const response = await module.exports.POST({json:async()=>({actualDate:"2026-09-04",discountRate:30})});
  if (!sameOrigin || failBuild) { assert.equal(saves.length,0); assert.equal(response.status,sameOrigin?400:403); return; }
  assert.equal(response.status,200);
  assert.equal(saves.length,2);
  for (const save of saves) assert.deepEqual(Array.from(save.folder),["쿠팡데이터","마케팅","쿠폰관리"]);
  assert.equal(response.headers["X-NOIDB-Drive-Saved"],String(!failSave));
  const zip = await JSZip.loadAsync(response.body);
  const names = Object.keys(zip.files);
  assert(names.includes("쿠폰발행리스트_입고일_20260904_02.xlsx"));
  assert(names.includes(failSave?"미입고_SKU리스트_입고일_20260904.xlsx":"미입고_SKU리스트_입고일_20260904_02.xlsx"));
  assert.equal(names.length,2);
  assert.equal(response.headers["X-NOIDB-Coupon-Count"],"1");
  assert.equal(response.headers["X-NOIDB-Missing-Count"],"1");
  if (failSave) assert(response.headers["X-NOIDB-Drive-Save-Warning"]);
}
(async()=>{
  await runCase(); await runCase({failBuild:true}); await runCase({failSave:true}); await runCase({sameOrigin:false});
  console.log("입고 출력 API PASS: 두 파일 생성 후 자동저장, 실제 버전 파일명 ZIP 일치, 생성 실패 저장0, 일부 자동저장 실패 별도 표시");
})().catch(error=>{console.error(error);process.exitCode=1;});
