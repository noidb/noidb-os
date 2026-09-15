# 단일 작업 폴더 통합 — 2026-09-15

## 추가 복구: 누적 버튼 및 과거청산 (최신)

- 운영 반영 완료: 사용자의 promote 승인 후 `dpl_AaHDdHbEV6rB9ZYoQho7QopfaUmf`를 `https://noidb-os.vercel.app`에 연결했다. inspect에서 운영 주소가 같은 배포 ID, target production, READY임을 확인했다.
- 운영 주소 확인: 작업센터의 `입고결과 누적` 버튼 표시, Drive `configured/connected/folderReady=true`, 과거청산 API 200·입고 912행·미처리 쿠폰 29개·blocker 0. 최근 1시간 Vercel error 로그 없음.

- Drive 재연결 완료(2026-09-15 12:31 KST). 검증용 최신 배포: https://noidb-yh8ajwk0c-noidb2017-2145s-projects.vercel.app (`dpl_AaHDdHbEV6rB9ZYoQho7QopfaUmf`, production 설정, 운영 주소 미연결).
- 전체 과거 누적 검증: Drive XLSX 29개, 과거 고유 이벤트 21,944개 + 현재 912개, 교차 중복 86개 제거, 병합 고유 이벤트 22,770개, 월별 SKU 결과 14,862행, 2023~2026년, 파싱 실패 0개.
- Drive 파일은 5개씩 병렬로 읽도록 바꿨다. 검증 응답은 Vercel CLI 포함 약 38.8초로, 첫 전체 로딩은 여전히 수십 초가 걸린다.
- 브라우저에서 2023/2024/2025/2026 연도, 월 선택, 상품명 `돌고래` 4행 검색, SKU `36035113` 1행 검색과 상품명/누적수량 표시를 확인했다.
- `noidb-os.vercel.app`은 기존 `dpl_ELX28u2ETorQqh6k2sa28BvgwZwD`를 계속 가리키는 것을 확인했다. 최신 검증 배포를 운영 주소에 promote하지 않았다.

- 후속 수정 미리보기 READY: https://noidb-3chblkkqb-noidb2017-2145s-projects.vercel.app (`dpl_763LF3LZbGWC2qisqizZq3yf65Py`). Drive 과거 파일이 실패해도 현재 Blob 입고이력 912행(2026-08/09, 월별 SKU 행 861개)은 연·월/SKU 검색 화면에 표시하고, 전체 과거 연결 누락을 경고한다.
- Google Drive 재연결 토큰은 Vercel Blob 저장본을 만료된 환경변수보다 우선하도록 수정했다. preview/staging의 재연결 링크는 고정 OAuth 콜백 origin으로 이동한다. Google 로그인/동의는 사용자가 직접 수행한다.
- 제품DB의 `=HYPERLINK(...)` 수식을 실제 URL로 정규화해 쿠폰 상품명 링크가 내부의 잘못된 경로로 열리는 문제를 수정했다.
- 운영 설정 검증 배포 `https://noidb-jfzjxy1ur-noidb2017-2145s-projects.vercel.app`에서 쿠폰 후보 29개와 상품명, 미처리 실제미납 87건/107개, 네 후속 메뉴를 읽기 전용 확인했다. 이 배포는 위 후속 수정 전 버전이다.
- 위 후속 수정본의 운영 설정 `--prod --skip-domain` 배포는 자동 승인 검토가 구체적 승인이 없다고 거부하여 실행되지 않았다. 최신 수정본을 운영 설정으로 별도 검증하려면 명시적 재승인이 필요하다.

