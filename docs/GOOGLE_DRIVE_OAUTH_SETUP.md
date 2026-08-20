# Google Drive 이미지 업로드 — 사용자 OAuth 2.0 연결 설정 가이드

이 문서는 NOID WMS 상품 이미지 업로드가 **사용자 본인의 Google 계정(noidb2017@gmail.com)**의
"내 드라이브" 저장 용량을 쓰도록 OAuth 2.0을 연결하는 방법을 설명합니다.

**Google Sheets(제품DB 조회/수정)는 이 문서와 무관합니다** — 그건 여전히 서비스 계정을 쓰고,
설정 방법은 [`docs/GOOGLE_SHEETS_SETUP.md`](./GOOGLE_SHEETS_SETUP.md)에 있습니다.

## 왜 서비스 계정이 아니라 사용자 OAuth인가

서비스 계정으로 이미지 업로드를 시도했을 때 실제 Google Drive API로 확인한 결과,
서비스 계정 자신의 `storageQuota.limit`이 항상 `"0"`이었습니다 — 서비스 계정은 원래
Drive 저장 용량이 없어서(Google 공식 정책) 개인 "내 드라이브"에 파일을 소유할 수 없습니다.
"내 드라이브 폴더를 서비스 계정에 편집자로 공유"하는 방식도 검토했지만, 그렇게 해도 파일
소유자는 여전히 서비스 계정이 되어 같은 문제가 재발하므로 채택하지 않았습니다.

이 프로젝트는 개인 Gmail 계정(Google Workspace 아님)이라 **공유 드라이브(Shared Drive)**도
쓸 수 없습니다(공유 드라이브는 Workspace 전용 기능). 그래서 사용자 본인 계정으로 직접
로그인해 업로드하는 OAuth 2.0 방식을 씁니다 — 업로드된 파일이 사용자 본인 계정 소유가 되어
본인의 정상적인 저장 용량을 씁니다.

## 1. Google Cloud 콘솔에서 OAuth 클라이언트 만들기

Sheets 서비스 계정과 **같은 프로젝트**를 그대로 써도 됩니다.

1. https://console.cloud.google.com 접속 → 기존 프로젝트 선택
2. 왼쪽 메뉴(≡) → **API 및 서비스** → **라이브러리** → `Google Drive API` 검색 → **사용 설정**
3. 왼쪽 메뉴 → **API 및 서비스** → **OAuth 동의 화면**
   - User Type: **외부(External)** 선택 (개인 Gmail 계정이므로 내부 옵션은 없음)
   - 앱 이름/지원 이메일 등 기본 정보 입력
   - **범위(Scopes)**: `.../auth/drive.file` **하나만** 추가 — `drive`, `drive.readonly`,
     `profile`, `email` 등 다른 범위는 추가하지 않습니다.
   - **테스트 사용자**에 `noidb2017@gmail.com`을 반드시 추가합니다 (아래 10번 항목 참고 — 앱이
     "테스트" 상태인 동안은 테스트 사용자로 등록된 계정만 로그인할 수 있습니다)
4. 왼쪽 메뉴 → **사용자 인증 정보** → **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 리디렉션 URI**에 아래를 등록:
     ```
     http://localhost:3000/api/auth/google-drive/callback
     ```
     (Cloudflare Quick Tunnel 주소는 재실행마다 바뀌므로 여기 등록하지 않습니다 — 최초 연결은
     항상 집 PC의 localhost에서 진행합니다.)
5. 생성된 **클라이언트 ID**와 **클라이언트 보안 비밀(client secret)**을 확인합니다.

## 2. 환경변수 등록

`.env.local`에 아래 값을 채웁니다(`.env.local`은 `.gitignore`로 이미 Git 추적에서 제외되어
있습니다 — 실제 값을 여기 적어도 커밋되지 않습니다):

```
GOOGLE_DRIVE_OAUTH_CLIENT_ID=발급받은 클라이언트 ID
GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=발급받은 클라이언트 보안 비밀
GOOGLE_DRIVE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google-drive/callback
```

`npm run dev`를 재시작합니다.

## 3. 최초 연결 (집 PC의 localhost에서)

1. 상품 이미지 촬영/교체 화면(대표이미지 교체 바텀시트)을 엽니다.
2. "Google Drive 연결이 필요합니다" 안내와 **[Google Drive 연결]** 버튼이 보입니다.
3. 버튼을 누르면 Google 동의 화면으로 이동합니다 — **noidb2017@gmail.com**으로 로그인하고
   "이 앱이 만든 파일에 대한 액세스 권한"에 동의합니다.
