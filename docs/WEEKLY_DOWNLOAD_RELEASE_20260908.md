# 주간 업무 선택 다운로드 운영 배포 및 외장하드 인수인계

## 배포 결과

- 운영 URL: https://noidb-os.vercel.app/wms/inbound
- Target: production
- Status: READY
- Deployment: dpl_ExA9nqVptuq9mQnhkavCDQTV9h2a
- Deployment URL: https://noidb-1v6f8r54j-noidb2017-2145s-projects.vercel.app
- 이전 운영 배포: dpl_3XJwvYzsooinFWcxB1R6sMWMyvB6
- Framework: Next.js 14.2.31
- Cloud build: 전체 npm run build 및 선행 WMS/주간업무 회귀검사 통과. Vercel Build Completed 약 1분(업로드·배포 시간 별도).
- Commit: 새 커밋 없음. 기존 HEAD 0c4b3b8 위 현재 작업 폴더(미커밋/미추적 포함)로 CLI 배포.

## 변경된 사용자 흐름

거래처 발주·재발주요청·단종 3종 기본 선택, 선택 자료 ZIP 1개, 전체 ZIP, 버튼 근처 진행/실패 안내, 브라우저 저장 위치 안내, 동일 ZIP 재다운로드, 발주 이미지/PDF 미리보기, 카톡 주문/서플라이허브 업로드 후 완료 표시 및 다음 발주·입고관리 링크.

## 배포 후 확인

- 주간 업무 HTTP 200, 운영 JS에 선택 파일만 받기 / 다운로드를 요청했습니다 / 카톡으로 주문했어요 표시 확인.
- 주간 업무 GET 성공. 배포 전후 저장소 revision 99, 작업 8개와 제품별 저장 정보 해시 동일. 사용자 검토 내용을 바꾸지 않았음.
- 현재 작업 WEEKLY-e947970d2df72ab7ce49, 2026-08-07~09-07, 검토 63건 보존.
- 사용자 진술: 쿠폰·광고 등록 완료. 운영 앱 couponUploadedAt은 아직 미표시이며, 이 배포에서는 완료 상태를 임의로 변경하지 않음.
- Error scan: 해당 배포에 vercel logs --level error --since 15m --no-follow 실행, No logs found.
- Drains 및 지속 모니터링 설정은 이번 범위에서 변경/확인하지 않았음.
- 브라우저 fixture 검증: 3종 기본 선택/쿠폰광고 제외/ZIP 내용/연속 클릭/재시도/기존 이력/모바일 가로 넘침 통과. 운영 카톡 전송·쿠팡 업로드·신청은 수행하지 않음.

## 외장하드 재개 준비

- 새PC_작업이어가기.cmd: 운영 사이트, 개발 준비, 로컬 서버, 브라우저 확장 폴더 설치, 읽기 전용 점검, 안내문 메뉴.
- 주간업무_열기.url: 운영 사이트 바로가기.
- 새PC-작업이어가기.md: 현재 작업, 실제 남은 업무, 새 PC 로그인·확장 설치, Codex 인수인계 문구.
- scripts/portable-workspace.ps1: 스크립트 위치 기준 상대 경로 사용. E: 문자나 현재 PC 사용자 경로를 고정하지 않음.
- Windows PowerShell 구문 분석/Node 확인/원래 프로젝트 Check 및 한글·공백이 있는 다른 위치 Check 통과. 새 PC 자체의 설치·로그인은 아직 실행하지 않았음.
- 현재 .env.local에는 운영 Blob 연결이 없으므로 실제 업무는 운영 URL에서 진행. 기존 로컬 설정을 자동으로 운영 설정으로 바꾸지 않음.
- 시작 메뉴와 인수인계 문서는 배포 후 외장하드에 추가한 로컬 재개 파일이며 웹 앱 재배포 대상이 아님.

## 배포 UI 파일 식별

- app/wms/inbound/WeeklyWork.tsx SHA-256: 3b52b9780be4c91957d8aa3a4e50457d624578a4923e6722e009868fb2135cc1
- app/wms/inbound/weekly-work.module.css SHA-256: 09ec4b975dd349d1bf42609aa9ecdc6f7c0ced3ca09ac45e23a3b3f05a3770ef

기존 미커밋/미추적 작업을 보존한다. 새 PC에서 git reset/clean 또는 기존 전체 git add/push용 PC_작업저장.cmd를 자동 실행하지 않는다.
