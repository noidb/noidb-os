/**
 * Sprint 2 피킹 UI/흐름 데모용 샘플 데이터.
 *
 * 아직 실제 선반/BOX/모델 위치 데이터 소스가 없으므로(구글시트에도 해당 구조가 없음),
 * 이 파일은 화면 흐름을 검증하기 위한 고정 샘플 데이터만 담는다.
 * 실제 데이터 연동은 위치 데이터 모델이 확정된 뒤 별도 스프린트에서 대체된다.
 *
 * lib/wms/types.ts의 정식 도메인 타입과는 별개의 데모 전용 타입이다.
 */

export interface PickingOption {
  skuId: string;
  optionLabel: string;
  productName: string;
  vendorName: string;
  imageDataUri: string;
  orderedQty: number;
  /** 임시 표시용 재고 수치 (실제 재고 시스템 연동 전) */
  currentStock: number;
}

export interface PickingModel {
  modelId: string;
  modelName: string;
  representativeImageDataUri: string;
  options: PickingOption[];
}

export interface PickingBox {
  boxId: string;
  shelfId: string;
  models: PickingModel[];
}

export interface WorkBatch {
  id: string;
  center: string;
  expectedDate: string;
  boxes: PickingBox[];
}

const LABEL_COLORS: Record<string, string> = {
  "실버": "#9AA5B1",
  "골드": "#C9A227",
  "로즈골드": "#B76E79",
  "블랙": "#2B2B2B",
  "화이트": "#D9D9D9",
  "투톤": "#6C7A89",
};

function colorForLabel(label: string): string {
  if (LABEL_COLORS[label]) return LABEL_COLORS[label];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 45%, 45%)`;
}

function swatchImage(label: string, bg: string): string {
  const textColor = bg === "#D9D9D9" ? "#333333" : "#ffffff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${bg}"/><text x="100" y="108" font-size="26" text-anchor="middle" fill="${textColor}" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function optionImage(label: string): string {
  return swatchImage(label, colorForLabel(label));
}

function modelImage(modelName: string): string {
  const initials = modelName.replace(/[^A-Za-z0-9가-힣]/g, "").slice(0, 4) || modelName.slice(0, 2);
  return swatchImage(initials, "#4A5568");
}

function makeModel(modelId: string, modelName: string, vendorName: string, labels: string[], orderedQty: number, currentStock: number): PickingModel {
  return {
    modelId,
    modelName,
    representativeImageDataUri: modelImage(modelName),
    options: labels.map((label, index) => ({
      skuId: `${modelId}-${String(index + 1).padStart(2, "0")}`,
      optionLabel: label,
      productName: `${modelName} ${label}`,
      vendorName,
      imageDataUri: optionImage(label),
      orderedQty,
      currentStock,
    })),
  };
}

export const SAMPLE_WORK_BATCHES: WorkBatch[] = [
  {
    id: "WB-ICN-20260820",
    center: "인천센터",
    expectedDate: "2026-08-20",
    boxes: [
      {
        boxId: "P-01",
        shelfId: "A-1",
        models: [
          makeModel("GN-1002", "GN-1002 목걸이", "골든주얼리", ["실버", "골드"], 3, 12),
          makeModel("GN-1005", "GN-1005 팔찌", "실버킹", ["실버", "골드", "로즈골드"], 2, 6),
        ],
      },
      {
        boxId: "P-02",
        shelfId: "A-2",
        models: [
          makeModel("ER-2010", "ER-2010 귀걸이", "골든주얼리", ["실버", "골드", "블랙", "화이트"], 2, 5),
          makeModel("RG-3001", "RG-3001 반지", "실버킹", ["5호", "10호", "15호"], 2, 4),
        ],
      },
      {
        boxId: "P-03",
        shelfId: "B-1",
        models: [
          makeModel("NC-4010", "NC-4010 목걸이", "골든주얼리", ["실버", "골드", "로즈골드", "블랙", "화이트", "투톤"], 2, 6),
          makeModel("BR-5020", "BR-5020 팔찌", "실버킹", ["실버", "골드", "로즈골드", "블랙", "화이트", "투톤"], 2, 5),
          makeModel("ER-6030", "ER-6030 귀걸이", "코퍼라인", ["실버", "골드", "로즈골드", "블랙", "화이트", "투톤"], 2, 4),
        ],
      },
    ],
  },
  {
    id: "WB-DT-20260819",
    center: "동탄센터",
    expectedDate: "2026-08-19",
    boxes: [
      {
        boxId: "T-01",
        shelfId: "C-1",
        models: [
          makeModel("PD-7001", "PD-7001 펜던트", "코퍼라인", ["실버", "골드", "로즈골드"], 2, 5),
          makeModel("EA-7002", "EA-7002 이어커프", "골든주얼리", ["실버", "골드", "블랙"], 2, 4),
        ],
      },
      {
        boxId: "T-02",
        shelfId: "C-2",
        models: [
          makeModel("RG-8001", "RG-8001 반지", "실버킹", ["5호", "10호", "15호", "20호"], 1, 3),
        ],
      },
    ],
  },
];

export function countOptionsInBox(box: PickingBox): number {
  return box.models.reduce((sum, model) => sum + model.options.length, 0);
}

export function countOptionsInBatch(batch: WorkBatch): number {
  return batch.boxes.reduce((sum, box) => sum + countOptionsInBox(box), 0);
}

export function countBoxesInBatch(batch: WorkBatch): number {
  return batch.boxes.length;
}

/** SKU 1개당 약 40초로 가정한 예상 작업시간(분). 실측 데이터가 없는 Sprint 3 시점의 단순 추정치. */
const ESTIMATED_SECONDS_PER_SKU = 40;

export function estimatePickingMinutes(batch: WorkBatch): number {
  return Math.max(1, Math.round((countOptionsInBatch(batch) * ESTIMATED_SECONDS_PER_SKU) / 60));
}
