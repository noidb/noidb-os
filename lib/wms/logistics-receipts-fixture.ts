import {
  buildLogisticsReceiptBoard,
  logisticsReceiptSourceFingerprint,
  type LogisticsAsideBaseline,
  type LogisticsReceiptBoard,
  type LogisticsReceiptBoardLine,
  type LogisticsReceiptRoute,
  type LogisticsReceiptSnapshot,
  type LogisticsReceiptTarget,
} from "./logistics-receipts";

export type LogisticsReceiptsPayload = {
  ok: true;
  status: "ready";
  source: "supplier-hub-shipments";
  schemaVersion: 3;
  collectedAt?: string;
  targets: LogisticsReceiptTarget[];
  board: LogisticsReceiptBoard;
};

export type FixtureFollowUpLine = Pick<
  LogisticsReceiptBoardLine,
  | "lineKey"
  | "sourceLineKey"
  | "shipmentNumber"
  | "boxId"
  | "purchaseOrderNumber"
  | "skuId"
  | "productName"
  | "barcode"
  | "kind"
  | "state"
  | "route"
> & { sourceFingerprint: string; blockedReason?: string };
export type FixtureFollowUpProof = {
  kind: "marketing" | "discontinue" | "reorder";
  outputKey: string;
  fileName: string;
  at: string;
  sourceKeys: string[];
  completedAt?: string;
  fixture: true;
};
export type FixtureFollowUp = {
  token: string;
  queues: Record<
    "marketing" | "discontinue" | "reorder" | "vendor",
    FixtureFollowUpLine[]
  >;
  exclusionHistory: Array<
    FixtureFollowUpLine & { at: string; restoredAt?: string }
  >;
  proofs: FixtureFollowUpProof[];
};
type FixtureState = {
  collectedAt: string;
  routes: Record<string, LogisticsReceiptRoute>;
  followUp?: FixtureFollowUp;
};
const storageKey = "noidb-logistics-receipts-fixture-v2";

const targets: LogisticsReceiptTarget[] = [
  ["99000001", "인천14", ["88000001", "88000002", "88000003"]],
  ["99000002", "양산1", ["88000004", "88000005"]],
  ["99000003", "동탄1", ["88000006", "88000007"]],
  ["99000004", "동탄1", ["88000008", "88000009", "88000010"]],
  ["99000005", "동탄1", ["88000011", "88000012", "88000013"]],
  ["99000006", "대구3", ["88000014", "88000015", "88000016"]],
  ["99000007", "안성5", ["88000017", "88000018"]],
  ["99000008", "이천4", ["88000019", "88000020"]],
  ["99000901", "개발예시센터", ["88100901"]],
  ["99000902", "개발예시센터", ["88100902"]],
  ["99000903", "개발예시센터", ["88100903"]],
].map(([shipmentNumber, centerName, purchaseOrderNumbers]) => ({
  shipmentNumber: String(shipmentNumber),
  expectedDate: "2026-09-04",
  centerName: String(centerName),
  purchaseOrderNumbers: purchaseOrderNumbers as string[],
  source: "aside",
}));

const baseline: LogisticsAsideBaseline = {
  closedShipmentNumbers: [],
  pendingTargets: [],
  completedMarketingSkuIds: [
    "77000003",
    "77000005",
    "77000006",
    "77000007",
    "77000008",
    "77000009",
  ],
  excludedMarketingSkuIds: ["77000010"],
  handledLines: [],
  source: { fixture: true },
};

const line = (
  purchaseOrderNumber: string,
  skuId: string,
  deliveredQuantity: number,
  receivedQuantity: number,
) => ({
  boxId: `상자-${purchaseOrderNumber.slice(-2)}`,
  purchaseOrderNumber,
  skuId,
  productName: skuId.startsWith("771009")
    ? `개발용 미분류 미납 예시 ${skuId.slice(-2)}`
    : `개발 확인 상품 ${skuId.slice(-2)}`,
  barcode: `9700000${skuId.slice(-6)}`,
  deliveredQuantity,
  receivedQuantity,
});

