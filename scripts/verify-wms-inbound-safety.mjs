import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const sourcePath = path.join(process.cwd(), "templates", "구글시트_상품DB_연동.gs");
const source = fs.readFileSync(sourcePath, "utf8");
const parserSource = fs.readFileSync(path.join(process.cwd(), "app", "api", "coupang-data", "route.ts"), "utf8");
const context = {
  console,
  Utilities: {
    formatDate(value) {
      const date = value instanceof Date ? value : new Date(value);
      return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("/");
    },
  },
  Session: { getScriptTimeZone: () => "Asia/Seoul" },
};

vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.__purchaseTrackingTotals = purchaseTrackingTotals_;`, context, { filename: sourcePath });

function poRow({ po, sku = "SKU-1", qty, received = 0, expectedDate = "2026-08-20", status = "발주확정", key = `${po}-${sku}` }) {
  const row = Array(16).fill("");
  row[0] = key;
  row[1] = po;
  row[2] = sku;
  row[4] = status;
  row[7] = expectedDate;
  row[8] = "2026-08-01";
  row[9] = qty;
  row[10] = qty;
  row[11] = received;
  return row;
}

function mockSpreadsheet(rows) {
  return {
    getSheetByName() {
      return {
        getLastRow: () => rows.length + 1,
        getRange: () => ({ getValues: () => rows }),
      };
    },
  };
}

function missing(rows, inboundTotals = {}, sku = "SKU-1") {
  return context.__purchaseTrackingTotals(mockSpreadsheet(rows), inboundTotals)[sku]?.missingTotal;
}

assert.equal(missing([poRow({ po: "A", qty: 12, received: 12 })]), 0, "정상 완전입고");
assert.equal(missing([poRow({ po: "A", qty: 12, received: 12, expectedDate: "2026-08-20" })]), 0, "지연일과 무관한 완전입고");
assert.equal(missing([poRow({ po: "A", qty: 12, received: 5 })]), 7, "부분입고");
assert.equal(
  missing([poRow({ po: "A", qty: 12, received: 5 })], { "SKU-1": { byPo: { A: 12 }, unassignedNet: 0 } }),
  0,
  "추가입고 누계",
);
assert.equal(
  missing([
    poRow({ po: "A", qty: 12, received: 12, key: "A-1" }),
    poRow({ po: "B", qty: 10, received: 0, key: "B-1" }),
  ]),
  10,
  "동일 SKU 복수 발주 분리",
);
assert.equal(missing([poRow({ po: "A", qty: 12, received: 20 })]), 0, "미입고 음수 방지");
assert.equal(missing([poRow({ po: "A", qty: 12, received: 0, status: "발주취소" })]), undefined, "취소 발주 제외");

assert.match(parserSource, /row\["발주번호"\].*row\["번호"\]/s, "번호 헤더를 발주번호 후보로 인식");
assert.match(source, /existingByFingerprint\[fingerprint\]/, "동일 파일 fingerprint 조회");
assert.match(source, /skippedDatasets\+\+; return;/, "동일 fingerprint 재업로드 건너뛰기");

console.log(JSON.stringify({
  ok: true,
  scenarios: ["정상 완전입고", "지연 완전입고", "부분입고", "추가입고", "동일 SKU 복수 발주", "음수 방지", "취소 제외", "동일 파일 재업로드 방지"],
}));
