# WMS 후속 개편: 실제 흐름과 검증 범위 (2026-09-05)

## 기준과 운영 확인

사용자의 0~54 개편 요청과 최종 10개 기준이 현재 계약이다. 과거 MASTER_PLAN/SPRINTS의 자동 외부신청, 피킹 후에만 서류 생성 규칙은 현재 요구를 대체하지 않는다.

Production GET `/api/wms/picking-waves` 읽기 전용 확인: 기존 WAVE-20260902-926d76fa 존재, 발주 33 / SKU 915 / 수량 979 / 센터 14 / 저장 generation 11. Wave.status=completed는 **피킹 완료**이지 출고작업 전체 완료가 아니다. 운영 데이터 수정·마이그레이션·파일 생성은 수행하지 않았다.

## 실제 데이터 흐름

| 영역 | 실제 경로 및 재사용 모듈 | 조사 결과 |
|---|---|---|
| 진입 | app/wms/work-center/page.tsx → ActiveWaveList, UpcomingInboundSummary, NewPurchaseOrdersUpdateButton | 기능메뉴 중심, 복잡한 거래처 입고 화면으로 바로 연결. 다음 할 일은 저장된 generation에 든 PO만 집계하여 아직 묶음이 없는 PO를 놓칠 수 있음 |
| 공용 작업/피킹 | picking-wave/context → SharedPickingWaveRepository → /api/wms/picking-waves → server-store | Blob 공용 스냅샷, 로컬 복구 미러. listWaves 후 각 listItems가 전체 스냅샷을 다시 읽음 |
| 발주 원본/버전 | import-latest-purchase-orders, supplier-hub-orders, purchase-order-source/index/parser | 기존 파서/인덱스를 유지. 최신 날짜 목록과 저장된 출고작업 조회는 분리 필요 |
| 서류 | complete/PoConfirmSection, HanjinStepSequence, HanjinUploadSection, HanjinAutoShipmentSection, ShipmentOutputSetSection | 생성기 재사용. 서류/피킹/실제 업로드는 서로 다른 상태 |
| 출력 | ShipmentOutputContext, shipment-print-client, shipment-output-files, buildBarTenderWorkbook | 확정된 Manifest 순서·전체 역순·구분행·영문숫자 모델 식별자·Excel 테이블 계약 보존 |
| 거래처 | picking page → vendor-order/derive-drafts/recalculate → shared repository → 공용 스냅샷 | 미처리 SKU 이동 누락, 수동/자동 중복 가능성, 상세 왕복 체크상태/삭제 이미지 fallback 결함 확인 |
| 단종/지연 | vendor-order-actions → Google Sheet 전용 이력탭 | 조회 함수에서 ensureHiddenSheet가 실행되는 숨은 쓰기 발견. 조회와 초기화 분리 필요 |
| 단종파일 | discontinue-files, discontinue-letter-client, data/discontinue-templates | XLSX 생성기 존재. PDF는 실제 샘플 보존이 아닌 Canvas 재작성으로 확인되어 샘플 일치 완료로 볼 수 없음 |
| 입고/쿠폰 | inbound-results, inbound-output-files, inbound-drive-sync 및 Apps Script | 계산 경로 두 벌 존재. confirmed || ordered가 확정 0을 원발주수량으로 바꾸는 오류. 미입고 C열 제품링크 요구 유지 |
| 폴더 | folder-connections, google-drive-oauth-reader/writer, google-drive-reader | Production은 Drive 연결 사용. G: 직접 읽기 가정 금지 |

## 이번 우선 구현

1. 기존 화면을 보존한 채 오늘 할 일 중심 첫 화면 병행. 공용 스냅샷 1회 읽기, 같은 출고작업의 서류/피킹/재출력 연결.
2. 날짜와 무관한 작업 표시, 출고 완료/보관은 피킹 상태와 별개인 선택적 표시 메타데이터. 기존 Wave/피킹/Shipment 재작성 금지.
3. 전체 Wave PO 집합을 분모로 다음 작업 계산. 출력파일 생성은 외부 업로드 완료로 간주하지 않음.
4. 선택 SKU 거래처 이동/이미지삭제/상세 왕복, 확정수량 0, 조회 중 숨은 쓰기 수정.

