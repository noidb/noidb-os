"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { composeQuickDetailPage, readImageFile, resizeSectionTo1000, splitDetailPage, type QuickDetailSection, type QuickDetailStyle } from "@/lib/image-generator/quick-detail";
import { deleteQuickDraft, listQuickDrafts, MAX_QUICK_DRAFTS, saveQuickDraft, type QuickDetailDraft } from "@/lib/image-generator/quick-drafts";
import {
  deleteCloudQuickDraft,
  getQuickDraftCloudStatus,
  hydrateCloudQuickDraft,
  listCloudQuickDrafts,
  loadCloudQuickDraftPreview,
  mergeCloudSummaries,
  saveCloudQuickDraft,
  type CloudQuickDraftSummary,
  type QuickDraftCloudListItem,
} from "@/lib/image-generator/quick-draft-cloud";
import styles from "./styles.module.css";

const HEADER_URL = "/노이드비-상단이미지.jpg";
const SYNC_CODE_STORAGE_KEY = "noidb-quick-detail-sync-code";
const STYLE_OPTIONS: Array<{ value: QuickDetailStyle; title: string; description: string }> = [
  { value: "clean", title: "밝은 주얼리 화이트", description: "밝고 깨끗한 쇼핑몰 제품사진 분위기" },
  { value: "ivory", title: "고급 아이보리", description: "따뜻하고 부드러운 고급 주얼리 분위기" },
  { value: "modern", title: "모던 그레이", description: "차분하고 세련된 현대적인 분위기" },
];

type Result = { dataUrl: string; sectionCount: number; width: number; height: number };

