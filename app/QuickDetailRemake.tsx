"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { extendToSquareCanvas } from "@/lib/thumbnail/fit";
import { composeQuickDetailPage, readImageFile, resizeSectionTo1000, splitDetailPage, type QuickDetailSection, type QuickDetailStyle } from "@/lib/image-generator/quick-detail";
import { deleteQuickDraft, listQuickDrafts, MAX_QUICK_DRAFTS, saveQuickDraft, type QuickDetailDraft } from "@/lib/image-generator/quick-drafts";
import styles from "./quick-detail.module.css";

const STYLE_OPTIONS: Array<{ value: QuickDetailStyle; title: string; description: string }> = [
  { value: "clean", title: "밝은 주얼리 화이트", description: "밝고 깨끗한 쇼핑몰 제품사진 분위기" },
  { value: "ivory", title: "고급 아이보리", description: "따뜻하고 부드러운 고급 주얼리 분위기" },
  { value: "modern", title: "모던 그레이", description: "차분하고 세련된 현대적인 분위기" },
];

type Result = { dataUrl: string; sectionCount: number; width: number; height: number };
type CutState = { dataUrl: string; name: string; top: number; bottom: number; mode: "top" | "bottom"; history: Array<{ top: number; bottom: number }> };

type Props = {
  headerUrl: string;
  footerUrl: string;
  modelName: string;
  incomingFile: File | null;
  incomingToken: number;
  onComplete: (result: { dataUrl: string; sections: QuickDetailSection[]; logoApplied?: boolean }) => void;
  onAddToList: (items: Array<{ fileName: string; dataUrl: string; source: string }>) => void;
  /** 5번 쿠팡 등록이미지(목록·칸)의 사진. 상세페이지 없이 여기서 골라 바로 AI 편집을 시작할 수 있다. */
  poolImages?: Array<{ dataUrl: string; fileName: string }>;
};

async function cropDataUrl(dataUrl: string, top: number, bottom: number): Promise<string> {
  if (top <= 0 && bottom >= 1) return dataUrl;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("상세페이지를 불러오지 못했습니다."));
    element.src = dataUrl;
  });
  const y = Math.round(image.naturalHeight * top);
  const h = Math.max(1, Math.round(image.naturalHeight * bottom) - y);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(image, 0, y, image.naturalWidth, h, 0, 0, image.naturalWidth, h);
  return canvas.toDataURL("image/jpeg", 0.97);
}

// 위를 잘라 로고가 없어진 상세페이지 맨 위에 6번 상단 로고 이미지를 같은 폭으로 붙인다(6번 상단 로고 칸의 "상세페이지 사용").
export async function prependHeader(dataUrl: string, headerUrl: string): Promise<string> {
  const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("상단 로고 이미지를 불러오지 못했습니다."));
    element.src = src;
  });
  const [page, header] = await Promise.all([load(dataUrl), load(headerUrl)]);
  const width = page.naturalWidth;
  const headerHeight = Math.round(header.naturalHeight * (width / header.naturalWidth));
  // 새로 만드는 상세페이지와 같은 비율(780px 기준 90px)로 로고 아래 여백을 둔다.
  const gap = Math.round(width * 90 / 780);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = headerHeight + gap + page.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(header, 0, 0, width, headerHeight);
  ctx.drawImage(page, 0, headerHeight + gap);
  return canvas.toDataURL("image/jpeg", 0.97);
}

