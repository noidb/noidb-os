"use client";

import { ChangeEvent, useState } from "react";
import { readImageFile, rebuildDetailPage, type QuickDetailStyle } from "@/lib/image-generator/quick-detail";
import styles from "./styles.module.css";

const STYLE_OPTIONS: Array<{ value: QuickDetailStyle; title: string; description: string }> = [
  { value: "clean", title: "깔끔한 화이트", description: "원본 분위기를 유지하고 여백과 크기만 정돈합니다." },
  { value: "ivory", title: "고급 아이보리", description: "따뜻한 배경과 카드 여백으로 부드럽게 구성합니다." },
  { value: "modern", title: "모던 그레이", description: "연한 회색 배경과 절제된 간격으로 구성합니다." },
];

export default function QuickDetailComposer() {
  const [source, setSource] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [modelName, setModelName] = useState("");
  const [style, setStyle] = useState<QuickDetailStyle>("clean");
  const [result, setResult] = useState<{ dataUrl: string; sectionCount: number; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("긴 상세이미지 한 장만 올려주세요.");

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setSource(await readImageFile(file));
      setSourceName(file.name);
      setModelName(file.name.replace(/\.[^.]+$/, ""));
      setResult(null);
      setMessage("이미지를 불러왔습니다. 스타일을 고르고 만들기만 누르세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 불러오지 못했습니다.");
    }
  }

  async function create() {
    if (!source) return setMessage("긴 상세이미지를 먼저 올려주세요.");
    setBusy(true);
    setMessage("상세이미지를 자동으로 나누고 새 배치로 구성하고 있습니다.");
    try {
      const rebuilt = await rebuildDetailPage(source, "/노이드비-상단이미지.jpg", style);
      setResult(rebuilt);
      setMessage(`${rebuilt.sectionCount}개 구간을 자동 재구성했습니다. API 비용은 들지 않습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "새 상세페이지를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.quickPanel}>
    <div className={styles.quickIntro}>
      <div><span>FAST DETAIL</span><h2>긴 상세이미지 한 장으로 바로 만들기</h2><p>사진을 하나씩 지정하지 않아도 자동으로 나누고, NOID-B 상단 이미지와 새로운 여백·배치로 다시 연결합니다.</p></div>
      <strong>API 비용 없음 · 약 5초</strong>
    </div>
    <div className={styles.quickSteps}>
      <article><span>1</span><h3>상세이미지 올리기</h3><label className={styles.quickUpload}>{source ? "다른 이미지 선택" : "긴 상세이미지 선택"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} /></label>{sourceName && <small>{sourceName}</small>}<label className={styles.quickModel}>저장할 모델명<input value={modelName} onChange={event => setModelName(event.target.value)} placeholder="예: we0001" /></label></article>
      <article><span>2</span><h3>분위기 선택</h3><div className={styles.styleChoices}>{STYLE_OPTIONS.map(option => <label key={option.value} className={style === option.value ? styles.selectedStyle : ""}><input type="radio" name="quick-style" value={option.value} checked={style === option.value} onChange={() => setStyle(option.value)} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div></article>
      <article><span>3</span><h3>한 번에 만들기</h3><button className={styles.quickCreate} disabled={!source || busy} onClick={create}>{busy ? "새로 구성하는 중…" : "새 상세페이지 만들기"}</button><p>{message}</p>{result && <a className={styles.quickDownload} href={result.dataUrl} download={`${modelName.trim() || "NOID-B-상세페이지"}.jpg`}>완성 이미지 저장하기</a>}</article>
    </div>
    {result && <div className={styles.quickResult}><div><strong>완성 미리보기</strong><span>{result.width}×{result.height}px · {result.sectionCount}개 구간</span></div><a href={result.dataUrl} target="_blank" rel="noreferrer"><img src={result.dataUrl} alt="자동 재구성 상세페이지" /></a></div>}
  </section>;
}
