"use client";

import { ChangeEvent, useState } from "react";
import { composeQuickDetailPage, readImageFile, splitDetailPage, type QuickDetailSection, type QuickDetailStyle } from "@/lib/image-generator/quick-detail";
import styles from "./styles.module.css";

const HEADER_URL = "/노이드비-상단이미지.jpg";
const STYLE_OPTIONS: Array<{ value: QuickDetailStyle; title: string; description: string }> = [
  { value: "clean", title: "밝은 주얼리 화이트", description: "밝고 깨끗한 쇼핑몰 제품사진 분위기" },
  { value: "ivory", title: "고급 아이보리", description: "따뜻하고 부드러운 고급 주얼리 분위기" },
  { value: "modern", title: "모던 그레이", description: "차분하고 세련된 현대적인 분위기" },
];

type Result = { dataUrl: string; sectionCount: number; width: number; height: number };

export default function QuickDetailComposer() {
  const [source, setSource] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [headerUrl, setHeaderUrl] = useState(HEADER_URL);
  const [headerName, setHeaderName] = useState("노이드비-상단이미지.jpg");
  const [footerUrl, setFooterUrl] = useState("");
  const [footerName, setFooterName] = useState("");
  const [modelName, setModelName] = useState("");
  const [style, setStyle] = useState<QuickDetailStyle>("clean");
  const [originalSections, setOriginalSections] = useState<QuickDetailSection[]>([]);
  const [editedSections, setEditedSections] = useState<QuickDetailSection[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanSummary, setScanSummary] = useState<{ found: number; kept: number; excluded: number } | null>(null);
  const [message, setMessage] = useState("긴 상세이미지 한 장만 올려주세요.");

  async function selectUsableSections(sections: QuickDetailSection[]) {
    const selected: QuickDetailSection[] = [];
    for (let offset = 0; offset < sections.length; offset += 8) {
      const batch = sections.slice(offset, offset + 8);
      setMessage(`${sections.length}개 구간 중 제품컷과 착용컷을 자동으로 선별하고 있습니다.`);
      const response = await fetch("/api/image-generator/quick-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: batch }),
      });
      const data = await response.json() as { decisions?: Array<{ id: string; keep: boolean; kind: "product" | "wear" | "exclude"; reason: string }>; error?: string };
      if (!response.ok || !data.decisions) throw new Error(data.error || "제품컷을 자동 선별하지 못했습니다.");
      const decisions = new Map(data.decisions.map(decision => [decision.id, decision]));
      batch.forEach(section => {
        const decision = decisions.get(section.id);
        if (decision?.keep && decision.kind !== "exclude") selected.push({ ...section, kind: decision.kind, reason: decision.reason });
      });
    }
    if (!selected.length) throw new Error("사용할 수 있는 제품컷이나 착용컷을 찾지 못했습니다.");
    return selected;
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const source = await readImageFile(file);
      const foundSections = await splitDetailPage(source, headerUrl);
      const sections = await selectUsableSections(foundSections);
      setSource(source);
      setSourceName(file.name);
      setModelName(file.name.replace(/\.[^.]+$/, ""));
      setOriginalSections(sections);
      setEditedSections([]);
      setResult(null);
      setProgress(0);
      setScanSummary({ found: foundSections.length, kept: sections.length, excluded: foundSections.length - sections.length });
      setMessage(`${foundSections.length}개 구간 중 제품·착용컷 ${sections.length}장만 남겼습니다. 설명·로고·패키지 ${foundSections.length - sections.length}개는 제외했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function chooseHeader(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const nextHeader = await readImageFile(file);
      setHeaderUrl(nextHeader);
      setHeaderName(file.name);
      setEditedSections([]);
      setResult(null);
      setProgress(0);
      if (source) {
        const foundSections = await splitDetailPage(source, nextHeader);
        const sections = await selectUsableSections(foundSections);
        setOriginalSections(sections);
        setScanSummary({ found: foundSections.length, kept: sections.length, excluded: foundSections.length - sections.length });
        setMessage(`상단 로고를 바꿨습니다. 제품·착용컷 ${sections.length}장으로 새 브랜드 상세페이지를 만들 수 있습니다.`);
      } else {
        setMessage("상단 로고 이미지를 바꿨습니다. 이제 긴 상세이미지를 올려주세요.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상단 로고 이미지를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function useNoidbHeader() {
    setBusy(true);
    try {
      setHeaderUrl(HEADER_URL);
      setHeaderName("노이드비-상단이미지.jpg");
      setEditedSections([]);
      setResult(null);
      setProgress(0);
      if (source) {
        const foundSections = await splitDetailPage(source, HEADER_URL);
        const sections = await selectUsableSections(foundSections);
        setOriginalSections(sections);
        setScanSummary({ found: foundSections.length, kept: sections.length, excluded: foundSections.length - sections.length });
      }
      setMessage("NOID-B 기본 상단 이미지로 되돌렸습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFooter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setFooterUrl(await readImageFile(file));
      setFooterName(file.name);
      setResult(null);
      setMessage("하단 이미지를 추가했습니다. 완성 상세페이지의 맨 아래에 원본 비율로 넣습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "하단 이미지를 불러오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  }

  function removeFooter() {
    setFooterUrl("");
    setFooterName("");
    setResult(null);
    setMessage("하단 이미지를 뺐습니다. 마지막 사진 아래 30px 흰 여백으로 끝납니다.");
  }

  async function editSection(section: QuickDetailSection) {
    const response = await fetch("/api/image-generator/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "quick-detail", style, sectionKind: section.kind, references: [{ dataUrl: section.dataUrl, role: section.kind || "detail-section" }] }),
    });
    const data = await response.json() as { imageDataUrl?: string; error?: string };
    if (!response.ok || !data.imageDataUrl) throw new Error(data.error || "사진을 새로 만들지 못했습니다.");
    return { ...section, dataUrl: data.imageDataUrl };
  }

  async function create() {
    if (!originalSections.length) return setMessage("긴 상세이미지를 먼저 올려주세요.");
    setBusy(true);
    setResult(null);
    const completed = [...editedSections];
    try {
      for (let index = completed.length; index < originalSections.length; index += 1) {
        setProgress(index);
        setMessage(`${originalSections.length}장 중 ${index + 1}번째 사진을 새롭게 만들고 있습니다. 완성된 사진은 그대로 보관됩니다.`);
        const edited = await editSection(originalSections[index]);
        completed.push(edited);
        setEditedSections([...completed]);
      }
      setProgress(originalSections.length);
      const composed = await composeQuickDetailPage(headerUrl, completed, footerUrl || undefined);
      setResult(composed);
      setMessage("같은 제품을 사용한 새로운 상세페이지를 완성했습니다. 사진 사이는 30px 여백으로 연결했습니다. 제품 모양을 꼭 확인해주세요.");
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "작업 중 문제가 생겼습니다."} 다시 누르면 ${completed.length + 1}번째부터 이어서 만듭니다.`);
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.quickPanel}>
    <div className={styles.quickIntro}>
      <div><span>AI DETAIL REMAKE</span><h2>같은 제품으로 새로운 상세페이지 만들기</h2><p>제품은 그대로 유지하고 제품컷은 흰 커튼·접시·책 등을 활용한 새로운 배경과 각도로, 모델컷은 새로운 얼굴·헤어·의상·분위기로 만듭니다.</p></div>
      <strong>사진별 AI 편집</strong>
    </div>
    <div className={styles.quickSteps}>
      <article><span>1</span><h3>이미지 올리기</h3><label className={styles.quickUpload}>{sourceName ? "다른 상세이미지 선택" : "긴 상세이미지 선택"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} /></label>{sourceName && <small>{sourceName}</small>}<div className={styles.headerUpload}><strong>상단 로고 이미지</strong><small>{headerName}</small><label>다른 브랜드 로고 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeader} /></label>{headerUrl !== HEADER_URL && <button type="button" onClick={useNoidbHeader}>NOID-B 기본 로고로 되돌리기</button>}</div><div className={styles.headerUpload}><strong>하단 로고·안내 이미지 (선택)</strong><small>{footerName || "올리지 않으면 30px 흰 여백으로 끝납니다."}</small><label>하단 이미지 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFooter} /></label>{footerUrl && <button type="button" onClick={removeFooter}>하단 이미지 빼기</button>}</div><label className={styles.quickModel}>저장할 모델명<input value={modelName} onChange={event => setModelName(event.target.value)} placeholder="예: we0001-new" /></label></article>
      <article><span>2</span><h3>새로운 분위기 선택</h3><div className={styles.styleChoices}>{STYLE_OPTIONS.map(option => <label key={option.value} className={style === option.value ? styles.selectedStyle : ""}><input type="radio" name="quick-style" value={option.value} checked={style === option.value} onChange={() => { setStyle(option.value); setEditedSections([]); setResult(null); setProgress(0); }} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div></article>
      <article><span>3</span><h3>한 번에 새로 만들기</h3><button className={styles.quickCreate} disabled={!originalSections.length || busy} onClick={create}>{busy ? `${originalSections.length}장 중 ${Math.min(progress + 1, originalSections.length)}장 작업 중…` : editedSections.length ? "이어서 만들기" : "새 상세페이지 만들기"}</button><p>{message}</p>{scanSummary && <div className={styles.scanSummary}><span>찾은 구간 <strong>{scanSummary.found}</strong></span><span>사용할 사진 <strong>{scanSummary.kept}</strong></span><span>자동 제외 <strong>{scanSummary.excluded}</strong></span></div>}{originalSections.length > 0 && <small>예상 AI 편집: {originalSections.length}회 · 완료: {editedSections.length}장</small>}{result && <a className={styles.quickDownload} href={result.dataUrl} download={`${modelName.trim() || "NOID-B-새상세페이지"}.jpg`}>완성 이미지 저장하기</a>}</article>
    </div>
    {result && <div className={styles.quickResult}><div><strong>완성 미리보기</strong><span>{result.width}×{result.height}px · AI 편집 {result.sectionCount}장</span><small>제품 무늬·잠금장치·크기가 원본과 같은지 확대해서 확인해주세요.</small></div><a href={result.dataUrl} target="_blank" rel="noreferrer"><img src={result.dataUrl} alt="AI로 새롭게 만든 상세페이지" /></a></div>}
  </section>;
}
