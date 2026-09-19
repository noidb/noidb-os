// Browser-test adapter: real reorder planning/routing with memory-only storage.
const { emptyWeeklyWorkspace } = require('../lib/wms/weekly-work-state.ts');
const { vendorReorderMaterial } = require('../lib/wms/vendor-order/reorder-material.ts');
const { moveWorkListItem } = require('../lib/wms/work-list-routing.ts');
const { applyPickingWaveStoreMutation } = require('../lib/wms/picking-wave/server-store.ts');
const { pendingReorderQueue } = require('../lib/wms/weekly-reorder-queue.ts');

module.exports = function createMemoryReorder({ getStore, setStore, listStatusRequests = async () => [] }) {
  let workspace = emptyWeeklyWorkspace();
  const receipts = getStore().vendorOrderLines.flatMap(line => (line.shipmentReceiptDetails || []).map(detail => ({ ...detail, productName: line.productName, barcode: line.barcode })));
  const numbers = [...new Set(receipts.map(row => row.shipmentNumber))];
  workspace.logisticsReceipts = {
    source: 'supplier-hub-shipments', schemaVersion: 2, collectedAt: new Date().toISOString(), requestedShipmentNumbers: numbers,
    shipments: numbers.map(shipmentNumber => {
      const lines = receipts.filter(row => row.shipmentNumber === shipmentNumber);
      return { shipmentNumber, status: '마감', totalDelivered: lines.reduce((sum, row) => sum + row.deliveredQuantity, 0), totalReceived: lines.reduce((sum, row) => sum + row.receivedQuantity, 0), lines };
    }),
  };
  const deps = {
    readWeeklyWorkspace: async () => structuredClone(workspace),
    mutateWeeklyWorkspace: async fn => { const next = structuredClone(workspace); const result = fn(next); next.revision++; workspace = next; return structuredClone(result); },
    listStatusRequests,
    readPickingWaveStore: async () => structuredClone(getStore()),
    mutatePickingWaveStore: async operation => { setStore(applyPickingWaveStoreMutation(getStore(), operation)); return structuredClone(getStore()); },
    transferWeeklyVendorQueue: async () => { throw new Error('Unexpected vendor queue transfer in reorder test'); },
  };
  return {
    preview(lineId) {
      const line = getStore().vendorOrderLines.find(row => row.id === lineId);
      const plan = vendorReorderMaterial(workspace, line);
      return { success: true, line, preview: { token: plan.token, skuId: line.skuId, productName: line.productName, linkedFromSku: plan.linkedFromSku, purchaseOrderNumbers: plan.purchaseOrderNumbers, quantity: plan.item.shortageQuantity, rows: plan.item.shortageDetails, sourceDate: plan.snapshot.createdAt } };
    },
    async move(body) {
      if (body.confirmed !== true) throw new Error('Reorder confirmation missing');
      const result = await moveWorkListItem('vendor', body.lineId, 'reorder', body.expectedUpdatedAt, deps, true, { token: body.token, purchaseOrderNumbers: body.purchaseOrderNumbers });
      return { success: true, ...result, line: getStore().vendorOrderLines.find(row => row.id === body.lineId) };
    },
    rows: () => pendingReorderQueue(workspace).rows,
  };
};
