export interface WaveCreationRequestBudget {
  apiMutations: number;
  blobGets: number;
  blobHeads: number;
  blobWrites: number;
  conditionalWrites: number;
  totalBlobRequests: number;
}

/** 5fd3f80의 saveWave + SKU별 saveItem + PO별 saveBasket 구조를 계측한 공식. */
export function legacyWaveCreationRequestBudget(poCount: number, skuCount: number): WaveCreationRequestBudget {
  const mutations = 1 + Math.max(0, poCount) + Math.max(0, skuCount);
  return { apiMutations: mutations, blobGets: mutations, blobHeads: mutations, blobWrites: mutations, conditionalWrites: mutations, totalBlobRequests: mutations * 3 };
}

/** createWaveBatch 1회, GET의 ETag를 바로 conditional PUT에 사용한다. */
export function batchWaveCreationRequestBudget(): WaveCreationRequestBudget {
  return { apiMutations: 1, blobGets: 1, blobHeads: 0, blobWrites: 1, conditionalWrites: 1, totalBlobRequests: 2 };
}
