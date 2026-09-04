const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

async function main() {
  const sourceDir = path.resolve(__dirname, "../browser-extension/noidb-supplier-sync");
  const outputPath = path.resolve(__dirname, "../public/downloads/noidb-supplier-sync.zip");
  const zip = new JSZip();
  const files = fs.readdirSync(sourceDir)
    .filter(name => fs.statSync(path.join(sourceDir, name)).isFile())
    .sort();
  for (const filename of files) zip.file(filename, fs.readFileSync(path.join(sourceDir, filename)));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
  console.log(`Supplier Hub 확장 ZIP 생성 완료: ${files.length}개 파일`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
