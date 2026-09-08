# AI 상품 재등록 / 견적서 / 검수상태 수정

## 사용자 요청과 완료 범위

판매중지된 동일 모델을 재등록하면 기존 옵션 행을 맨 위로 이동하고 새 입력값만 반영한다. 기존 누적입고, 현재고, 창고 정보, 수식, 사용자 추가열은 보존한다. 기존 SKU ID, 바코드, 발주가능상태, 제품링크, 노출상품ID, 옵션ID는 새 입력값과 관계없이 비우고 새 승인 결과를 연결한다. 견적서 모델명/품번은 입력한 모델명을 사용한다.

## 확인한 원인

- 견적서: 2026-08-21 커밋 `89233c4` (`feat: include model SKU in quote options`)에서 모델명/품번의 `payload.model`을 `sku.sku`로 변경한 회귀. 해당 칸을 원래 매핑으로 복구했다. 옵션별 모델SKU는 색상/상품명/이미지 파일명에 유지한다.
- 재등록: UI의 기존 모델 일괄저장 차단 및 API의 `skipDuplicate` 강제 때문에 판매중지도 차단됐다. 기존 갱신 함수는 SKU/바코드를 보호하고 제자리 갱신하므로 요구사항과 달랐다.
- 상태: WIMS 검수중은 화면 분류만 하고 제품DB에는 쓰지 않았다. 검수상태 반영 버튼과 승인대기 전환을 추가했다.

## 최종 동작

1. 신규 모델은 기존 신규등록 절차를 유지한다. 기존 상품 일괄 이전의 `skipDuplicate`도 유지한다.
2. 기존 모델은 판매중지된 기본 옵션의 정확한 동일 모델만 재등록을 허용한다. 다중 옵션은 모델SKU로 각각 1행에 대응해야 한다. 단일 구형 모델은 기존행 1개/입력옵션 1개이고 다른 모델과 SKU 충돌이 없을 때 새 모델SKU로 갱신할 수 있다.
3. 실제 시트의 열 이름으로 좌표를 찾는다. 재등록 및 중복확인 때문에 전체 시트 열을 재배열하지 않는다.
4. 기존 행의 입력된 상품 필드만 갱신한다. 공백 가격은 유지하고 명시적 0은 반영한다. 실제 원가/판매가 헤더 별칭을 지원하며 중복 의미 열은 변경 전 차단한다. 운영 열, 미입력 정보, 추가열, 행 서식은 보존한다. 새 이미지 업로드가 없는 옵션은 파일명이 생성되어도 기존 IMAGE 수식을 유지한다.
5. 기존 SKU ID/바코드/발주가능상태/제품링크/노출상품ID/옵션ID 6개 초기화, 현재상태 `재등록파일생성`, 전체 행 이동, 이전 SKU 이력 기록을 Sheets batchUpdate 하나로 처리한다. 원본 시트 백업 및 반영 후 검증을 수행한다.
6. 같은 작업번호는 중복 적용하지 않는다. 위 6개 필드가 모두 공란인 `재등록파일생성`은 파일 저장 실패 후 재시도가 가능하다. 재등록 이미지 업로드가 실패해도 기존 Drive 이미지는 삭제하지 않는다.
7. WIMS에서 실제 검수중 확인 후 `검수상태 N건 반영`을 누르면 신규는 `신상승인대기`, 재등록은 `기존상품승인대기`. 검수완료는 새 SKU/바코드/상품명과 `완료`를 반영한다. 이전 SKU, 충돌, 여러 등록 후보는 차단한다.

## 오늘 실제 제품DB 정리 완료

