const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", {paths:[process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()]}));
const base = process.env.NOIDB_TEST_URL || "http://127.0.0.1:3114";
if (!["localhost","127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Fixture is localhost-only");
const output = "tmp/discontinue-browser-check";
async function main() {
  await fs.mkdir(output,{recursive:true});
  const browser = await chromium.launch({headless:true,channel:"chrome"});
  const context = await browser.newContext();
  const requests = ["단종","단종해제","단종","단종해제"].map((requestType,index)=>({id:`REQ${index}`,skuId:`7000000${index}`,requestType,supplyHubStatus:index<2?"처리완료":"처리대기",productName:"검증 여성 반지",optionLabel:"실버, 20호",modelSku:`MODEL${index}`,requestedAt:"2026-09-05T00:00:00Z",currentStatus:"정상"}));
  const original = structuredClone(requests);
  const actions = [],errors=[];
  await context.route("**/api/**", async route=>{
    const request=route.request(),url=new URL(request.url());
    if (url.pathname==="/api/wms/vendor-order-actions") {
      if (request.method()==="GET") return route.fulfill({json:{success:true,statusRequests:requests,statusFileGenerations:[]}});
      const data=request.postDataJSON(); actions.push(data);
      assert.equal(data.action,"record-status-files","Regeneration must not complete or restore a request");
      return route.fulfill({json:{success:true}});
    }
    if (url.pathname==="/api/wms/discontinue-files") {
      const data=request.postDataJSON(); actions.push(data);
      assert.equal(data.items.length,1);
      assert.equal(data.items[0].skuId,data.kind==="discontinue"?"70000000":"70000001");
      return route.fulfill({body:Buffer.from("isolated download fixture"),headers:{
        "Content-Type":"application/octet-stream","X-NOIDB-Preserved-Template":"true","X-NOIDB-Item-Count":"1","X-NOIDB-Document-Date":"2026-09-05",
        "X-NOIDB-File-Name":data.kind==="discontinue"?"fixture.zip":"release_02.xlsx","X-NOIDB-XLSX-File-Name":"fixture_02.xlsx",
        "X-NOIDB-PDF-File-Name":data.kind==="discontinue"?"fixture_02.pdf":"","X-NOIDB-Drive-Saved":"true",
      }});
    }
    assert.equal(request.method(),"GET",`Unexpected write ${url.pathname}`);
    return route.fulfill({json:{configured:true,items:[]}});
  });
  const page=await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
  try {
    await page.goto(base+"/wms/vendor-orders/status-requests");
    await page.getByRole("checkbox",{name:"70000000 요청 선택",exact:true}).waitFor();
    assert.equal(actions.length,0);
    for(const width of [360,390,412,430,1920]) {
      await page.setViewportSize({width,height:width<500?844:1080});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
      await page.screenshot({path:path.join(output,`status-${width}.png`),fullPage:true});
    }
    await page.getByRole("button",{name:"전체선택",exact:true}).click();
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(),4);
    assert.equal(await page.getByRole("button",{name:"단종 업로드 완료",exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole("button",{name:"해제 이메일 발송 완료",exact:true}).isEnabled(),true);
    page.once("dialog",dialog=>dialog.dismiss());
    await page.getByRole("button",{name:"해제 이메일 발송 완료",exact:true}).click();
    assert.equal(actions.length,0,"Cancel must not change external completion status");
    await page.getByRole("button",{name:"선택해제",exact:true}).click();
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(),0);
    for(const [sku,button] of [["70000000","선택 단종파일 생성"],["70000001","선택 단종해제 파일 생성"]]) {
      await page.getByRole("checkbox",{name:`${sku} 요청 선택`,exact:true}).check();
      await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:button,exact:true}).click()]);
      await page.getByText(/생성완료 ·/).waitFor();
      await page.getByRole("button",{name:"선택해제",exact:true}).click();
    }
    assert.deepEqual(requests,original);
    assert.equal(actions.filter(action=>action.action==="record-status-files").length,2);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,widths:[360,390,412,430,1920],completedRegeneration:true,explicitCompletionCancelWrites:0,historyOnlyWrites:2,operatingWrites:0,originalRequestsPreserved:true}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
