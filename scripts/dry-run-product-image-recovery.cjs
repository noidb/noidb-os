const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const SOURCE_PATH = "G:\\내 드라이브\\상품이미지DB\\쿠팡데이터\\이미지db_수정.xlsx";
const SOURCE_SHEET = "이미지DB";
const PRODUCT_SHEET = "제품DB";
const DEFAULT_SPREADSHEET_ID = "15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA";
const DRIVE_IMAGE_ROOT = "G:\\내 드라이브\\상품이미지DB";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SHEETS_WMS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_WMS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets 서비스 계정 환경변수가 없습니다.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || `HTTP ${response.status}`);
  return result.access_token;
}

function normalizeSkuId(value) {
  return String(value ?? "").trim().replace(/^'/, "").replace(/[\s,]/g, "").replace(/\.0+$/, "");
}

function normalizeMatchKey(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

function normalizeStrictStem(value) {
  return String(value ?? "").trim().normalize("NFKC").toLowerCase();
}

function listImageFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(entry.name)) result.push(fullPath);
    }
  }
  return result;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pushMap(map, key, value) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (typeof value.error === "string") return value.error;
    if (typeof value.formula === "string") return `=${value.formula}`;
    if (typeof value.hyperlink === "string") return value.hyperlink;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("");
    if (value.result !== undefined) return String(value.result ?? "");
  }
  return String(value).trim();
}

