"""
로켓 미등록(제품DB에 없는) 상품 목록 만들기 — data/rocket-pending.json

입력(3개):
  1) 상품공급상태관리 다운로드 xlsx (SKU ID·상품명·바코드·발주가능상태)
  2) 상품연결표 xlsx (10_SKU조회 탭) — 이미 제품DB에 있는 SKU를 빼는 데 쓴다
  3) 쿠팡 Wing 상품정보 다운로드 xlsx (Template 탭: 등록상품명·모델번호·바코드·카테고리)

모델명은 Wing "모델번호"에서 가져온다. 바코드 → 상품명 정확히 일치 → 비슷한 상품명(확인 필요) 순서.
사용: python3 scripts/build-rocket-pending.py 공급상태.xlsx 연결표.xlsx wing.xlsx
"""
import json, re, sys, difflib, collections
import openpyxl

supply_path, link_path, wing_path = sys.argv[1:4]
norm = lambda s: re.sub(r"[\s\W_]+", "", re.sub(r"노이드비", "", s or "")).lower()

supply = list(openpyxl.load_workbook(supply_path).worksheets[0].iter_rows(min_row=2, values_only=True))
link = openpyxl.load_workbook(link_path, read_only=True)
linked = {str(r[0]).strip() for r in link["10_SKU조회"].iter_rows(min_row=2, values_only=True) if r[0]}

ws = openpyxl.load_workbook(wing_path)["Template"]
hdr = [c.value for c in ws[4]]
col = {name: hdr.index(name) for name in ["등록상품ID", "등록상품명", "카테고리", "노출상품ID", "모델번호", "바코드"]}
def model_of(raw):
    """Wing 모델번호에는 상품명이 적힌 경우도 있다 → 모델명 형식(영문 1~4자 + 숫자)만 쓰고, 끝의 색상 코드(rg 등)는 뗀다."""
    m = re.match(r"^([a-z]{1,4}\d{3,7})", (raw or "").strip().lower())
    return m.group(1) if m else ""

wing = []
for r in ws.iter_rows(min_row=5, values_only=True):
    if not r[col["등록상품ID"]]:
        continue
    row = {k: str(r[i] or "").strip() for k, i in col.items()}
    row["모델번호"] = model_of(row["모델번호"])
    wing.append(row)
by_barcode = {w["바코드"]: w for w in wing if w["바코드"] and w["모델번호"]}
by_name = collections.defaultdict(list)
for w in wing:
    if w["모델번호"]:
        by_name[norm(w["등록상품명"])].append(w)
name_keys = list(by_name)

PREFIX_CATEGORY = {"e": "귀걸이", "n": "목걸이", "r": "반지", "b": "팔찌", "a": "발찌", "p": "피어싱"}
def category_of(model, name, wing_category):
    m = re.match(r"^([wm])([a-z])", model.lower())
    if m and m.group(2) in PREFIX_CATEGORY:
        return PREFIX_CATEGORY[m.group(2)]
    text = f"{name} {wing_category}"
    for word in ["발찌", "팔찌", "피어싱", "귀걸이", "반지", "목걸이"]:
        if word in text:
            return word
    return ""
def gender_of(model, name):
    if model.lower().startswith("m") or "남성" in name:
        return "남성"
    return "여성"

items = []
for r in supply:
    sku = str(r[0] or "").strip()
    if not sku or sku in linked:
        continue
    full = str(r[2] or "")
    name, _, option = full.partition(" / ")
    w, source = by_barcode.get(str(r[3] or "").strip()), "바코드"
    if not w:
        hit = by_name.get(norm(name))
        w, source = (hit[0], "상품명") if hit else (None, "")
    if not w:
        close = difflib.get_close_matches(norm(name), name_keys, n=1, cutoff=0.9)
        if close:
            w, source = by_name[close[0]][0], "비슷한 상품명 · 확인 필요"
    model = (w or {}).get("모델번호", "").lower()
    items.append({
        "skuId": sku, "modelSku": "", "modelName": model,
        "category": category_of(model, name, (w or {}).get("카테고리", "")),
        "gender": gender_of(model, name),
        "productName": name.strip(), "optionLabel": option.strip(),
        "barcode": str(r[3] or "").strip(), "orderableStatus": str(r[4] or ""),
        "exposedProductId": (w or {}).get("노출상품ID", ""),
        "modelSource": source or "모델번호 없음",
    })

json.dump({"generatedFrom": [p.split("/")[-1] for p in (supply_path, link_path, wing_path)], "items": items},
          open("data/rocket-pending.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
c = collections.Counter(i["modelSource"] for i in items)
print(len(items), "SKU ·", len({i["modelName"] for i in items if i["modelName"]}), "모델 ·", dict(c))