function snapshot(collectedAt: string): LogisticsReceiptSnapshot {
  return {
    source: "supplier-hub-shipments",
    schemaVersion: 3,
    collectedAt,
    requestedShipmentNumbers: targets.map((target) => target.shipmentNumber),
    shipments: [
      {
        shipmentNumber: "99000001",
        status: "마감",
        totalDelivered: 4,
        totalReceived: 3,
        lines: [
          line("88000001", "77000001", 2, 1),
          line("88000002", "77000002", 1, 1),
          line("88000003", "77000003", 1, 1),
        ],
      },
      {
        shipmentNumber: "99000002",
        status: "발송 완료",
        totalDelivered: null,
        totalReceived: null,
        lines: [],
      },
      {
        shipmentNumber: "99000003",
        status: "마감",
        totalDelivered: 3,
        totalReceived: 0,
        lines: [
          line("88000006", "77000004", 2, 0),
          line("88000007", "77000005", 1, 0),
        ],
      },
      {
        shipmentNumber: "99000004",
        status: "발송 가능",
        totalDelivered: null,
        totalReceived: null,
        lines: [],
      },
      {
        shipmentNumber: "99000005",
        status: "마감",
        totalDelivered: 3,
        totalReceived: 3,
        lines: [
          line("88000011", "77000006", 1, 1),
          line("88000012", "77000007", 1, 1),
          line("88000013", "77000008", 1, 1),
        ],
      },
      {
        shipmentNumber: "99000006",
        status: "마감",
        totalDelivered: 4,
        totalReceived: 3,
        lines: [
          line("88000014", "77000009", 1, 1),
          line("88000015", "77000010", 1, 1),
          line("88000016", "77000011", 2, 1),
        ],
      },
      {
        shipmentNumber: "99000007",
        status: "발송 완료",
        totalDelivered: null,
        totalReceived: null,
        lines: [],
      },
      {
        shipmentNumber: "99000008",
        status: "발송 가능",
        totalDelivered: null,
        totalReceived: null,
        lines: [],
      },
      {
        shipmentNumber: "99000901",
        status: "마감",
        totalDelivered: 5,
        totalReceived: 3,
        lines: [line("88100901", "77100901", 5, 3)],
      },
      {
        shipmentNumber: "99000902",
        status: "마감",
        totalDelivered: 6,
        totalReceived: 4,
        lines: [line("88100902", "77100902", 6, 4)],
      },
      {
        shipmentNumber: "99000903",
        status: "마감",
        totalDelivered: 4,
        totalReceived: 1,
        lines: [line("88100903", "77100903", 4, 1)],
      },
    ],
    skuStatuses: [
      "77000001", "77000002", "77000003", "77000004", "77000005", "77000006", "77000007", "77000008", "77000009", "77000010", "77000011", "77100901", "77100902", "77100903",
    ].map((skuId) => ({ skuId, orderStatus: "정상" as const })),
  };
}

function defaultState(): FixtureState {
  return {
    collectedAt: new Date(Date.now() - 1_000).toISOString(),
    routes: {},
  };
}

function readState(): FixtureState {
  if (typeof window === "undefined") return defaultState();
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(storageKey) || "null",
    ) as Partial<FixtureState> | null;
    if (
      parsed &&
      typeof parsed.collectedAt === "string" &&
      parsed.routes &&
      typeof parsed.routes === "object"
    )
      return {
        collectedAt: parsed.collectedAt,
        routes: parsed.routes as Record<string, LogisticsReceiptRoute>,
        followUp: parsed.followUp,
      };
  } catch {
    /* Recreate only the development example state. */
  }
  const state = defaultState();
  window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}

function writeState(state: FixtureState) {
  if (typeof window !== "undefined")
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
}

function payloadFor(state: FixtureState): LogisticsReceiptsPayload {
  const savedSnapshot = snapshot(state.collectedAt);
  const board = buildLogisticsReceiptBoard({
    targets,
    snapshot: savedSnapshot,
    baseline,
    routes: state.routes,
  });
  return {
    ok: true,
    status: "ready",
    source: "supplier-hub-shipments",
    schemaVersion: 3,
    collectedAt: savedSnapshot.collectedAt,
    targets: board.targets,
    board,
  };
}

/** 개발용 합성 수집자료. 보드 계산 경로는 실제 화면과 동일하다. */
export function createLogisticsReceiptsFixture(): LogisticsReceiptsPayload {
  return payloadFor(readState());
}

/** 개발용 route-item 모사. 같은 지문과 route를 보드에 다시 반영한다. */
export function routeLogisticsReceiptsFixtureItem(
  payload: LogisticsReceiptsPayload,
  lineKey: string,
  decision: "vendor" | "discontinue" | "reorder" | "marketing",
): LogisticsReceiptsPayload {
  const line = payload.board.lines.find((item) => item.lineKey === lineKey);
  if (!line)
    throw new Error("개발용 예시자료에서 처리할 행을 찾지 못했습니다.");
  const state = readState();
  state.routes[line.lineKey] = {
    decision,
    runId: `fixture-${decision}-${line.skuId}`,
    at: state.collectedAt,
    completed: true,
    quantity: decision === "marketing" ? 1 : line.remainingQuantity || 0,
    sourceFingerprint: logisticsReceiptSourceFingerprint(line),
    note: "개발용 예시자료 후속 처리",
  };
  writeState(state);
  return payloadFor(state);
}

function cloneFollowUpLine(
  line: LogisticsReceiptBoardLine,
): FixtureFollowUpLine {
  return {
    lineKey: line.lineKey,
    sourceLineKey: line.sourceLineKey,
    shipmentNumber: line.shipmentNumber,
    boxId: line.boxId,
    purchaseOrderNumber: line.purchaseOrderNumber,
    skuId: line.skuId,
    productName: line.productName,
    barcode: line.barcode,
    kind: line.kind,
    state: line.state,
    route: line.route,
    sourceFingerprint: logisticsReceiptSourceFingerprint(line),
  };
}

function emptyFollowUp(): FixtureFollowUp {
  return {
    token: "fixture-follow-up-v1",
    queues: { marketing: [], discontinue: [], reorder: [], vendor: [] },
    exclusionHistory: [],
    proofs: [],
  };
}