function collectCellCandidates(cell) {
  const candidates = [];
  const value = cell.value;
  const push = (url, method) => {
    const normalized = String(url || "").trim().replace(/^['"]|['"]$/g, "");
    if (normalized && !candidates.some(item => item.url === normalized)) candidates.push({ url: normalized, method });
  };
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^"'\s,)]+/gi)) push(match[0], "direct");
  } else if (value && typeof value === "object") {
    if (typeof value.hyperlink === "string") push(value.hyperlink, "hyperlink");
    if (typeof value.formula === "string") {
      for (const match of value.formula.matchAll(/https?:\/\/[^"'\s,)]+/gi)) push(match[0], "formula");
    }
    if (typeof value.result === "string") {
      for (const match of value.result.matchAll(/https?:\/\/[^"'\s,)]+/gi)) push(match[0], "formula-result");
    }
  }
  if (typeof cell.hyperlink === "string") push(cell.hyperlink, "hyperlink");
  const formulaText = String(cell.formula || "");
  for (const match of formulaText.matchAll(/https?:\/\/[^"'\s,)]+/gi)) push(match[0], "formula");
  return candidates;
}

function isSafeImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(pathname)) return true;
    if (/(^|\.)coupangcdn\.com$/.test(host) && /\/image\//i.test(pathname)) return true;
    if (host === "drive.google.com" && pathname === "/uc" && url.searchParams.has("id")) return true;
    if (/(^|\.)googleusercontent\.com$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

async function fetchProductRows() {
  const token = await getAccessToken();
  const spreadsheetId = process.env.GOOGLE_SHEETS_WMS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const range = encodeURIComponent(`'${PRODUCT_SHEET}'`);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMULA`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (response.ok) return result.values || [];
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(result?.error?.message || `HTTP ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("Google Sheets 읽기 재시도에 실패했습니다.");
}

async function main() {
  loadLocalEnv();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_PATH);
  const sourceSheet = workbook.getWorksheet(SOURCE_SHEET);
  if (!sourceSheet) throw new Error(`원본 시트가 없습니다: ${SOURCE_SHEET}`);
  const sourceHeaders = sourceSheet.getRow(1).values.slice(1).map(value => String(value ?? "").trim());
  const imageIndex = sourceHeaders.indexOf("이미지링크") + 1;
  const thumbnailIndex = sourceHeaders.indexOf("썸네일") + 1;
  const skuIndex = sourceHeaders.indexOf("SKU") + 1;
  if (!imageIndex || !thumbnailIndex || !skuIndex) throw new Error("이미지DB에서 이미지링크/썸네일/SKU 헤더를 찾지 못했습니다.");
  const otherImageIndexes = sourceHeaders
    .map((header, index) => ({ header, index: index + 1 }))
    .filter(entry => entry.index !== imageIndex && entry.index !== thumbnailIndex && /이미지|썸네일/i.test(entry.header) && entry.header !== "제품링크");

  const sourceBySku = new Map();
  for (let rowNumber = 2; rowNumber <= sourceSheet.rowCount; rowNumber += 1) {
    const row = sourceSheet.getRow(rowNumber);
    const sku = normalizeSkuId(cellText(row.getCell(skuIndex)));
    if (!sku) continue;
    const imageLinkCandidates = collectCellCandidates(row.getCell(imageIndex)).filter(candidate => isSafeImageUrl(candidate.url));
    const thumbnailCandidates = collectCellCandidates(row.getCell(thumbnailIndex)).filter(candidate => isSafeImageUrl(candidate.url));
    const otherImageCandidates = otherImageIndexes.flatMap(entry =>
      collectCellCandidates(row.getCell(entry.index)).filter(candidate => isSafeImageUrl(candidate.url)).map(candidate => ({ ...candidate, header: entry.header }))
    );
    const record = {
      rowNumber,
      sku,
      image: cellText(row.getCell(imageIndex)),
      productNumber: cellText(row.getCell(sourceHeaders.indexOf("제품번호") + 1)),
      productName: cellText(row.getCell(sourceHeaders.indexOf("상품명") + 1)),
      modelName: cellText(row.getCell(sourceHeaders.indexOf("모델명") + 1)),
      imageLinkCandidates,
      thumbnailCandidates,
      otherImageCandidates,
    };
    const current = sourceBySku.get(sku) || [];
    current.push(record);
    sourceBySku.set(sku, current);
  }

  const productRows = await fetchProductRows();
  const headers = (productRows[0] || []).map(value => String(value ?? "").trim());
  const productSkuIndex = headers.indexOf("SKU ID");
  const productImageIndex = headers.indexOf("이미지");
  if (productSkuIndex < 0 || productImageIndex < 0) throw new Error("제품DB에서 SKU ID/이미지 헤더를 찾지 못했습니다.");

  const dataRows = productRows.slice(1).filter(row => row.some(value => String(value ?? "").trim()));
  const blankRows = dataRows.map((row, offset) => ({ rowNumber: offset + 2, row })).filter(({ row }) => !String(row[productImageIndex] ?? "").trim());
  const exactMatches = [];
  const usableMatches = [];
  const recoveryBySource = { imageLink: [], thumbnail: [], hyperlinkOrFormula: [], otherImageColumn: [] };
  const unmatched = [];
  const duplicates = [];
  const matchedEmptyImages = [];
  const blankWithoutSku = [];
  for (const entry of blankRows) {
    const rawSku = String(entry.row[productSkuIndex] ?? "");
    const sku = normalizeSkuId(rawSku);
    if (!sku) {
      blankWithoutSku.push({ rowNumber: entry.rowNumber, rawSku });
      continue;
    }
    const candidates = sourceBySku.get(sku) || [];
    if (candidates.length === 0) unmatched.push({ rowNumber: entry.rowNumber, sku });
    else if (candidates.length > 1) duplicates.push({ rowNumber: entry.rowNumber, sku, sourceRows: candidates.map(item => item.rowNumber) });
    else if (!candidates[0].image.trim() && candidates[0].thumbnailCandidates.length === 0 && candidates[0].otherImageCandidates.length === 0) matchedEmptyImages.push({ rowNumber: entry.rowNumber, sku, sourceRow: candidates[0].rowNumber });
    else {
      const source = candidates[0];
      const directImageLink = source.imageLinkCandidates.find(candidate => candidate.method === "direct");
      const directThumbnail = source.thumbnailCandidates.find(candidate => candidate.method === "direct");
      const formulaOrHyperlink = [...source.imageLinkCandidates, ...source.thumbnailCandidates]
        .find(candidate => candidate.method !== "direct");
      const otherImage = source.otherImageCandidates[0];
      const selected = directImageLink || directThumbnail || formulaOrHyperlink || otherImage;
      const sourceType = directImageLink ? "imageLink" : directThumbnail ? "thumbnail" : formulaOrHyperlink ? "hyperlinkOrFormula" : otherImage ? "otherImageColumn" : "invalid";
      const match = { rowNumber: entry.rowNumber, sku, sourceRow: source.rowNumber, image: selected?.url || source.image, sourceType };
      exactMatches.push(match);
      if (selected) {
        usableMatches.push(match);
        recoveryBySource[sourceType].push(match);
      }
    }
  }

  const populatedImageFormats = dataRows
    .map(row => String(row[productImageIndex] ?? "").trim())
    .filter(Boolean)
    .reduce((counts, value) => {
      const type = /^=IMAGE\(/i.test(value) ? "IMAGE_FORMULA" : /^https?:\/\//i.test(value) ? "URL" : "OTHER";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});

  const productFieldIndex = {
    modelName: headers.indexOf("모델명/품번"),
    modelSku: headers.indexOf("모델SKU"),
    productName: headers.indexOf("상품명"),
    color: headers.indexOf("색상"),
    jewelrySize: headers.indexOf("주얼리사이즈"),
    dimensions: headers.indexOf("치수"),
  };
  const productMetaRows = dataRows.map((row, offset) => ({
    rowNumber: offset + 2,
    sku: normalizeSkuId(row[productSkuIndex]),
    modelName: String(row[productFieldIndex.modelName] ?? "").trim(),
    modelSku: String(row[productFieldIndex.modelSku] ?? "").trim(),
    productName: String(row[productFieldIndex.productName] ?? "").trim(),
    option: [row[productFieldIndex.color], row[productFieldIndex.jewelrySize], row[productFieldIndex.dimensions]]
      .map(value => String(value ?? "").trim()).filter(Boolean).join(" / "),
    image: String(row[productImageIndex] ?? "").trim(),
  }));
  const modelCounts = new Map();
  const nameOptionCounts = new Map();
  for (const row of productMetaRows) {
    pushMap(modelCounts, normalizeMatchKey(row.modelName), row);
    pushMap(nameOptionCounts, `${normalizeMatchKey(row.productName)}::${normalizeMatchKey(row.option)}`, row);
  }

  const imageFiles = listImageFiles(DRIVE_IMAGE_ROOT);
  const byStem = new Map();
  const byStrictStem = new Map();
  const searchableFiles = [];
  for (const filePath of imageFiles) {
    const stem = path.basename(filePath, path.extname(filePath));
    if (/^(라벨|label)[-_]/i.test(stem)) continue;
    const info = { path: filePath, stem, stemKey: normalizeMatchKey(stem), pathKey: normalizeMatchKey(filePath) };
    searchableFiles.push(info);
    pushMap(byStem, info.stemKey, info);
    pushMap(byStrictStem, normalizeStrictStem(stem), info);
  }

  const urlMatchesByProductRow = new Map(usableMatches.map(match => [match.rowNumber, match]));
  const rawAudit = [];
  const candidateFilePaths = new Set();
  for (const product of productMetaRows.filter(row => !row.image)) {
    const candidates = [];
    const seen = new Set();
    const addUrl = (url, source, evidence, priority) => {
      const key = `url:${url}`;
      if (!url || seen.has(key)) return;
      seen.add(key);
      candidates.push({ kind: "url", location: url, source, evidence, priority });
    };
    const addFiles = (files, source, evidence, priority) => {
      for (const file of files || []) {
        const key = `file:${file.path.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidateFilePaths.add(file.path);
        candidates.push({ kind: "file", location: file.path, source, evidence, priority });
      }
    };
    const prior = urlMatchesByProductRow.get(product.rowNumber);
    if (prior) addUrl(prior.image, "기존 이미지DB", `SKU ${product.sku} 정확 일치`, 4);
    addFiles(byStrictStem.get(normalizeStrictStem(product.sku)), "Google Drive", `파일명이 SKU ${product.sku}와 정확 일치`, 1);
    addFiles(byStem.get(normalizeMatchKey(product.modelSku)), "Google Drive", `파일명이 옵션별 모델SKU ${product.modelSku}와 정확 일치`, 2);
    const sourceRecords = sourceBySku.get(product.sku) || [];
    for (const source of sourceRecords) {
      addFiles(byStrictStem.get(normalizeStrictStem(source.productNumber)), "Google Drive", `이미지DB 제품번호 ${source.productNumber}와 파일명 정확 일치`, 3);
    }
    const modelKey = normalizeMatchKey(product.modelName);
    const optionKey = normalizeMatchKey(product.option);
    const productNameKey = normalizeMatchKey(product.productName);
    if (modelKey) {
      addFiles(byStem.get(modelKey), "Google Drive", `파일명이 모델명 ${product.modelName}과 정확 일치`, 5);
      if (optionKey) {
        addFiles(searchableFiles.filter(file => file.pathKey.includes(modelKey) && file.pathKey.includes(optionKey)), "Google Drive", `경로에 모델명과 옵션이 모두 정확 포함`, 2);
      }
    }
    if (productNameKey && optionKey) {
      addFiles(searchableFiles.filter(file => file.pathKey.includes(productNameKey) && file.pathKey.includes(optionKey)), "Google Drive", "경로에 전체 상품명과 옵션 조합이 정확 포함", 6);
    }
    rawAudit.push({ ...product, candidates });
  }

  const fileHashes = new Map();
  for (const filePath of candidateFilePaths) fileHashes.set(filePath, sha256File(filePath));
  const auditRows = rawAudit.map(row => {
    const candidates = row.candidates.map(candidate => ({ ...candidate, contentHash: candidate.kind === "file" ? fileHashes.get(candidate.location) : `url:${candidate.location}` }));
    const strongestPriority = candidates.length ? Math.min(...candidates.map(candidate => candidate.priority)) : null;
    const strongest = candidates.filter(candidate => candidate.priority === strongestPriority);
    const uniqueStrongContents = new Set(strongest.map(candidate => candidate.contentHash));
    const modelVariants = modelCounts.get(normalizeMatchKey(row.modelName)) || [];
    const nameOptionVariants = nameOptionCounts.get(`${normalizeMatchKey(row.productName)}::${normalizeMatchKey(row.option)}`) || [];
    let confidence = "C";
    let recoverable = "아니오";
    let note = "안전한 이미지 원본을 찾지 못함";
    if (strongest.length) {
      const priorityAllowsAuto = [1, 2, 3, 4].includes(strongestPriority)
        || (strongestPriority === 5 && modelVariants.length === 1)
        || (strongestPriority === 6 && nameOptionVariants.length === 1);
      if (priorityAllowsAuto && uniqueStrongContents.size === 1) {
        confidence = "A";
        recoverable = "예";
        note = strongest.length > 1 ? `동일 콘텐츠 복제본 ${strongest.length}개, 충돌 없음` : "단일 원본, 충돌 없음";
      } else {
        confidence = "B";
        note = uniqueStrongContents.size > 1
          ? `서로 다른 이미지 후보 ${uniqueStrongContents.size}개 — 옵션 확인 필요`
          : `모델 변형 ${modelVariants.length}개 또는 중복 상품명/옵션 — 사용자 확인 필요`;
      }
    }
    const selected = confidence === "A" ? strongest[0] : null;
    return {
      rowNumber: row.rowNumber,
      sku: row.sku,
      modelName: row.modelName,
      modelSku: row.modelSku,
      productName: row.productName,
      option: row.option,
      currentImage: row.image,
      source: selected?.source || [...new Set(candidates.map(candidate => candidate.source))].join(" / "),
      imageLocation: selected?.location || candidates.slice(0, 10).map(candidate => candidate.location).join("\n"),
      evidence: selected?.evidence || [...new Set(strongest.map(candidate => candidate.evidence))].join(" / "),
      candidateCount: candidates.length,
      uniqueContentCount: new Set(candidates.map(candidate => candidate.contentHash)).size,
      confidence,
      recoverable,
      note,
      candidates,
    };
  });
  const confidenceCounts = auditRows.reduce((counts, row) => {
    counts[row.confidence] += 1;
    return counts;
  }, { A: 0, B: 0, C: 0 });
  const revalidatedExistingSafe = auditRows.filter(row => row.confidence === "A" && row.source === "기존 이미지DB").length;

  const result = {
    dryRun: true,
    source: {
      path: SOURCE_PATH,
      sheet: SOURCE_SHEET,
      rowCount: sourceSheet.rowCount - 1,
      headers: sourceHeaders,
      duplicateSkuCount: [...sourceBySku.values()].filter(records => records.length > 1).length,
    },
    productDb: { sheet: PRODUCT_SHEET, headers, totalRows: dataRows.length, blankImageCells: blankRows.length, populatedImageFormats },
    results: {
      exactOneToOneMatches: exactMatches.length,
      usableOneToOneMatches: usableMatches.length,
      matchedButInvalidImage: exactMatches.length - usableMatches.length,
      recoverableFromImageLink: recoveryBySource.imageLink.length,
      additionallyRecoverableFromThumbnail: recoveryBySource.thumbnail.length,
      additionallyRecoverableFromHyperlinkOrFormula: recoveryBySource.hyperlinkOrFormula.length,
      additionallyRecoverableFromOtherImageColumns: recoveryBySource.otherImageColumn.length,
      finalSafeRecoverable: usableMatches.length,
      stillWithoutSafeImageSource: blankRows.length - usableMatches.length,
      unmatched: unmatched.length,
      duplicateSkuRows: duplicates.length,
      matchedButEmptyImage: matchedEmptyImages.length,
      blankRowsWithoutSku: blankWithoutSku.length,
      driveImageFilesScanned: imageFiles.length,
      candidateFilesHashed: candidateFilePaths.size,
      confidenceCounts,
      newlyFoundCandidates: auditRows.filter(row => row.candidateCount > 0 && !urlMatchesByProductRow.has(row.rowNumber)).length,
      revalidatedExistingSafe,
    },
    samples: {
      exactMatches: exactMatches.slice(0, 20).map(({ image, ...rest }) => ({
        ...rest,
        imageType: /^=IMAGE\(/i.test(image) ? "IMAGE_FORMULA" : /^https?:\/\//i.test(image) ? "URL" : "OTHER",
        imagePreview: image.slice(0, 180),
      })),
      unmatched: unmatched.slice(0, 10),
      duplicates: duplicates.slice(0, 10),
      matchedButEmptyImage: matchedEmptyImages.slice(0, 10),
      blankWithoutSku: blankWithoutSku.slice(0, 10),
    },
    auditRows,
  };
  const outputArgIndex = process.argv.indexOf("--output-json");
  if (outputArgIndex >= 0 && process.argv[outputArgIndex + 1]) {
    fs.mkdirSync(path.dirname(process.argv[outputArgIndex + 1]), { recursive: true });
    fs.writeFileSync(process.argv[outputArgIndex + 1], JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({ dryRun: true, output: process.argv[outputArgIndex + 1], results: result.results }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
