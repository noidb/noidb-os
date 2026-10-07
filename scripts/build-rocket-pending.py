"""
로켓 미등록 상품 목록 만들기 — data/rocket-pending.json

"로켓 미등록" = 쿠팡 Wing(판매자센터)에만 있고 Supplier Hub(로켓)에는 없는 상품.
상품공급상태 파일에 있는 상품은 모두 이미 로켓 SKU ID가 있으므로 넣지 않는다(다시 올리면 중복 반려).

입력(3개):
  1) 상품공급상태관리 다운로드 xlsx — 로켓에 이미 있는 상품(바코드·상품명)을 빼는 데 쓴다
  2) 상품연결표 xlsx (10_SKU조회 탭) — 로켓에 이미 있는 모델명을 빼는 데 쓴다
  3) 쿠팡 Wing 상품정보 다운로드 xlsx (Template 탭)

Wing 모델번호의 모델이 로켓(연결표·공급상태)에 이미 있으면 같은 상품이 로켓에 있는 것이므로 뺀다.
사용: python3 scripts/build-rocket-pending.py 공급상태.xlsx 연결표.xlsx wing.xlsx
"""
import json, re, sys, collections
import openpyxl

supply_path, link_path, wing_path = sys.argv[1:4]
norm = lambda s: re.sub(r"[\s\W_]+", "", re.sub(r"노이드비", "", s or "")).lower()

def model_of(raw):
    """Wing 모델번호에는 상품명이 적힌 경우도 있다 → 모델명 형식(영문 1~4자 + 숫자)만 쓰고, 끝의 색상 코드는 뗀다."""
    m = re.match(r"^([a-z]{1,4}\d{3,7})", (raw or "").strip().lower())
    return m.group(1) if m else ""

supply = list(openpyxl.load_workbook(supply_path).worksheets[0].iter_rows(min_row=2, values_only=True))
supply_barcodes = {str(r[3] or "").strip() for r in supply if r[3]}
supply_names = {norm(str(r[2] or "").split(" / ")[0]) for r in supply}
link = openpyxl.load_workbook(link_path, read_only=True)
rocket_models = {str(r[2]).strip().lower() for r in link["10_SKU조회"].iter_rows(min_row=2, values_only=True) if r[2]}

ws = openpyxl.load_workbook(wing_path)["Template"]
hdr = [c.value for c in ws[4]]
col = {name: hdr.index(name) for name in ["등록상품ID", "등록상품명", "카테고리", "노출상품ID", "옵션 ID", "등록 옵션명", "모델번호", "바코드", "판매상태", "승인상태"]}
rows = []
for r in ws.iter_rows(min_row=5, values_only=True):
    if r[col["등록상품ID"]]:
        rows.append({k: str(r[i] or "").strip() for k, i in col.items()})

# 공급상태(로켓)에 바코드나 상품명이 있는 Wing 상품 → 그 상품의 모델도 로켓에 있는 모델로 본다.
on_rocket_product = collections.defaultdict(bool)
for row in rows:
    if row["바코드"] in supply_barcodes or norm(row["등록상품명"]) in supply_names:
        on_rocket_product[row["등록상품ID"]] = True
        if model_of(row["모델번호"]):
            rocket_models.add(model_of(row["모델번호"]))

PREFIX_CATEGORY = {"e": "귀걸이", "n": "목걸이", "r": "반지", "b": "팔찌", "a": "발찌", "p": "피어싱"}
def category_of(model, name, wing_category):
    m = re.match(r"^([wm])([a-z])", model)
    if m and m.group(2) in PREFIX_CATEGORY:
        return PREFIX_CATEGORY[m.group(2)]
    for word in ["발찌", "팔찌", "피어싱", "귀걸이", "반지", "목걸이"]:
        if word in f"{name} {wing_category}":
            return word
    return ""

items, skipped = [], collections.Counter()
seen = set()
for row in rows:
    if on_rocket_product[row["등록상품ID"]]:
        skipped["로켓에 같은 상품"] += 1
        continue
    model = model_of(row["모델번호"])
    if model and model in rocket_models:
        skipped["로켓에 같은 모델"] += 1
        continue
    key = f"wing:{row['옵션 ID'] or row['등록상품ID']}"
    if key in seen:
        continue
    seen.add(key)
    name = row["등록상품명"]
    items.append({
        "skuId": key, "modelSku": "", "modelName": model,
        "category": category_of(model, name, row["카테고리"]),
        "gender": "남성" if model.startswith("m") or "남성" in name else "여성",
        "productName": name, "optionLabel": row["등록 옵션명"],
        "barcode": row["바코드"], "orderableStatus": row["판매상태"] or row["승인상태"],
        "exposedProductId": row["노출상품ID"], "wingProductId": row["등록상품ID"],
        "modelSource": "Wing 모델번호" if model else "모델번호 없음",
    })

json.dump({"generatedFrom": [p.split("/")[-1] for p in (supply_path, link_path, wing_path)], "items": items},
          open("data/rocket-pending.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "상품(옵션) ·", len({i["modelName"] for i in items if i["modelName"]}), "모델 ·",
      dict(collections.Counter(i["modelSource"] for i in items)), "· 뺀 것", dict(skipped))