export default function QuickDetailComposer() {
  const [draftId, setDraftId] = useState("");
  const [drafts, setDrafts] = useState<QuickDetailDraft[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [draftsReady, setDraftsReady] = useState(false);
  const [cloudDrafts, setCloudDrafts] = useState<CloudQuickDraftSummary[]>([]);
  const [cloudPreviews, setCloudPreviews] = useState<Record<string, string>>({});
  const [syncCode, setSyncCode] = useState("");
  const [syncCodeInput, setSyncCodeInput] = useState("");
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("연동번호를 입력하면 집·창고 PC에서 같은 임시저장을 볼 수 있습니다.");
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudSavingRef = useRef(false);
  const cloudPendingRef = useRef<QuickDetailDraft | null>(null);
  const [draggingDetail, setDraggingDetail] = useState(false);
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
  const [sectionActions, setSectionActions] = useState<Record<string, "edit" | "original">>({});
  const [finalSections, setFinalSections] = useState<QuickDetailSection[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanSummary, setScanSummary] = useState<{ found: number; kept: number; excluded: number } | null>(null);
  const [message, setMessage] = useState("상세페이지를 업로드해주세요.");
  const expectedEdits = originalSections.filter(section => (sectionActions[section.id] || "edit") === "edit").length;
  const completedEdits = editedSections.filter(section => originalSections.some(original => original.id === section.id) && (sectionActions[section.id] || "edit") === "edit").length;
  const draftItems = useMemo(() => mergeCloudSummaries(drafts, cloudDrafts, MAX_QUICK_DRAFTS), [drafts, cloudDrafts]);

  useEffect(() => {
    void listQuickDrafts().then(items => {
      setDrafts(items);
      setDraftsReady(true);
    }).catch(() => setDraftsReady(true));
    const storedCode = window.localStorage.getItem(SYNC_CODE_STORAGE_KEY) || "";
    if (storedCode) {
      setSyncCode(storedCode);
      setSyncCodeInput(storedCode);
    }
  }, []);

  useEffect(() => {
    if (!draftsReady || !syncCode) return;
    void connectCloud(syncCode, false);
    // 연동번호가 바뀔 때만 클라우드 목록을 다시 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsReady, syncCode]);

  useEffect(() => {
    if (!draftsReady || !originalSections.length) return;
    const timeout = window.setTimeout(() => {
      const id = draftId || `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!draftId) setDraftId(id);
      const draft: QuickDetailDraft = {
        id,
        savedAt: new Date().toISOString(),
        modelName,
        source,
        sourceName,
        headerUrl,
        headerName,
        footerUrl,
        footerName,
        style,
        originalSections,
        editedSections,
        finalSections,
        sectionActions,
        result,
        scanSummary,
        preview: editedSections[0]?.dataUrl || originalSections[0]?.dataUrl || source,
      };
      void saveQuickDraft(draft).then(items => setDrafts(items)).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [draftsReady, draftId, source, sourceName, headerUrl, headerName, footerUrl, footerName, modelName, style, originalSections, editedSections, finalSections, sectionActions, result, scanSummary]);

  useEffect(() => {
    if (!cloudConfigured || !syncCode || !draftId || !originalSections.length) return;
    const timeout = window.setTimeout(() => {
      cloudPendingRef.current = {
        id: draftId,
        savedAt: new Date().toISOString(),
        modelName,
        source,
        sourceName,
        headerUrl,
        headerName,
        footerUrl,
        footerName,
        style,
        originalSections,
        editedSections,
        finalSections,
        sectionActions,
        result,
        scanSummary,
        preview: editedSections[0]?.dataUrl || originalSections[0]?.dataUrl || source,
      };
      void flushCloudSave();
    }, 4500);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudConfigured, syncCode, draftId, source, sourceName, headerUrl, headerName, footerUrl, footerName, modelName, style, originalSections, editedSections, finalSections, sectionActions, result, scanSummary]);

  async function refreshCloudDrafts(code: string) {
    const items = await listCloudQuickDrafts(code);
    setCloudDrafts(items);
    const previews = await Promise.all(items.map(async item => {
      if (!item.previewPathname) return [item.id, ""] as const;
      try { return [item.id, await loadCloudQuickDraftPreview(item, code)] as const; }
      catch { return [item.id, ""] as const; }
    }));
    setCloudPreviews(Object.fromEntries(previews));
    return items;
  }

  async function connectCloud(codeValue = syncCodeInput, remember = true) {
    const code = codeValue.trim();
    if (!code) {
      setCloudConfigured(false);
      setCloudStatus("집·창고 PC에서 함께 사용할 연동번호를 입력해주세요.");
      return;
    }
    setCloudBusy(true);
    setCloudStatus("클라우드 임시저장에 연결하고 있습니다…");
    try {
      const status = await getQuickDraftCloudStatus(code);
      if (!status.configured) throw new Error(status.error || "클라우드 임시저장이 아직 설정되지 않았습니다.");
      setSyncCode(code);
      setSyncCodeInput(code);
      setCloudConfigured(true);
      if (remember) window.localStorage.setItem(SYNC_CODE_STORAGE_KEY, code);
      const items = await refreshCloudDrafts(code);
      setCloudStatus(`클라우드 연결 완료 · 공유 임시저장 ${items.length}개`);
    } catch (error) {
      setCloudConfigured(false);
      setCloudDrafts([]);
      setCloudPreviews({});
      setCloudStatus(error instanceof Error ? error.message : "클라우드에 연결하지 못했습니다.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function flushCloudSave() {
    if (cloudSavingRef.current || !syncCode || !cloudConfigured) return;
    cloudSavingRef.current = true;
    try {
      while (cloudPendingRef.current) {
        const pending = cloudPendingRef.current;
        cloudPendingRef.current = null;
        setCloudStatus("클라우드에 사진을 안전하게 저장하고 있습니다…");
        await saveCloudQuickDraft(pending, syncCode, {
          onProgress: progress => {
            if (progress.phase === "upload") setCloudStatus(`클라우드 사진 저장 ${progress.completed}/${progress.total}`);
          },
        });
      }
      await refreshCloudDrafts(syncCode);
      setCloudStatus("클라우드 저장 완료 · 다른 PC에서도 이어서 할 수 있습니다.");
    } catch (error) {
      setCloudStatus(`${error instanceof Error ? error.message : "클라우드 저장에 실패했습니다."} 현재 PC 임시저장은 안전하게 남아 있습니다.`);
    } finally {
      cloudSavingRef.current = false;
      if (cloudPendingRef.current) void flushCloudSave();
    }
  }

  async function uploadAllLocalDrafts() {
    if (!cloudConfigured || !syncCode || !drafts.length) return;
    setCloudBusy(true);
    try {
      for (let index = 0; index < drafts.length; index += 1) {
        setCloudStatus(`이 PC 임시저장 올리는 중 ${index + 1}/${drafts.length}`);
        await saveCloudQuickDraft(drafts[index], syncCode);
      }
      await refreshCloudDrafts(syncCode);
      setCloudStatus(`이 PC 임시저장 ${drafts.length}개를 클라우드에 올렸습니다.`);
    } catch (error) {
      setCloudStatus(`${error instanceof Error ? error.message : "임시저장을 올리지 못했습니다."} 완료된 항목은 그대로 남아 있습니다.`);
    } finally {
      setCloudBusy(false);
    }
  }

  function restoreDraft(draft: QuickDetailDraft) {
    setDraftId(draft.id);
    setSource(draft.source);
    setSourceName(draft.sourceName);
    setHeaderUrl(draft.headerUrl);
    setHeaderName(draft.headerName);
    setFooterUrl(draft.footerUrl);
    setFooterName(draft.footerName);
    setModelName(draft.modelName);
    setStyle(draft.style);
    setOriginalSections(draft.originalSections);
    setEditedSections(draft.editedSections);
    setFinalSections(draft.finalSections);
    setSectionActions(draft.sectionActions);
    setResult(null);
    setScanSummary(draft.scanSummary);
    setProgress(draft.editedSections.length);
    setMessage("임시저장한 작업을 새 90px 여백과 꽉 찬 사진 규격으로 다시 정리하고 있습니다.");
    if (draft.result && draft.finalSections.length) {
      void composeQuickDetailPage(draft.headerUrl, draft.finalSections, draft.footerUrl || undefined).then(nextResult => {
        setResult(nextResult);
        setMessage("임시저장한 작업을 불러왔습니다. 사진을 꽉 채우고 90px 여백으로 다시 정리했습니다.");
      });
    }
  }

  async function restoreDraftItem(item: QuickDraftCloudListItem) {
    const localIsCurrent = item.localDraft && (!item.cloudSummary || item.localDraft.savedAt >= item.cloudSummary.savedAt);
    if (localIsCurrent) {
      restoreDraft(item.localDraft!);
      return;
    }
    if (!item.cloudSummary || !syncCode) return;
    setCloudBusy(true);
    setCloudStatus("클라우드에서 작업 사진을 불러오고 있습니다…");
    try {
      const draft = await hydrateCloudQuickDraft(item.id, syncCode, {
        recompose: composeQuickDetailPage,
        onProgress: progress => setCloudStatus(`클라우드 사진 불러오기 ${progress.completed}/${progress.total}`),
      });
      await saveQuickDraft(draft);
      setDrafts(await listQuickDrafts());
      restoreDraft(draft);
      setCloudStatus("클라우드 작업을 이 PC로 불러왔습니다.");
    } catch (error) {
      setCloudStatus(error instanceof Error ? error.message : "클라우드 작업을 불러오지 못했습니다.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function removeDraft(id: string) {
    await deleteQuickDraft(id);
    setDrafts(await listQuickDrafts());
    if (cloudConfigured && syncCode) {
      try {
        await deleteCloudQuickDraft(id, syncCode);
        await refreshCloudDrafts(syncCode);
        setCloudStatus("집·창고 PC 공용 임시저장에서 삭제했습니다.");
      } catch (error) {
        setCloudStatus(`${error instanceof Error ? error.message : "클라우드에서 삭제하지 못했습니다."} 이 PC에서는 삭제했습니다.`);
      }
    }
    setSelectedDraftIds(current => current.filter(item => item !== id));
    if (draftId === id) setDraftId("");
  }

  function toggleDraftSelection(id: string) {
    setSelectedDraftIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function addDraftToZip(zip: JSZip, draft: QuickDetailDraft, folderName: string) {
    if (!draft.result || !draft.finalSections.length) return false;
    const folder = zip.folder(folderName);
    if (!folder) return false;
    const composed = await composeQuickDetailPage(draft.headerUrl, draft.finalSections, draft.footerUrl || undefined);
    folder.file(`${folderName}.jpg`, composed.dataUrl.split(",")[1], { base64: true });
    for (let index = 0; index < draft.finalSections.length; index += 1) {
      const square = await resizeSectionTo1000(draft.finalSections[index].dataUrl);
      folder.file(`${folderName}-${String(index + 1).padStart(2, "0")}.jpg`, square.split(",")[1], { base64: true });
    }
    return true;
  }

  async function saveSelectedDrafts() {
    const chosen: QuickDetailDraft[] = [];
    for (const item of draftItems.filter(value => selectedDraftIds.includes(value.id))) {
      if (item.localDraft?.result && item.localDraft.finalSections.length) {
        chosen.push(item.localDraft);
        continue;
      }
      if (item.cloudSummary?.complete && syncCode) {
        try {
          chosen.push(await hydrateCloudQuickDraft(item.id, syncCode, { recompose: composeQuickDetailPage }));
        } catch { /* 저장 가능한 작업만 모읍니다. */ }
      }
    }
    if (!chosen.length) return setMessage("완성된 임시저장을 한 개 이상 선택해주세요.");
    setBusy(true);
    try {
      const zip = new JSZip();
      for (let index = 0; index < chosen.length; index += 1) {
        const baseName = `${chosen[index].modelName.trim() || "상세페이지"}-${String(index + 1).padStart(2, "0")}`;
        await addDraftToZip(zip, chosen[index], baseName);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `NOID-B-상세페이지-일괄저장-${chosen.length}개.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage(`선택한 상세페이지 ${chosen.length}개를 한 번에 저장했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "선택한 상세페이지를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function prepareSections(sections: QuickDetailSection[]) {
    setOriginalSections(sections);
    setSectionActions(Object.fromEntries(sections.map(section => [section.id, "edit"])));
    setEditedSections([]);
    setFinalSections([]);
    setResult(null);
    setProgress(0);
  }

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

  async function uploadDetailPage(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("JPG, PNG 또는 WEBP 이미지 파일을 올려주세요.");
      return;
    }
    setBusy(true);
    try {
      setDraftId(`quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const source = await readImageFile(file);
      const foundSections = await splitDetailPage(source, headerUrl);
      const sections = await selectUsableSections(foundSections);
      setSource(source);
      setSourceName(file.name);
      setModelName(file.name.replace(/\.[^.]+$/, ""));
      prepareSections(sections);
      setScanSummary({ found: foundSections.length, kept: sections.length, excluded: foundSections.length - sections.length });
      setMessage(`${foundSections.length}개 구간 중 제품·착용컷 ${sections.length}장만 남겼습니다. 설명·로고·패키지 ${foundSections.length - sections.length}개는 제외했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await uploadDetailPage(file);
    event.target.value = "";
  }

  async function dropDetailPage(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingDetail(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) await uploadDetailPage(file);
  }

  function dragDetailPage(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!busy) setDraggingDetail(true);
  }

  function leaveDetailPage(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDraggingDetail(false);
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
        prepareSections(sections);
        setScanSummary({ found: foundSections.length, kept: sections.length, excluded: foundSections.length - sections.length });
        setMessage(`상단 로고를 바꿨습니다. 제품·착용컷 ${sections.length}장으로 새 브랜드 상세페이지를 만들 수 있습니다.`);
      } else {
        setMessage("상단 로고 이미지를 바꿨습니다. 이제 상세페이지를 업로드해주세요.");
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
        prepareSections(sections);
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
    setMessage("하단 이미지를 뺐습니다. 마지막 사진 아래 90px 흰 여백으로 끝납니다.");
  }

  function deleteSection(id: string) {
    setOriginalSections(current => current.filter(section => section.id !== id));
    setEditedSections(current => current.filter(section => section.id !== id));
    setFinalSections([]);
    setResult(null);
    setSectionActions(current => { const next = { ...current }; delete next[id]; return next; });
    setMessage("선택한 사진을 상세페이지와 저장 파일에서 제외했습니다.");
  }

  function toggleSectionEdit(id: string) {
    setSectionActions(current => ({ ...current, [id]: current[id] === "original" ? "edit" : "original" }));
    setEditedSections(current => current.filter(section => section.id !== id));
    setFinalSections([]);
    setResult(null);
    setMessage("선택을 반영했습니다. 예상 AI 편집 횟수를 확인해주세요.");
  }

  function toggleSectionKind(id: string) {
    setOriginalSections(current => current.map(section => section.id === id ? { ...section, kind: section.kind === "wear" ? "product" : "wear" } : section));
    setEditedSections(current => current.filter(section => section.id !== id));
    setFinalSections([]);
    setResult(null);
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
    if (!originalSections.length) return setMessage("상세페이지를 먼저 업로드해주세요.");
    setBusy(true);
    setResult(null);
    const editedById = new Map(editedSections.map(section => [section.id, section]));
    const completed: QuickDetailSection[] = [];
    let editIndex = completedEdits;
    try {
      for (const section of originalSections) {
        if ((sectionActions[section.id] || "edit") === "original") {
          completed.push(section);
          continue;
        }
        let edited = editedById.get(section.id);
        if (!edited) {
          setProgress(editIndex);
          setMessage(`AI 편집 ${expectedEdits}장 중 ${editIndex + 1}번째를 만들고 있습니다. 완성된 사진은 그대로 보관됩니다.`);
          edited = await editSection(section);
          editedById.set(section.id, edited);
          setEditedSections(Array.from(editedById.values()));
          editIndex += 1;
        }
        completed.push(edited);
      }
      setProgress(expectedEdits);
      const composed = await composeQuickDetailPage(headerUrl, completed, footerUrl || undefined);
      setFinalSections(completed);
      setResult(composed);
      setMessage("같은 제품을 사용한 새로운 상세페이지를 완성했습니다. 각 사진은 가로 폭의 최대 80%로 가운데 배치하고 90px 여백으로 연결했습니다. 제품 모양을 꼭 확인해주세요.");
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

  return <section className={styles.quickPanel}>
    <div className={styles.quickIntro}>
      <div><span>AI DETAIL REMAKE</span><h2>같은 제품으로 새로운 상세페이지 만들기</h2><p>제품은 그대로 유지하고 제품컷은 흰 커튼·접시·책 등을 활용한 새로운 배경과 각도로, 모델컷은 새로운 얼굴·헤어·의상·분위기로 만듭니다.</p></div>
      <strong>사진별 AI 편집</strong>
    </div>
    <div className={styles.quickSteps} onDragEnter={dragDetailPage} onDragOver={dragDetailPage} onDragLeave={leaveDetailPage} onDrop={dropDetailPage}>
      <article><span>1</span><h3>상세페이지 업로드</h3><label className={`${styles.quickUpload} ${draggingDetail ? styles.quickUploadDragging : ""}`}><strong>{sourceName ? "다른 상세페이지 업로드" : "상세페이지 업로드"}</strong><span>클릭해서 선택하거나 여기에 끌어다 놓으세요</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} /></label>{sourceName && <small>{sourceName}</small>}<div className={styles.headerUpload}><strong>상단 로고 이미지</strong><small>{headerName}</small><label>다른 브랜드 로고 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseHeader} /></label>{headerUrl !== HEADER_URL && <button type="button" onClick={useNoidbHeader}>NOID-B 기본 로고로 되돌리기</button>}</div><div className={styles.headerUpload}><strong>하단 로고·안내 이미지 (선택)</strong><small>{footerName || "올리지 않으면 90px 흰 여백으로 끝납니다."}</small><label>하단 이미지 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFooter} /></label>{footerUrl && <button type="button" onClick={removeFooter}>하단 이미지 빼기</button>}</div><label className={styles.quickModel}>저장할 모델명<input value={modelName} onChange={event => setModelName(event.target.value)} placeholder="예: we0001-new" /></label></article>
      <article><span>2</span><h3>새로운 분위기 선택</h3><div className={styles.styleChoices}>{STYLE_OPTIONS.map(option => <label key={option.value} className={style === option.value ? styles.selectedStyle : ""}><input type="radio" name="quick-style" value={option.value} checked={style === option.value} onChange={() => { setStyle(option.value); setEditedSections([]); setResult(null); setProgress(0); }} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div><p className={styles.fixedGap}>모든 사진은 780px 캔버스 안에서 가로 폭의 최대 80%로 가운데 배치되고, 사진 사이는 90px 흰 여백으로 연결됩니다. 작은 사진은 저장할 때 자동으로 고품질 업스케일됩니다.</p></article>
      <article><span>3</span><h3>한 번에 새로 만들기</h3><button className={styles.quickCreate} disabled={!originalSections.length || busy} onClick={create}>{busy ? `AI 편집 ${expectedEdits}장 중 ${Math.min(progress + 1, expectedEdits)}장 작업 중…` : completedEdits ? "이어서 만들기" : "새 상세페이지 만들기"}</button><p>{message}</p>{scanSummary && <div className={styles.scanSummary}><span>찾은 구간 <strong>{scanSummary.found}</strong></span><span>사용할 사진 <strong>{originalSections.length}</strong></span><span>자동 제외 <strong>{scanSummary.excluded}</strong></span></div>}{originalSections.length > 0 && <small>예상 AI 편집: {expectedEdits}회 · 완료: {completedEdits}장</small>}{result && <a className={styles.quickDownload} href={result.dataUrl} download={`${modelName.trim() || "NOID-B-새상세페이지"}.jpg`}>완성 이미지만 저장하기</a>}</article>
    </div>
    {originalSections.length > 0 && !result && <div className={styles.preEditReview}><div><h3>편집 전 사진 확인</h3><p>제품컷·착용컷 구분이 틀리면 먼저 바꿔주세요. 불필요한 사진은 삭제하고, AI 비용 없이 그대로 쓸 사진은 `편집 제외`를 누르세요.</p></div><div className={styles.reviewGrid}>{originalSections.map((section, index) => { const original = sectionActions[section.id] === "original"; return <article key={section.id}><img src={section.dataUrl} alt={`선별 사진 ${index + 1}`} /><button type="button" className={styles.kindToggle} onClick={() => toggleSectionKind(section.id)}>{section.kind === "wear" ? "착용컷 → 제품컷으로 변경" : "제품컷 → 착용컷으로 변경"}</button><strong>{index + 1}. {section.kind === "wear" ? "착용컷" : "제품컷"}</strong><small>{section.reason}</small><div><button type="button" className={original ? styles.reviewSelected : ""} onClick={() => toggleSectionEdit(section.id)}>{original ? "원본 사용 중" : "편집 제외"}</button><button type="button" className={styles.reviewDelete} onClick={() => deleteSection(section.id)}>삭제</button></div></article>; })}</div><p className={styles.reviewCost}>최종 사용 {originalSections.length}장 · 예상 AI 편집 <strong>{expectedEdits}회</strong> · 원본 사용 {originalSections.length - expectedEdits}장</p></div>}
    {result && <div className={styles.quickResult}><div><strong>완성 미리보기</strong><span>{result.width}×{result.height}px · 최종 사용 {result.sectionCount}장</span><small>제품 무늬·잠금장치·크기가 원본과 같은지 확대해서 확인해주세요.</small><button className={styles.zipDownload} disabled={busy} onClick={saveZip}>상세페이지 + 개별사진 ZIP 저장</button></div><a href={result.dataUrl} target="_blank" rel="noreferrer"><img src={result.dataUrl} alt="AI로 새롭게 만든 상세페이지" /></a></div>}
    <section className={styles.cloudSync}>
      <div>
        <strong>집·창고 PC 임시저장 연동</strong>
        <p>{cloudStatus}</p>
      </div>
      <label>연동번호<input type="password" value={syncCodeInput} onChange={event => setSyncCodeInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void connectCloud(); }} placeholder="두 PC에 같은 번호 입력" autoComplete="off" /></label>
      <button type="button" disabled={cloudBusy || !syncCodeInput.trim()} onClick={() => void connectCloud()}>{cloudBusy ? "연결 중…" : cloudConfigured ? "목록 새로고침" : "연결하기"}</button>
      {cloudConfigured && drafts.length > 0 && <button type="button" className={styles.cloudUploadAll} disabled={cloudBusy} onClick={() => void uploadAllLocalDrafts()}>이 PC 임시저장 모두 올리기</button>}
    </section>
    {draftItems.length > 0 && <section className={styles.quickDrafts}>
      <div className={styles.draftToolbar}>
        <div><h3>임시저장 목록 <span>{draftItems.length}/{MAX_QUICK_DRAFTS}</span></h3><p>현재 PC는 즉시 저장하고, 연결되면 집·창고 공용 목록에도 자동 저장합니다.</p></div>
        <div><label><input type="checkbox" checked={selectedDraftIds.length === draftItems.length && draftItems.length > 0} onChange={() => setSelectedDraftIds(selectedDraftIds.length === draftItems.length ? [] : draftItems.map(draft => draft.id))} /> 전체 선택</label><button type="button" disabled={busy || cloudBusy || !selectedDraftIds.length} onClick={saveSelectedDrafts}>선택한 작업 일괄저장</button></div>
      </div>
      <div className={styles.draftGrid}>{draftItems.map(item => {
        const preview = item.localDraft?.preview || cloudPreviews[item.id];
        return <article key={item.id} className={item.id === draftId ? styles.currentDraft : ""}>
          <label className={styles.draftCheck}><input type="checkbox" checked={selectedDraftIds.includes(item.id)} onChange={() => toggleDraftSelection(item.id)} /><span>선택</span></label>
          {preview ? <img src={preview} alt={`${item.modelName || "이름 없는 작업"} 미리보기`} /> : <div className={styles.draftPlaceholder}>미리보기 불러오는 중</div>}
          <span className={styles.draftLocation}>{item.location === "both" ? "집·창고 공용" : item.location === "cloud" ? "다른 PC 저장" : "현재 PC 저장"}</span>
          <div><strong>{item.modelName || "이름 없는 작업"}</strong><small>{new Date(item.savedAt).toLocaleString("ko-KR")}</small><span>사진 {item.originalCount}장 · AI 완료 {item.editedCount}장{item.complete ? " · 완성" : ""}</span></div>
          <footer><button type="button" disabled={cloudBusy} onClick={() => void restoreDraftItem(item)}>이어서 작업</button><button type="button" disabled={cloudBusy} onClick={() => void removeDraft(item.id)}>삭제</button></footer>
        </article>;
      })}</div>
    </section>}
  </section>;
}
