# NOID-B 쿠팡 발주 자동수집기

다운로드 폴더의 Supplier Hub 발주리스트를 감지해 기존 NOID-B 발주 업로드 API에 자동 반영합니다.

## 안전한 자동화 범위

Supplier Hub는 자동화 브라우저 접속을 차단하므로 로그인과 발주리스트 다운로드는 사용자가 직접 수행합니다. 파일 다운로드 이후의 감지, 중복검사, 업로드, 구글시트 반영과 발주서 출력은 자동입니다.

1. `npm install`
2. `npm run coupang:watch`
3. Supplier Hub에서 `PO_SKU_LIST.csv/xlsx` 또는 발주서 엑셀을 다운로드

처리한 파일의 SHA-256 해시는 `.state/processed.json`에 저장되므로 같은 파일은 다시 올리지 않습니다. 원본 다운로드 파일은 삭제하거나 이동하지 않습니다.

Windows 로그인 때 자동 감시 시작:

```powershell
powershell -ExecutionPolicy Bypass -File .\automation\coupang-po\install-task.ps1
```
