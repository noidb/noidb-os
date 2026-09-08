const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const repositoryRoot = path.resolve(__dirname, "..");
const target = path.resolve(repositoryRoot, process.argv[2] || "scripts/verify-safe-product-file-write.ts");
if (!target.startsWith(`${__dirname}${path.sep}`) || !target.endsWith(".ts")) {
  throw new Error("scripts 폴더의 TypeScript 검증 파일만 실행할 수 있습니다.");
}
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith("@/") ? path.join(repositoryRoot, request.slice(2)) : request, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);
require(target);
