# 상품 카탈로그·재등록 작업 인수인계

작성일: 2026-09-21  
작업 폴더: `E:\노이드비AI`  
브랜치: `codex/current-logistics-flow`  
HEAD: `267943d docs: add first office handoff command`

## 1. 사용자 목표

- 상품 재등록 목록에서 모델명과 옵션별 식별자를 분리해 검토한다.
- 모델명으로 사진을 검색하되, 현재·과거 SKU ID도 보조 검색어로 사용한다.
- 한 옵션만 판매중지여도 모델 전체를 재등록 후보로 표시한다.
- 상품명(옵션 제외), 모델SKU, SKU ID, 바코드, 색상·사이즈, 누적입고, 발주가능상태를 확인한다.
- 분석용 사진은 1장만 사용하고, 선택한 전체 사진은 쿠팡 등록 이미지 풀에서 사용자가 슬롯을 직접 배치한다.
- 장기적으로 제품 정보·SKU ID·옵션 ID·제품 링크·모델명 등을 하나의 관리용 Google Sheets 파일에서 관리한다.

## 2. 현재 코드 변경 상태

수정됐지만 아직 커밋하지 않은 파일:

- `app/wms/product-catalog/page.tsx`
  - 모델명 기준으로 재등록 그룹을 만들고 옵션 행은 별도 표시
  - 누적입고 내림차순 정렬
  - 상품명 표시
  - 모델SKU·SKU ID·바코드·옵션·발주가능상태 표시
  - 누적입고 조회 실패 시 임의의 월별 값으로 대체하지 않고 `미확인` 표시
  - 모델명과 현재·과거 SKU ID를 사진 검색어로 사용
- `app/page.tsx`
  - 첫 사진은 AI 분석용
  - 선택한 전체 사진은 쿠팡 등록 이미지 업로드 풀에 전달
  - 슬롯 자동 배치하지 않고 사용자가 직접 배치
- `lib/image-search/browser-folder.ts`
  - 하위 폴더까지 재귀 검색
  - 모델명 우선, SKU ID 보조 검색
  - 검색 결과에 `matchedBy` 표시
  - 폴더 미선택·권한 오류를 추측으로 우회하지 않음

현재 미커밋 변경은 위 3개 파일 외에도 기존 사용자 파일이 있을 수 있으므로, 커밋 전 `git status --short`를 다시 확인한다. 기존 `.codex-backup-20260915_231924/`, `scripts/remove-test-stage-orders.ts`, `scripts/seed-test-stage-orders.ts`는 삭제하지 않는다.

## 3. 확인된 검증

- `node node_modules/typescript/bin/tsc --noEmit --incremental false` 통과
- `git diff --check` 통과
- 로컬 `http://localhost:3001/wms/product-catalog`에서 `wn011918` 확인
- 재등록 후보 3개 옵션이 별도 행으로 표시됨
- 확인된 예시:
  - `wn011918GO` / SKU `39606837` / 누적입고 80개 / 발주가능 불가
  - `wn011918RG` / SKU `39606838` / 누적입고 138개 / 발주가능 불가
  - `wn011918SI` / SKU `39606840` / 누적입고 70개 / 발주가능 불가
- `등록 준비` 후 `/?reregisterModel=wn011918`으로 이동하고, 분석 사진 1장·전체 사진 업로드 풀 안내 문구 확인
- 실제 사진 폴더 선택과 사진 검색 결과는 아직 완료하지 않음

## 4. Google Sheets 상태

### 현재 WMS 직접 연결

- 파일명: `노이드비 상품DB`
- Spreadsheet ID: `15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA`
- 주 탭: `제품DB`
- 보조 탭: `_SKU마스터`, `_입고요약`, `_발주이력`, `_SKU교체이력` 등
- 로컬 `/api/wms/product-registration-catalog`은 `configured: true`, 약 2,667개 항목 반환

### 별도 확인된 파일

- `★노이드비 상품관리`
- Spreadsheet ID: `1JXU_bWin6ltv91KAgoEgpCR23Wy4Chy0dhJ9Tq1fbH0`
- `제품DB`, `★로켓리스트`, `전수조사`, `이미지수정` 등 별도 탭 존재

### 현재 미확인

- 운영 Apps Script의 실제 배포 URL·버전·대상 스프레드시트
- 로컬 `.env.local`에 `GOOGLE_SHEETS_WEB_APP_URL`이 없어 `/api/google-sheet`는 비활성
- 위 두 Google Sheets 중 어느 쪽이 운영 Apps Script의 기준인지

## 5. Excel 통합 파일 점검 결과

파일: `G:\내 드라이브\쿠팡데이터\SKU_ID_상품명_기준_통합정리.xlsx`

주요 탭:

- `01_마스터`: 2,800행
- `02_물류전용`: 3,718행
- `03_불일치검증`: 현재 불일치 146건
- `00_통합데이터`: 수식 기반 통합 영역, 직접 수정 금지
- `99_원본_보관`: 원본 보관 영역, 보기 전용

`01_마스터` 품질 점검:

- SKU ID 공란 0건, 중복 키 9개
- 모델명 공란 137건
- 모델SKU 공란 439건, 중복 키 43개
- 옵션 ID 공란 37건, 중복 키 29개
- 제품 링크 공란 24건
- 바코드 공란 0건

중요한 식별 기준:

1. SKU ID exact match
2. 모델SKU는 옵션 수준 보조 식별자
3. 옵션 ID와 바코드는 독립적으로 검증
4. 모델명은 검색·그룹·표시용이며 병합 키로 사용하지 않음
5. 패키지·세트·랜덤 행은 일반 재등록 후보와 분리

## 6. 다음 최소 작업

1. 운영 시트를 덮어쓰지 않고 Excel을 검토용 staging Google Sheet로 가져올지 사용자 승인 받기
2. SKU ID·옵션 ID·바코드 기준으로 기존 운영 시트와 비교
3. 중복·불일치를 `정리검토` 탭에 모으고 원본 탭은 보존
4. 사용자가 검토·수정한 뒤 기준 파일을 하나로 확정
5. Apps Script의 실제 배포 버전과 기준 파일을 연결
6. 이후에만 운영 배포 및 쿠팡 제출 검토

## 7. 절대 금지 사항

- 사용자 승인 전 Google Sheets 쓰기
- Apps Script 배포
- 쿠팡 제출
- `reset`, `clean`, `stash`, 삭제, 덮어쓰기
- 새 worktree 생성
- 모델명만으로 SKU·옵션 행 병합

## 8. 새 채팅 시작용 요청문

> `E:\노이드비AI\docs\HANDOFF_PRODUCT_CATALOG_20260921.md`를 먼저 읽어라. 기존 변경과 운영 데이터는 보존하고, 새 worktree·reset·clean·stash·삭제·덮어쓰기를 하지 마라. 먼저 현재 git 상태와 문서의 미확인 항목을 읽기 전용으로 재확인하라. 그 다음 사진 폴더 검색 흐름과 Google Sheets 통합 staging 계획을 검토하되, 내 명시적 승인 전에는 Google Sheets 쓰기·Apps Script 배포·쿠팡 제출을 하지 마라. 기획·식별 기준 검토는 Astra, 단순 구현은 Terra 또는 Luna를 사용하고, 결과를 `확인됨 / 미확인 / 막힌 이유 / 다음 최소 작업`으로 보고하라.
