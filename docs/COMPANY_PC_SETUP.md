# 회사 컴퓨터에서 이어서 개발하기 (아주 쉬운 가이드)

이 문서는 컴퓨터를 잘 몰라도 따라할 수 있도록 순서대로 작성되어 있습니다. 위에서부터
차례대로 하나씩 따라 하시면 됩니다. 집 컴퓨터와 회사 컴퓨터의 Windows 사용자 이름이나
폴더 경로가 달라도 상관없이 아래 방법대로 하면 됩니다 (특정 경로를 외울 필요 없음).

---

## 1. Git 설치 확인

1. 키보드에서 `Win` 키를 누르고 `PowerShell`이라고 입력한 뒤 Enter
2. 열린 창에 아래를 입력하고 Enter

   ```
   git --version
   ```

3. `git version 2.x.x` 같은 글자가 나오면 이미 설치되어 있는 것입니다. 다음 단계로 넘어가세요.
4. 아무것도 안 나오거나 오류가 나면, https://git-scm.com/download/win 에서 다운로드 후
   설치하세요 (기본 옵션 그대로 "다음"만 눌러도 됩니다).

## 2. Node.js 설치 확인

같은 PowerShell 창에 아래를 입력하고 Enter

```
node --version
npm --version
```

버전 번호(예: `v20.x.x`)가 둘 다 나오면 설치되어 있는 것입니다. 안 나오면
https://nodejs.org 에서 **LTS(권장)** 버전을 받아 설치하세요.

## 3. Claude Code 설치와 로그인

1. PowerShell에 아래를 입력해 설치되어 있는지 확인

   ```
   claude --version
   ```

2. 버전이 나오면 이미 설치된 것입니다. 나오지 않으면 안내에 따라 Claude Code를 설치하세요
   (설치 방법은 회사에서 안내받은 방법을 그대로 따르면 됩니다).
3. 설치 후 처음 실행하면 로그인 창이 뜹니다. 평소 쓰는 계정으로 로그인하면 됩니다.

## 4. 프로젝트를 처음 받는 명령

원하는 폴더(예: `문서` 폴더)에서 PowerShell을 열고 아래를 그대로 입력하세요.
(경로는 원하는 곳 아무 데나 상관없습니다 — 어디에 받든 이후 명령은 똑같이 동작합니다.)

```
cd $HOME\Documents
git clone https://github.com/noidb/noidb-os.git 노이드비AI
cd 노이드비AI
```

`노이드비AI`라는 폴더가 생기고, 그 안에 프로젝트 전체가 받아집니다.

## 5. feature/noid-wms-foundation 브랜치 열기

받은 직후에는 기본적으로 `main` 브랜치 상태입니다. 아래 명령으로 작업 중이던
브랜치로 전환하세요.

```
git checkout feature/noid-wms-foundation
```

**절대 `main` 브랜치에서 직접 코드를 수정하거나 커밋하지 마세요.** 항상
`feature/noid-wms-foundation`에서 작업합니다.

## 6. npm install

프로젝트 폴더 안에서 (위 4~5단계를 마친 그 창에서 그대로) 아래를 입력

```
npm install
```

시간이 좀 걸릴 수 있습니다 (1~5분 정도). 끝날 때까지 기다리세요.

## 7. npm run dev (개발 서버 실행)

**가장 쉬운 방법 — 준비된 스크립트 사용:**

```
powershell -ExecutionPolicy Bypass -File scripts\start-noidb-os.ps1
```

이 스크립트가 자동으로:
- node_modules가 없으면 설치하라고 안내해줍니다.
- 이미 서버가 켜져 있으면 억지로 다시 켜지 않고 안내만 해줍니다.
- 문제없으면 개발 서버를 켜고 접속 주소를 보여줍니다.

**직접 하고 싶다면:**

```
npm run dev
```

## 8. localhost 주소 열기

개발 서버가 켜지면 웹 브라우저(크롬 등)를 열고 주소창에 아래를 입력하세요.

```
http://localhost:3000
```

메인 화면(NOID-B OS)이 보이면 성공입니다. WMS 화면은 아래 주소들입니다.

```
http://localhost:3000/wms/work-center
http://localhost:3000/wms/picking
http://localhost:3000/wms/warehouse
```

## 9. 휴대폰 테스트용 Cloudflare Tunnel 설치와 실행

휴대폰에서 접속해보려면 별도 프로그램(cloudflared)이 필요합니다.

**설치 확인 및 설치** (PowerShell, 관리자 권한 필요할 수 있음):

```
cloudflared --version
```

버전이 안 나오면 설치:

```
winget install --id Cloudflare.cloudflared -e
```

**실행 — 준비된 스크립트 사용 (개발 서버를 먼저 켜둔 상태에서):**

```
powershell -ExecutionPolicy Bypass -File scripts\start-mobile-tunnel.ps1
```

