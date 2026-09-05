const fs = require("node:fs");
const path = require("node:path");
const source = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
const destination = path.join(__dirname, "../public/barcode-reader/zxing_reader.wasm");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
const ocrDir = path.join(__dirname, "../public/barcode-reader/ocr");
fs.mkdirSync(path.join(ocrDir, "core"), { recursive: true });
fs.mkdirSync(path.join(ocrDir, "lang"), { recursive: true });
const tesseractDir = path.dirname(require.resolve("tesseract.js/package.json"));
const coreDir = path.dirname(require.resolve("tesseract.js-core/package.json"));
fs.copyFileSync(path.join(tesseractDir, "dist/worker.min.js"), path.join(ocrDir, "worker.min.js"));
// Keep all engine variants: Tesseract selects the supported SIMD/LSTM engine on each device.
for (const file of fs.readdirSync(coreDir).filter(name => /\.wasm(?:\.js)?$/.test(name))) {
  fs.copyFileSync(path.join(coreDir, file), path.join(ocrDir, "core", file));
}
fs.copyFileSync(path.join(require("@tesseract.js-data/eng").langPath, "eng.traineddata.gz"), path.join(ocrDir, "lang/eng.traineddata.gz"));
console.log("사진 바코드 판독기 준비 완료");
