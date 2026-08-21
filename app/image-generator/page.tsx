"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { basicQualityChecks, composeAllColorCut, composeDetailPage, normalizeSquare } from "@/lib/image-generator/canvas";
import { clearGeneratorSession, loadGeneratorSession, saveGeneratorSession } from "@/lib/image-generator/idb";
import { allColorRule, COLOR_OPTIONS, colorLabel, estimateImageCalls, filenameFor, initialProduct, PHOTO_ROLES } from "@/lib/image-generator/rules";
import { saveGeneratorResults } from "@/lib/image-generator/storage";
import type { ColorCode, GeneratedAsset, GeneratorSession, PhotoRole, ProductAnalysis, ReferencePhoto } from "@/lib/image-generator/types";
import { ensureReadWritePermission, loadDirectoryHandle, saveDirectoryHandle, supportsDirectoryPicker } from "@/lib/product-db/idb";
import { CATEGORY_PROFILES, categoryProfile } from "@/lib/image-generator/category-profiles";
import QuickDetailComposer from "./QuickDetailComposer";
import styles from "./styles.module.css";

const DEFAULT_HEADER: ReferencePhoto = { id: "noidb-detail-header", name: "노이드비-상단이미지.jpg", role: "detail-reference", dataUrl: "/노이드비-상단이미지.jpg", primary: false };