- 스프레드시트: `15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA`, 제품DB sheetId `1195273007`.
- 유지: 2행 `wn00272` / `wn00272-SI` / 써지컬스틸 드로잉양면 엘리자베스코인 롱목걸이.
- 삭제: 정리 전 1937행, 모델/모델SKU를 `재등록`으로 바꾼 판매중지 행. 기존 SKU `38256597`, 바코드 `R016030940070`.
- 빈칸 9개를 우선 복원한 뒤, 추가 요청에 따라 제품링크/노출상품ID는 다시 비웠다. 최종 유지한 복원 항목 7개: 창고번호, 최근입고일, 이전/최근 쿠팡공급가, 공급가차이/확인, 이전창고번호.
- 누적입고는 신규 기본값 0에서 기존 293으로 복원. 새 상품명/모델명/이미지/가격은 유지.
- SKU ID/바코드/발주가능상태/제품링크/노출상품ID/옵션ID 6개 공란 재확인. 기존 SKU가 제품DB에 남지 않았고 같은 상품은 1행임을 재조회했다.
- 백업: `_백업_재등록정리_20260908_wn00272` (sheetId `1609081902`). `_SKU교체이력`에 원본 및 새행 스냅샷과 `재등록중복정리` 기록 보관.
- 사용자가 최종 제출 후 `검수중`임을 확인하여 A2를 `기존상품승인대기`로 변경했다. 다른 35열 보존을 재조회했다. 이후 추가 요청된 R2/AF2/AG2 초기화에서도 전체 36열 비교로 다른 값 보존을 확인했다.
- 초기 정리 증거: `outputs/registration-fix-20260908/live-merge-verification.json`. 이후 상태 변경 및 최종 6항목 공란은 `outputs/registration-fix-20260908/live-final-six-fields-verification.json`.

## 검증

- `node scripts/verify-product-reregistration.cjs`: 실제 Apps Script 본문을 vm에서 실행한 71개 시나리오. 6개 초기화 필드, 입력된 새 링크/ID도 초기화, 수식 및 숫자 0 처리, 6개 공란 재시도 조건, 실제 가격 헤더 별칭 및 공백/명시적 0, doPost 실제 경로의 이미지 미입력 보존, 일반 연결취소로 인한 재등록행 복원 차단, 재등록 이력 상태 보존 포함. 실제 시트 열 순서/추가열/서식/노트/행높이, 비연속 행 이동, 구형 단일 옵션, 충돌, 원자 실패, 동시 변경, 반복 작업, 이력 및 이미지 보존.
- `node scripts/verify-quote-model-name.cjs`: 6카테고리 단독/묶음 실제 XLSX 12개, 34행 생성 후 ExcelJS 재로딩. 모델명/모델SKU/이미지명 등 확인.
- `node scripts/verify-wims-registration-state.cjs`: 검수중/승인완료/이전 SKU/오늘 수동정리/쓰기 후 미반영 검출/인증 11개 그룹.
- `node scripts/run-typescript-verification.cjs scripts/verify-safe-product-file-write.ts`: API 보안, 이전 skipDuplicate 유지, 미입력/0 가격, 파일 보호 및 실패 복구.
- `node scripts/verify-supply-retired-sku.cjs`: 공급상태의 이전 SKU 제외, 새 승인 SKU/정상 기존 SKU 갱신 유지, 읽기 오류·이력 변경 시 중단, 실시간 및 구형 파일 경로 검증.
- 기존 등록 작업번호, 파일생성 상태, WIMS 파서/확장, 공급상태 확장 회귀검증 통과.
- 실제 브라우저: 재등록 UI → ZIP 다운로드 → ZIP 안 견적서 모델명 재확인, 일반 중복 차단, 지연된 이전 모델 응답 무시, 교육모드 복귀, 390px 화면 확인. 모든 API는 모의 응답으로 격리해 외부 쓰기 없음. 증거: `outputs/reregistration-20260908/`.
- 통합 TypeScript `tsc --noEmit` 통과.
- 실제 wn00272 교정 견적서는 동일 로컬 생성기로 생성 후 재로딩 검증: `outputs/registration-fix-20260908/견적서_wn00272_목걸이.xlsx`. 운영 API는 내부 데이터 없는 가상 상품으로 HTTP 200 및 XLSX 모델명을 검증했다. 실제 제품 payload의 운영 API 전송은 자동 승인 검토에서 거절되어 실행하지 않았다.
- 운영 사이트 브라우저도 전체 API를 모의 응답으로 격리해 7개 흐름을 검증했다: `outputs/registration-fix-20260908/production-browser/browser-results.json`.

