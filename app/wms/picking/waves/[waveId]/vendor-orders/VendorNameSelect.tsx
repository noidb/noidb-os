"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { wmsColors } from "@/lib/wms/ui-tokens";

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  disabled?: boolean;
}

const fieldStyle: CSSProperties = {
  width: "100%", minWidth: 0, minHeight: "44px", boxSizing: "border-box",
  border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "8px",
  padding: "9px 10px", fontSize: "14px", color: wmsColors.ink, background: "#fff",
};

export default function VendorNameSelect({ value, onChange, options, disabled = false }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const registered = useMemo(() => [...new Set(options.map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [options]);
  const matched = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko");
    return keyword ? registered.filter(name => name.toLocaleLowerCase("ko").includes(keyword)) : registered;
  }, [query, registered]);

  useEffect(() => { if (open && !disabled) searchInput.current?.focus(); }, [open, disabled]);

  function closeList() {
    setOpen(false);
    toggleButton.current?.focus();
  }

  return <div style={{ width: "100%", minWidth: 0, flexBasis: "100%", display: "grid", gap: "7px", opacity: disabled ? 0.6 : 1 }}>
    <label htmlFor={`${id}-name`} style={{ fontSize: "12px", fontWeight: 700 }}>거래처 이름 · 직접 입력 가능</label>
    <input id={`${id}-name`} className="wms-input" value={value} disabled={disabled} autoComplete="off" placeholder="거래처 이름" onChange={event => onChange(event.target.value)} style={fieldStyle} />
    <button ref={toggleButton} type="button" disabled={disabled} aria-expanded={open} aria-controls={`${id}-options`} onClick={() => {
      // Opening the list always shows every registered vendor, independently of the current name.
      if (!open) setQuery("");
      setOpen(current => !current);
    }} style={{ ...fieldStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", textAlign: "left", cursor: disabled ? "default" : "pointer", fontWeight: 700, background: wmsColors.surfaceBeige }}>
      <span>등록된 거래처 {registered.length}곳 {open ? "접기" : "펼치기"}</span><span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div id={`${id}-options`} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeList(); } }} style={{ minWidth: 0, border: `1px solid ${wmsColors.border}`, borderRadius: "9px", padding: "8px", background: "#fff" }}>
      <label htmlFor={`${id}-search`} style={{ display: "block", marginBottom: "5px", fontSize: "12px", fontWeight: 700 }}>등록된 거래처 검색</label>
      <input ref={searchInput} id={`${id}-search`} type="search" disabled={disabled} value={query} placeholder="이름으로 검색" onChange={event => setQuery(event.target.value)} style={fieldStyle} />
      <p role="status" style={{ margin: "7px 0", fontSize: "12px", color: wmsColors.muted }}>{query.trim() ? `검색 결과 ${matched.length}곳 · 전체 ${registered.length}곳` : `전체 ${registered.length}곳`}</p>
      {matched.length > 0 ? <ul aria-label="등록된 거래처 목록" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "220px", overflowY: "auto" }}>
        {matched.map(name => <li key={name} style={{ margin: 0, padding: 0 }}>
          <button type="button" disabled={disabled} aria-pressed={value.trim() === name} onClick={() => { onChange(name); closeList(); }} style={{ width: "100%", minWidth: 0, minHeight: "44px", boxSizing: "border-box", padding: "10px", border: 0, borderRadius: "6px", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere", fontSize: "14px", color: wmsColors.ink, background: value.trim() === name ? wmsColors.greenSoft : "#fff", fontWeight: value.trim() === name ? 800 : 400, cursor: disabled ? "default" : "pointer" }}>{name}</button>
        </li>)}
      </ul> : <p style={{ margin: "10px 0 2px", fontSize: "12px", lineHeight: 1.6, color: wmsColors.muted }}>{registered.length ? "검색된 거래처가 없습니다. 새 거래처는 위 ‘거래처 이름’에 직접 입력해 주세요." : "등록된 거래처가 없습니다. 위 ‘거래처 이름’에 직접 입력해 주세요."}</p>}
    </div>}
  </div>;
}
