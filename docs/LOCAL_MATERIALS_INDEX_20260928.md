# NOID-B 로컬 자료 위치 (2026-09-28)

현재 사이트의 소스는 `E:\노이드비AI`가 기준이다. 다른 PC 폴더에 흩어져 있던 작업 산출물은 `E:\노이드비AI\local-archive`에 보관했다. 이 보관 폴더는 Git과 Vercel 배포에서 제외된다. 과거 복제본의 코드를 현재 소스처럼 수정하거나 배포하지 않는다.

## 찾는 방법

`E:\노이드비AI\local-archive\manifest.csv`를 Excel에서 열고 `Source`, `RelativePath` 또는 파일명으로 검색한다. `CanonicalPath`가 실제로 열어야 할 파일이다. 같은 내용의 파일은 SHA-256으로 확인해 한 벌만 저장했으며, 중복된 원래 위치는 목록에 모두 남겼다.

| 자료 | E: 보관 위치 |
| --- | --- |
| MYBOX 통합 실행·최종검증·초기 중복 보고서 | `local-archive\records\MYBOX-original-reports` |
| MYBOX 중복 재분류·삭제계획 보고서 | `local-archive\records\MYBOX-review-reports` |
| OneDrive의 NOID-B 사진정리기 코드와 작업 기록 | `local-archive\records\photo-organizer-OneDrive` |
| 과거 Documents 프로젝트 복제본 | `local-archive\records\historical-Documents-checkout` |
| 과거 Downloads 프로젝트·서식·엑셀 | `local-archive\records\historical-Downloads-checkout` 및 `Downloads-loose-documents` |
| 과거 Codex 상품 작업 폴더 | `local-archive\records\historical-Codex-product-checkout` |
| OneDrive 문서 폴더의 NOID-B/SKU 엑셀 | `local-archive\records\OneDrive-loose-documents` |

## 검증과 범위

- 8개 출처에서 1,517개 파일 항목을 대조했다. 내용이 고유한 916개 파일(651,862,777바이트)을 E:에 보관하고 복사 후 크기·SHA-256을 확인했다. 391개는 현재 E: 프로젝트에 내용이 같고, 210개는 다른 보관 파일과 내용이 같아 원래 위치만 목록에 기록했다. 목록에 포함된 파일의 복사 오류는 0건이다.
- `C:\MYBOX\_중복검사`와 `C:\MYBOX_중복검사`는 서로 다른 보고서 위치라 둘 다 포함했다. 보고서의 9월 23일 결과를 현재 MYBOX 상태로 간주하지 않는다.
- `N:\개인\★전체제품사진`의 실제 사진은 이 보관 작업에 포함하지 않았다. 당시 스냅샷만 약 719GB이고 E:의 작업 전 여유 공간은 약 86GB였다. MYBOX 사진 원본은 N:에 있으며 E:에는 경로·검증 보고서만 보관했다.
- 실행 환경, 의존성, 빌드 산출물, 시험 출력, Git 내부 파일, 인증정보는 보관 대상에서 제외했다. Claude/Codex의 세션·캐시도 실행 환경이므로 이동하지 않았다. OneDrive 사진정리기의 업무 코드와 `jobs` 작업 기록은 보관했다.
- 원래 C:/OneDrive 파일은 삭제하거나 이동하지 않았다. 진행 중인 다른 채팅의 작업 경로를 깨지 않기 위해서다. 실제 제품DB Google Sheet와 운영 사이트의 데이터는 별도의 현재 운영 상태이며, 여기의 오래된 XLSX는 시점별 참고본이다.

다시 통합해야 할 때는 `local-archive\consolidate.ps1`이 같은 SHA-256으로 중복을 확인하고 `manifest.csv`를 다시 만든다. 새 출처를 추가할 때는 작업용 파일과 비밀 파일을 구분한 뒤 대상에 넣는다.