## 교체된 이전 SKU 재연결 방지

WIMS뿐 아니라 상품공급상태의 실시간 대조 및 구형 파일 미리보기에도 교체이력의 이전 SKU를 후보에서 제외하는 공통 검증을 적용한다. 새 승인 SKU와 정상 기존 SKU 갱신은 유지하며, 이력 읽기 오류나 이력 변경 시 재대조로 변경을 중단한다. 일반 SKU 연결취소는 두 새 재등록 이력 종류를 변경 전에 거절하며, 기존행 삭제 기능의 이력 상태 갱신에서도 이 두 종류를 보존한다. 기존 일반 연결취소는 유지한다. 재등록 71개·공급상태 10개 그룹·WIMS 11개 그룹·타입검사·프로덕션 빌드 통과 후 운영 배포를 완료했다. Apps Script 보호 변경은 아래의 운영 반영 경계가 적용된다.

## 운영 반영 경계

실제 시트 정리 및 추가 6개 초기화는 반영·검증 완료했다. 사이트의 견적서 모델명 수정과 WIMS 검수상태 반영 버튼은 운영 배포 `dpl_2p4PvPuA5e1rGNZu3httS3af8X25`의 READY 및 `noidb-os.vercel.app` 연결을 확인했다. 추가 6개 규칙 안내와 이전 SKU 연결 방지까지 포함한 후속 배포 `dpl_CZBo9y7Wd9Tp2UTZRtVe8FmB69Li`도 READY 및 운영 별칭 연결을 확인했다. 운영 페이지 HTTP 200, 실제 제공된 번들의 6개 안내·성공문구·검수상태 버튼을 재검증했다. 최종 증거는 `outputs/registration-fix-20260908/final-completion.json`과 `final-production-verification.json`이다.

동일 모델 자동 재등록은 Apps Script 운영 배포가 남아 있다. 로컬 템플릿 변경이나 Vercel 배포는 Google Apps Script를 갱신하지 않는다. 사용자가 편집기 주소 https://script.google.com/u/0/home/projects/1nlJWmtoAhPc_Mi7avgncWqoz7C4aA_JFTMRonPBT5b5-2ShlsfDGhJ7A/edit 를 제공했다. CUA 및 Computer Use의 node_repl 초기화가 모두 `windows sandbox failed: helper_unknown_error: setup refresh had errors`로 실패했고 재시도도 동일했다. 현재 운영 소스는 읽거나 수정하지 못했고 Apps Script 새 버전은 배포하지 않았다. Codex 연결 복구 후 이 정확한 프로젝트를 읽고 현재 운영 소스를 백업하여 필요한 함수 변경만 병합해야 한다. 구형 Apps Script 응답에서는 기존 모델 쓰기를 차단하도록 사이트 API를 보호했다. 연결 후 현재 운영 소스 백업, 새 버전 배포, 실제 checkModel 읽기 및 별도 테스트 시트에서 원자 재등록 검증을 완료해야 한다.

동시에 작업한 작업센터 변경을 보존하기 위해 `outputs/deploy-stage-source-preparation-20260908`을 기준으로 격리 빌드 폴더 `outputs/deploy-stage-product-registration-20260908`을 사용했다. 공유 개발 서버와 `.next`는 변경하지 않았다.

최종 운영 확인 후 이 문서의 완료 상태만 갱신했다. 배포한 응용프로그램 소스와 검증된 빌드는 변경하지 않았다.
