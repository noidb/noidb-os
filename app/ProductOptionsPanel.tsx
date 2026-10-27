"use client";

/**
 * 2026-10-27 상품등록 기본정보의 선택 목록(거래처·카테고리·성별·소재)을 사용자가 직접 추가·관리한다.
 * 새 카테고리는 쿠팡 양식 파일을 올리면 카테고리 경로·필수 칸·고를 수 있는 값을 읽어,
 * 칸마다 기본값을 한 번 정해 두고(카테고리 설정) 상품마다 필요한 칸만 고친다(카테고리 전용 칸).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { defaultProductOptions, normalizeProductOptions } from "@/lib/product-options/defaults";
import type { CategoryConfig, OptionListKey, ProductOptionsConfig, TemplateField, TemplateInfo } from "@/lib/product-options/types";

const CACHE_KEY = "noidb-product-options";
const INFO_CACHE_KEY = "noidb-product-options-template-info";
export const ADD_NEW_VALUE = "__add_new__";

const LIST_LABEL: Record<OptionListKey | "categories", string> = {
  suppliers: "거래처", genders: "성별", materials: "소재", categories: "카테고리",
};

function readCachedConfig(): ProductOptionsConfig {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) return normalizeProductOptions(JSON.parse(raw));
  } catch { /* 저장된 값이 없거나 읽을 수 없으면 기본 목록 */ }
  return defaultProductOptions();
}

async function postOptions(body: unknown): Promise<{ config: ProductOptionsConfig; info?: TemplateInfo }> {
  const response = await fetch("/api/product-options", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "저장하지 못했습니다.");
  return data;
}

