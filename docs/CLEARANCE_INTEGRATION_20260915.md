# NOID-B 과거청산 코드 복구·통합 결과

작성일: 2026-09-15. 이번 단계는 격리된 코드 통합과 로컬·모의·운영 읽기 전용 검증이다.
**운영 배포 및 실제 과거청산 처리는 아직 완료하지 않았다.**

## 작업 위치와 보존

- 작업 폴더: `E:\노이드비AI\.tmp\clearance-lifecycle-20260915`
- branch: `codex/clearance-lifecycle-20260915`
- 시작 commit: `fb9d20bae23380b95a4c98957f20a7be60e0e417` (확인한 origin/main)
- 기존 루트 main: `6881685e877a0c1a1b07dc92d70b93a6a0cbc663`, 기존 수정 91개·미추적 상태 항목 153개 유지.
- 최초 복구 명세의 원본 63개 항목 SHA256 재대조 결과 변경 0개. 기존 inbound 원본도 수정하지 않았다.
- 사용자 승인으로 새 worktree만 생성했다. commit, main 반영, push, 배포, 운영 데이터 쓰기, 외부 전송은 실행하지 않았다.
- Supplier Hub 확장프로그램·신규발주 자동수집 연구는 수정하지 않았다.

## 복구 원본과 범위

기준 문서: `NOID-B_workflow_recovery_report_20260915.md` 및 최신 사용자 첨부 요청.

1. `E:\노이드비AI`에 보존된 현행 화면·입고 저장본·OAuth·기존 출고 수정분을 파일별로 가져왔다. 정상 Shipment/피킹/서류 생성 흐름은 재작성하지 않았다.
2. `E:\노이드비AI\.worktrees\inbound` (HEAD `392ee5d`, 미커밋 작업 포함)에서 거래처 통합 편집기, 전송 후 결과 처리, 단종 서류, queue/completion/reorder/delay API 및 필요한 도우미만 복구했다. branch 전체 병합·폴더 전체 복사는 하지 않았다.
3. 기존 복구 이력의 `23ed4d1` 누적조회, `5a13e3d` 저장 발주, `f4e6e57` 완료 제외, `f836517` 표시 순번, `0e2bbbe` 새 초안 구현을 현행/복구 소스와 연결했다. 이 커밋들을 통째로 cherry-pick하지 않았다.
4. 쿠폰·광고·재발주·단종 원본 서식 6개를 개별 복구했다.

주요 파일:

| 영역 | 파일 |
| --- | --- |
| 배포 제외 오류 | `.gitignore`, `.vercelignore` |
| 거래처 편집/전송 결과 | `app/wms/picking/waves/[waveId]/vendor-orders/VendorOrderEditor.tsx` 및 기존 버튼들, `app/wms/vendor-orders/receiving/page.tsx` |
| 최초 미납 분류 | `app/api/wms/vendor-orders/actual-inbound-shortage/route.ts`, `lib/wms/actual-inbound-classification.ts`, `ActualInboundShortage.tsx` |
| 완료 판정/업무 소유권 | `lib/wms/inbound-lifecycle.ts`, `lib/wms/supplier-hub-active-orders.ts` |
| 저장본 조회/명시적 갱신 | `lib/wms/saved-inbound-history.ts`, `lib/wms/supplier-hub-orders.ts`, supplier-hub-orders API |
| 최종 결과 조회 | `app/wms/inbound/cumulative/page.tsx` |
| 청산 현황 | `lib/wms/clearance-status.ts`, clearance-status API, `ClearanceOverview.tsx` |
| 동시 수정/재시도 | vendor-order repository/consolidate/sent-vendor-transfer, shared-store mutation 검증 |

초기 원본 해시는 `.audit/restoration-manifest.json`, 최종 소스 파일 해시는 `.audit/final-file-manifest.json`에 보존했다. 문서 추가 전 변경 소스/서식/검증 파일은 94개이다. 운영 읽기 자료 및 로컬 로그가 있는 `.audit`는 Git과 Vercel에서 제외된다.

## 연결한 업무 규칙

- 최초 실제미납은 원발주번호+SKU별 거래처/단종/쿠팡 재발주/입고지연으로 분류한다.
- 기존 주간 처리 저장소에 먼저 이동 의도를 기록하고 대상 대기 목록 연결을 확인한다. 도중 실패는 재시도 상태로 남으며 동일 목적지 재시도가 중복을 만들지 않는다.
- 기존 목적지가 있는 항목은 최초 분류 목록에서 제외한다. 서로 다른 목적지가 겹치면 확인 대상으로 남긴다.
- 같은 SKU라도 원발주별 확정수량·실제입고·미납 근거를 별도로 보존한다. 동일 거래처 라인에 합칠 때 신규 원발주의 부족수량만 더한다.
- 전송완료 원본은 보존하고 기존 `transferSentVendorLine` 및 operationId를 사용한다. 대상 거래처의 전송 전 초안을 재사용하거나 새 초안을 만든다.
- 전송 후 정상입고는 기존 쿠팡 미납 재발주 대기로 연결한다. 지연은 근거와 원발주를 유지하며 이후 최종 분류로 이동한다.
- 최초 지연 후 실제 입고가 완료된 경우에도 확인 버튼을 거쳐 지연을 종료한다. 수량이 부족하면 종료를 거부한다.
- 파일 다운로드만으로 쿠팡 업로드·카카오 전송 완료를 기록하지 않는다. 기존 명시적 완료 절차와 근거를 사용한다.
- 단순 부족수량 0으로 발주를 종료하지 않는다. 정산·이벤트 근거, 쿠폰 처리, 대기 목적지, 원발주별 외부 처리 근거를 확인하고 모든 SKU가 끝난 발주만 active에서 제외한다.
- 제품DB의 SKU 단종 표시만으로 다른 원발주까지 완료시키지 않는다. 업로드 근거가 없는 항목은 단종 대기에 연결해 확인할 수 있다.
- 최종 결과는 원발주/SKU/상품명/확정수량/실제입고/최초미납/분류/상태/완료일/입고예정일/거래처/이동·완료 근거를 표시한다. 기존 월별 누적조회와 연·월·상품명·SKU 검색을 유지한다.
- 일반 발주·누적 조회는 저장본을 사용한다. 사용자가 최신 원본 또는 과거 원본 새로고침을 눌렀을 때만 해당 원본 수집을 실행한다. 기존 정상 발주 생성 호출의 기본 동작은 유지한다.
- Drive 조회 실패 시 기존 저장본을 유지하고 실패를 알린다. 갱신 실패 자료로 정상 저장본을 덮어쓰지 않는다.

