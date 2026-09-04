const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

const client = source("lib/product-db/files.ts");
const route = source("app/api/google-sheet/route.ts");
const appsScript = source("templates/구글시트_상품DB_연동.gs");

assert.match(client, /const operationId = globalThis\.crypto\?\.randomUUID/);
assert.match(client, /const requestBody = JSON\.stringify\([\s\S]*operationId/);
assert.match(client, /for \(let attempt = 0; attempt < 2;/, "같은 작업번호로 네트워크 실패를 한 번 재시도해야 합니다.");
assert.match(route, /등록 작업번호가 올바르지 않습니다/);
assert.match(route, /operationId,/);
assert.match(appsScript, /LockService\.getScriptLock\(\)/);
assert.match(appsScript, /CacheService\.getScriptCache\(\)/);
assert.match(appsScript, /product-registration:/);
assert.match(appsScript, /operationCache\.put\(operationKey, JSON\.stringify\(result\), 21600\)/);

console.log("상품등록 중복 실행 방지·동일 작업 재시도 규칙 검증 완료");
