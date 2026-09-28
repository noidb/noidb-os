# Codex 인수인계 — 제품DB 옵션ID/링크/이미지/가격/재고 수집 (2026-09-23 완료, 2026-09-28 정리)

## 결론
제품DB(구글시트)의 대상 R바코드 행 2,517건에 대해 쿠팡 광고센터 SKU 검색 API로 6개 필드를 수집해 시트에 반영을 끝냈다. 이 작업은 종료 상태이며 재개할 것이 없다.

반영한 필드: 옵션ID, 노출상품ID, 제품링크, 이미지(`=IMAGE(url,4,80,80)`), 쿠팡 판매가, 현재고.
SKU ID와 바코드는 건드리지 않았다.

## 검증 상태
- 시트 전체(2,734행)를 스캔해 "옵션ID는 있는데 이미지가 없는 행"을 확인했고, 25건을 재수집해 채운 뒤 0건이 됐다.
- 마지막 확인 시점(2026-09-23)의 시트 기준이며, 이후 시트가 바뀌었는지는 재확인하지 않았다.

## 남아 있는 문제
- 쿠팡 API에서 상품을 찾지 못한 SKU(삭제/비활성 추정)는 반영하지 못했다. 옵션ID 등이 비어 있을 수 있다.
  - 기록된 sheetRow: 865, 866, 873, 875, 882 / 1121, 1122, 1144, 1146, 1148, 1150 / 1486, 1561, 1563, 1564, 1566
  - 그 외 회차(1657 부근, 2130대 등)에도 스킵이 있었으나 sheetRow를 다 기록하지는 못했다. 필요하면 시트에서 "SKU ID는 있고 옵션ID가 빈 행"으로 다시 뽑는 것이 정확하다.
- 판매중지/가품 제외 대상이라 원래 목록에 없던 행은 손대지 않았다.

## 정리된 것 / 안 된 것
- 삭제함: 인증 없이 시트에 쓰던 임시 라우트 `app/api/tmp-apply-optionid/`, `staging/target-chunks2~4/`, `staging/optionid-batches/`, `staging/target-slim2.json`.
- 커밋/푸시는 하지 않았다. 브랜치는 `codex/current-logistics-flow`.
- 아래는 이번 작업과 무관한 기존 미추적 파일이라 그대로 뒀다: `.codex-backup-*`, `scripts/*test-stage-orders.ts`, `staging/*.xlsx`, `templates/*.gs`, `docs/HANDOFF_20260923.md`, `docs/HANDOFF_OPTIONID_COLLECTION_20260923.md`.

## 다시 수집해야 할 때 참고
- 수집 API: `GET https://advertising.coupang.com/marketing/cmg-api/vendoritems?page=1&size=1&keyword={SKU ID}&searchBy=sku` (광고센터 탭에서 로그인된 상태로 fetch, 요청 간격 800ms).
- 응답 필드: `vendoritemid`(옵션ID), `productid`(노출상품ID), `itemid`, `sales_price`, `stockQuantity`, `mainImagePath`.
- 이미지 URL: `https://image6.coupangcdn.com/image/{mainImagePath}`
- 제품링크: `https://www.coupang.com/vp/products/{노출상품ID}?itemId={itemId}&vendorItemId={옵션ID}`
- 쓰기 전에 시트의 해당 행 SKU ID가 요청 SKU와 일치하는지 반드시 확인한다(불일치면 건너뜀).
- 노출상품ID는 옵션 여러 개가 공유하므로 고유키로 쓰면 안 된다. SKU ID·바코드·옵션ID는 고유키라 지우거나 덮어쓰지 않는다(옵션ID 보정은 사용자 지시가 있을 때만).

## 겪은 함정
- 브라우저 탭에서 `Failed to fetch`가 반복됐다. 페이지를 새로고침하면 복구됐다.
- 브라우저 도구 출력이 약 6행 단위로 잘려 큰 결과를 한 번에 못 꺼냈다. 작은 조각으로 나눠 꺼내야 한다.
- 브라우저에서 만든 문자열에 `?itemId=...&vendorItemId=...` 같은 쿼리스트링이 있으면 출력이 차단되므로, 링크는 숫자만 넘기고 서버 쪽에서 조립했다.
- 개발 서버 실행 중에는 `npm run build`를 돌리지 않는다(CLAUDE.md 규칙).
