"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { WarehouseBox } from "@/lib/wms/types";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { BOX_KIND_LABEL } from "@/lib/warehouse/labels";
import { WarehouseScreen, BackLink, Card, wmsColors } from "@/lib/warehouse/ui";

/**
 * QR 값 미리보기. 이번 스프린트는 실제 QR 이미지 생성/라이브러리 설치는 하지 않는다.
 * 데이터 구조(qrValue, 스캔 후 이동할 경로 문자열)만 보여준다.
 * 설계 근거: docs/WAREHOUSE_QR_PLAN.md
 */
export default function WmsWarehouseBoxQrPreviewPage() {
  const params = useParams<{ boxId: string }>();
  const boxId = decodeURIComponent(String(params.boxId || ""));
  const repository = useWarehouseRepository();
  const [box, setBox] = useState<WarehouseBox | null | undefined>(undefined);

  useEffect(() => {
    repository.getBox(boxId).then(setBox);
  }, [repository, boxId]);

  if (box === undefined) return <WarehouseScreen>불러오는 중...</WarehouseScreen>;
  if (box === null) {
    return (
      <WarehouseScreen>
        <BackLink href="/wms/warehouse/boxes" />
        <p>BOX "{boxId}"를 찾을 수 없습니다.</p>
      </WarehouseScreen>
    );
  }

  const scanRoute = `/wms/warehouse/boxes/${box.id}`;

  return (
    <WarehouseScreen>
      <BackLink href={`/wms/warehouse/boxes/${encodeURIComponent(box.id)}`} />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>QR 미리보기</h1>

      <Card style={{ textAlign: "center" }}>
        <div
          style={{
            width: "160px",
            height: "160px",
            margin: "0 auto 12px",
            border: `2px dashed ${wmsColors.borderStrong}`,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            color: wmsColors.muted,
          }}
        >
          QR 이미지
          <br />
          (다음 스프린트 구현)
        </div>
        <div style={{ fontSize: "24px", fontWeight: 900 }}>{box.id}</div>
      </Card>

      <Card>
        <Row label="카테고리" value={box.category} />
        <Row label="선반" value={box.shelfId} />
        <Row label="시리즈" value={box.series || "-"} />
        <Row label="BOX 종류" value={BOX_KIND_LABEL[box.kind]} />
      </Card>

      <Card>
        <div style={{ fontSize: "12px", color: wmsColors.muted, marginBottom: "4px" }}>QR에 들어갈 값 (qrValue)</div>
        <div style={{ fontFamily: "monospace", fontSize: "15px", wordBreak: "break-all" }}>{box.qrValue || box.id}</div>
      </Card>

      <Card>
        <div style={{ fontSize: "12px", color: wmsColors.muted, marginBottom: "4px" }}>스캔 후 이동할 경로 (설계, 미구현)</div>
        <div style={{ fontFamily: "monospace", fontSize: "15px", wordBreak: "break-all" }}>{scanRoute}</div>
      </Card>

      <p style={{ fontSize: "12px", color: wmsColors.muted }}>
        * 이번 스프린트에서는 실제 QR 이미지 생성이나 인쇄를 구현하지 않았습니다. 데이터 구조만
        준비되어 있으며, 다음 스프린트에서 QR 라이브러리를 붙이면 이 값을 그대로 사용할 수 있습니다.
      </p>
    </WarehouseScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}>
      <span style={{ color: wmsColors.muted }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