## 운영 읽기 자료 재검증

운영 API GET 응답을 로컬 메모리에서 계산했다. 운영 데이터 쓰기는 0회이다.
입고 저장소 revision 1163, updatedAt `2026-09-15T03:25:58.692Z`; 주간 저장소 revision 341.

| 항목 | 결과 |
| --- | --- |
| 실제미납 원발생 | 146건 / 180개 |
| 재발주 완료 제외 | 40건 / 50개 → 잔여 106건 / 130개 |
| 제품DB 단종 제외 | 26건 / 30개 → 잔여 80건 / 100개 |
| 추가 단종 근거 제외 | 10건 / 10개 → 기존 운영 pending 70건 / 90개 |
| 이미 목적지가 있는 미납 제외 후 최초 미분류 | 44건 / 53개 |
| 입고 이벤트 / 고유 이벤트 / status | 912 / 912 / 82 |
| 계산불가 / 중복 목적지 충돌 | 0 / 0 |
| 쿠폰·광고 미완료 후보 | 29 SKU, 현재 파일 선택 18 SKU |
| 단종 대기 | 3건, 그중 2건 원발주번호 누락 |
| 쿠팡 미납 재발주 대기 | 0건 |
| 미전송 거래처 발주 | 4장 / 25라인 |
| 전송 후 결과 대기 | 9장 / 52라인: 미분류 40, 입고지연 12 |
| 보관 원발주 / 새 판정의 완료 원발주 | 126 / 27 (로컬 투영이며 운영 반영 전) |

기준 보고서의 pending 87건/107개와 이번 70건/90개의 차이는 제품DB 단종 제외 대상이 9건/13개에서 26건/30개로 늘어난 17건/17개이다. 기존 수치를 맞추려고 데이터를 변경하지 않았다. 각 건수는 서로 다른 단위이므로 합산하지 않는다. 최초 목록에서 제외되었다는 것과 최종 업로드 완료는 구분한다.

## 검증 결과와 한계

- `npx tsc --noEmit` 통과.
- `npm run build` 통과. API output 경로 포함 확인.
- `git diff --check` 통과.
- 기존 검증: sent-order-resolution, work-list-routing, vendor-queue, vendor-queue-conflicts, weekly-discontinue-submit, supplier-hub-snapshot-selection 통과.
- 추가 검증: clearance-lifecycle, clearance-api 통과. 동일 SKU 다른 원발주·부분입고·중복 이벤트·분류 재시도·전송 원본·목적지 변경·단종/재발주/쿠폰 파일·완료 전 차단·지연 해제·전체 SKU 종료를 검증했다.
- 실제 API handler를 메모리 저장소에 연결하고 외부 fetch를 차단해 저장본 GET 반복, 원본 장애 fallback, 지연 처리, 완료 조건을 검증했다.
- Edge/Playwright 390px·1440px: 4분류, 지연 저장 후 재조회, 하단 4개 메뉴, 전송 결과 편집기, 누적 검색/완료근거 표시 통과. 업무 API는 모의 응답, 외부 이미지 요청은 차단했다.
- 실제 로컬 빌드의 `/api/wms/weekly-work/output` GET은 405(POST 전용)이며 기존 누락 시의 404가 아니다. 파일 생성 함수의 ZIP/XLSX/PDF도 별도 검증했다.
- 실제 외부 쿠팡 업로드, 카카오 전송, 물류 입출고, 운영 배포 검증은 이번에 수행하지 않았다. 모의 완료 기록을 실제 운영 완료라고 보고하지 않는다.

## 운영 반영 전에 알아야 할 잔여 사항

1. 단종 대기 중 원발주번호가 없는 기존 2건은 확인이 필요하다. 원발주를 임의 추정해 완료 처리하지 않는다.
   - `status-20260910075922517-uephfov`
   - `status-20260910161440422-uc7e1d4`
2. 과거 원본 전체의 새 저장 컬렉션은 아직 운영에 생성하지 않았다. 승인 후 배포되면 누적 화면의 **과거 원본 새로고침**을 한 번 실행해야 한다. 그 전에는 저장된 Supplier Hub 912행을 사용할 수 있고, 과거 원본 저장본 부재를 화면에 알린다.
3. 29개 쿠폰 후보의 선택 해제만으로 완료 처리하지 않는다. 파일 생성과 실제 적용 확인을 마쳐야 한다.
4. 이번 복구는 실제 과거청산을 대신 수행하지 않았다. 미분류·파일 업로드·거래처 전송 및 결과 처리가 남아 있다. 모두 처리하고 기다리기로 한 입고지연만 남은 뒤 신규발주 업무 기준선을 설정한다.
5. 운영 주소와 배포는 그대로이다. 승인 후 변경 파일 재확인 → 범위별 commit → main 안전 반영 → push → Production 배포 → 운영 검증 순서로 진행한다.