- 작업센터의 `입고결과 누적` 버튼을 기존 unified-final 수정본에서 복원했다. 브라우저에서 버튼과 누적 화면 이동 확인.
- `lib/wms/clearance-coupons.ts`, `/api/wms/weekly-work/clearance`: 저장된 전체 Supplier Hub 입고 이벤트의 SKU별 총 입고가 1개인 대상을 계산한다. 중복 이벤트 제거, 동일 이벤트 수량 충돌 차단, 반출로 다수 입고를 1개로 만들지 않음, 제품DB 단종 제외.
- 이전 JSON 배열 형식과 현재 pipe 형식의 입고 이벤트 키를 대조하여 완료 쿠폰이 다시 나오지 않도록 보완했다.
- GET은 작업공간 복제본에서만 집계한다. 화면의 `쿠폰·광고 작업 시작`을 사용자가 누르면 검토 작업을 저장하며, 실제 쿠폰 등록/광고 전송/완료 처리를 자동으로 실행하지 않는다. 기존 주간 분석의 최신 자료 선택을 방해하지 않도록 TRANSFER-CLEARANCE ID를 사용한다.
- 실제미납은 기존 입고완료/단종 근거도 제외한다. 거래처 라인에 연결된 원발주번호 전체를 대조한다. 기존 네 후속 메뉴 유지.
- 누락된 원본 양식 6개를 `.worktrees/inbound`에서 복원하고 SHA-256 일치 확인: 쿠폰 1, 광고/재발주 2, 단종 XLSX/PDF 3. `next.config.mjs` 배포 파일 추적에 포함했다.
- 타입 검사, 완료/부분완료/복수 원발주 대조, 과거 이벤트 및 중복/충돌 검사 통과. 쿠폰+광고 XLSX/ZIP은 테스트 데이터로 메모리에서 생성 성공. 실제 운영 저장/다운로드/전송 없음.
- 저장 자료 912행 기준 후보 713개, 기존 쿠폰 완료/유효쿠폰 제외 후 29개. 제품DB 없이 실시한 보관 자료 검증이므로 현재 운영 확정 건수는 아니다.
- 최신 미리보기 READY: https://noidb-gjz30tp5q-noidb2017-2145s-projects.vercel.app (`dpl_HBwXqnchn1qNDxxCw8APuwHsDK5K`).
- 미리보기에는 제품DB 서비스계정/Drive OAuth 환경변수가 없어 현재 실데이터 연결 검증이 막혔다. 화면에서도 제품DB/Drive 설정 오류가 확인된다. 오류를 무시하거나 빈 결과를 성공으로 처리하지 않는다.
- `vercel deploy --prod --skip-domain`으로 운영 주소를 유지한 검증 배포를 시도했으나 자동 승인 검토가 거부했다: 미리보기만 승인됐고 별도 production 배포의 운영 데이터 접근은 명시적 승인 없음. 명령은 실행되지 않았다. 운영 설정 검증 배포 승인 필요. 환경변수 복사 우회 없음, 운영 주소 변경 없음.
- 현재 남은 작업: 승인 후 운영 설정으로 별도 배포 → 실데이터 조회/검색/후속 메뉴 검증 → 운영 반영 범위에 맞춰 마무리. 신규발주 자동수집 미완료 작업은 아직 착수하지 않았다.

## 현재 기준

- 앞으로 소스 수정 위치: `E:\노이드비AI`
- 통합 기준: GitHub main `fb9d20bae23380b95a4c98957f20a7be60e0e417` (원격 조회 확인)
- 기존 로컬 HEAD: `6881685`. Git branch/ref는 변경하지 않았다.
- 검증된 후보에서 188개 파일 반영, 반영 후 SHA-256 불일치 0개.
- `.gitignore`, `.vercelignore`에 로컬 복구본·worktree·운영 원본·비밀 파일 제외 규칙 추가.
- 기존 worktree는 삭제·이동하지 않았다. 새 Git worktree도 만들지 않았다.

## 보존 및 통합

- 백업: `E:\노이드비AI\.tmp\recovery-20260915`
- `backup/`: main·inbound·Claude·통합 후보 등에서 수집한 기존 수정본 223개와 추가 의존 파일.
- `original-head.tar`: 기존 HEAD의 추적 파일.
- `before-apply/`: 이번 반영 직전 실제 파일.
- `inventory.json`: 후보별 반영/동일/충돌 검토 내역. 버전이 다른 원본도 백업에 보존.
- `apply-plan.json`: 반영한 188개 파일의 변경 전후 SHA-256.
- 기존 운영의 입고결과·실제미납·상품·출고 코드를 기준으로 확장프로그램, 신규 발주 원본 저장, 과거 입고 포함 누적조회, 이미지 검색, 광고 분석, 인증 초안을 통합.
- 과거 Claude 입고 화면이나 타입으로 최신 완료처리·Shipment 계약을 덮어쓰지 않았다. 이 차이와 개발용 fixture 연결 3개는 원본 보존으로 분류했다.
- 새로운 인증 초안은 `/login`에 존재하지만 기존 전체 사이트의 인증 체계를 대체하지 않는다. 사용에는 해당 인증 환경변수가 필요하다.
- Supplier Hub 실제 SKU/원래 확정수량 API 추적은 여전히 미완료다. 확장 버전 0.9.2 소스를 보존했고 수집을 완료했다고 판정하지 않았다.

## 통합 중 수정한 결함

- 공통 저장 함수에 빠져 있던 `appendSupplierHubInboundEvents` 처리를 복원했다.
- 신규 발주 원본 저장 필드를 기존 Shipment·발주 스냅샷 계약과 함께 유지했다.
- Claude 화면이 참조하는 `single-unit-inbound.ts` 누락을 보완했다.
- 현재 Node 타입과 충돌하던 출고 원본 파일의 null 제거 타입 구문 2곳을 수정했다.

## 검증

