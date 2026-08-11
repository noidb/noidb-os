# NOID-B 쿠팡 발주 자동수집기

Supplier Hub에서 발주리스트를 내려받고 기존 NOID-B 발주 업로드 API에 자동 반영합니다.

## 첫 설정

1. `npm install`
2. `npm run coupang:login` 실행 후 전용 Edge 창에서 직접 로그인
3. `npm run coupang:inspect`로 로그인된 화면 메뉴 검사
4. `npm run coupang:auto`로 다운로드와 업로드 시험

아이디와 비밀번호는 코드나 설정 파일에 저장하지 않습니다. 로그인 쿠키는 Git에서 제외된 `.profile` 폴더에만 보관됩니다.

처리한 파일의 SHA-256 해시는 `.state/processed.json`에 저장되므로 같은 파일은 다시 올리지 않습니다. 원본 다운로드 파일은 삭제하거나 이동하지 않습니다.

시험 성공 후 예약 실행 예시:

```powershell
powershell -ExecutionPolicy Bypass -File .\automation\coupang-po\install-task.ps1 -DailyTime "08:30"
```
