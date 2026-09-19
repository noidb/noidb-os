import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "개발 미리보기에서만 사용할 수 있습니다." }, { status: 404 });
  const orders = Array.from({ length: 20 }, (_, index) => {
    const number = String(910000001 + index);
    const date = index < 10 ? "2026-09-22" : "2026-09-23";
    const center = index % 3 === 0 ? "덕평 FC" : index % 3 === 1 ? "동탄 FC" : "인천 FC";
    return {
      purchaseOrderNumber: number, orderType: "테스트", fulfillmentCenter: center,
      fulfillmentAddress: `${center} 테스트 주소`, fulfillmentContactPhone: "010-0000-0000", expectedDate: date,
      accountName: "NOID-B 테스트", sourceFileName: "개발용_물류흐름_20건", capturedAt: "2026-09-20T00:00:00.000Z",
      items: [{ lineNo: 1, productCode: `TEST-SKU-${index + 1}`, productName: `테스트 상품 ${index + 1}`, barcode: `880000000${String(index + 1).padStart(3, "0")}`, purchaseType: "직매입", taxType: "과세", orderedQuantity: index % 4 + 1, vendorConfirmedQuantity: index % 4 + 1, receivedQuantity: 0 }],
    };
  });
  return NextResponse.json({ orders, fixture: true });
}