- 통합 후보 TypeScript 검사 통과.
- 저장 처리 수정 후 Next.js 최종 빌드 통과 (`build-final.log`).
- 기존 실제미납 재발주 분류·중복 재사용·발주번호별 분리·완료건 차단 검증 통과.
- 기존 발주 스냅샷 선택·동일시각 충돌 검증 통과.
- 메모리 기반 입고 이벤트 중복 방지·원본 발주 upsert·재읽기·과거 데이터 기본값·피킹/Shipment 보존 검증 통과 (`verify-store.cjs`). 실제 저장소 쓰기 없음.
- 반영 파일 188개와 빌드 후보의 해시 일치, `git diff --check` 통과.
- 로컬 HTTP 확인: `/`, `/wms/work-center`, `/image-search`, `/coupang-ads`, `/login`, `/wms/inbound/cumulative` 모두 200.
- 확장프로그램 JS 문법 검사 통과.
- 브라우저 실제 업무 조작·실물 인쇄·운영 데이터 수치 재검증은 하지 않았다.

## 배포 및 다음 단계

- Vercel 대상: 기존 `noidb-os`, project `prj_awFXWWtDM7Q752UMiB7ZViONH2j1`.
- 최신 미리보기 배포 완료: `dpl_DuDhje5paFA2fFKEvxesbzd7CzPf`, 상태 `READY`.
- URL: https://noidb-ozfj55e5w-noidb2017-2145s-projects.vercel.app
- 과거청산 화면: `/wms/vendor-orders`의 쿠폰 영역은 `WeeklyWork clearanceMode`, 분류 영역은 `ActualInboundShortage pendingOnly`를 사용한다. 처리기간 선택 없이 저장된 쿠폰 집계를 유지하며 실제미납 분류는 현재 Supplier Hub 집계를 GET으로 조회한다.
- `actual-inbound-shortage?pending=1`은 기존 `completedShortagePairs`의 명시적 완료 이력을 발주번호+SKU로 대조하여 제외한다. 기간 필터를 사용하지 않는다. 일반 조회·POST 분류 API와 기존 저장 구조는 유지한다.
- 읽기 전용 조회 결과: 입고이벤트 912개, 완료 제외 API 결과 106건/130개. 이 API 건수에서 화면은 기존 거래처발주에 연결된 항목을 추가로 제외한다. 과거 132건/157개 메모를 현재 값으로 덮어씌우지 않는다.
- 아래 메뉴: 단종 처리(`/wms/vendor-orders/status-requests`), 거래처 발주(`/wms/vendor-orders/manage`), 미납분 재발주요청(`/wms/inbound/reorder`), 입고확인 내역(`/wms/vendor-orders/receiving`).
- 검증: 타입 검사·완료/부분완료/발주번호별 분리·기존 최초 분류 검사 통과, 원격 빌드 READY, 화면 GET 200 및 처리기간 선택 제거/4개 메뉴 HTML 확인. 실제 업무 처리·저장 자료 재집계는 하지 않았다.
- 입고결과 연결 복원: `/wms/vendor-orders`가 기존 `WeeklyWork`를 직접 렌더링한다. 쿠폰·광고 생성과 미입고 상품 검토/분류 화면을 복원했고 원래 `/wms/inbound/weekly`도 유지한다. 구형 허브는 `vendor-orders-hub-before-connect.tsx`에 백업했다.
- 연결 검증: 원격 빌드 및 해당 주소 GET 200, WeeklyWork HTML 확인. 기존 weekly-work GET 성공, 저장 작업 46개 확인. 화면이 선택하는 최근 일반 작업의 기간은 2026-09-09~2026-09-11, 원본 couponItems 9개와 vendorItems 169개다. 이 원본 건수는 현재 미처리 실제미납 건수와 동일하다고 단정하지 않는다. 데이터 재집계·파일 생성·처리 이력 수정은 하지 않았다.
- 후속 상단 복원: `app/wms/WmsHomeHeader.tsx`를 Claude `019ebec`의 디자인으로 복원. 로고 왼쪽·뒤로/HOME 오른쪽 한 줄, 공통 되돌리기 버튼 제거. 기존 상단은 `header-before-restore.tsx`에 백업. 원본 undo 저장 로직은 변경하지 않았다.
- 상단 복원 후 원격 빌드 통과, `/wms/vendor-orders` 인증 GET 200 및 복원된 상단 HTML 확인.
- 인증된 GET 확인: `/wms/work-center` 200, `/api/wms/vendor-orders/supplier-hub-inbound-events` 200 및 `ok: true`, 기존 입고이벤트 912건 확인. 운영 데이터 쓰기는 하지 않았다.
- 운영 도메인은 변경하지 않았다. 운영 배포와 원본 worktree 제거는 미리보기 업무 확인 이후 단계.
- 현재 commit/push 없음. 운영 데이터·이력·원본 파일 삭제 없음.
- 이후 작업은 `E:\노이드비AI`에서 이어간다. 복구 후보와 백업 폴더에서 새로운 기능 개발을 진행하지 않는다.
