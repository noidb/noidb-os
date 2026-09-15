# 메뉴별 수정 작업 사용법

## 작업 공간

| 역할 | 폴더 | 브랜치 | 개발 포트 |
| --- | --- | --- | --- |
| 통합·최종 배포 | E:\노이드비AI | codex/menu-baseline-20260910 | 기존 설정 |
| 상품·이미지·견적서 | E:\노이드비AI\.worktrees\product | codex/menu-product-20260910 | 3101 |
| 입고·주간업무·거래처·재발주 | E:\노이드비AI\.worktrees\inbound | codex/menu-inbound-20260910 | 3102 |
| 피킹·출고·송장·출력물 | E:\노이드비AI\.worktrees\outbound | codex/menu-outbound-20260910 | 3103 |

각 폴더는 전체 프로젝트를 포함한다. 파일·브랜치·node_modules·.next는 작업별로 분리한다. Git 커밋 이력과 원격 저장소는 공유한다.

## Codex에서 사용

1. 위 메뉴 폴더를 Codex 프로젝트로 추가하거나 열고, 그 폴더에서 수정 작업을 시작한다. 이 메뉴 폴더 자체가 워크트리이므로 이 폴더를 직접 사용하는 Local 작업으로 실행한다.
2. 첫 요청에 `WORKTREE_SCOPE.md를 읽고 실제 작업 경로와 브랜치를 확인한 뒤, 이 폴더 안에서 담당 메뉴만 수정해줘`라고 적는다.
3. 같은 메뉴 폴더에서는 한 작업만 수정한다. 서로 다른 메뉴 폴더끼리는 동시에 작업할 수 있다.
4. 개발 서버는 해당 폴더의 `개발서버_시작.cmd`를 실행하거나 `npm run dev -- --port 3101`처럼 지정 포트를 쓴다.
5. 작업이 끝나면 변경 파일과 검증 결과를 남기고, 승인된 커밋을 통합 폴더에서 하나씩 합친다. 다음 작업을 시작하기 전 통합 기준의 변경을 반영한다.

기존 `AI상품등록도우미 관리자`와 `출고 서류 단계 안전 마무리` 대화의 경로는 자동 변경되지 않는다. 그 대화를 다시 실행한다고 새 메뉴 폴더로 옮겨지는 것은 아니다. 기존 대화는 참고 이력으로 보존한다. 본 작업에서는 새 Codex 대화를 임의로 생성하지 않는다.

## 수정 범위

- 상품: `app/page.tsx`, `app/image-generator`, `lib/product-db`, `lib/drafts`, `lib/excel`, 상품 등록 Apps Script.
- 입고·거래처: `app/wms/inbound`, `app/wms/vendor-orders`, 거래처 편집기 `app/wms/picking/waves/[waveId]/vendor-orders`, 주간업무·거래처 발주 관련 API와 lib.
- 출고: 피킹·포장·Shipment·출고 작업센터 관련 화면과 lib. 거래처 편집기는 입고·거래처 담당과 조정한다.
- 공통 API·업무 저장소·전역 스타일·패키지·업무 완료 규칙을 바꿀 때는 다른 메뉴 영향을 확인하고 통합 담당과 변경 순서를 맞춘다.

## 개발 연결과 검증

설치된 의존성은 각 폴더에 독립 복사한다. 운영 `.env.local`, `.secrets`와 실제 업무 데이터는 자동 복사하지 않는다. 코드·타입·모의 API 검증부터 진행하고, 실제 연결이 필요한 경우 원본 설정에서 필요한 연결만 검토한다. 환경설정이 없을 때 개발 화면에 운영 목록이 나타나지 않는 것은 예상된 상태다.

개발 서버와 build를 같은 작업 공간에서 동시에 실행하지 않는다. 작은 수정에는 해당 화면·타입·연결된 업무만 확인하고, 최종 통합·배포 전 필수 전체 검증을 실행한다. 서버 종료·설치·Git 변경·실제 외부 데이터 변경은 AGENTS.md와 사용자 승인 범위를 따른다.

## 기준과 복구

- 웹 기준: 검증된 운영 배포 `dpl_HXDdJ5Wao37GWvJzcKWbfFhvAWhm`.
- 상품 Apps Script canonical과 `verify-product-reregistration.cjs`는 2026-09-10 최신 원본을 보존했다.
- 분리 전 보존 브랜치: `codex/workspace-snapshot-20260910`.
- 소스 백업과 전체 Git bundle: `E:\노이드비AI\outputs\worktree-separation-20260910`.
- 이전 출고 워크트리와 기존 생성파일·실제 데이터는 삭제하지 않았다.
- 로컬 분리용 문서·Git 설정의 반영은 웹사이트나 Apps Script 운영 배포를 의미하지 않는다.

## 실제 기존 작업 연결 완료 (2026-09-10, 이전 경로 표보다 우선)

- 상품등록: AI상품등록도우미 관리자. 실제 cwd C:\Users\noidb\.codex\worktrees\6281\노이드비AI. handoff 성공, 작업 ID 01a08b65-a602-7e10-b307-df04a6ec339c. 이전 대화 내용 보존, 해당 작업 화면 열기 완료.
- 입고·거래처: 메뉴별 안전한 워크트리 분리. 소스 작업은 E:\노이드비AI\.worktrees\inbound로 명시하여 실행한다. 현재 앱 등록 cwd는 원본이지만 입고 코드는 inbound에서만 수정한다.
- 출고: 출고 서류 단계 안전 마무리. 기존 독립 cwd C:\Users\noidb\.codex\worktrees\bc73\노이드비AI 유지, 미커밋 수정 보존.
- 미리 준비한 E:\노이드비AI\.worktrees\product/outbound는 기존 작업의 실제 연결 위치가 아니다. 사용자는 기존 작업 이름으로 들어가며 각 실제 cwd에서 수정한다.
- 상품 워크트리 AGENTS.override.md와 WORKTREE_SCOPE.md에 현재 폴더와 배포 합치기 규칙을 기록했다. 운영 배포 전 최신 기준 ID를 확인하고 해당 메뉴 변경만 합친다.