/** 마지막으로 본 목록을 바로 보여주고, 최신 저장본은 뒤에서 조용히 받아 바꾼다(기다리지 않음). */
export function useProductOptions() {
  const [config, setConfigState] = useState<ProductOptionsConfig>(defaultProductOptions);
  const setConfig = useCallback((next: ProductOptionsConfig) => {
    setConfigState(next);
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* 저장 공간 없음 */ }
  }, []);
  useEffect(() => {
    setConfigState(readCachedConfig());
    let active = true;
    fetch(`/api/product-options?t=${Date.now()}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active && data?.config) setConfig(normalizeProductOptions(data.config)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [setConfig]);
  const send = useCallback(async (body: unknown) => {
    const data = await postOptions(body);
    setConfig(normalizeProductOptions(data.config));
    return data;
  }, [setConfig]);
  return { config, setConfig, send };
}

const infoMemory = new Map<string, TemplateInfo | null>();

function templateKey(config: ProductOptionsConfig, category: string) {
  const found = config.categories.find(item => item.name === category);
  return `${category}|${found?.template?.blobPath || "builtin"}`;
}

/** 카테고리 양식의 칸 정보(필수·값 목록). 한 번 받은 것은 이 컴퓨터에 기억해 바로 보여준다. */
export function useTemplateInfo(config: ProductOptionsConfig, category: string) {
  const key = templateKey(config, category);
  const [state, setState] = useState<{ key: string; info: TemplateInfo | null; loading: boolean; error: string }>({ key: "", info: null, loading: false, error: "" });
  const reload = useCallback(async (force = false) => {
    if (!category) return;
    if (!force && infoMemory.has(key)) { setState({ key, info: infoMemory.get(key) || null, loading: false, error: "" }); return; }
    if (!force) {
      try {
        const cached = JSON.parse(window.localStorage.getItem(INFO_CACHE_KEY) || "{}")[key];
        if (cached !== undefined) { infoMemory.set(key, cached); setState({ key, info: cached, loading: false, error: "" }); return; }
      } catch { /* 없으면 서버에서 */ }
    }
    setState(prev => ({ ...prev, key, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/product-options?templateInfo=${encodeURIComponent(category)}&t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "양식 정보를 읽지 못했습니다.");
      const info = (data.info || null) as TemplateInfo | null;
      infoMemory.set(key, info);
      try {
        const all = JSON.parse(window.localStorage.getItem(INFO_CACHE_KEY) || "{}");
        all[key] = info;
        window.localStorage.setItem(INFO_CACHE_KEY, JSON.stringify(all));
      } catch { /* 저장 공간 없음 */ }
      setState({ key, info, loading: false, error: "" });
    } catch (error) {
      setState({ key, info: null, loading: false, error: error instanceof Error ? error.message : "양식 정보를 읽지 못했습니다." });
    }
  }, [category, key]);
  useEffect(() => { void reload(); }, [reload]);
  const current = state.key === key ? state : { key, info: infoMemory.get(key) || null, loading: true, error: "" };
  return { ...current, reload, remember: (info: TemplateInfo | null) => { infoMemory.set(key, info); setState({ key, info, loading: false, error: "" }); } };
}

/** 목록 + 맨 아래 '+ 새 항목 추가'. 고르면 그 자리에 입력칸이 나온다. */
export function OptionSelect({ value, items, label, onChange, onAdd }: {
  value: string;
  items: string[];
  label: string;
  onChange: (value: string) => void;
  onAdd: (value: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = items.includes(value) || !value ? items : [...items, value];
  if (adding) {
    const save = async () => {
      const name = draft.trim();
      if (!name) return;
      setBusy(true); setError("");
      try { await onAdd(name); onChange(name); setAdding(false); setDraft(""); }
      catch (e) { setError(e instanceof Error ? e.message : "추가하지 못했습니다."); }
      finally { setBusy(false); }
    };
    return (
      <span className="optionAddRow">
        <input autoFocus value={draft} placeholder={`새 ${label} 이름`} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape") setAdding(false); }} />
        <button type="button" className="softSageButton" disabled={busy || !draft.trim()} onClick={() => void save()}>{busy ? "저장 중" : "추가"}</button>
        <button type="button" className="softApricotButton" disabled={busy} onClick={() => { setAdding(false); setError(""); }}>취소</button>
        {error && <small className="optionError">{error}</small>}
      </span>
    );
  }
  return (
    <select value={value} onChange={e => {
      if (e.target.value === ADD_NEW_VALUE) { setAdding(true); setDraft(""); return; }
      onChange(e.target.value);
    }}>
      {options.map(item => <option key={item} value={item}>{item}</option>)}
      <option value={ADD_NEW_VALUE}>+ 새 {label} 추가</option>
    </select>
  );
}

export function ManageLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className="optionManageLink" onClick={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}>목록 관리</button>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="optionModalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={wide ? "optionModal wide" : "optionModal"} role="dialog" aria-label={title}>
        <div className="optionModalHead">
          <h3>{title}</h3>
          <button type="button" className="softApricotButton" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 거래처·성별·소재 목록 관리: 이름 바꾸기·순서·지우기. 이미 등록된 상품의 값은 그대로 남는다. */
export function OptionListManager({ list, config, send, onClose }: {
  list: OptionListKey;
  config: ProductOptionsConfig;
  send: (body: unknown) => Promise<unknown>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = LIST_LABEL[list];
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try { await send({ list, ...body }); }
    catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const items = config[list];
  return (
    <Modal title={`${label} 목록 관리`} onClose={onClose}>
      <p className="optionHint">지워도 이미 등록된 상품에 적힌 {label}은 그대로 남습니다.</p>
      <div className="optionManagerList">
        {items.map((item, index) => (
          <div className="optionManagerRow" key={item}>
            {editing?.from === item ? (
              <>
                <input autoFocus value={editing.to} onChange={e => setEditing({ from: item, to: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter" && editing.to.trim()) { void run({ action: "renameItem", from: item, to: editing.to }).then(() => setEditing(null)); } }} />
                <button type="button" className="softSageButton" disabled={busy || !editing.to.trim()} onClick={() => void run({ action: "renameItem", from: item, to: editing.to }).then(() => setEditing(null))}>저장</button>
                <button type="button" className="softApricotButton" onClick={() => setEditing(null)}>취소</button>
              </>
            ) : (
              <>
                <span className="optionName">{item}</span>
                <button type="button" className="softApricotButton" disabled={busy || index === 0} onClick={() => void run({ action: "moveItem", value: item, direction: -1 })} aria-label="위로">▲</button>
                <button type="button" className="softApricotButton" disabled={busy || index === items.length - 1} onClick={() => void run({ action: "moveItem", value: item, direction: 1 })} aria-label="아래로">▼</button>
                <button type="button" className="softBeigeButton" disabled={busy} onClick={() => setEditing({ from: item, to: item })}>이름 바꾸기</button>
                <button type="button" className="softPinkButton" disabled={busy || items.length <= 1} onClick={() => { if (window.confirm(`'${item}'을(를) 목록에서 지울까요?`)) void run({ action: "removeItem", value: item }); }}>지우기</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="optionAddRow">
        <input value={draft} placeholder={`새 ${label} 이름`} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && draft.trim()) { void run({ action: "addItem", value: draft }).then(() => setDraft("")); } }} />
        <button type="button" className="softSageButton" disabled={busy || !draft.trim()} onClick={() => void run({ action: "addItem", value: draft }).then(() => setDraft(""))}>{label} 추가</button>
      </div>
      {message && <p className="optionError">{message}</p>}
    </Modal>
  );
}

function FieldValueInput({ field, value, placeholder, onChange }: { field: TemplateField; value: string; placeholder?: string; onChange: (value: string) => void }) {
  if (field.choices.length) {
    const choices = value && !field.choices.includes(value) ? [value, ...field.choices] : field.choices;
    return (
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder || "(비워 둠)"}</option>
        {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    );
  }
  return <input value={value} placeholder={placeholder || (field.example ? `예: ${field.example.replace(/\s+/g, " ").slice(0, 40)}` : "")} onChange={e => onChange(e.target.value)} />;
}

/** 카테고리 목록 + 선택한 카테고리 설정(모델명 글자·쿠팡 양식·성별별 경로·칸별 기본값). */
export function CategoryManager({ config, send, setConfig, initialCategory, onClose, onTemplateChanged }: {
  config: ProductOptionsConfig;
  send: (body: unknown) => Promise<{ config: ProductOptionsConfig; info?: TemplateInfo }>;
  setConfig: (config: ProductOptionsConfig) => void;
  initialCategory?: string;
  onClose: () => void;
  onTemplateChanged?: () => void;
}) {
  // initialCategory가 빈 문자열이면 '+ 새 카테고리 추가'로 연 것 → 바로 새 카테고리 입력
  const [selected, setSelected] = useState<string>(initialCategory === "" ? "" : initialCategory || config.categories[0]?.name || "");
  const [isNew, setIsNew] = useState(initialCategory === "");
  const current = config.categories.find(item => item.name === selected);
  const [form, setForm] = useState<CategoryConfig>(() => current ? structuredClone(current) : { name: "", letter: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const template = useTemplateInfo(config, isNew ? "" : selected);

  useEffect(() => {
    if (isNew) return;
    const found = config.categories.find(item => item.name === selected);
    setForm(found ? structuredClone(found) : { name: "", letter: "" });
    setMessage("");
  }, [selected, isNew, config]);

  const startNew = () => { setIsNew(true); setSelected(""); setForm({ name: "", letter: "" }); setMessage(""); };
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await send({ action: "saveCategory", original: isNew ? "" : selected, category: form });
      setIsNew(false);
      setSelected(form.name.trim());
      setMessage(isNew ? "저장했습니다. 이제 쿠팡 양식 파일을 올려주세요." : "저장했습니다.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setMessage("양식 파일을 읽고 있습니다...");
    try {
      const body = new FormData();
      body.append("category", selected);
      body.append("file", file);
      const response = await fetch("/api/product-options", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "양식을 올리지 못했습니다.");
      const next = normalizeProductOptions(data.config);
      infoMemory.set(templateKey(next, selected), data.info || null);
      setConfig(next);
      onTemplateChanged?.();
      setMessage(`양식을 읽었습니다: 칸 ${data.info?.fields?.length || 0}개, 카테고리 경로 ${data.info?.categoryPaths?.length || 0}개. 아래에서 경로와 기본값을 확인하고 '설정 저장'을 눌러주세요.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "양식을 올리지 못했습니다."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const remove = async () => {
    if (!window.confirm(`'${selected}' 카테고리를 목록에서 지울까요? 이미 등록된 상품은 그대로 남습니다.`)) return;
    setBusy(true);
    try { await send({ action: "removeCategory", value: selected }); setSelected(config.categories.find(item => item.name !== selected)?.name || ""); }
    catch (e) { setMessage(e instanceof Error ? e.message : "지우지 못했습니다."); }
    finally { setBusy(false); }
  };
  const move = (name: string, direction: number) => void send({ action: "moveCategory", value: name, direction }).catch(e => setMessage(e.message));

  const info = template.info;
  const fields = info?.fields.filter(field => !field.siteFilled) || [];
  const requiredFields = fields.filter(field => field.required);
  const optionalFields = fields.filter(field => !field.required);
  const setDefault = (header: string, value: string) => setForm(prev => ({ ...prev, defaults: { ...(prev.defaults || {}), [header]: value } }));
  const emptyRequired = requiredFields.filter(field => !String(form.defaults?.[field.header] || "").trim());
  const hasTemplate = Boolean(info);

  return (
    <Modal title="카테고리 목록 관리" onClose={onClose} wide>
      <div className="categoryManager">
        <div className="categoryManagerList">
          {config.categories.map((item, index) => (
            <div key={item.name} className={!isNew && item.name === selected ? "categoryListRow active" : "categoryListRow"}>
              <button type="button" className="categoryListName" onClick={() => { setIsNew(false); setSelected(item.name); }}>
                {item.name}<small>{item.letter ? `w${item.letter}0001` : ""}</small>
              </button>
              <button type="button" className="softApricotButton" disabled={index === 0} onClick={() => move(item.name, -1)} aria-label="위로">▲</button>
              <button type="button" className="softApricotButton" disabled={index === config.categories.length - 1} onClick={() => move(item.name, 1)} aria-label="아래로">▼</button>
            </div>
          ))}
          <button type="button" className="softSageButton" onClick={startNew}>+ 새 카테고리</button>
        </div>

        <div className="categoryManagerBody">
          <div className="categoryFormGrid">
            <label className="field"><span>카테고리 이름</span>
              <input value={form.name} placeholder="예: 집게핀" onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
            </label>
            <label className="field"><span>모델명 글자(영어 소문자)</span>
              <input value={form.letter} placeholder="예: h" maxLength={4} onChange={e => setForm(prev => ({ ...prev, letter: e.target.value.toLowerCase().replace(/[^a-z]/g, "") }))} />
              <small>{form.letter ? `여성 w${form.letter}0001 · 남성 m${form.letter}0001 · 남녀공용 u${form.letter}0001` : "다른 카테고리와 겹치지 않는 글자"}</small>
            </label>
          </div>

          {!isNew && selected && (
            <div className="categoryTemplateBox">
              <div className="categoryTemplateHead">
                <strong>쿠팡 양식</strong>
                <span>{form.template ? `${form.template.fileName} (올린 양식)` : info ? `${info.fileName} (기본 제공)` : template.loading ? "확인 중..." : "없음 — 양식을 올려야 등록 엑셀을 만들 수 있습니다."}</span>
                <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
                <button type="button" className="softBeigeButton" disabled={busy} onClick={() => fileRef.current?.click()}>{hasTemplate ? "양식 바꾸기" : "쿠팡 양식 올리기"}</button>
              </div>
              {template.error && <p className="optionError">{template.error}</p>}
            </div>
          )}

          {!isNew && info && (
            <>
              <h4 className="categorySubTitle">성별별 쿠팡 카테고리 경로</h4>
              <div className="categoryFormGrid">
                {config.genders.map(gender => (
                  <label className="field" key={gender}><span>{gender}</span>
                    <select value={form.paths?.[gender] || ""} onChange={e => setForm(prev => ({ ...prev, paths: { ...(prev.paths || {}), [gender]: e.target.value } }))}>
                      <option value="">{form.template ? "(경로를 골라주세요)" : "(기본 경로 사용)"}</option>
                      {info.categoryPaths.map(path => <option key={path} value={path}>{path}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <h4 className="categorySubTitle">칸별 기본값 <small>사이트가 자동으로 못 채우는 칸입니다. 한 번 정하면 이 카테고리 상품에 모두 들어갑니다.</small></h4>
              {emptyRequired.length > 0 && <p className="optionError">필수 칸 {emptyRequired.length}개가 비어 있습니다. 비워 두면 상품마다 기본정보에서 채워야 합니다.</p>}
              <div className="templateFieldTable">
                {requiredFields.map(field => (
                  <TemplateFieldRow key={field.header} field={field} value={form.defaults?.[field.header] || ""} onChange={value => setDefault(field.header, value)} />
                ))}
                {!requiredFields.length && <p className="optionHint">비어 있는 필수 칸이 없습니다.</p>}
              </div>
              {optionalFields.length > 0 && (
                <button type="button" className="softApricotButton categoryOptionalToggle" onClick={() => setShowOptional(value => !value)}>
                  {showOptional ? "선택 칸 접기" : `선택 칸 ${optionalFields.length}개 보기`}
                </button>
              )}
              {showOptional && (
                <div className="templateFieldTable">
                  {optionalFields.map(field => (
                    <TemplateFieldRow key={field.header} field={field} value={form.defaults?.[field.header] || ""} onChange={value => setDefault(field.header, value)} />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="categoryActions">
            <button type="button" className="softPinkButton" disabled={busy || !form.name.trim() || !form.letter} onClick={() => void save()}>{isNew ? "카테고리 추가" : "설정 저장"}</button>
            {!isNew && selected && <button type="button" className="softApricotButton" disabled={busy || config.categories.length <= 1} onClick={() => void remove()}>목록에서 지우기</button>}
          </div>
          {message && <p className={/못|오류|없|이미|입력/.test(message) ? "optionError" : "optionHint"}>{message}</p>}
        </div>
      </div>
    </Modal>
  );
}

function TemplateFieldRow({ field, value, onChange }: { field: TemplateField; value: string; onChange: (value: string) => void }) {
  return (
    <div className="templateFieldRow">
      <div className="templateFieldName">
        <strong>{field.header}{field.required && <span className="requiredMark"> 필수</span>}</strong>
        {field.description && <small title={field.description}>{field.description.replace(/\s+/g, " ").slice(0, 70)}</small>}
      </div>
      <FieldValueInput field={field} value={value} onChange={onChange} />
    </div>
  );
}

/** 기본정보 화면의 '카테고리 전용 칸'. 기본값이 미리 보이고, 상품마다 다르면 여기서만 고친다. */
export function CategoryExtraFields({ config, category, values, onChange, onOpenSettings }: {
  config: ProductOptionsConfig;
  category: string;
  values: Record<string, string>;
  onChange: (header: string, value: string) => void;
  onOpenSettings: () => void;
}) {
  const template = useTemplateInfo(config, category);
  const [showAll, setShowAll] = useState(false);
  const settings = config.categories.find(item => item.name === category);
  const defaults = settings?.defaults || {};
  const fields = useMemo(() => (template.info?.fields || []).filter(field => !field.siteFilled), [template.info]);
  if (!category) return null;
  if (!template.loading && !template.info) {
    return (
      <div className="field fullRowField categoryExtraBox">
        <span>카테고리 전용 칸</span>
        <p className="optionError">{template.error || `${category}에는 쿠팡 양식이 없어 등록 엑셀을 만들 수 없습니다.`}</p>
        <button type="button" className="softBeigeButton" onClick={onOpenSettings}>{category} 쿠팡 양식 올리기</button>
      </div>
    );
  }
  const important = fields.filter(field => field.required || defaults[field.header] || values[field.header]);
  const shown = showAll ? fields : important;
  const missing = fields.filter(field => field.required && !String(values[field.header] || defaults[field.header] || "").trim());
  return (
    <div className="field fullRowField categoryExtraBox">
      <span>카테고리 전용 칸 <small>{template.loading ? "확인 중..." : "기본값은 카테고리 설정에서 정합니다. 이 상품만 다르면 여기서 고치세요."}</small></span>
      {missing.length > 0 && <p className="optionError">비어 있는 필수 칸: {missing.map(field => field.header).join(", ")}</p>}
      {shown.length > 0 && (
        <div className="templateFieldTable compact">
          {shown.map(field => (
            <div className="templateFieldRow" key={field.header}>
              <div className="templateFieldName"><strong>{field.header}{field.required && <span className="requiredMark"> 필수</span>}</strong></div>
              <FieldValueInput field={field} value={values[field.header] || ""}
                placeholder={defaults[field.header] ? `기본값: ${defaults[field.header]}` : field.choices.length ? "(고르세요)" : undefined}
                onChange={value => onChange(field.header, value)} />
            </div>
          ))}
        </div>
      )}
      <div className="categoryExtraActions">
        {fields.length > important.length && (
          <button type="button" className="softApricotButton" onClick={() => setShowAll(value => !value)}>{showAll ? "선택 칸 접기" : `선택 칸 ${fields.length - important.length}개 더 보기`}</button>
        )}
        <button type="button" className="softBeigeButton" onClick={onOpenSettings}>{category} 기본값 설정</button>
      </div>
    </div>
  );
}
