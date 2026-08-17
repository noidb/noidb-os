"use client";

import { useEffect, useState } from "react";
import { useWarehouseRepository } from "@/lib/warehouse/context";
import { validateWarehouse, issueTypeLabel, type WarehouseValidationIssue, type WarehouseValidationIssueType } from "@/lib/warehouse/validation";
import { listCatalogModelNames } from "@/lib/warehouse/sample-data";
import { WarehouseScreen, BackLink, Card, wmsColors, wmsGhostButton } from "@/lib/warehouse/ui";

const ISSUE_TYPES: WarehouseValidationIssueType[] = [
  "unassigned_model",
  "missing_box_reference",
  "duplicate_box_id",
  "empty_box",
  "inactive_box_placement",
  "duplicate_sku_exception",
  "set_product_wrong_box",
];

function fixLink(issue: WarehouseValidationIssue): string {
  if (issue.targetKind === "box") return `/wms/warehouse/boxes/${encodeURIComponent(issue.targetId)}`;
  if (issue.targetKind === "model") return `/wms/warehouse/model-locations?model=${encodeURIComponent(issue.targetId)}`;
  return `/wms/warehouse/sku-exceptions`;
}

export default function WmsWarehouseValidationPage() {
  const repository = useWarehouseRepository();
  const [issues, setIssues] = useState<WarehouseValidationIssue[] | null>(null);

  async function runValidation() {
    setIssues(null);
    const [boxes, modelLocations, skuExceptions] = await Promise.all([
      repository.listBoxes(),
      repository.listModelLocations(),
      repository.listSkuExceptions(),
    ]);
    setIssues(validateWarehouse({ boxes, modelLocations, skuExceptions, catalogModelNames: listCatalogModelNames() }));
  }

  useEffect(() => {
    runValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  return (
    <WarehouseScreen>
      <BackLink href="/wms/warehouse" />
      <h1 style={{ fontSize: "18px", margin: "0 0 12px" }}>위치 검증</h1>

      {issues === null ? (
        <p>검사 중...</p>
      ) : (
        <>
          <Card style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 900, color: issues.length ? wmsColors.warn : wmsColors.greenDark }}>{issues.length}</div>
            <div style={{ fontSize: "12px", color: wmsColors.muted }}>발견된 문제</div>
          </Card>

          {ISSUE_TYPES.map(type => {
            const group = issues.filter(issue => issue.type === type);
            if (!group.length) return null;
            return (
              <div key={type} style={{ marginBottom: "16px" }}>
                <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>
                  {issueTypeLabel(type)} ({group.length})
                </h2>
                {group.map((issue, index) => (
                  <a key={`${type}-${index}`} href={fixLink(issue)} style={{ textDecoration: "none", color: "inherit" }}>
                    <Card style={{ cursor: "pointer" }}>
                      <div style={{ fontSize: "13px" }}>{issue.message}</div>
                      <div style={{ fontSize: "11px", color: wmsColors.green, marginTop: "4px" }}>수정 화면으로 이동 →</div>
                    </Card>
                  </a>
                ))}
              </div>
            );
          })}

          {issues.length === 0 && <p style={{ color: wmsColors.greenDark }}>발견된 문제가 없습니다.</p>}
        </>
      )}

      <button onClick={runValidation} style={{ ...wmsGhostButton, width: "100%" }}>
        다시 검사
      </button>
    </WarehouseScreen>
  );
}
