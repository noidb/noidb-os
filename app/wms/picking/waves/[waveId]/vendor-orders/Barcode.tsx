"use client";

import { encodeCode128B } from "@/lib/wms/vendor-order/code128";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 실제 Code128B 바코드를 SVG로 그린다(스캔 가능한 표준 규격). 숫자 원문도 함께 표시한다.
 * 인코딩할 수 없는 값(허용 범위 밖 문자)이면 그래픽 없이 "쿠팡 바코드 미등록"과 함께
 * 원문만 보여준다 — 잘못된 가짜 그래픽을 보여주지 않기 위함.
 */
interface BarcodeProps {
  value: string;
  height?: number;
  moduleWidth?: number;
  /** 바코드 숫자 글씨 크기 — 참고용으로 작게 쓸 때 줄인다 (2026-08-19 4차 실사용 테스트 반영) */
  valueFontSize?: number;
}

export default function Barcode({ value, height = 44, moduleWidth = 2, valueFontSize = 13 }: BarcodeProps) {
  if (!value) {
    return <div style={{ fontSize: "11px", color: wmsColors.warn, fontWeight: 700, textAlign: "center" }}>쿠팡 바코드 미등록</div>;
  }

  let widths: number[] | null = null;
  try {
    widths = encodeCode128B(value);
  } catch {
    widths = null;
  }

  if (!widths) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "11px", color: wmsColors.warn, fontWeight: 700 }}>바코드 이미지 생성 불가</div>
        <div style={{ fontFamily: "monospace", fontSize: valueFontSize, fontWeight: 700 }}>{value}</div>
      </div>
    );
  }

  const totalWidth = widths.reduce((sum, w) => sum + w, 0) * moduleWidth;
  let x = 0;
  const bars: { x: number; width: number }[] = [];
  widths.forEach((w, index) => {
    const barWidth = w * moduleWidth;
    if (index % 2 === 0) bars.push({ x, width: barWidth }); // 짝수 인덱스 = 바(막대)
    x += barWidth;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", minWidth: 0 }}>
      {/* width:100%+viewBox로 부모 폭 안에서만 줄어들게 한다 — 고정 px 폭이 좁은 화면에서
       *  카드 밖으로 넘치는 가로 스크롤 원인이었다(2026-08-20, 2번 요구사항 반영).
       *  maxWidth로 원래 크기보다 커지지는 않는다. */}
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", maxWidth: `${totalWidth}px`, height: "auto", background: "#ffffff" }}
      >
        {bars.map((bar, index) => (
          <rect key={index} x={bar.x} y={0} width={bar.width} height={height} fill="#000000" />
        ))}
      </svg>
      <div style={{ fontFamily: "monospace", fontSize: valueFontSize, fontWeight: 700, textAlign: "center", letterSpacing: "1px", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}