## 보호/검증

- 기존 데이터 삭제·초기화 없음. 새 표시 메타데이터는 사용자가 직접 선택할 때만 저장.
- fixture 검증과 읽기 전용 Production 확인 분리. mock API 성공을 실제 외부 업로드 성공으로 보고하지 않음.
- 단종 PDF 실제 샘플, 실제 양식 대조, 입고 셀별 dry-run, 전체 단계 운영 검증은 별도 완료 증거 필요.
- 수정 후 tsc → build → diff 순차 실행, PC 1920 및 모바일 360/390/412/430 검증 후 관련 파일만 배포.

## 원인과 이번 수정 연결

- 완료된 피킹 상태와 출고작업 전체 완료를 혼용하지 않도록 `outboundWorkStates`를 공용 스냅샷의 선택적 메타데이터로 분리했다. 생성·마이그레이션 없이 기존 Wave 그대로 표시하며, 사용자의 완료·보관 확인 시에만 이 메타데이터를 쓴다. 이전 화면의 `saveWave`도 이를 지우지 않는다.
- 새 `/api/wms/work-center`는 전체 스냅샷을 한 번 읽어 작은 요약만 전달한다. 날짜로 작업을 제외하지 않으며, 모든 원본 PO를 기준으로 남은 작업을 계산한다. 일부 PO만 처리된 이전 묶음을 잘못 추천하지 않는다.
- 기존 작업센터는 `?view=classic`으로 보존했다. 신규·미연결 발주 검토를 다시 열 수 있고, 기존 추가 편집기가 허용하지 않는 완료·보관 작업은 신규 PO 추가 대상으로 제안하지 않는다. 기존 작업에 이미 포함된 PO를 새 작업 대상으로 제안하지 않는다.
- 다음 작업 링크는 저장된 generation을 query로 명시하고 실제 카드 anchor로 이동한다. 없는 generation ID를 다른 묶음으로 조용히 바꾸지 않는다.
- `buildAutoShipmentFile`이 확정수량 대신 원발주수량을 다시 넣는 오류를 수정했다. 저장된 발주확정 기록의 정확한 파일명만 읽고, PO+SKU·원수량·바코드·센터·입고일을 대조한 뒤 확정 0개와 감소수량을 H/J열까지 보존한다. 정확한 파일이 없으면 전체 차단한다.
- 기존 전체 출력세트 경로도 `expectedWorkbookName`을 필수로 받고 정확한 파일명/PO 집합으로 연결한다. Drive의 중복 방지 `_02` 저장명은 실제 저장된 이름을 기록한다.
- 피킹에서 미처리 SKU는 부족수량 0이어서 기존 거래처 이동에서 누락됐다. 선택 SKU·부족수량 미리보기 후 해당 행만 저장하고 기존 초안에 연결한다. 재시도·수동 수정 수량·메모를 보존하며 거래처 화면 조회는 초안을 몰래 저장하거나 삭제하지 않는다.
- 상세 왕복은 체크 집합·SKU anchor·화면 내 위치를 저장하고 초기 lazy layout 안정화 후 같은 위치를 복원한다. 실측으로 확인한 7px 드리프트를 보정했고 사용자 입력 시 보정을 즉시 멈춘다. 이미지 연결이 빈 값이면 예전 Wave의 잘못된 이미지로 되돌리지 않는다.
- 단종/지연 이력 조회는 시트 생성/헤더쓰기와 분리했다. 빈 행을 제외해도 실제 Sheet 행번호를 보존하므로 완료 처리 대상 행이 어긋나지 않는다.
- TS 및 Apps Script 원본의 `확정수량 || 발주수량`을 빈 값 여부 검사로 바꿨다. **Apps Script 원본 수정은 Vercel 배포로 Google의 실행 코드에 반영되지 않는다.** 실제 Apps Script 배포는 별도 후속 작업이다.

