"use client";

/**
 * 2026-11-10 신상등록대기 모델 카드: 폴더를 열지 않고 사이트에서 '상품정보.txt'를 보고(드래그·줄별·전체 복사),
 * 모델 폴더 경로를 복사한다. 글자는 마우스로 끌어 선택해 복사할 수 있다.
 * 읽은 내용은 이 화면 안에서만 기억하고, 다시 읽으려면 '다시 읽기'를 누른다(MYBOX는 폴더를 열 때마다 느림).
 */
import { useState } from "react";
import { readProductInfoText } from "@/lib/image-search/browser-folder";
import { parseProductInfo } from "@/lib/product-info";
import { wmsColors } from "@/lib/wms/ui-tokens";

/** 경로 복사에 쓰는 앞부분. 사진 폴더가 있는 위치가 PC마다 다르면 '기준 경로 바꾸기'로 고친다. */
const ROOT_KEY = "noidb-photo-root-windows-path";
const DEFAULT_ROOT = "N:\\개인\\★전체제품사진";

function windowsRoot() {
  try { return window.localStorage.getItem(ROOT_KEY) || DEFAULT_ROOT; } catch { return DEFAULT_ROOT; }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    // 클립보드 권한이 막혔을 때: 잠깐 만든 입력칸으로 복사한다.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch { return false; }
  }
}

type Loaded = { text: string | null } | { error: string };
const memory = new Map<string, Loaded>();

const buttonStyle = { minHeight: 34, padding: "0 12px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" } as const;

export default function ProductInfoBox({ folderPath }: { folderPath: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | undefined>(() => memory.get(folderPath));
  const [notice, setNotice] = useState("");
  const [copiedAt, setCopiedAt] = useState("");

  async function load(force = false) {
    if (!force && memory.has(folderPath)) { setLoaded(memory.get(folderPath)); return; }
    setLoading(true);
    let result: Loaded;
    try { result = { text: await readProductInfoText(folderPath) }; }
    catch (cause) { result = { error: cause instanceof Error ? cause.message : "상품정보.txt를 읽지 못했습니다." }; }
    memory.set(folderPath, result);
    setLoaded(result);
    setLoading(false);
  }

  async function copy(key: string, text: string) {
    const ok = await copyText(text);
    setCopiedAt(ok ? key : "");
    setNotice(ok ? "" : "복사하지 못했습니다. 글자를 마우스로 끌어 선택한 뒤 Ctrl+C를 눌러주세요.");
    if (ok) window.setTimeout(() => setCopiedAt(current => current === key ? "" : current), 1500);
  }

  async function copyFolderPath() {
    const full = `${windowsRoot()}\\${folderPath.split("/").filter(Boolean).join("\\")}`;
    const ok = await copyText(full);
    setNotice(ok ? `폴더 경로를 복사했습니다. 탐색기 주소창을 누르고 Ctrl+V → Enter: ${full}` : "경로를 복사하지 못했습니다.");
  }

  function changeRoot() {
    const next = window.prompt("사진 폴더(★전체제품사진)가 이 PC에서 있는 경로를 적어주세요.\n탐색기 주소창의 경로를 그대로 붙여넣으면 됩니다.", windowsRoot());
    if (!next || !next.trim()) return;
    try { window.localStorage.setItem(ROOT_KEY, next.trim().replace(/[\\/]+$/, "")); setNotice("기준 경로를 저장했습니다."); } catch { setNotice("기준 경로를 저장하지 못했습니다."); }
  }

  const text = loaded && "text" in loaded ? loaded.text : null;
  const parsed = text ? parseProductInfo(text) : null;

  return (
    <div style={{ marginTop: 8 }} onClick={event => event.stopPropagation()}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="softBeigeButton" style={buttonStyle} disabled={loading}
          onClick={() => { const next = !open; setOpen(next); if (next) void load(); }}>
          {loading ? "읽는 중…" : open ? "상품정보 접기" : "상품정보 보기"}
        </button>
        <button type="button" className="softApricotButton" style={buttonStyle} onClick={() => void copyFolderPath()} title={`${windowsRoot()}\\${folderPath.split("/").join("\\")}`}>폴더 경로 복사</button>
        <button type="button" className="softApricotButton" style={buttonStyle} onClick={changeRoot} title="폴더 경로 복사의 앞부분(드라이브 글자 등)을 이 PC에 맞게 바꿉니다.">기준 경로 바꾸기</button>
      </div>
      {notice && <div style={{ color: wmsColors.ink, fontSize: 12, marginTop: 6, overflowWrap: "anywhere" }}>{notice}</div>}
      {open && !loading && loaded && (
        <div style={{ marginTop: 8, border: `1px solid ${wmsColors.border}`, borderRadius: 10, background: "#fff", padding: "10px 12px" }}>
          {"error" in loaded && <div role="alert" style={{ color: wmsColors.warnText, fontSize: 13, fontWeight: 700 }}>{loaded.error}</div>}
          {"text" in loaded && loaded.text === null && <div style={{ color: wmsColors.muted, fontSize: 13 }}>이 폴더에 상품정보.txt(또는 상품설명.txt)가 없습니다.</div>}
          {parsed && (
            <div style={{ display: "grid", gap: 6 }}>
              {parsed.problems.length > 0 && <div role="alert" style={{ color: wmsColors.warnText, fontSize: 12, fontWeight: 700 }}>상품정보.txt 형식 확인 필요: {parsed.problems.join(" ")}</div>}
              {parsed.entries.map((entry, index) => (
                <div key={index} style={{ display: "grid", gridTemplateColumns: "130px 1fr 64px", gap: 8, alignItems: "center" }}>
                  <span style={{ color: wmsColors.muted, fontSize: 12, fontWeight: 700 }}>{entry.label}</span>
                  {/* 글자를 끌어서 선택·복사할 수 있게 selectable 로 둔다. 이름표(거래처: 등)는 빼고 값만 복사한다. */}
                  <span style={{ userSelect: "text", cursor: "text", fontSize: 14, overflowWrap: "anywhere" }}>{entry.value}</span>
                  <button type="button" className="softApricotButton" style={{ ...buttonStyle, minHeight: 30, padding: "0 8px" }} onClick={() => void copy(`line${index}`, entry.value)}>{copiedAt === `line${index}` ? "복사됨" : "복사"}</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button type="button" className="softSageButton" style={buttonStyle} onClick={() => void copy("all", parsed.lines.join("\n"))}>{copiedAt === "all" ? "복사됨" : "전체 복사"}</button>
                <button type="button" className="softApricotButton" style={buttonStyle} onClick={() => void load(true)}>다시 읽기</button>
              </div>
            </div>
          )}
          {"text" in loaded && loaded.text === null && <button type="button" className="softApricotButton" style={{ ...buttonStyle, marginTop: 8 }} onClick={() => void load(true)}>다시 읽기</button>}
        </div>
      )}
    </div>
  );
}