/** Development-only local follow-up board. It never calls an API, creates downloads, or opens an external service. */
export function createLogisticsFollowUpFixture(
  payload: LogisticsReceiptsPayload,
): FixtureFollowUp {
  const state = readState();
  const followUp = state.followUp || emptyFollowUp();
  const board = payloadFor(state).board;
  const completedKeys = new Set(
    followUp.proofs
      .filter((proof) => proof.completedAt)
      .flatMap((proof) => proof.sourceKeys),
  );
  for (const line of board.lines.filter(
    (item) => item.state === "routed" && item.route,
  )) {
    const kind = line.route!.decision as
      "marketing" | "discontinue" | "reorder" | "vendor";
    if (
      !completedKeys.has(line.lineKey) &&
      !followUp.queues[kind].some((item) => item.lineKey === line.lineKey)
    )
      followUp.queues[kind].push(cloneFollowUpLine(line));
  }
  const discontinuedSkuIds = new Set(
    followUp.queues.discontinue.map((line) => line.skuId),
  );
  const displacedMarketing = followUp.queues.marketing.filter((line) =>
    discontinuedSkuIds.has(line.skuId),
  );
  for (const line of displacedMarketing) {
    if (
      !followUp.exclusionHistory.some((item) => item.lineKey === line.lineKey)
    )
      followUp.exclusionHistory.push({
        ...line,
        at: new Date().toISOString(),
      });
  }
  followUp.queues.marketing = followUp.queues.marketing.filter(
    (line) => !discontinuedSkuIds.has(line.skuId),
  );
  state.followUp = followUp;
  writeState(state);
  return structuredClone(followUp);
}

export function fixtureMarketingCandidates(
  payload: LogisticsReceiptsPayload,
  followUp: FixtureFollowUp,
) {
  const hidden = new Set([
    ...followUp.queues.marketing.map((line) => line.lineKey),
    ...followUp.exclusionHistory
      .filter((line) => !line.restoredAt)
      .map((line) => line.lineKey),
    ...followUp.proofs.flatMap((proof) => proof.sourceKeys),
  ]);
  const discontinuedSkuIds = new Set(
    followUp.queues.discontinue.map((line) => line.skuId),
  );
  return payload.board.lines.filter(
    (line) =>
      line.kind === "marketing" &&
      line.state === "ready" &&
      !hidden.has(line.lineKey) &&
      !discontinuedSkuIds.has(line.skuId),
  );
}

export function applyLogisticsFollowUpFixture(
  payload: LogisticsReceiptsPayload,
  input:
    | {
        action: "queueMarketing";
        lineKeys: string[];
        excludedLineKeys?: string[];
      }
    | { action: "excludeMarketing" | "restoreMarketing"; lineKeys: string[] }
    | { action: "generate"; kind: "marketing" | "discontinue" | "reorder" }
    | {
        action: "complete";
        kind: "marketing" | "discontinue" | "reorder";
        outputKey: string;
      },
): FixtureFollowUp {
  const state = readState();
  const followUp = createLogisticsFollowUpFixture(payload);
  const candidates = fixtureMarketingCandidates(payload, followUp);
  const findCandidate = (key: string) =>
    candidates.find((line) => line.lineKey === key);
  const now = new Date().toISOString();
  if (input.action === "queueMarketing") {
    for (const key of input.lineKeys) {
      const line = findCandidate(key);
      if (line) followUp.queues.marketing.push(cloneFollowUpLine(line));
    }
    for (const key of input.excludedLineKeys || []) {
      const line = findCandidate(key);
      if (line)
        followUp.exclusionHistory.push({
          ...cloneFollowUpLine(line),
          at: now,
        });
    }
  } else if (input.action === "excludeMarketing") {
    for (const key of input.lineKeys) {
      const line = followUp.queues.marketing.find(
        (item) => item.lineKey === key,
      );
      if (line) followUp.exclusionHistory.push({ ...line, at: now });
    }
    followUp.queues.marketing = followUp.queues.marketing.filter(
      (line) => !input.lineKeys.includes(line.lineKey),
    );
  } else if (input.action === "restoreMarketing") {
    for (const line of followUp.exclusionHistory)
      if (input.lineKeys.includes(line.lineKey) && !line.restoredAt)
        line.restoredAt = now;
  } else if (input.action === "generate") {
    followUp.proofs.push({
      kind: input.kind,
      outputKey: `fixture-${input.kind}-${Date.now()}-${followUp.proofs.length + 1}`,
      fileName: `개발용-${input.kind}-생성예시.xlsx`,
      at: now,
      sourceKeys: followUp.queues[input.kind].map((line) => line.lineKey),
      fixture: true,
    });
  } else if (input.action === "complete") {
    const proof = followUp.proofs.find(
      (item) => item.outputKey === input.outputKey && item.kind === input.kind,
    );
    if (proof) {
      proof.completedAt = now;
      followUp.queues[input.kind] = followUp.queues[input.kind].filter(
        (line) => !proof.sourceKeys.includes(line.lineKey),
      );
    }
  }
  state.followUp = followUp;
  writeState(state);
  return structuredClone(followUp);
}