## 실제 재사용 모듈

`readPickingWaveStore`, `mutatePickingWaveStore`, `summarizeShippingByDate`, `deriveVendorOrderDrafts`, `isSupersededOutputGeneration`, 기존 `saveProgress`, `buildSections`, `recalculateAutoVendorOrderLines`, `toVendorOrderQuantity`, `buildShipmentOutputContext`, `buildShipmentCreationUploadFile`, `parseTrackingRowsFromBuffer`, 기존 OOXML/XLSX 출력기 및 `ShipmentOutputContext`를 재사용했다. 바코드 생성기/Manifest 정렬 formatter는 바꾸지 않았다.

## 운영 파일과 fixture 확인 구분

- G드라이브 발주서업로드완성의 실제 XLSX 3개(10/19/33 PO)는 읽기 전용 파서 확인을 통과했다. Production 기록의 33건 파일명(`20260902_153810`)과 로컬 목록의 33건 파일명(`20260902_023921`)은 다르다. 연결된 Google Drive에서도 정확한 이름 조회와 `PO_FOR_CONFIRM` 범위 검색을 수행했으며, 접근 가능한 결과에는 기록된 이름이 없고 `023921` 파일만 확인됐다. 이름이 다르다는 이유로 최신 파일을 대체 연결하지 않았다. 해당 기존 작업에서 새 Shipment를 생성하려면 확정파일 연결 복구/재생성 확인이 남아 있으며, 운영 연결 기록을 임의 수정하지 않았다.
- fixture는 취소 SKU=0, 원발주 12개 중 확정 4개를 실제 Shipment 템플릿으로 메모리에서 생성·재파싱하여 H/J열을 확인한다. 운영 출고파일 생성·저장·인쇄는 하지 않는다.
- 작업센터 360/390/412/430/1920px, 다음 버튼 상단 노출, 신규 PO 상세 기본 접힘, 보관 취소/저장/복원, 재접속을 mock으로 검증했다.
- 출고작업→서류의 실제 링크를 클릭하는 추가 fixture에서 초기 스크롤 복원이 hash 이동을 덮는 문제와 비동기 카드 확장 문제를 발견·수정했다. 390/1920px 6개 경로에서 과거 묶음 1/2 정확 선택, 단계 3/4 실행버튼 노출, 없는 묶음 Preview/실행 0, 뒤로가기 작업센터 scrollY 300 복원을 확인했다. 딥링크 진입 뒤 사용자가 다른 묶음을 클릭해도 Preview의 PO 집합과 선택 저장이 정확히 전환된다.
- 피킹 fixture 45 SKU: 선택 취소 쓰기 0, 선택 SKU 1종만 부족 3개 반영, 재시도 중복 0, 체크 2개와 scrollY 2412/anchor offset 140.171875 복원, 발주수량 17과 메모 보존, 전송완료 별도 모바일 context 공유를 확인했다. 실제 카카오톡 메시지를 발송하지 않았다.

## 아직 완료로 보고할 수 없는 범위

1. 단종 PDF를 실제 샘플 레이아웃으로 보존하는 생성기, 완료 상태에서도 재생성, 단종해제 이메일 완료 UX.
2. 입고파일 hash/PO별 증분 중복 방지, 적용 전 셀별 dry-run·백업·충돌 재검사, 실제 Apps Script 안전 배포.
3. 쿠폰/미입고 Drive 자동저장·동일 날짜 버전명·전체 날짜/생성이력, 실제 양식 전체 보존 검증.
4. 거래처 입고지연 표시의 피킹 연결, 거래처 변경 즉시 초안 이동, 후순위 간단 입고/부가세 원가 확인.
5. 서류 묶음의 운영 파일 전체 end-to-end, 실제 외부 업로드 및 물리적 모바일 기기 테스트. 반응형 브라우저 검증과 구분한다.

이 문서는 0~54 전체 완료 선언이 아니다. 배포 직전 tsc/build/diff와 배포 후 읽기 전용 확인 결과는 해당 배포 결과 보고서에 기록한다.
