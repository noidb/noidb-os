# NOID-B OS V8 실무수정판

- 여성 반지 기본 사이즈: 9,11,14,17,20호
- 남성 반지 기본 사이즈: 20,22,25호
- 성별 변경 시 반지 사이즈 자동 변경
- 원본 디자인 유지 1000x1000 흰 배경 썸네일
- 반지 SKU 파일명: 모델명-GO9.jpg, 모델명-SI11.jpg 형태
- 라벨 파일명: 라벨_모델명.jpg
- 제조자: 프리스타일 협력사
- 수입자: 프리스타일
- 주소: 경기도 고양시 탄현동 탄현동 1559-1
- 상세페이지 사진 사이/상단/하단 30px 여백
- 상세페이지 파일명: 모델명.jpg
- 상세사진 드래그앤드롭 순서변경
- 사선 제품컷, 뒷면 구조컷 제거
- 모바일 버튼/입력칸 확대
# NOID-B OS

노이드비 상품 등록·이미지·재고·발주·물류 자동화 프로젝트입니다.

## 집 PC와 창고 PC에서 이어서 작업하기

GitHub `noidb/noidb-os`의 `main` 브랜치를 공용 원본으로 사용합니다. 어느 PC에서든 작업 전에 `PC_작업시작.cmd`, 작업을 마친 뒤 `PC_작업저장.cmd`를 실행합니다.

- `PC_작업시작.cmd`: GitHub의 최신 코드를 현재 PC로 받습니다.
- `PC_작업저장.cmd`: 빌드 검사 후 변경사항을 GitHub에 저장하고 Vercel 배포를 시작합니다.
- `.env.local`, 쿠팡 로그인 프로필, 처리 이력은 PC별 로컬 정보이므로 GitHub에 올리지 않습니다.
- 운영 사이트는 [https://noidb-os.vercel.app](https://noidb-os.vercel.app)이며 집·창고 PC가 꺼져도 작동합니다.

새 PC에서는 먼저 저장소를 복제합니다.

```powershell
git clone https://github.com/noidb/noidb-os.git NOID-B-자동화
cd NOID-B-자동화
npm ci
```

쿠팡 발주 자동수집 설정은 `automation/coupang-po/README.md`를 따릅니다.
