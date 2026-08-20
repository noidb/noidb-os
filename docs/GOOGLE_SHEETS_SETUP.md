# 구글시트 읽기 전용 연동 설정 가이드 (아주 쉽게)

이 문서는 NOID WMS가 구글시트("노이드비 상품DB")를 **읽기 전용**으로 조회할 수 있도록
"서비스 계정"을 만들고 연결하는 방법을 처음 하시는 분도 따라 할 수 있게 설명합니다.

기존 상품등록 자동화가 쓰는 구글시트 웹훅(Apps Script)은 전혀 건드리지 않습니다.
여기서 만드는 서비스 계정은 **시트를 읽기만 할 수 있고, 절대 수정/삭제할 수 없습니다.**

---

## 1. Google Cloud 프로젝트 준비

1. https://console.cloud.google.com 접속 (구글 계정으로 로그인)
2. 상단의 프로젝트 선택 메뉴 클릭 → **새 프로젝트** 클릭
   - 이미 쓰는 프로젝트가 있다면 그걸 선택해도 됩니다.
3. 프로젝트 이름을 예: `noidb-wms` 로 입력하고 **만들기**

## 2. Google Sheets API 켜기

1. 왼쪽 메뉴(≡) → **API 및 서비스** → **라이브러리**
2. 검색창에 `Google Sheets API` 입력
3. 결과 클릭 → **사용 설정(Enable)** 버튼 클릭

## 3. 서비스 계정 만들기

1. 왼쪽 메뉴(≡) → **IAM 및 관리자** → **서비스 계정**
2. 상단 **+ 서비스 계정 만들기** 클릭
3. 서비스 계정 이름: 예 `noid-wms-sheets-reader` 입력 → **만들고 계속하기**
4. 역할(Role) 선택 화면은 **건너뛰어도 됩니다** (아래에서 시트 자체를 공유하는 방식으로 권한을 줄 것이므로 프로젝트 전체 권한은 필요 없음) → **계속** → **완료**

## 4. 서비스 계정 키(JSON) 발급받기

1. 방금 만든 서비스 계정 목록에서 이름 클릭
2. 상단 탭에서 **키(Keys)** 클릭
3. **키 추가** → **새 키 만들기** → 유형 **JSON** 선택 → **만들기**
4. `.json` 파일이 자동으로 다운로드됩니다. **이 파일은 비밀번호와 같으니 절대 공개 저장소(GitHub 등)에 올리지 마세요.**

이 JSON 파일을 텍스트 편집기로 열면 아래와 같은 항목이 보입니다 (예시, 실제 값은 다릅니다):

```json
{
  "client_email": "noid-wms-sheets-reader@noidb-wms.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
}
```

이 중 **`client_email`** 값과 **`private_key`** 값, 두 개만 필요합니다.

## 5. 스프레드시트를 서비스 계정에 "뷰어"로 공유하기

**이 단계가 가장 중요합니다.** 키를 만들어도 시트에 접근 권한이 없으면 조회가 실패합니다.

1. 구글시트 "노이드비 상품DB" 파일을 엽니다.
   (링크: `https://docs.google.com/spreadsheets/d/15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA`)
2. 오른쪽 위 **공유** 버튼 클릭
3. "사용자 및 그룹 추가"에 위에서 확인한 **`client_email`** 값을 붙여넣기
   (예: `noid-wms-sheets-reader@noidb-wms.iam.gserviceaccount.com`)
4. 권한은 반드시 **"뷰어(Viewer)"**로 설정 (편집자로 주지 않아도 읽기 전용 연동에는 충분합니다)
5. **보내기(공유)** 클릭

## 6. 환경변수 등록하기

아래 3개의 환경변수를 등록합니다. (변수 이름은 고정, 값만 본인 것으로 채웁니다)

| 변수명 | 값 | 필수 |
| --- | --- | --- |
| `GOOGLE_SHEETS_WMS_CLIENT_EMAIL` | JSON 파일의 `client_email` 값 | 필수 |
| `GOOGLE_SHEETS_WMS_PRIVATE_KEY` | JSON 파일의 `private_key` 값 (아래 주의사항 참고) | 필수 |
| `GOOGLE_SHEETS_WMS_SPREADSHEET_ID` | `15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA` | 선택 (비워두면 이 값이 기본으로 사용됨) |

### private key 등록 시 주의사항

`private_key` 값은 여러 줄로 되어 있고 중간에 줄바꿈이 포함되어 있습니다.

- **로컬 개발(.env.local)**: JSON 파일에 있는 값을 그대로 큰따옴표로 감싸서 붙여넣으면 됩니다.
  ```
  GOOGLE_SHEETS_WMS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
  ```
- **Vercel 등 배포 환경**: 환경변수 입력창에 위와 동일하게 `\n`이 포함된 한 줄 문자열로 붙여넣으면 됩니다.
  (이 프로젝트 코드가 `\n` 문자열을 자동으로 실제 줄바꿈으로 변환해서 처리하므로, 있는 그대로 붙여넣기만 하면 됩니다.)

### 로컬에서 테스트하는 경우

프로젝트 루트에 `.env.local` 파일을 만들고 위 3개 값을 적은 뒤 `npm run dev`를 다시 실행하세요.
`.env.local`은 `.gitignore`에 포함되어 있어 Git에 올라가지 않습니다 (혹시 안 되어 있다면 반드시 추가해주세요).

## 7. 정상 연결됐는지 확인하는 방법

1. 앱을 실행하고 브라우저에서 `/wms/work-center` 페이지로 이동합니다.
2. 화면에 **"⚠️ 구글시트 연결 필요"** 안내가 사라지고, 발주서 목록 표가 보이면 성공입니다.
3. 만약 **"❌ 발주서 조회 실패"**가 뜬다면:
   - 5번(시트 공유) 단계를 다시 확인해주세요 — 가장 흔한 원인은 시트 공유를 빼먹은 경우입니다.
   - 오류 메시지에 `PERMISSION_DENIED`가 보이면 100% 공유 설정 문제입니다.
   - 오류 메시지에 인증 관련 문구가 보이면 `client_email` / `private_key` 값이 잘못 붙여넣어졌을 가능성이 큽니다 (특히 `private_key`의 줄바꿈).

## 참고: 이 연동이 할 수 있는 것 / 할 수 없는 것

- ✅ `발주서 출력`, `제품DB` 시트의 내용을 읽고, 사용자가 화면에서 저장을 누른 셀만 지정해서 씁니다(제품DB 상품정보 수정 기능).
- ❌ 기존 상품등록 자동화가 쓰는 Apps Script 웹훅과는 무관하며, 그쪽 코드/시트 구조를 전혀 건드리지 않습니다.
- ❌ **이 서비스 계정으로 Google Drive에 이미지를 업로드하지 않습니다.** 서비스 계정은 Drive
  저장 할당량이 0이라("Service Accounts do not have storage quota") 업로드가 항상 실패했습니다
  (2026-08-19 확인). 상품 이미지 업로드는 완전히 별도인 **사용자 OAuth 2.0** 방식으로 전환했습니다
  — 설정 방법은 [`docs/GOOGLE_DRIVE_OAUTH_SETUP.md`](./GOOGLE_DRIVE_OAUTH_SETUP.md)를 참고하세요.
  ("내 드라이브 폴더를 서비스 계정에 편집자로 공유"하는 방식은 검토 후 채택하지 않았습니다 —
  같은 저장공간 문제가 재발하기 때문입니다.)
