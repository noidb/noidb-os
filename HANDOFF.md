# NOID-B 통합 후보 인수인계

- 후보 경로: `E:\노이드비AI\.tmp\unified-final`
- 기준 Production commit: `4f4edd27bfcc1fe4e412a6fd4a50ccc14d4df2c6`
- branch: `codex/unified-final-20260914`
- 상태: 미커밋 후보본. 원본 worktree와 main은 수정하지 않음.

## 통합 완료

- Production actual-inbound-shortage 화면/API와 Supplier Hub status·inbound event 계약 보존
- inbound WeeklyWork 화면/API/helper 및 WeeklyWorkspace 의존성 추가
- `/wms/inbound/weekly`에 WeeklyWork route 연결
- 거래처 queue·입고·재발주·삭제·복원에 필요한 store/type/helper 계약을 additive 통합
- 기존 Production picking wave·PO confirmation·warehouse 계약 보존
- outbound의 Shipment·출고·피킹·한진 업로드·재출력 관련 기능을 공통 계약 충돌을 피하는 범위에서 통합
- product의 WIMS 등록·감사·상품 DB·엑셀 연동 관련 기능을 통합

## 별도 분류

- outbound: `tmp/deploy-2bb40f6`의 기능 단위 변경을 통합했으며 vendor/inbound 공통 파일은 후보의 최신 계약을 유지
- product: 기준 branch 이후 WIMS 등록·상품 DB·엑셀 연동 변경을 통합
- image: `image-search`는 POC로 분류하여 통합하지 않음. 이미지 생성 실행도 하지 않음
- Claude auth: login/logout/session 변경은 기존 Production 인증 흐름과 연결되지 않은 별도 초안이므로 통합하지 않고 원본 보존
- Supplier Hub extension: POC/미완료 확장프로그램으로 통합하지 않고 원본 보존
- `minimal-inbound-completion`: actual-shortage를 되돌리는 구형 후보라 통합하지 않음
- 기타 tmp/deploy: 고유 기능이 없거나 후보와 충돌하는 배포 산출물이라 통합하지 않음

## 검증

- `npx tsc --noEmit`: 통과
- `git diff --check`: 통과(개행 변환 경고만 있음)
- 충돌 마커: 0개
- `npx tsc --noEmit`: 통과
- `git diff --check`: 통과. LF/CRLF 변환 경고만 있음
- 읽기 전용 smoke: `/wms/inbound`, `/wms/inbound/weekly`, weekly-work/actual-shortage/Supplier Hub API, 거래처발주·입고·재발주대기·피킹·Shipment는 200 응답 또는 정상 컴파일. 실제 상품 API `/api/wms/product-catalog`는 200. `/wms/product-registration`·`/login`은 후보에 route가 없어 404
- Production 데이터 쓰기·삭제·초기화·배포: 하지 않음
