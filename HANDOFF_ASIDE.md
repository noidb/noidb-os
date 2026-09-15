# NOID-B Aside 인수인계

## 기준과 목적

- 기준 프로젝트 폴더: `E:\노이드비AI`
- 원격 저장소: https://github.com/noidb/noidb-os
- 이 문서는 다른 PC의 Aside 작업이 현재 상황을 안전하게 이어가기 위한 요약이다.
- 첫 단계는 **읽기 전용 진단**이다. 코드 수정, commit, push, deploy, reset, clean, merge, 파일 삭제·이동을 하지 않는다.

## 가장 중요한 발견

로컬 프로젝트와 실제 GitHub 최신 main이 서로 다르다.

- 로컬 `main` 참조: `6881685e877a0c1a1b07dc92d70b93a6a0cbc663`
- 로컬 `origin/main` 참조: `4f4edd27bfcc1fe4e412a6fd4a50ccc14d4df2c6`
- GitHub 실제 최신 `main`: `fb9d20bae23380b95a4c98957f20a7be60e0e417`
- GitHub 최신 main commit: `feat(wms): complete inbound result workflow`
- GitHub에서 최신 main의 Vercel 배포 성공 상태 확인됨.

따라서 `E:\노이드비AI`에 무작정 `pull`, `merge`, `reset`, `clean`을 실행하면 안 된다. 먼저 로컬의 `.tmp`, `.worktrees`, stash, 로컬 전용 브랜치에 있는 변경을 분류해야 한다.

## 확인된 운영 데이터 기준

운영 API 읽기 전용 확인 결과:

- 실제미납 라인: 146건
- 실제미납수량 합계: 180개
- Supplier Hub status: 82건
- supplierHubInboundEvents: 912건
- 고유 inbound events: 912건
- 중복 inbound events: 0건
- 스냅샷 충돌: 0건
- 활성 발주: 62건
- 완료 발주: 64건
- 월별 SKU 입고 집계 행: 861건

이 값은 데이터 초기화, 재계산 로직 교체, 대량 수정 전에 반드시 보존·재확인해야 하는 기준값이다.

## 현재 폴더 상태

`E:\노이드비AI` 내부에서 확인된 보관 대상:

- `.tmp`
- `.worktrees`
- `.deploy-*` 후보 폴더들
- `.secrets`
- `.env.local`
- `HANDOFF.md` (과거 Claude/Codex 작업 인수인계)

삭제, 이동, 통째로 merge 금지. 과거 폴더는 현재 main과 필요한 파일 단위 diff 비교용이다.

로컬 Git packed refs에는 다수의 과거 Codex/Claude 브랜치와 `refs/stash`가 남아 있다. 특히 아래는 검토 전 통합 금지:

- `codex/unified-final-20260914`
- `codex/inbound-production-integration-20260914`
- `codex/exact-shortage-prod-20260914`
- `codex/minimal-inbound-completion-20260914`
- `claude/*`
- `.worktrees` 내부 후보들

## 원격 코드 감사에서 발견한 차이

### 확인됨

- 실제미납 API는 기존 `calculateSupplierHubShortages`를 사용하고, 운영 기준값 146/180을 유지한다.
- 활성 발주 자체보관 수치 62 활성 / 64 완료가 운영 API에서 확인된다.
- 실제미납 최초 3분류(거래처발주, 단종, 미납분 재발주) UI와 기존 로직 재사용 코드가 있다.
- SKU별 PNG 거래처 카드 다운로드 코드는 있다. 카카오 자동 전송은 하지 않는다.
- Production용 Google Drive 읽기 설정 코드가 있으며 Vercel에서 `G:`를 직접 읽지 않도록 설계돼 있다.

### 부분완료 또는 점검 필요

1. 작업센터의 `입고결과 처리` 명칭은 현재 main에 있으나, 링크는 `/wms/vendor-orders`의 구형 3카드 허브로 연결된다. 최종 업무 화면으로 바로 이어지는지 실제 동선 검증 필요.
2. `sent` 거래처발주 잠금 규칙이 코드와 충돌할 가능성이 높다. `/wms/vendor-orders/receiving`에는 sent 발주도 삭제·수량 수정 경로가 남아 있다.
3. 거래처 수정 helper는 sent 원본 발주 라인을 이동하려 할 때 거부하는 조건이 있어, 요구된 `sent이면 새 발주서 생성 후 이동` 규칙을 실제로 충족하는지 검증·수정 필요.
4. `/wms/inbound/cumulative` route는 GitHub 최신 main에서 확인되지 않았다. `monthlyInboundBySku` 데이터는 있으나 누적 입고 조회 UI는 미통합 가능성이 높다.
5. 1개입고 목록과 실제미납 목록의 `최종 입고일` 표시 코드를 찾지 못했다.
6. `automation/coupang-po`는 현재 사용자가 Supplier Hub에서 직접 다운로드한 파일을 감시·반영하는 방식이다. PC 없이 모바일 버튼으로 쿠팡 다운로드까지 수행하는 클라우드 작업기는 아직 구현되지 않았다.
7. 최신 main은 `noidb-os`와 `laura-os` 두 Vercel 상태가 성공으로 표시된다. 실제 운영 도메인과 배포 대상 정리 필요.

## 절대 지킬 규칙

- 운영 데이터 삭제·reset·clean 금지
- 과거 완료이력 삭제 금지
- `.tmp`, `.worktrees`, `.deploy-*` 삭제·이동 금지
- 구형 worktree 전체 merge 금지
- 기존 파일 전체 덮어쓰기 금지
- `.env.local`, `.secrets` 값 표시·공유 금지
- 사용자 승인 없는 commit, push, deploy, branch/worktree 삭제 금지
- 불명확한 업무규칙은 한글로 짧게 질문

## 다음 작업 우선순위

1. 읽기 전용으로 로컬 `.tmp`, `.worktrees`, stash, 로컬 브랜치별 변경을 `완료 / 부분완료 / 미완료 / 구형 / main 외부`로 분류한다.
2. GitHub 최신 main과 로컬 현재 프로젝트의 핵심 WMS 파일을 비교한다.
3. 실제 Production 화면 동선과 API 쓰기 동작은 테스트 데이터 또는 사용자 승인 범위에서만 검증한다.
4. 위 진단 보고서 후 사용자가 승인하면, 필요한 기능만 최신 main 기준으로 최소 통합한다.
5. 최종 통합·Production 확인 뒤에만 과거 업무 청산과 폴더 정리 계획을 제안한다.

## 이번 조사에서 수정한 것

- 코드 수정: 없음
- Git commit/push/deploy: 없음
- 운영 데이터 변경: 없음
- 파일 삭제/이동: 없음
- 작성한 파일: 이 `HANDOFF_ASIDE.md` 한 개