function newDraftId() {
  return `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function QuickDetailRemake({ headerUrl, footerUrl, modelName, incomingFile, incomingToken, onComplete, onAddToList, poolImages = [] }: Props) {
  const [pickingPool, setPickingPool] = useState(false);
  /** 이미 5번 목록에 넣은 AI 사진 — "이어서 만들기"를 다시 눌러도 같은 사진이 두 번 들어가지 않게 한다. */
  const alreadyAdded = useRef(new Set<string>());
  const [pickedPool, setPickedPool] = useState<string[]>([]);
  const [draftId, setDraftId] = useState("");
  const [drafts, setDrafts] = useState<QuickDetailDraft[]>([]);
  const [draftsReady, setDraftsReady] = useState(false);
  const deletedDraftIdsRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [cut, setCut] = useState<CutState | null>(null);
  const [source, setSource] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [style, setStyle] = useState<QuickDetailStyle>("clean");
  const [originalSections, setOriginalSections] = useState<QuickDetailSection[]>([]);
  const [editedSections, setEditedSections] = useState<QuickDetailSection[]>([]);
  const [sectionActions, setSectionActions] = useState<Record<string, "edit" | "original">>({});
  const [finalSections, setFinalSections] = useState<QuickDetailSection[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanSummary, setScanSummary] = useState<{ found: number; kept: number; excluded: number } | null>(null);
  const [message, setMessage] = useState("상세페이지를 올리거나, 등록이미지에서 사진을 골라주세요.");
  const expectedEdits = originalSections.filter(section => (sectionActions[section.id] || "edit") === "edit").length;
  const completedEdits = editedSections.filter(section => originalSections.some(original => original.id === section.id) && (sectionActions[section.id] || "edit") === "edit").length;
  const editedById = useMemo(() => new Map(editedSections.map(section => [section.id, section])), [editedSections]);

  useEffect(() => {
    void listQuickDrafts().then(items => { setDrafts(items); setDraftsReady(true); }).catch(() => setDraftsReady(true));
  }, []);

  // AI 편집은 비용이 들기 때문에 진행 중인 작업을 이 PC에 자동으로 보관한다.
  useEffect(() => {
    if (!draftsReady || !originalSections.length) return;
    const timeout = window.setTimeout(() => {
      const id = draftId || newDraftId();
      if (deletedDraftIdsRef.current.has(id)) return;
      if (!draftId) setDraftId(id);
      const draft: QuickDetailDraft = {
        id, savedAt: new Date().toISOString(), modelName, source, sourceName, headerUrl: "", headerName: "", footerUrl: "", footerName: "",
        style, originalSections, editedSections, finalSections, sectionActions, result, scanSummary,
        preview: editedSections[0]?.dataUrl || originalSections[0]?.dataUrl || source,
      };
      void saveQuickDraft(draft).then(items => setDrafts(items)).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsReady, draftId, source, sourceName, modelName, style, originalSections, editedSections, finalSections, sectionActions, result, scanSummary]);

  useEffect(() => {
    if (incomingFile) void startUpload(incomingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingToken]);

  function resetWork() {
    setOriginalSections([]);
    setEditedSections([]);
    setSectionActions({});
    setFinalSections([]);
    setResult(null);
    setProgress(0);
    setScanSummary(null);
  }

  async function startUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("JPG, PNG 또는 WEBP 이미지 파일을 올려주세요.");
      return;
    }
    try {
      const dataUrl = await readImageFile(file);
      setCut({ dataUrl, name: file.name, top: 0, bottom: 1, mode: "top", history: [] });
      setMessage("자를 부분이 있으면 위·아래 위치를 클릭해 정한 뒤, 그대로 상세페이지에 쓸지 사진별로 나눌지 선택하세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 불러오지 못했습니다.");
    }
  }

  async function classifyKinds(sections: QuickDetailSection[]) {
    const kinds = new Map<string, { kind: "product" | "wear"; reason: string }>();
    try {
      for (let offset = 0; offset < sections.length; offset += 8) {
        const batch = sections.slice(offset, offset + 8);
        setMessage(`${sections.length}장의 제품컷·착용컷 구분을 확인하고 있습니다.`);
        const response = await fetch("/api/image-generator/quick-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections: batch }) });
        const data = await response.json() as { decisions?: Array<{ id: string; keep: boolean; kind: "product" | "wear" | "exclude"; reason: string }>; error?: string };
        if (!response.ok || !data.decisions) throw new Error(data.error || "구분하지 못했습니다.");
        for (const decision of data.decisions) if (decision.kind === "product" || decision.kind === "wear") kinds.set(decision.id, { kind: decision.kind, reason: decision.reason });
      }
    } catch { /* 구분하지 못한 사진은 제품컷으로 두고 직접 바꿀 수 있게 한다. */ }
    return sections.map(section => ({ ...section, kind: kinds.get(section.id)?.kind || ("product" as const), reason: kinds.get(section.id)?.reason || "직접 확인해주세요." }));
  }

  // 사진별로 나눠서 등록이미지·AI 새로 만들기에 쓴다. 자를 때마다 이전에 나눠 둔 사진은 새 사진으로 바뀐다.
  async function confirmCutForSplit() {
    if (!cut || cut.bottom - cut.top < 0.02) {
      setMessage("사용할 구간이 너무 좁습니다. 위·아래 자를 위치를 다시 정해주세요.");
      return;
    }
    setBusy(true);
    try {
      const usable = await cropDataUrl(cut.dataUrl, cut.top, cut.bottom);
      const found = await splitDetailPage(usable, headerUrl);
      const classified = await classifyKinds(found);
      const stamp = Date.now().toString(36);
      const sections = classified.map(section => ({ ...section, id: `${stamp}-${section.id}` }));
      setDraftId(newDraftId());
      setSource(usable);
      setSourceName(cut.name);
      resetWork();
      setOriginalSections(sections);
      setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
      setScanSummary({ found: found.length, kept: sections.length, excluded: 0 });
      setCut(null);
      setMessage(`${sections.length}장을 가져왔습니다. 제품컷·착용컷 구분을 확인하고 새로 만들기를 누르세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세페이지를 나누지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 상세페이지 없이 사진 몇 장으로 바로 시작한다(모델컷·제품컷만 골라 AI 편집).
   * 고른 사진이 그대로 "사진별 확인" 목록이 되고, 2·3단계는 상세페이지를 나눴을 때와 똑같다.
   */
  async function startFromPhotos(images: Array<{ dataUrl: string; name: string }>, label: string) {
    if (!images.length || busy) return;
    setBusy(true);
    try {
      const stamp = Date.now().toString(36);
      const found = images.map((image, index) => ({ id: `${stamp}-p${index + 1}`, dataUrl: image.dataUrl }));
      const sections = await classifyKinds(found);
      setDraftId(newDraftId());
      setSource("");
      setSourceName(label);
      resetWork();
      setOriginalSections(sections);
      setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
      setScanSummary({ found: sections.length, kept: sections.length, excluded: 0 });
      setCut(null);
      setPickingPool(false);
      setPickedPool([]);
      setMessage(`사진 ${sections.length}장을 가져왔습니다. 제품컷·착용컷 구분을 확인하고, AI로 바꾸지 않을 사진은 "편집 제외"를 누른 뒤 새로 만들기를 누르세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 가져오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function choosePhotoFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])].filter(file => file.type.startsWith("image/"));
    event.target.value = "";
    if (!files.length) return;
    try {
      const images = await Promise.all(files.map(async file => ({ dataUrl: await readImageFile(file), name: file.name })));
      await startFromPhotos(images, `사진 ${images.length}장`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
    }
  }

  // 이미 완성된 상세페이지를 위·아래만 자르고, 맨 위에 6번 상단 로고만 붙여 상세페이지 칸에 넣는다(하단 이미지는 붙이지 않는다).
  async function useCroppedAsDetailPage() {
    if (!cut || cut.bottom - cut.top < 0.02) {
      setMessage("사용할 구간이 너무 좁습니다. 위·아래 자를 위치를 다시 정해주세요.");
      return;
    }
    setBusy(true);
    try {
      const usable = await prependHeader(await cropDataUrl(cut.dataUrl, cut.top, cut.bottom), headerUrl);
      onComplete({ dataUrl: usable, sections: [], logoApplied: true });
      setCut(null);
      setMessage("자른 상세페이지 맨 위에 상단 로고를 붙여 아래 상세페이지 칸에 넣었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상세페이지를 자르지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function dropFile(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) void startUpload(file);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void startUpload(file);
    event.target.value = "";
  }

  function invalidateResult() {
    setFinalSections([]);
    setResult(null);
  }

  function deleteSection(id: string) {
    setOriginalSections(current => current.filter(section => section.id !== id));
    setEditedSections(current => current.filter(section => section.id !== id));
    setSectionActions(current => { const next = { ...current }; delete next[id]; return next; });
    invalidateResult();
    setMessage("선택한 사진을 상세페이지와 저장 파일에서 제외했습니다.");
  }

  function toggleSectionEdit(id: string) {
    setSectionActions(current => ({ ...current, [id]: current[id] === "original" ? "edit" : "original" }));
    setEditedSections(current => current.filter(section => section.id !== id));
    invalidateResult();
    setMessage("선택을 반영했습니다. 예상 AI 편집 횟수를 확인해주세요.");
  }

  async function addToRegistrationImages() {
    if (!originalSections.length) return;
    setBusy(true);
    try {
      const stamp = Date.now().toString(36).slice(-4);
      const base = modelName.trim() || "NOID-B";
      const items: Array<{ fileName: string; dataUrl: string; source: string }> = [];
      for (let index = 0; index < originalSections.length; index += 1) {
        const section = originalSections[index];
        const edited = editedById.get(section.id);
        const useEdited = sectionActions[section.id] !== "original" && edited;
        const source = useEdited ? edited.dataUrl : section.dataUrl;
        items.push({ fileName: `${base}-cut-${stamp}-${String(index + 1).padStart(2, "0")}.jpg`, dataUrl: await extendToSquareCanvas(source, 1000), source });
      }
      onAddToList(items);
      setMessage(`${items.length}장을 5번 쿠팡 등록이미지 목록에 추가했습니다. 위 이미지 목록에서 썸네일·추가이미지 칸으로 끌어 넣으세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록이미지에 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function moveSection(id: string, direction: -1 | 1) {
    setOriginalSections(current => {
      const index = current.findIndex(section => section.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    invalidateResult();
    setMessage("순서를 바꿨습니다. 새 상세페이지 만들기를 다시 누르면 AI 편집이 끝난 사진은 그대로 쓰고 순서만 반영합니다.");
  }

  function toggleSectionKind(id: string) {
    setOriginalSections(current => current.map(section => section.id === id ? { ...section, kind: section.kind === "wear" ? "product" : "wear" } : section));
    setEditedSections(current => current.filter(section => section.id !== id));
    invalidateResult();
    setMessage("제품컷·착용컷 구분을 바꿨습니다. 이 사진은 새 구분에 맞춰 편집합니다.");
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
    if (!originalSections.length) return setMessage("상세페이지를 먼저 올려주세요.");
    setBusy(true);
    setResult(null);
    const byId = new Map(editedSections.map(section => [section.id, section]));
    const completed: QuickDetailSection[] = [];
    let editIndex = completedEdits;
    try {
      for (const section of originalSections) {
        if ((sectionActions[section.id] || "edit") === "original") {
          completed.push(section);
          continue;
        }
        let edited = byId.get(section.id);
        if (!edited) {
          setProgress(editIndex);
          setMessage(`AI 편집 ${expectedEdits}장 중 ${editIndex + 1}번째를 만들고 있습니다. 완성된 사진은 그대로 보관됩니다.`);
          edited = await editSection(section);
          byId.set(section.id, edited);
          setEditedSections(Array.from(byId.values()));
          editIndex += 1;
        }
        completed.push(edited);
      }
      setProgress(expectedEdits);
      // 상세페이지는 만들지 않는다(아래 상세페이지 칸을 덮어쓰지 않음). AI로 새로 만든 사진만 1000×1000으로
      // 5번 쿠팡 등록이미지 목록에 넣고, 썸네일·추가이미지 칸에 쓴 뒤 그 사진들로 상세페이지를 만든다.
      const newlyEdited = completed.filter(section => (sectionActions[section.id] || "edit") === "edit" && !alreadyAdded.current.has(section.dataUrl));
      if (newlyEdited.length) {
        const stamp = Date.now().toString(36).slice(-4);
        const base = modelName.trim() || "NOID-B";
        const items: Array<{ fileName: string; dataUrl: string; source: string }> = [];
        for (let index = 0; index < newlyEdited.length; index += 1) {
          items.push({ fileName: `${base}-ai-${stamp}-${String(index + 1).padStart(2, "0")}.jpg`, dataUrl: await extendToSquareCanvas(newlyEdited[index].dataUrl, 1000), source: newlyEdited[index].dataUrl });
          alreadyAdded.current.add(newlyEdited[index].dataUrl);
        }
        onAddToList(items);
      }
      setFinalSections(completed);
      setMessage(newlyEdited.length
        ? `AI 편집 사진 ${newlyEdited.length}장을 5번 쿠팡 등록이미지 목록에 넣었습니다. 제품 모양을 꼭 확인한 뒤 썸네일·추가이미지 칸으로 끌어 넣으세요.`
        : "새로 넣을 AI 편집 사진이 없습니다. 이미 5번 목록에 넣었습니다.");
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "작업 중 문제가 생겼습니다."} 다시 누르면 완료된 AI 사진 다음부터 이어서 만듭니다.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveZip() {
    if (!result || !finalSections.length) return;
    setBusy(true);
    setMessage("상세페이지와 1000×1000 개별 이미지를 ZIP으로 묶고 있습니다.");
    try {
      const zip = new JSZip();
      const baseName = modelName.trim() || "NOID-B-새상세페이지";
      const composed = await composeQuickDetailPage(headerUrl, finalSections, footerUrl || undefined);
      zip.file(`${baseName}.jpg`, composed.dataUrl.split(",")[1], { base64: true });
      for (let index = 0; index < finalSections.length; index += 1) {
        const square = await resizeSectionTo1000(finalSections[index].dataUrl);
        zip.file(`${baseName}-${String(index + 1).padStart(2, "0")}.jpg`, square.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${baseName}-전체이미지.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage(`상세페이지 1장과 1000×1000 개별 이미지 ${finalSections.length}장을 ZIP으로 저장했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ZIP 파일을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function restoreDraft(draft: QuickDetailDraft) {
    deletedDraftIdsRef.current.delete(draft.id);
    setCut(null);
    setDraftId(draft.id);
    setSource(draft.source);
    setSourceName(draft.sourceName);
    setStyle(draft.style);
    setOriginalSections(draft.originalSections);
    setEditedSections(draft.editedSections);
    setFinalSections(draft.finalSections);
    setSectionActions(draft.sectionActions);
    setResult(draft.result);
    setScanSummary(draft.scanSummary);
    setProgress(draft.editedSections.length);
    setMessage("임시저장한 작업을 불러왔습니다.");
  }

  async function removeDraft(id: string) {
    deletedDraftIdsRef.current.add(id);
    await deleteQuickDraft(id);
    setDrafts(await listQuickDrafts());
    if (draftId === id) {
      setDraftId("");
      setSource("");
      setSourceName("");
      resetWork();
      setMessage("상세페이지를 올려주세요.");
    }
  }

  return <div className={styles.quickPanel} style={{ maxWidth: "none", margin: 0 }}>
    <div className={styles.quickIntro}>
      <div><span>AI DETAIL REMAKE</span><h3 style={{ fontSize: 20, margin: "0 0 6px" }}>같은 제품으로 새로운 상세페이지 만들기</h3></div>
    </div>
    <div className={styles.quickSteps} onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { event.preventDefault(); setDragging(false); }} onDrop={dropFile}>
      <article>
        <span>1</span><h3>상세페이지 올리기</h3>
        <label className={`${styles.quickUpload} ${dragging ? styles.quickUploadDragging : ""}`}>
          <strong>{sourceName ? "다른 상세페이지 올리기" : "상세페이지 올리기"}</strong>
          <span>클릭해서 선택하거나 여기에 끌어다 놓으세요</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
        </label>
        <div className={styles.photoSourceButtons}>
          <button type="button" disabled={busy || !poolImages.length}
            title={poolImages.length ? "5번 쿠팡 등록이미지에서 AI로 편집할 사진을 고릅니다." : "5번 쿠팡 등록이미지에 사진이 없습니다."}
            onClick={() => { setPickingPool(value => !value); setPickedPool([]); }}>등록이미지에서 고르기</button>
          <label style={{ cursor: busy ? "wait" : "pointer" }} title="상세페이지 없이 사진 여러 장을 바로 올립니다.">
            사진 여러 장 올리기
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} disabled={busy} onChange={event => void choosePhotoFiles(event)} />
          </label>
        </div>
        <small className={styles.wrapNote}>상세페이지가 없어도 사진만 골라 바로 AI 편집할 수 있습니다.</small>
        {sourceName && <small>{sourceName}</small>}
      </article>
      <article>
        <span>2</span><h3>새로운 분위기 선택</h3>
        <div className={styles.styleChoices}>{STYLE_OPTIONS.map(option => <label key={option.value} className={style === option.value ? styles.selectedStyle : ""}><input type="radio" name="quick-style" value={option.value} checked={style === option.value} onChange={() => { setStyle(option.value); setEditedSections([]); invalidateResult(); setProgress(0); }} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div>
      </article>
      <article>
        <span>3</span><h3>AI 사진편집</h3>
        <button type="button" className={styles.quickCreate} disabled={!originalSections.length || busy} onClick={() => void create()}>{busy ? `작업 중… (${Math.min(progress + 1, Math.max(expectedEdits, 1))}/${Math.max(expectedEdits, 1)})` : completedEdits ? "이어서 AI 편집" : "AI 편집 시작"}</button>
        <button type="button" className={styles.splitButton} disabled={!cut || busy}
          title={cut ? "올린 상세페이지를 사진별로 나눕니다. 사진 바깥 흰 여백의 글자 줄은 잘라내고, 사진 위 글자는 그대로 둡니다." : "1단계에서 상세페이지를 먼저 올려주세요."}
          onClick={() => void confirmCutForSplit()}>{busy && cut ? "나누는 중…" : "상세페이지 분할"}</button>
        <small className={styles.wrapNote}>완성된 사진은 5번 쿠팡 등록이미지 목록에 들어갑니다. 아래 상세페이지 칸은 바꾸지 않습니다.</small>
        <p>{message}</p>
        {scanSummary && <div className={styles.scanSummary}><span>가져온 사진 <strong>{originalSections.length}</strong></span><span>AI 편집 예정 <strong>{expectedEdits}</strong></span><span>원본 사용 <strong>{originalSections.length - expectedEdits}</strong></span></div>}
        {originalSections.length > 0 && <small>예상 AI 편집: {expectedEdits}회 · 완료: {completedEdits}장</small>}
      </article>
    </div>

    {pickingPool && (
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #d8d3cc", borderRadius: 10, background: "#faf9f7" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>AI로 편집할 사진 고르기 · {pickedPool.length}장 선택</strong>
          <button type="button" className="green compactFieldButton" disabled={busy || !pickedPool.length}
            onClick={() => void startFromPhotos(poolImages.filter(image => pickedPool.includes(image.dataUrl)).map(image => ({ dataUrl: image.dataUrl, name: image.fileName })), `등록이미지 ${pickedPool.length}장`)}>
            {busy ? "가져오는 중…" : "선택한 사진으로 시작"}
          </button>
          <button type="button" className="secondaryButton compactFieldButton" onClick={() => { setPickingPool(false); setPickedPool([]); }}>닫기</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
          {poolImages.map((image, index) => {
            const picked = pickedPool.includes(image.dataUrl);
            return <button key={`${image.fileName}-${index}`} type="button" onClick={() => setPickedPool(current => picked ? current.filter(url => url !== image.dataUrl) : [...current, image.dataUrl])}
              style={{ position: "relative", padding: 0, border: picked ? "3px solid #60766a" : "1px solid #d8d3cc", borderRadius: 8, background: "#fff", cursor: "pointer", overflow: "hidden" }}>
              <img src={image.dataUrl} alt={image.fileName} style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "contain" }} />
              {picked && <span style={{ position: "absolute", top: 4, left: 4, background: "#60766a", color: "#fff", borderRadius: 999, minWidth: 22, height: 22, fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>{pickedPool.indexOf(image.dataUrl) + 1}</span>}
            </button>;
          })}
        </div>
      </div>
    )}

    {cut && (
      <div className="pageCutPanel" style={{ marginTop: 16 }}>
        <div className="detailActions">
          <button type="button" className={cut.mode === "top" ? "green" : "secondaryButton"} onClick={() => setCut(c => c && { ...c, mode: "top" })}>위쪽 자를 위치 정하기</button>
          <button type="button" className={cut.mode === "bottom" ? "green" : "secondaryButton"} onClick={() => setCut(c => c && { ...c, mode: "bottom" })}>아래쪽 자를 위치 정하기</button>
          <button type="button" className="purpleButton" disabled={busy} onClick={() => void useCroppedAsDetailPage()} title="자른 상세페이지 맨 위에 상단 로고만 붙여 상세페이지 칸에 넣습니다.">상세페이지 사용</button>          <button type="button" className="secondaryButton" disabled={busy} onClick={() => void confirmCutForSplit()} title="사진별로 나눠서 등록이미지에 추가하거나 AI로 새로 만들 때 씁니다.">사진별로 나누기</button>
          <button type="button" className="secondaryButton" disabled={!cut.history.length} onClick={() => setCut(c => c && c.history.length ? { ...c, ...c.history[c.history.length - 1], history: c.history.slice(0, -1) } : c)}>되돌리기</button>
          <button type="button" className="secondaryButton" disabled={cut.top === 0 && cut.bottom === 1} onClick={() => setCut(c => c && { ...c, top: 0, bottom: 1, history: [...c.history, { top: c.top, bottom: c.bottom }] })}>초기화</button>
          <button type="button" className="secondaryButton" onClick={() => setCut(null)}>닫기</button>
        </div>
        <p className="detailMessage">{cut.mode === "top" ? "사용할 부분이 시작되는 위치를 이미지에서 클릭하세요. 그 위쪽은 버려집니다." : "사용할 부분이 끝나는 위치를 이미지에서 클릭하세요. 그 아래쪽은 버려집니다."}</p>
        <div className="pageCutScroll">
          <div className="pageCutFrame" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
            setCut(c => c && (c.mode === "top"
              ? { ...c, top: Math.min(ratio, c.bottom - 0.01), history: [...c.history, { top: c.top, bottom: c.bottom }] }
              : { ...c, bottom: Math.max(ratio, c.top + 0.01), history: [...c.history, { top: c.top, bottom: c.bottom }] }));
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cut.dataUrl} alt="올린 상세페이지" draggable={false} />
            <div className="pageCutShade" style={{ top: 0, height: `${cut.top * 100}%` }} />
            <div className="pageCutShade" style={{ top: `${cut.bottom * 100}%`, bottom: 0 }} />
            <div className="pageCutLine" style={{ top: `${cut.top * 100}%` }}>위쪽 자름선</div>
            <div className="pageCutLine" style={{ top: `${cut.bottom * 100}%` }}>아래쪽 자름선</div>
          </div>
        </div>
      </div>
    )}

    {originalSections.length > 0 && (
      <div className={styles.preEditReview}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>사진별 확인</h3>
          <button type="button" className="existingDetailUseButton" disabled={busy} title="지금 보이는 사진을 1000×1000 여백 없는 정사각형으로 만들어 5번 쿠팡 등록이미지 목록에 넣습니다. 썸네일·추가이미지·상세페이지에 모두 쓸 수 있습니다."
            onClick={() => void addToRegistrationImages()}>등록이미지에 추가 ({originalSections.length}장)</button>
        </div>
        <div className={styles.reviewGrid}>
          {originalSections.map((section, index) => {
            const original = sectionActions[section.id] === "original";
            const edited = editedById.get(section.id);
            const shown = !original && edited ? edited.dataUrl : section.dataUrl;
            return <article key={section.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown} alt={`사진 ${index + 1}`} />
              <button type="button" className={styles.kindToggle} onClick={() => toggleSectionKind(section.id)}>{section.kind === "wear" ? "착용컷 → 제품컷으로 변경" : "제품컷 → 착용컷으로 변경"}</button>
              <strong>{index + 1}. {section.kind === "wear" ? "착용컷" : "제품컷"}{!original && edited ? " · AI 완료" : ""}</strong>
              <div>
                <button type="button" title="앞으로" disabled={index === 0} onClick={() => moveSection(section.id, -1)}>◀</button>
                <button type="button" title="뒤로" disabled={index === originalSections.length - 1} onClick={() => moveSection(section.id, 1)}>▶</button>
                <button type="button" className={original ? styles.reviewSelected : ""} onClick={() => toggleSectionEdit(section.id)}>{original ? "원본 사용 중" : "편집 제외"}</button>
                <button type="button" className={styles.reviewDelete} onClick={() => deleteSection(section.id)}>삭제</button>
              </div>
            </article>;
          })}
        </div>
        <p className={styles.reviewCost}>최종 사용 {originalSections.length}장 · 예상 AI 편집 <strong>{expectedEdits}회</strong> · 원본 사용 {originalSections.length - expectedEdits}장</p>
      </div>
    )}


    {drafts.length > 0 && (
      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>이어서 작업 <span style={{ color: "#77716a", fontWeight: 600 }}>{drafts.length}/{MAX_QUICK_DRAFTS}</span></strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {drafts.map(draft => (
            <span key={draft.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid #d8d3cc", borderRadius: 8, background: draft.id === draftId ? "#e3ede6" : "#f4f1ec", fontSize: 12 }}>
              <button type="button" disabled={busy} className="secondaryButton compactFieldButton" onClick={() => restoreDraft(draft)}>{draft.modelName || "이름 없는 작업"} · {draft.originalSections.length}장 · AI {draft.editedSections.length}장{draft.result ? " · 완성" : ""}</button>
              <button type="button" disabled={busy} className="secondaryButton compactFieldButton" onClick={() => void removeDraft(draft.id)}>삭제</button>
            </span>
          ))}
        </div>
      </div>
    )}
  </div>;
}