몇 초 뒤 `https://무언가.trycloudflare.com` 형태의 주소가 화면에 크게 나옵니다.
그 주소를 휴대폰 브라우저에 입력하면 됩니다.

## 10. 회사 컴퓨터에서 새 터널 URL 확인

**중요: Cloudflare Quick Tunnel 주소는 실행할 때마다 매번 새로 만들어집니다.**
어제 집 컴퓨터에서 쓰던 주소는 회사 컴퓨터에서 그대로 쓸 수 없습니다 — 반드시
회사 컴퓨터에서 9번 방법대로 다시 실행해서 **새로운 주소**를 받아야 합니다.
스크립트를 실행할 때마다 화면에 크게 표시되는 주소를 그대로 복사해서 쓰면 됩니다.

## 11. 작업 종료 전 commit/push 방법

하루 작업을 마치고 다른 컴퓨터에서 이어가려면, 변경된 내용을 GitHub에 올려야 합니다.

```
git status
```

먼저 이 명령으로 어떤 파일이 바뀌었는지 확인하세요. 문제없어 보이면:

```
git add -A
git commit -m "작업 내용을 짧게 설명"
git push origin feature/noid-wms-foundation
```

**주의사항**:
- 반드시 `feature/noid-wms-foundation`에 있는 상태에서만 commit/push 하세요
  (`git branch --show-current`로 확인 가능, `feature/noid-wms-foundation`이 나와야 정상)
- `main`에는 절대 push하지 않습니다.
- `.env.local`처럼 비밀번호/키가 든 파일은 자동으로 Git에서 제외되도록 설정되어 있습니다
  (`.gitignore`). 혹시 `git status`에 `.env`로 시작하는 파일이 보이면 커밋하지 말고
  Claude Code에게 먼저 확인을 요청하세요.

## 12. 집 컴퓨터에서 다시 이어받는 pull 방법

다음에 집 컴퓨터를 켜면, 회사에서 올린 최신 내용을 받아와야 합니다.

```
cd (프로젝트 폴더로 이동)
git checkout feature/noid-wms-foundation
git pull origin feature/noid-wms-foundation
```

만약 집 컴퓨터에서도 미처 저장 안 한 변경사항이 있다면, `git pull` 하기 전에
Claude Code에게 먼저 상태를 확인해달라고 요청하세요 (충돌 방지).

## 13. 자주 발생하는 오류와 해결법

**"git을(를) 인식할 수 없습니다" / "node을(를) 인식할 수 없습니다"**
→ 1번/2번 단계의 설치가 안 되어 있거나, 설치 후 PowerShell 창을 새로 열지 않은 경우입니다.
새 PowerShell 창을 열고 다시 시도하세요.

**`npm install` 도중 오류가 많이 나옴**
→ Node.js 버전이 너무 오래된 경우일 수 있습니다. https://nodejs.org 에서 최신 LTS로
다시 설치해보세요.

**`npm run dev` 실행했는데 화면이 안 열림 / 오류가 남**
→ 이미 3000번 포트에서 다른 프로그램이 실행 중일 수 있습니다. 다른 개발 서버 창이
열려있는지 먼저 확인하세요. Claude Code와 함께 작업 중이라면, Claude Code에게
"3000번 포트 상태를 확인해달라"고 요청하고, **직접 프로세스를 강제 종료하지 마세요.**

**빌드(`npm run build`) 관련 오류가 개발 서버에서도 같이 남**
→ `npm run dev`가 켜진 상태에서 `npm run build`를 동시에 실행하면 캐시 충돌이 날 수
있습니다 (`CLAUDE.md`에 관련 규칙이 적혀있습니다). 개발 중에는 `npm run build`를 실행하지
말고, 타입 확인이 필요하면 `npx tsc --noEmit`만 쓰세요.

**cloudflared 터널 주소가 안 열림 / "사이트에 연결할 수 없음"**
→ 주소가 만료되었거나(재시작 시 매번 새 주소 발급, 10번 참고), 개발 서버(`localhost:3000`)가
꺼져 있는 경우입니다. `start-noidb-os.ps1`이 켜져 있는지 먼저 확인 후 터널을 다시 실행하세요.

**GitHub에 push할 때 "rejected" 또는 "non-fast-forward" 오류**
→ 다른 컴퓨터에서 먼저 올린 내용이 있는데 이 컴퓨터가 그걸 받지 않은 상태입니다.
이런 경우 **강제로 push하지 말고** Claude Code에게 상황을 알려서 안전하게 합치는 방법을
안내받으세요.

**어떤 명령을 실행해야 할지 전혀 모르겠을 때**
→ Claude Code를 실행하고 "지금 상태를 확인하고 다음에 뭘 해야 하는지 알려줘"라고
물어보세요.
