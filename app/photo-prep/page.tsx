"use client";

import Link from "next/link";
import { useState } from "react";
import { compressImageDataUrl } from "@/lib/image/compress";
import { cutoutToWhiteSquare, type CutoutResult } from "@/lib/thumbnail/cutout";

/**
 * 2026-11-11 사진 정리(1단계): 폰으로 찍은 사진 → 대표이미지(흰 배경 정사각형) + 자 사진 사이즈 읽기.
 * 이후 단계(상세페이지 만들기·상품DB 폴더 저장)에서 이 화면의 결과를 이어서 쓴다.
 */

type Cover = { id: string; name: string; sourceUrl: string; result?: CutoutResult; busy: boolean; message: string };
type Measured = {
  chainCm: number | null;
  chainSideCm: number | null;
  extensionCm: number | null;
  pendantWidthCm: number | null;
  pendantHeightCm: number | null;
  confidence: number;
  notes: string;
  rulerVisible: boolean;
};

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

const numberText = (value: number | null) => (value === null ? "" : String(value));
const toNumber = (text: string) => {
  const value = Number(text.replace(/[^0-9.]/g, ""));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
};

export default function PhotoPrepPage() {
  const [covers, setCovers] = useState<Cover[]>([]);
  const [rulerUrl, setRulerUrl] = useState("");
  const [folded, setFolded] = useState(true);
  const [measureBusy, setMeasureBusy] = useState(false);
  const [measureMessage, setMeasureMessage] = useState("");
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [chain, setChain] = useState("");
  const [extension, setExtension] = useState("");
  const [pendantW, setPendantW] = useState("");
  const [pendantH, setPendantH] = useState("");
  const [copied, setCopied] = useState("");

  const patchCover = (id: string, patch: Partial<Cover>) =>
    setCovers(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)));

  const addCoverFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const items: Cover[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
      if (!/^image\/(jpeg|png)$/.test(file.type)) continue;
      items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, sourceUrl: await readFile(file), busy: false, message: "" });
    }
    setCovers(prev => [...prev, ...items]);
  };

  const cleanUp = async (cover: Cover) => {
    patchCover(cover.id, { busy: true, message: "시작합니다..." });
    try {
      const result = await cutoutToWhiteSquare(cover.sourceUrl, { onProgress: message => patchCover(cover.id, { message }) });
      patchCover(cover.id, {
        busy: false,
        result,
        message: result.brightnessGain > 1 ? `완료 · 밝기 ${Math.round((result.brightnessGain - 1) * 100)}% 올림` : "완료 · 밝기 그대로",
      });
    } catch (error) {
      patchCover(cover.id, { busy: false, message: `오류: ${error instanceof Error ? error.message : "다시 시도해주세요."}` });
    }
  };

  const downloadCover = (cover: Cover) => {
    if (!cover.result) return;
    const link = document.createElement("a");
    link.href = cover.result.squareDataUrl;
    link.download = `${cover.name.replace(/\.[^.]+$/, "")}_대표.jpg`;
    link.click();
  };

  const addRulerFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setRulerUrl(await readFile(file));
    setMeasured(null);
    setMeasureMessage("");
  };

  const readRuler = async () => {
    if (!rulerUrl) return;
    setMeasureBusy(true);
    setMeasureMessage("자 눈금을 읽는 중입니다...");
    try {
      const compressed = await compressImageDataUrl(rulerUrl, 1600, 0.85);
      const response = await fetch("/api/measure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: compressed, foldedInHalf: folded }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        setMeasureMessage(`오류: ${data?.error || "자 읽기에 실패했습니다."}`);
        return;
      }
      setMeasured(data as Measured);
      setChain(numberText(data.chainCm));
      setExtension(numberText(data.extensionCm));
      setPendantW(numberText(data.pendantWidthCm));
      setPendantH(numberText(data.pendantHeightCm));
      setMeasureMessage(
        data.rulerVisible
          ? "읽었습니다. 아래 값을 확인하고 틀리면 고쳐 주세요."
          : "자를 찾지 못했습니다. 자가 나란히 보이게 다시 찍어주세요."
      );
    } catch (error) {
      setMeasureMessage(`오류: ${error instanceof Error ? error.message : "다시 시도해주세요."}`);
    } finally {
      setMeasureBusy(false);
    }
  };

  const sizeText = (() => {
    const parts: string[] = [];
    const chainValue = toNumber(chain);
    const extValue = toNumber(extension);
    const w = toNumber(pendantW);
    const h = toNumber(pendantH);
    if (chainValue) parts.push(`체인 약 ${chainValue}cm${extValue ? ` + 연장 ${extValue}cm` : ""}`);
    else if (extValue) parts.push(`연장 ${extValue}cm`);
    if (w && h) parts.push(`펜던트 약 ${w}×${h}cm`);
    else if (w || h) parts.push(`펜던트 약 ${w || h}cm`);
    return parts.join(", ");
  })();

  const copySize = async () => {
    try {
      await navigator.clipboard.writeText(sizeText);
      setCopied("복사했습니다.");
    } catch {
      setCopied("복사하지 못했습니다. 글자를 직접 선택해 복사해주세요.");
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">NOID-B OS · 사진</p>
          <h1>사진 정리</h1>
          <p className="sub">폰으로 찍은 사진을 대표이미지로 정리하고, 자 사진에서 사이즈를 읽습니다.</p>
        </div>
        <Link className="softBeigeButton" href="/" style={{ borderRadius: 8, padding: "10px 14px", textDecoration: "none", color: "#252525", whiteSpace: "nowrap" }}>
          상품등록으로 돌아가기
        </Link>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>대표이미지 정리</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          전체컷을 올리면 배경을 지우고 흰 배경 정사각형(1000×1000)으로 맞춥니다. 결과는 눈으로 확인하고 저장하세요(체인 모양이 잘리지 않았는지 봐 주세요).
        </p>
        <input type="file" accept="image/jpeg,image/png" multiple onChange={event => { void addCoverFiles(event.target.files); event.target.value = ""; }} />
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {covers.map(cover => (
            <div key={cover.id} className="result" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, alignItems: "start" }}>
              <div>
                <span>원본 · {cover.name}</span>
                <img src={cover.sourceUrl} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 8, background: "#fff" }} />
              </div>
              <div>
                <span>정리 결과</span>
                {cover.result ? (
                  <img src={cover.result.squareDataUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }} />
                ) : (
                  <div style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #cbd5e1", borderRadius: 8, color: "#6b7280", textAlign: "center", padding: 12 }}>
                    {cover.busy ? cover.message : "아직 정리 전입니다."}
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gap: 8, gridColumn: "1 / -1", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
                <button type="button" className="softSageButton" disabled={cover.busy} onClick={() => void cleanUp(cover)}>
                  {cover.busy ? "정리 중..." : cover.result ? "다시 정리하기" : "배경 지우고 정리"}
                </button>
                <button type="button" className="softPinkButton" disabled={!cover.result} onClick={() => downloadCover(cover)}>위 이미지 저장</button>
                <button type="button" className="softBeigeButton" onClick={() => setCovers(prev => prev.filter(item => item.id !== cover.id))}>목록에서 빼기</button>
              </div>
              {cover.message && !cover.busy && <small className="modelAvailable" style={{ gridColumn: "1 / -1" }}>{cover.message}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>자 사진으로 사이즈 읽기</h2>
        <p className="note" style={{ marginBottom: 12 }}>
          자 옆에 상품을 나란히 놓고 위에서 수평으로 찍은 사진 1장을 올립니다. 읽은 값은 꼭 확인하고 고쳐 쓰세요.
        </p>
        <input type="file" accept="image/jpeg,image/png" onChange={event => { void addRulerFile(event.target.files); event.target.value = ""; }} />
        {rulerUrl && (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <img src={rulerUrl} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb" }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
              <input type="checkbox" checked={folded} onChange={event => setFolded(event.target.checked)} />
              체인을 반으로 접어 찍었음 (체인 길이를 2배로 계산)
            </label>
            <button type="button" className="softSageButton" disabled={measureBusy} onClick={() => void readRuler()}>
              {measureBusy ? "읽는 중..." : "자 눈금 읽기"}
            </button>
          </div>
        )}
        {measureMessage && <p className="detailMessage">{measureMessage}</p>}

        {(measured || rulerUrl) && (
          <div style={{ marginTop: 12 }}>
            <div className="formGrid">
              <label className="field"><span>체인 길이(cm){measured && measured.chainSideCm !== null && folded ? ` · 접힌 길이 ${measured.chainSideCm}cm × 2` : ""}</span>
                <input value={chain} inputMode="decimal" onChange={event => setChain(event.target.value)} placeholder="예: 40" /></label>
              <label className="field"><span>연장 체인(cm)</span>
                <input value={extension} inputMode="decimal" onChange={event => setExtension(event.target.value)} placeholder="예: 5" /></label>
              <label className="field"><span>펜던트 가로(cm)</span>
                <input value={pendantW} inputMode="decimal" onChange={event => setPendantW(event.target.value)} placeholder="예: 1.0" /></label>
              <label className="field"><span>펜던트 세로(cm)</span>
                <input value={pendantH} inputMode="decimal" onChange={event => setPendantH(event.target.value)} placeholder="예: 0.8" /></label>
            </div>
            {measured && <p className="note">AI 확신도 {measured.confidence}%{measured.notes ? ` · ${measured.notes}` : ""}</p>}
            <div className="result" style={{ marginTop: 10 }}>
              <span>사이즈 안내 문구</span>
              <strong>{sizeText || "값을 입력하면 문구가 만들어집니다."}</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 10 }}>
              <button type="button" className="softBeigeButton" disabled={!sizeText} onClick={() => void copySize()}>위 문구 복사</button>
            </div>
            {copied && <small className="modelAvailable">{copied}</small>}
          </div>
        )}
      </section>
    </main>
  );
}
