"use client";

import { useEffect, useState } from "react";

type Summary = { expectedDate: string; centers: string; purchaseOrderCount: number; skuCount: number; quantity: number };
type Step = { title: string; action: string; note: string; href?: string };

const STORAGE_KEY = "noidb-inbound-execution-board-v1";
const steps: Step[] = [
  { title: "신규발주서 다운로드", action: "Supplier Hub 발주리스트 열기", note: "입고예정일(EDD) 기준 신규 발주서를 직접 내려받습니다. 원본 파일은 G:\\내 드라이브\\쿠팡데이터\\발주서리스트다운에 저장합니다.", href: "https://supplier.coupang.com" },
  { title: "한진 송장파일 준비", action: "발주상세 입고 정보 확인", note: "NOID-B OS가 아닌 발주 상세의 실제 센터 주소·전화·우편번호로 1발주 1행 한진택배_업로드_YYYYMMDD_HHMMSS.xlsx를 만듭니다. 저장: G:\\내 드라이브\\쿠팡데이터\\한진택배 송장파일." },
  { title: "한진 n-Focus 등록·출력", action: "한진 n-Focus 열기", note: "먼저 재출력 및 출고관리에서 같은 발주의 기존 회차를 확인합니다. 있으면 재발번하지 말고 재출력합니다. 신규만 쿠팡 [고정형]·운임 S·오류체크 후 직접 출력합니다.", href: "https://focus.hanjin.com" },
  { title: "한진 세부내역 저장", action: "재출력 및 출고관리에서 다운로드", note: "보기 > 세부내역 다운로드 > 엑셀 다운로드로 재출력_세부내역_YYYYMMDD_HHMMSS.xlsx를 저장합니다. 위치: G:\\내 드라이브\\쿠팡데이터\\한진택배 송장파일.", href: "https://focus.hanjin.com" },
  { title: "쉽먼트 파일 생성·등록", action: "Supplier Hub 쉽먼트 일괄등록 열기", note: "양식의 송장번호(12자리)·납품수량을 채워 쉽먼트생성_업로드파일_YYYYMMDD_HHMMSS.xlsx로 저장합니다. 위치: G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성. 한진택배·작업일 다음날 발송일을 직접 선택해 등록합니다.", href: "https://supplier.coupang.com" },
  { title: "Label·내역서 다운로드", action: "Supplier Hub 쉽먼트 열기", note: "생성된 쉽먼트 번호를 확인하고 Label·내역서 PDF를 직접 받습니다. 위치: G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성\\쉽먼트출력세트\\YYYYMMDD(입고예정일).", href: "https://supplier.coupang.com" },
  { title: "바코드 엑셀 생성", action: "출력세트 파일 확인", note: "03_바코드_YYYYMMDD_{PO}.xlsx를 같은 출력세트 폴더에 저장합니다. SKU ID·번호·바코드·상품명·옵션명·제조국명·출력유형만 포함하며, 쉽먼트별 구분행을 확인합니다." },
  { title: "BarTender TSC 라벨 출력", action: "BarTender에서 직접 출력", note: "바코드양식_로켓_쉽먼트구분.btw에 7단계 엑셀을 연결하고 TSC TTP-244 Pro로 직접 출력합니다." },
  { title: "4분할 문서·동봉내역서 출력", action: "PDF·Samsung 출력 확인", note: "01_부착문서_4분할_YYYYMMDD.pdf와 02_동봉내역서_전체_YYYYMMDD.pdf가 출력세트 폴더에 있는지 확인한 뒤 Samsung M203x Series에서 직접 출력합니다." },
];

export default function InboundExecutionBoard({ summaries }: { summaries: Summary[] }) {
  const [completed, setCompleted] = useState<boolean[]>(() => steps.map(() => false));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) setCompleted(steps.map((_, index) => saved[index] === true));
    } catch { /* A damaged local record is safely replaced on the next change. */ }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(completed)); }, [completed, loaded]);

  const done = completed.filter(Boolean).length;
  return <section aria-label="입고 실행판" style={{ margin: "22px 0", padding: 18, border: "2px solid #b9d5bd", borderRadius: 12, background: "#f7fbf5" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
      <div><h2 style={{ margin: 0 }}>오늘 전체 물류작업 실행판</h2><p style={{ margin: "6px 0 0", color: "#526158" }}>NOID-B OS는 작업 순서와 대상만 안내합니다. 외부 사이트 로그인·업로드·다운로드·출력은 자동 실행하지 않으며, 직접 끝낸 단계만 이 브라우저에 기록됩니다.</p></div>
      <strong>{done}/9 단계 완료</strong>
    </div>
    <details style={{ marginTop: 16 }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>현재 발주 원본 요약 {summaries.length ? `${summaries.length}개 입고예정일` : "없음"} · 펼쳐서 확인</summary><div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><caption style={{ textAlign: "left", paddingBottom: 8, color: "#526158" }}>입고예정일별 발주 원본 집계</caption><thead><tr>{["입고예정일", "발주서 건수", "물류센터", "총 SKU", "총수량"].map(label => <th key={label} scope="col" style={{ textAlign: "left", padding: 8, background: "#e8f2e7", borderBottom: "1px solid #cfe0cf", whiteSpace: "nowrap" }}>{label}</th>)}</tr></thead><tbody>{summaries.length ? summaries.map(row => <tr key={row.expectedDate}><td style={{ padding: 8, borderBottom: "1px solid #e3ece2", whiteSpace: "nowrap" }}>{row.expectedDate}</td><td style={{ padding: 8, borderBottom: "1px solid #e3ece2", whiteSpace: "nowrap" }}>{row.purchaseOrderCount.toLocaleString()}건</td><td style={{ padding: 8, borderBottom: "1px solid #e3ece2" }}>{row.centers}</td><td style={{ padding: 8, borderBottom: "1px solid #e3ece2", whiteSpace: "nowrap" }}>{row.skuCount.toLocaleString()}개</td><td style={{ padding: 8, borderBottom: "1px solid #e3ece2", whiteSpace: "nowrap" }}>{row.quantity.toLocaleString()}개</td></tr>) : <tr><td colSpan={5} style={{ padding: 8 }}>불러온 발주 원본이 없습니다. 1단계에서 신규발주서를 다운로드해 주세요.</td></tr>}</tbody></table></div></details>
    <ol style={{ paddingLeft: 22, margin: "18px 0 0" }}>{steps.map((step, index) => <li key={step.title} style={{ margin: "12px 0", padding: 10, borderRadius: 8, background: completed[index] ? "#e7f4e8" : "#fff" }}>
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer" }}><input type="checkbox" checked={completed[index]} onChange={() => setCompleted(previous => previous.map((value, position) => position === index ? !value : value))} /><span><strong>{index + 1}. {step.title}</strong><br /><span style={{ color: "#526158" }}>{step.note}</span></span></label>
      <div style={{ margin: "8px 0 0 25px" }}>{step.href ? <a href={step.href} target={step.href.startsWith("http") ? "_blank" : undefined} rel={step.href.startsWith("http") ? "noreferrer" : undefined}>{step.action} ↗</a> : <span style={{ color: "#526158" }}>{step.action}</span>}</div>
    </li>)}</ol>
    <button type="button" onClick={() => setCompleted(steps.map(() => false))} disabled={!done} style={{ padding: "8px 12px" }}>진행상태 초기화</button>
    {done === steps.length ? <p role="status" style={{ marginBottom: 0, color: "#176b32", fontWeight: 700 }}>전체 물류작업 9단계 완료 기록됨</p> : null}
  </section>;
}
