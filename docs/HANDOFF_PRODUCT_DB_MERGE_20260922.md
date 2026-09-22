# 인수인계: 제품DB 하나로 합치기 (2026-09-22, 5단계까지)

작업자: Claude Code + Codex (같은 저장소, 이어서 작업). 계획 원본: `docs/PLAN_PRODUCT_DB_MERGE_20260922.md` (단계별 상세·수치 근거는 그 문서가 기준).
관련 이전 인수인계: `docs/HANDOFF_PRODUCT_LINK_TABLE_20260922.md` (연결표 v8 자체의 배경, 아직 유효)

## 0. 한눈에 보기

- **목표:** 지금까지 갈라져 있던 기준(제품DB / 연결표 구글시트 / 통합 엑셀)을 **제품DB 하나**로 합친다. 연결표·엑셀은 보관용으로만 남긴다.
- **1~4단계: 전부 완료, 운영에 반영됨.** Apps Script 배포 끝났고, 제품DB에 새 열 4개(제품코드·재등록구분·사진폴더(확정)·정리메모)를 채우고, 통합 엑셀에만 있던 67행도 추가했다. 상세·검증 수치는 `docs/PLAN_PRODUCT_DB_MERGE_20260922.md` 4번 표.
- **5단계(코드만 완료, 배포 전):** 사이트 코드는 다 고쳤고 타입 검사까지 통과했다(돌아가기 링크 수정 포함). **커밋·push·배포는 안 함.**
- **다음 세션이 할 일:** 5단계 코드를 사용자에게 보여주고 커밋·배포 승인 받기. 그러면 이 프로젝트의 계획된 작업은 끝난다(6번 최종 확인만 남음).

## 1. 지금 git 상태

브랜치 `codex/current-logistics-flow`. 아직 **커밋하지 않은 수정**:
- `app/page.tsx` — 재등록 시 모델명·모델번호 잠금, AI 분석이 모델명 안 덮어씀, '기존상품 재등록 SKU ID' 칸 숨김, 메인 버튼 추가
- `app/wms/product-catalog/page.tsx` — 재등록구분 기준 목록·판단, 사진 폴더를 제품DB에서 직접 읽음, 검색 초기화 버튼, 재등록 묶음에 제품링크 추가, "링크 상태 확인" 버튼 삭제(쿠팡이 자동 접속을 막아서 항상 같은 결과만 나옴)
- `lib/wms/product-catalog.ts` — `ProductCatalogItem`에 `productCode`·`reregistrationTier`·`photoFolder` 3개 필드 추가
- `lib/wms/load-shipment-print-groups.ts`, `scripts/verify-shipment-manifest-order.ts` — 위 인터페이스 추가로 생긴 타입 오류 보정(빈 문자열 채움)
- `docs/PLAN_PRODUCT_DB_MERGE_20260922.md`, `docs/HANDOFF_PRODUCT_LINK_TABLE_20260922.md` — 진행 기록

검증: `npx tsc --noEmit` 통과(Claude 확인), `git diff --check` 통과(Claude 확인), `npm run build` 통과(보고받음). **커밋·push·배포는 전혀 안 했다.**

## 2. 운영에 이미 반영된 것 (되돌릴 필요 없음)

- **Apps Script** (project 'DB자동입력', https://script.google.com/u/0/home/projects/1nlJWmtoAhPc_Mi7avgncWqoz7C4aA_JFTMRonPBT5b5-2ShlsfDGhJ7A/edit) — 배포 완료.
  - 로컬 사본: `templates/DB자동입력_운영_20260922_수정본.gs` (배포된 내용과 같음). `templates/DB자동입력_운영_20260922.gs`는 수정 전 원본.
  - **⚠️ 두 파일 다 웹훅 비밀번호(`NOIDB_WEBHOOK_SECRET`)가 1번째 줄에 그대로 들어 있다. 커밋 금지.**
  - 고친 내용: 정렬·쓰기가 전체 열(37열 이후 포함)을 함께 옮기게 함, 열 배치가 다르면 자동 재배치 대신 오류로 멈춤, 재등록 허용 조건을 `재등록구분` 열(1차/2차 허용, 영구제외 차단) + 판매중지 옵션 하나만 있어도 허용으로 바꿈, '패키지' 열 검사 삭제(세트도 재등록 허용).
- **제품DB 시트**: AK~AN열에 `제품코드`·`재등록구분`·`사진폴더(확정)`·`정리메모` 추가, 2,667행 채움. 백업 탭 `_백업_제품DB_20260922_061122_합치기3단계`(숨김)에 이전 상태 보관.
- 운영 API(`/api/google-sheet?model=…`)로 가품 차단·2차 허용까지 확인 완료.

## 3. 다음 세션이 바로 할 일

1. **5단계 코드를 사용자에게 보여주고 커밋·배포 승인 받기.** (돌아가기 링크 수정까지 이미 완료됨)
   - 배포 전 확인: `npm run dev`로 화면 확인 → 재등록 화면에서 모델명이 잠기는지, 재등록 목록이 `재등록구분` 기준으로 맞는지(4단계로 늘어난 67행도 대상에 잡히는지), 사진 검색이 여전히 되는지.
   - 커밋 전 `git status`로 `templates/DB자동입력_운영_20260922*.gs` 두 파일이 **스테이징에 안 들어가게** 특히 주의(비밀값).
   - `npm run build`는 개발 서버를 끄고 실행(CLAUDE.md 규칙). 끝나면 `npm run dev` 다시 켜기.
2. 5단계 배포까지 끝나면 계획서 6번 "확인" 단계(재등록 목록 수, 사진 검색, 8번 안전진단 숫자)를 한 번 더 돈다. 이걸로 이 프로젝트의 계획된 작업이 끝난다.
3. (선택, 급하지 않음) `_중복옛SKU` 탭의 66행 중 "모델SKU가 제품DB의 다른 모델(ms011412)과 충돌"로 기록해 둔 SKU 41093265(mp011412)는 사용자가 실제로 뭔지 한 번 확인해 볼 만하다 — 같은 쿠팡 제품링크(8220649506 아님, products/6348785610)의 다른 옵션ID로 보이며, 중복 등록일 가능성.

## 4. 주의사항 (계속 유효)

- reset / clean / restore / checkout / stash / 삭제 / 덮어쓰기 금지.
- commit / push / merge / deploy, 구글시트 쓰기, Apps Script 배포, 쿠팡 제출은 **매번 사용자 승인** 후에만.
- Apps Script 수정·배포는 이제 Claude가 직접 한다(사용자 요청, 2026-09-22). 클릭을 사용자에게 안내하지 말고 Claude in Chrome으로 직접 붙여넣기·저장·배포까지 하되, 무엇을 바꿀지는 먼저 보여주고 승인받는다. **▷실행 버튼은 절대 누르지 않는다**(첫 함수 `setupProductDbSheets`가 무거운 전체 정리 작업).
- 복사용 요약([복사용 요약] 블록)은 사용자가 요청할 때만 붙인다(2026-09-22부터).
- 수정 요청을 받으면 작업을 시작하기 전에 먼저 **모델·노력 수준을 추천**하고, 사용자가 바꾼 뒤에 시작한다.
- staging/ 폴더 엑셀들, `scripts/seed-test-stage-orders.ts`/`remove-test-stage-orders.ts`, `.codex-backup-20260915_231924/`는 그대로 보존(용도 확정 전까지 지우지 않음).
