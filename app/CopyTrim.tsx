"use client";

import { useEffect } from "react";

/**
 * 2026-10-19: SKU·바코드 번호를 더블클릭해서 복사하면 뒤 여백 한 칸이 같이 복사되는 문제.
 * 사이트 전체에서, 복사할 글자가 한 단어(중간에 띄어쓰기 없음)인데 앞뒤에 여백이 붙어 있으면 여백을 빼고 복사한다.
 * 입력칸 안에서 복사하는 것과 여러 단어를 드래그한 복사는 그대로 둔다.
 */
export default function CopyTrim() {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const text = window.getSelection()?.toString() ?? "";
      const trimmed = text.trim();
      if (!trimmed || trimmed === text || /\s/.test(trimmed) || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", trimmed);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
  return null;
}
