import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-generator/rules.ts", import.meta.url), "utf8");
const profileSource = fs.readFileSync(new URL("../lib/image-generator/category-profiles.ts", import.meta.url), "utf8");
const profileCompiled = ts.transpileModule(profileSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const profileModule = { exports: {} };
vm.runInNewContext(`(function(exports,module){${profileCompiled}\n})(module.exports,module)`, { module: profileModule });
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(`(function(exports,module,require){${compiled}\n})(module.exports,module,require)`, { module, require: path => path === "./category-profiles" ? profileModule.exports : (() => { throw new Error(`지원하지 않는 테스트 모듈: ${path}`); })() });
const { allColorRule, filenameFor, initialProduct, estimateImageCalls } = module.exports;

assert.equal(allColorRule(["RG"]).enabled, false, "1컬러는 옵션컷을 생략해야 합니다.");
assert.equal(allColorRule(["RG", "SI"]).expectedProducts, 4, "2컬러는 제품 4개여야 합니다.");
assert.equal(allColorRule(["RG", "GO", "SI"]).expectedProducts, 6, "3컬러는 제품 6개여야 합니다.");
assert.equal(allColorRule(["RG", "SI"], "목걸이").expectedProducts, 2, "목걸이 2컬러는 제품 2개여야 합니다.");
assert.equal(allColorRule(["RG", "SI"], "여자반지").expectedProducts, 2, "여자반지 2컬러는 제품 2개여야 합니다.");
assert.equal(allColorRule(["RG", "SI"], "여자발찌").expectedProducts, 2, "여자발찌 2컬러는 제품 2개여야 합니다.");
assert.equal(allColorRule(["RG", "SI"], "남자반지").expectedProducts, 2, "남자반지 2컬러는 제품 2개여야 합니다.");
assert.equal(allColorRule(["RG", "RG"]).colorCount, 1, "중복 색상은 한 색상으로 계산해야 합니다.");
assert.equal(filenameFor("we0001", "wear", undefined, 2), "we0001-WEAR-02.jpg");
assert.equal(filenameFor("we0001", "color", "GO"), "we0001-GO.jpg");
assert.equal(estimateImageCalls(initialProduct(), [], false).total, 8, "기본 최초 생성은 기준1+색상3+착용3+모델1입니다.");
console.log("이미지 자동생성 규칙 테스트 11개 통과");