const newSession = (): GeneratorSession => ({
  version: 1, updatedAt: Date.now(), product: initialProduct(), photos: [], modelTemplateApproved: false,
  assets: [], detailOrder: [], detailOptions: [], headerImage: DEFAULT_HEADER,
});

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function fileToDataUrl(file: File, max = 1800) {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error("사진을 열지 못했습니다.")); value.src = raw;
  });
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export default function ImageGeneratorPage() {
  const [session, setSession] = useState<GeneratorSession>(newSession);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("제품 정보를 입력하고 사진을 올려주세요.");
  const [savedFiles, setSavedFiles] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);

  useEffect(() => { loadGeneratorSession().then(saved => { if (saved) setSession({ ...saved, headerImage: saved.headerImage || DEFAULT_HEADER }); }).finally(() => setReady(true)); }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => saveGeneratorSession({ ...session, updatedAt: Date.now() }).catch(() => undefined), 400);
    return () => window.clearTimeout(timer);
  }, [session, ready]);

  const profile = useMemo(() => categoryProfile(session.product.category), [session.product.category]);
  const rule = useMemo(() => allColorRule(session.product.colors, session.product.category), [session.product.colors, session.product.category]);
  const estimate = useMemo(() => estimateImageCalls(session.product, session.assets, Boolean(session.modelTemplate)), [session]);
  const approvedBaseline = session.assets.find(asset => asset.kind === "baseline" && asset.approved);
  const approvedColors = session.assets.filter(asset => asset.kind === "color" && asset.approved);
  const approvedWearColor = approvedColors.find(asset => asset.color === session.product.wearColor);
  const orderedAssets = session.detailOrder.map(id => session.assets.find(asset => asset.id === id)).filter((asset): asset is GeneratedAsset => Boolean(asset?.approved && asset.kind !== "baseline"));

  function patchProduct(patch: Partial<GeneratorSession["product"]>) {
    setSession(current => ({ ...current, product: { ...current.product, ...patch }, detailPage: undefined }));
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>, role: PhotoRole = "front") {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy("upload");
    try {
      const added = await Promise.all(files.map(async (file, index): Promise<ReferencePhoto> => ({ id: uid(), name: file.name, role, dataUrl: await fileToDataUrl(file), primary: session.photos.length === 0 && index === 0 })));
      setSession(current => ({ ...current, photos: [...current.photos, ...added], analysis: undefined }));
      setNotice(`${added.length}장의 사진을 불러왔습니다. 각 사진의 역할을 확인해주세요.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "사진을 불러오지 못했습니다."); }
    finally { setBusy(""); event.target.value = ""; }
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setSession(current => { const photos = [...current.photos]; const next = index + direction; if (next < 0 || next >= photos.length) return current; [photos[index], photos[next]] = [photos[next], photos[index]]; return { ...current, photos }; });
  }

  async function uploadHeader(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const photo: ReferencePhoto = { id: uid(), name: file.name, role: "detail-reference", dataUrl: await fileToDataUrl(file, 2400) };
    setSession(current => ({ ...current, headerImage: photo, detailPage: undefined }));
  }

  async function uploadModel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const dataUrl = await normalizeSquare(await fileToDataUrl(file));
    setSession(current => ({ ...current, modelTemplate: { id: uid(), kind: "model-template", label: "노이드비 전용 모델", filename: filenameFor(current.product.model, "model-template"), dataUrl, approved: false, createdAt: Date.now(), regenerationCount: 0 }, modelTemplateApproved: false }));
  }

  async function analyze() {
    if (!session.photos.length) return setNotice("제품 사진을 한 장 이상 올려주세요.");
    setBusy("analyze"); setNotice("제품 모양을 확인하고 있습니다.");
    try {
      const response = await fetch("/api/image-generator/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photos: session.photos.map(({ role, dataUrl }) => ({ role, dataUrl })), product: session.product }) });
      const data = await response.json() as ProductAnalysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "제품을 분석하지 못했습니다.");
      setSession(current => ({ ...current, analysis: data })); setNotice(data.canGenerate ? "분석이 끝났습니다. 기준 제품 이미지를 만들어주세요." : data.reason);
    } catch (error) { setNotice(error instanceof Error ? error.message : "제품을 분석하지 못했습니다."); }
    finally { setBusy(""); }
  }

  function upsertAsset(asset: GeneratedAsset) {
    setSession(current => {
      const index = current.assets.findIndex(item => item.kind === asset.kind && item.color === asset.color && item.variant === asset.variant);
      const assets = [...current.assets];
      const oldId = index >= 0 ? assets[index].id : null;
      if (index >= 0) assets[index] = asset; else assets.push(asset);
      const detailOrder = oldId ? current.detailOrder.map(id => id === oldId ? asset.id : id) : [...current.detailOrder, asset.id];
      return { ...current, assets, detailOrder, detailPage: undefined };
    });
  }

  async function generate(kind: "baseline" | "color" | "wear" | "detail" | "model-template", options: { color?: ColorCode; variant?: number; detail?: string } = {}) {
    if (busy) return;
    if (!session.product.model.trim() && kind !== "model-template") return setNotice("모델명을 먼저 입력해주세요.");
    if (kind === "baseline" && !session.analysis?.canGenerate) return setNotice("제품 사진 분석을 먼저 통과해주세요.");
    let references: Array<{ role: string; dataUrl: string }> = [];
    if (kind === "baseline" || kind === "detail") references = session.photos.map(photo => ({ role: photo.role, dataUrl: photo.dataUrl }));
    if (kind === "color" && approvedBaseline) references = [{ role: "approved-baseline", dataUrl: approvedBaseline.dataUrl }];
    if (kind === "wear" && approvedWearColor && session.modelTemplateApproved && session.modelTemplate) references = [{ role: "approved-product", dataUrl: approvedWearColor.dataUrl }, { role: "approved-model", dataUrl: session.modelTemplate.dataUrl }];
    if (kind !== "model-template" && !references.length) return setNotice("이 단계에 필요한 승인 이미지가 없습니다.");
    const key = `${kind}-${options.color || ""}-${options.variant || ""}`; setBusy(key); setNotice("이미지를 만들고 있습니다. 버튼을 다시 누르지 말아주세요.");
    try {
      const response = await fetch("/api/image-generator/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, references, product: session.product, color: options.color, metal: COLOR_OPTIONS.find(item => item.code === options.color)?.metal, variant: options.variant, detail: options.detail }) });
      const data = await response.json() as { imageDataUrl?: string; error?: string };
      if (!response.ok || !data.imageDataUrl) throw new Error(data.error || "이미지를 만들지 못했습니다.");
      const normalized = await normalizeSquare(data.imageDataUrl);
      const existing = kind === "model-template" ? session.modelTemplate : session.assets.find(item => item.kind === kind && item.color === options.color && item.variant === options.variant);
      const asset: GeneratedAsset = { id: uid(), kind, color: options.color, variant: options.variant, label: kind === "baseline" ? "승인용 기준 제품" : kind === "color" ? `${colorLabel(options.color!)} 단독 썸네일` : kind === "wear" ? `착용컷 ${options.variant}` : kind === "detail" ? options.detail || "상세 이미지" : "노이드비 전용 모델", filename: filenameFor(session.product.model, kind, options.color, options.variant), dataUrl: normalized, approved: false, createdAt: Date.now(), regenerationCount: (existing?.regenerationCount || 0) + (existing ? 1 : 0) };
      asset.checks = await basicQualityChecks(asset);
      if (kind === "model-template") setSession(current => ({ ...current, modelTemplate: asset, modelTemplateApproved: false })); else upsertAsset(asset);
      setNotice("미리보기를 확인한 뒤 승인해주세요.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "이미지를 만들지 못했습니다."); }
    finally { setBusy(""); }
  }

  function approveAsset(id: string) {
    setSession(current => ({ ...current, assets: current.assets.map(asset => asset.id === id ? { ...asset, approved: true } : asset), detailPage: undefined }));
  }

  async function makeAllColors() {
    if (!rule.enabled) return setNotice(rule.message);
    if (session.product.colors.some(color => !approvedColors.some(asset => asset.color === color))) return setNotice("선택한 모든 색상 이미지를 먼저 승인해주세요.");
    setBusy("all-colors");
    try {
      for (const variant of [1, 2]) {
        const dataUrl = await composeAllColorCut(approvedColors, session.product.colors, variant);
        const existing = session.assets.find(asset => asset.kind === "all-colors" && asset.variant === variant);
        const asset: GeneratedAsset = { id: uid(), kind: "all-colors", variant, label: `선택 색상 옵션컷 ${variant}`, filename: filenameFor(session.product.model, "all-colors", undefined, variant), dataUrl, approved: false, createdAt: Date.now(), regenerationCount: existing ? existing.regenerationCount + 1 : 0 };
        asset.checks = await basicQualityChecks(asset); upsertAsset(asset);
      }
      setNotice(`${rule.colorCount}컬러, 총 ${rule.expectedProducts}개 제품이 보이는 옵션컷 2장을 조합했습니다. 직접 확인해주세요.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "옵션컷을 만들지 못했습니다."); }
    finally { setBusy(""); }
  }

  async function makeDetailPage() {
    if (!session.headerImage) return setNotice("노이드비 상단 고정 이미지를 먼저 올려주세요.");
    if (!orderedAssets.length) return setNotice("상세페이지에 넣을 승인 이미지가 없습니다.");
    setBusy("detail-page");
    try { const detailPage = await composeDetailPage(session.headerImage.dataUrl, orderedAssets); setSession(current => ({ ...current, detailPage })); setNotice("가로 780px 상세페이지를 만들었습니다."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "상세페이지를 만들지 못했습니다."); }
    finally { setBusy(""); }
  }

  function reorderDrop(event: DragEvent<HTMLDivElement>, target: string) {
    event.preventDefault(); if (!dragged || dragged === target) return;
    setSession(current => { const order = [...current.detailOrder]; const from = order.indexOf(dragged); const to = order.indexOf(target); if (from < 0 || to < 0) return current; order.splice(from, 1); order.splice(to, 0, dragged); return { ...current, detailOrder: order, detailPage: undefined }; }); setDragged(null);
  }

  function applyDefaultOrder() {
    const rank = (asset: GeneratedAsset) => {
      if (asset.kind === "all-colors" && asset.variant === 1) return 10;
      if (asset.kind === "color" && asset.color === session.product.wearColor) return 20;
      if (asset.kind === "color") return 30 + (["GO", "RG", "SI"].indexOf(asset.color || "") + 1);
      if (asset.kind === "wear") return 40 + (asset.variant || 0);
      if (asset.kind === "all-colors" && asset.variant === 2) return 50;
      if (asset.kind === "detail") return 60 + (asset.variant || 0);
      return 100;
    };
    setSession(current => ({ ...current, detailOrder: current.assets.filter(asset => asset.kind !== "baseline").sort((a, b) => rank(a) - rank(b)).map(asset => asset.id), detailPage: undefined }));
  }

  async function saveAll() {
    const requiredColors = session.product.colors.every(color => approvedColors.some(asset => asset.color === color));
    const requiredWear = [1, 2, 3].every(variant => session.assets.some(asset => asset.kind === "wear" && asset.variant === variant && asset.approved));
    const requiredAll = !rule.enabled || [1, 2].every(variant => session.assets.some(asset => asset.kind === "all-colors" && asset.variant === variant && asset.approved));
    if (!requiredColors || !requiredWear || !requiredAll || !session.detailPage) return setNotice("필수 이미지를 모두 승인하고 상세페이지를 만든 뒤 저장해주세요.");
    setBusy("save");
    try {
      let handle = await loadDirectoryHandle();
      if (!handle || !(await ensureReadWritePermission(handle))) {
        if (!supportsDirectoryPicker()) throw new Error("이 브라우저에서는 상품DB 폴더 선택을 지원하지 않습니다.");
        handle = await window.showDirectoryPicker({ mode: "readwrite" }); await saveDirectoryHandle(handle);
      }
      const saved = await saveGeneratorResults(handle, session); setSavedFiles(saved); setNotice(`${saved.length}개 파일을 상품DB에 저장했습니다.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "파일을 저장하지 못했습니다."); }
    finally { setBusy(""); }
  }

  async function reset() { if (!window.confirm("현재 임시 작업을 지울까요? 저장한 상품DB 파일은 지워지지 않습니다.")) return; await clearGeneratorSession(); setSession(newSession()); setSavedFiles([]); }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <div className={styles.brandLockup}><img className={styles.noidbMark} src="/icon-192.png" alt="" aria-hidden="true" /><div><strong>NOID-B OS</strong><span>NOID-B AUTOMATION</span></div></div>
        <h1>빠른 상세페이지</h1>
        <p>긴 상세이미지 한 장을 NOID-B 형식으로 간편하게 다시 구성합니다.</p>
      </div>
      <div className={styles.headerButtons}><Link href="/">상품등록으로 돌아가기</Link></div>
    </header>
    <QuickDetailComposer />

    <details className={styles.precisionDetails}>
      <summary>기존 정밀 이미지 생성 열기</summary>
      <div className={styles.precisionBody}>
    <div className={styles.notice}>{busy && <span className={styles.spinner} />} {notice}</div>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>1</span><h2>상품 정보</h2></div><p>예상 유료 이미지 생성 호출: <strong>{estimate.total}회</strong> · 옵션컷/상세페이지 조합은 API 비용 없음</p></div>
      <div className={styles.formGrid}>
        <label>카테고리<select value={profile.label} onChange={e => patchProduct({ category: e.target.value })}>{CATEGORY_PROFILES.map(item => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label>모델명<input value={session.product.model} onChange={e => patchProduct({ model: e.target.value })} placeholder="예: we0001" /></label>
        <label>실제 촬영 제품 색상<select value={session.product.photographedColor} onChange={e => patchProduct({ photographedColor: e.target.value as ColorCode })}>{COLOR_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}</select></label>
        <label>대표 착용 색상<select value={session.product.wearColor} onChange={e => patchProduct({ wearColor: e.target.value as ColorCode })}>{session.product.colors.map(c => <option key={c} value={c}>{colorLabel(c)} ({c})</option>)}</select></label>
        <label>가로 크기(mm)<input inputMode="decimal" value={session.product.widthMm} onChange={e => patchProduct({ widthMm: e.target.value })} /></label>
        <label>세로 크기(mm)<input inputMode="decimal" value={session.product.heightMm} onChange={e => patchProduct({ heightMm: e.target.value })} /></label>
        <label>두께(mm)<input inputMode="decimal" value={session.product.thicknessMm} onChange={e => patchProduct({ thicknessMm: e.target.value })} /></label>
      </div>
      <div className={styles.colorChoices}><strong>생성할 색상 옵션</strong>{COLOR_OPTIONS.map(color => <label key={color.code}><input type="checkbox" checked={session.product.colors.includes(color.code)} onChange={e => { const colors = e.target.checked ? [...session.product.colors, color.code] : session.product.colors.filter(value => value !== color.code); if (!colors.length) return setNotice("색상은 한 가지 이상 선택해주세요."); patchProduct({ colors, wearColor: colors.includes(session.product.wearColor) ? session.product.wearColor : colors[0] }); }} />{color.label} ({color.code})</label>)}</div>
      <p className={styles.rule}>{rule.message} · {profile.label}는 색상마다 제품 {profile.unitsPerColor === 2 ? "한 쌍" : "1개"}를 사용합니다.</p>
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>2</span><h2>제품 참고사진</h2></div><label className={styles.fileButton}>여러 장 올리기<input type="file" accept="image/*" multiple onChange={e => addPhotos(e)} /></label></div>
      <p className={styles.help}>앞면·뒷면·측면·잠금장치·한 쌍·착용 크기·자와 함께 찍은 사진을 올리고 역할을 지정해주세요. 사용자 착용사진에서는 크기와 위치만 참고합니다.</p>
      <div className={styles.photoGrid}>{session.photos.map((photo, index) => <article className={styles.photoCard} key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><select value={photo.role} onChange={e => setSession(current => ({ ...current, photos: current.photos.map(item => item.id === photo.id ? { ...item, role: e.target.value as PhotoRole } : item), analysis: undefined }))}>{PHOTO_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select><label className={styles.primary}><input type="radio" checked={Boolean(photo.primary)} onChange={() => setSession(current => ({ ...current, photos: current.photos.map(item => ({ ...item, primary: item.id === photo.id })) }))} />대표 참고사진</label><div><button onClick={() => movePhoto(index, -1)}>←</button><button onClick={() => movePhoto(index, 1)}>→</button><button onClick={() => setSession(current => ({ ...current, photos: current.photos.filter(item => item.id !== photo.id), analysis: undefined }))}>삭제</button></div></article>)}</div>
      <button className={styles.primaryButton} disabled={Boolean(busy) || !session.photos.length} onClick={analyze}>제품 사진 분석하기</button>
      {session.analysis && <Analysis result={session.analysis} />}
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>3</span><h2>기준 제품 승인</h2></div><button className={styles.primaryButton} disabled={Boolean(busy) || !session.analysis?.canGenerate} onClick={() => generate("baseline")}>{session.assets.some(a => a.kind === "baseline") ? "기준 이미지만 다시 만들기" : "기준 제품 이미지 만들기"}</button></div>
      <AssetGrid assets={session.assets.filter(a => a.kind === "baseline")} approve={approveAsset} regenerate={asset => generate("baseline", { variant: asset.variant })} exclude={id => setSession(current => ({ ...current, assets: current.assets.filter(a => a.id !== id) }))} />
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>4</span><h2>색상별 단독 썸네일</h2></div></div><div className={styles.actionRow}>{session.product.colors.map(color => <button key={color} disabled={Boolean(busy) || !approvedBaseline} onClick={() => generate("color", { color })}>{colorLabel(color)} {session.assets.some(a => a.kind === "color" && a.color === color) ? "다시 만들기" : "만들기"}</button>)}</div>
      {!approvedBaseline && <p className={styles.help}>기준 제품 이미지를 먼저 승인해주세요.</p>}<AssetGrid assets={session.assets.filter(a => a.kind === "color" && session.product.colors.includes(a.color!))} approve={approveAsset} regenerate={asset => generate("color", { color: asset.color })} exclude={id => setSession(current => ({ ...current, assets: current.assets.filter(a => a.id !== id) }))} />
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>5</span><h2>노이드비 전용 모델과 착용컷</h2></div></div>
      <div className={styles.modelActions}><label className={styles.fileButton}>승인된 모델 이미지 올리기<input type="file" accept="image/*" onChange={uploadModel} /></label><button disabled={Boolean(busy)} onClick={() => generate("model-template")}>{session.modelTemplate ? "모델 템플릿 다시 만들기" : "모델 템플릿 만들기"}</button></div>
      {session.modelTemplate && <article className={styles.modelCard}><img src={session.modelTemplate.dataUrl} alt="노이드비 모델 템플릿" /><div><strong>노이드비 전용 모델</strong><p>{session.modelTemplateApproved ? "승인됨" : "얼굴·귀·구도를 확인해주세요."}</p><button onClick={() => setSession(current => ({ ...current, modelTemplateApproved: true }))}>이 모델 승인하기</button></div></article>}
      <div className={styles.actionRow}>{[1,2,3].map(variant => <button key={variant} disabled={Boolean(busy) || !approvedWearColor || !session.modelTemplateApproved} onClick={() => generate("wear", { variant })}>착용컷 {variant} {session.assets.some(a => a.kind === "wear" && a.variant === variant) ? "다시 만들기" : "만들기"}</button>)}</div>
      <AssetGrid assets={session.assets.filter(a => a.kind === "wear")} approve={approveAsset} regenerate={asset => generate("wear", { variant: asset.variant })} exclude={id => setSession(current => ({ ...current, assets: current.assets.filter(a => a.id !== id) }))} />
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>6</span><h2>선택 색상 옵션컷</h2></div><button disabled={Boolean(busy) || !rule.enabled} onClick={makeAllColors}>{rule.enabled ? "옵션컷 2장 조합하기" : "1컬러라서 자동 생략"}</button></div><p className={styles.help}>{rule.message} 승인된 색상 썸네일을 배치하므로 생성형 AI 비용이 들지 않습니다.</p>
      <AssetGrid assets={session.assets.filter(a => a.kind === "all-colors")} approve={approveAsset} regenerate={() => makeAllColors()} exclude={id => setSession(current => ({ ...current, assets: current.assets.filter(a => a.id !== id) }))} />
    </section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>7</span><h2>선택 상세 이미지</h2></div></div><div className={styles.actionRow}>{["앞면 확대", "측면 확대", "뒷면 확대", "잠금장치 확대", "무늬·장식 확대"].map((detail, index) => <button key={detail} disabled={Boolean(busy)} onClick={() => generate("detail", { detail, variant: index + 1 })}>{detail} 만들기</button>)}</div><AssetGrid assets={session.assets.filter(a => a.kind === "detail")} approve={approveAsset} regenerate={asset => generate("detail", { variant: asset.variant, detail: asset.label })} exclude={id => setSession(current => ({ ...current, assets: current.assets.filter(a => a.id !== id) }))} /></section>

    <section className={styles.panel}><div className={styles.sectionTitle}><div><span>8</span><h2>상세페이지 순서와 저장</h2></div></div>
      <div className={styles.uploadRow}><label className={styles.fileButton}>노이드비 상단이미지 올리기<input type="file" accept="image/*" onChange={uploadHeader} /></label><button onClick={applyDefaultOrder}>기본 순서로 정렬</button><span>{session.headerImage ? session.headerImage.name : "상단 고정 이미지가 필요합니다."}</span></div>
      <div className={styles.orderList}>{orderedAssets.map(asset => <div key={asset.id} draggable onDragStart={() => setDragged(asset.id)} onDragOver={e => e.preventDefault()} onDrop={e => reorderDrop(e, asset.id)}><span>↕</span><img src={asset.dataUrl} alt="" /><strong>{asset.label}</strong><small>{asset.filename}</small></div>)}</div>
      <div className={styles.actionRow}><button className={styles.primaryButton} disabled={Boolean(busy)} onClick={makeDetailPage}>780px 상세페이지 만들기</button><button className={styles.saveButton} disabled={Boolean(busy)} onClick={saveAll}>승인 및 전체 저장</button></div>
      {session.detailPage && <a href={session.detailPage} download={`${session.product.model || "detail"}.jpg`} className={styles.detailPreview}><img src={session.detailPage} alt="완성 상세페이지" /><span>상세페이지 확대 또는 다운로드</span></a>}
      {savedFiles.length > 0 && <details className={styles.saved}><summary>저장된 파일 {savedFiles.length}개 보기</summary>{savedFiles.map(file => <div key={file}>{file}</div>)}</details>}
    </section>
      </div>
    </details>
  </main>;
}

function Analysis({ result }: { result: ProductAnalysis }) {
  return <div className={`${styles.analysis} ${result.canGenerate ? styles.ok : styles.stop}`}><strong>{result.canGenerate ? "생성할 수 있습니다" : "사진을 다시 확인해주세요"}</strong><dl><dt>제품 유형</dt><dd>{result.detectedType}</dd><dt>실제 색상</dt><dd>{result.detectedColor}</dd><dt>예상 크기</dt><dd>{result.estimatedSize}</dd><dt>확인된 사진</dt><dd>{result.confirmedViews.join(", ") || "없음"}</dd><dt>부족한 사진</dt><dd>{result.missingPhotos.join(", ") || "없음"}</dd></dl><p>{result.reason}</p></div>;
}

function AssetGrid({ assets, approve, regenerate, exclude }: { assets: GeneratedAsset[]; approve: (id: string) => void; regenerate: (asset: GeneratedAsset) => void; exclude: (id: string) => void }) {
  if (!assets.length) return null;
  return <div className={styles.assetGrid}>{assets.map(asset => { const failed = asset.checks?.some(check => check.status === "fail") || false; return <article key={asset.id} className={styles.assetCard}><a href={asset.dataUrl} target="_blank" rel="noreferrer"><img src={asset.dataUrl} alt={asset.label} /></a><div><strong>{asset.label}</strong><small>{asset.filename}</small>{asset.checks?.map(check => <p key={check.key} className={check.status === "fail" ? styles.fail : check.status === "pass" ? styles.pass : styles.review}>{check.label}: {check.message}</p>)}<div className={styles.cardActions}><button disabled={asset.approved || failed} onClick={() => approve(asset.id)}>{asset.approved ? "승인됨" : failed ? "검사 실패" : "이 이미지 승인"}</button><button onClick={() => regenerate(asset)}>이 이미지만 다시 만들기</button><button onClick={() => exclude(asset.id)}>제외</button></div></div></article>; })}</div>;
}