4. 성공 화면이 뜨면 원래 화면으로 돌아가 다시 시도하면 업로드가 가능합니다.

연결 정보(refresh token)는 프로젝트 루트의 **`.secrets/google-drive-oauth.json`**에 저장됩니다.
이 파일은 `.gitignore`에 포함되어 있어 Git에 올라가지 않고, 클라이언트(브라우저)에서도 접근할
수 없으며, API 응답이나 서버 로그에도 절대 출력되지 않습니다.

## 4. 업로드 폴더

연결 후 사용자 계정의 "내 드라이브"에 **"NOID-B WMS 상품이미지"** 폴더를 자동으로 찾거나
만듭니다. 폴더를 직접 지정하고 싶으면 `GOOGLE_DRIVE_UPLOAD_FOLDER_ID` 환경변수에 폴더 ID를
넣으면 그 폴더를 그대로 씁니다. 같은 이름의 폴더가 여러 개 있으면 임의로 고르지 않고 오류를
보여줍니다 — Drive에서 직접 정리하거나 폴더 ID를 지정해주세요.

## 5. localhost와 Cloudflare Tunnel(휴대폰) 환경

- **연결/재연결**은 항상 localhost(집 PC)에서만 할 수 있습니다 — 서버가 요청 origin을
  검사해서 localhost나 등록된 redirect URI의 origin이 아니면 거부합니다.
- 한 번 연결되면(refresh token이 `.secrets/`에 저장되면) **휴대폰이 Cloudflare Tunnel로
  접속한 화면에서도 이미지 업로드 API는 정상 동작**합니다 — 업로드 자체는 서버가 저장된
  refresh token으로 access token을 갱신해 처리하므로 휴대폰이 다시 로그인할 필요가 없습니다.
- 서버를 재시작해도 `.secrets/google-drive-oauth.json`이 남아있는 한 재연결 없이 계속
  업로드할 수 있습니다.

## 6. 배포 환경(Vercel 등) 주의

`.secrets/google-drive-oauth.json` 로컬 파일 저장은 **그 서버 프로세스가 살아있는 동안만**
유지되고, 재배포나 서버리스 인스턴스 재시작 시 사라집니다 — Vercel 같은 환경에서는 영구
저장이 되지 않습니다. 배포 환경에서는 최초 연결로 발급받은 refresh token 값을
`GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` 환경변수에 직접 등록하거나, 별도의 영구 Secret Storage를
써야 합니다. `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`이 설정되어 있으면 로컬 파일보다 항상
우선합니다.

## 7. OAuth 앱 게시 상태 — "테스트" 상태의 7일 만료 주의

OAuth 동의 화면이 **"테스트(Testing)"** 상태인 동안 발급된 refresh token은 **7일 후
자동 만료**될 수 있습니다(Google 정책). 개발 중 짧게 테스트하는 동안은 문제없지만, 실제로
반복 사용하려면 OAuth 동의 화면을 **"프로덕션(In production)"** 상태로 전환해야 합니다.

- 요청 범위가 `drive.file` 하나뿐인 민감하지 않은(non-sensitive) 범위라, Google의 보안 심사
  없이도 게시 상태를 프로덕션으로 전환할 수 있는 경우가 많습니다(앱 정보만 채우면 됨).
- 프로덕션으로 전환하지 않은 채 7일이 지나 refresh token이 만료되면, 화면에 "Google Drive
  연결이 만료되었거나 취소되었습니다" 안내가 뜨고 다시 연결하면 됩니다.

## 8. 연결 해제 · 재연결

- 화면의 **[연결 해제]** 버튼은 `.secrets/google-drive-oauth.json`의 refresh token만
  지웁니다 — 기존에 Drive에 올라간 이미지 파일이나 제품DB 시트의 이미지 URL은 그대로
  남습니다.
- `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` 환경변수가 설정되어 있다면, 연결 해제 버튼으로는 지울
  수 없습니다(환경변수는 앱이 수정할 수 없음) — 완전히 해제하려면 배포 환경변수를 직접
  제거해야 합니다.
- 재연결은 3번 항목과 동일하게 [Google Drive 연결] 버튼을 다시 누르면 됩니다.

## 9. 토큰 보안

- client secret, refresh token, access token은 어떤 API 응답에도 포함되지 않습니다
  (`/api/auth/google-drive/status`는 연결 여부만 반환합니다).
- 서버 로그에도 토큰 원문을 출력하지 않습니다.
- `.secrets/`와 `.env.local`은 모두 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.
