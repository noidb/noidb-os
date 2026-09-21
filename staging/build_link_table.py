"""상품 연결표 v5: 제품 정보(staging v5) + 사진 폴더(연결후보 v3) 합치기.

- 입력 파일은 읽기만 한다. 결과는 staging/ 의 새 xlsx (기존 파일 있으면 중단).
- 사진 폴더 '확정' = 사용자 O 확인 / 사용자 지정 / 폴더명으로 찾은 폴더가 딱 1개.
"""
import sys, io, os, csv
from collections import defaultdict, Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO_ROOT = r"N:\개인\★전체제품사진"
STAGING = os.path.join(HERE, "NOIDB_상품마스터_staging_20260922_v5.xlsx")
PHOTO = os.path.join(HERE, "NOIDB_사진폴더연결후보_20260922_v4.xlsx")  # v3 → v4: 세트구성품 폴더 후보
CONFIRM = os.path.join(HERE, "input_사진폴더확인_20260922.csv")
OUT = os.path.join(HERE, "NOIDB_상품연결표_20260922_v7.xlsx")  # v5·v6 보존. v7: 확인 CSV의 O를 재스캔 없이 바로 반영
OUT = os.path.join(HERE, "NOIDB_상품연결표_20260922_v8.xlsx")  # v8: 확인 CSV의 X 제외 + 새 지정 폴더 추가도 재스캔 없이

if os.path.exists(OUT):
    sys.exit(f"결과 파일이 이미 있습니다. 덮어쓰지 않고 중단합니다: {OUT}")


def read(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True)
    it = wb[sheet].iter_rows(values_only=True)
    h = [str(x) for x in next(it)]
    rows = [{k: ("" if v is None else str(v)) for k, v in zip(h, r)} for r in it]
    wb.close()
    return rows


skus = read(STAGING, "20_연결표")
prods = read(STAGING, "10_제품")
aliases = read(STAGING, "30_별칭")
cands = read(PHOTO, "20_연결후보")

notes = {}
user_ok = set()  # (모델명, 상대경로) — 재스캔 없이 사용자 O 반영
user_no = set()  # X·삭제됨
with open(CONFIRM, encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        key = (r["모델명"].strip(), r["사진폴더(상대경로)"].strip())
        if r["판정"].strip() == "O":
            user_ok.add(key)
        elif r["판정"].strip() in ("X", "삭제됨"):
            user_no.add(key)
        if not r["사진폴더(상대경로)"].strip() and r["판정"].strip() in ("사진없음", "사진불필요"):
            notes[r["모델명"].strip()] = r["판정"].strip()

by_code = defaultdict(list)
for c in cands:
    by_code[c["제품코드"]].append(c)

photo = {}
added_manual = 0
for p in prods:
    code = p["제품코드"]
    ms = p["모델명들"].split(", ")
    cs = [c for c in by_code.get(code, []) if not any((m, c["사진폴더(상대경로)"]) in user_no for m in ms)]
    have = {c["사진폴더(상대경로)"] for c in cs}
    for m, rel in sorted(user_ok):
        if m in ms and rel and rel not in have and os.path.isdir(os.path.join(PHOTO_ROOT, rel)):
            cs.append({"사진폴더(상대경로)": rel, "찾은방식": "사용자 지정", "확인(O/X)": "O"})
            have.add(rel)
            added_manual += 1
    auto_single = len(cs) == 1 and cs[0]["찾은방식"] == "폴더명"
    ok, pending = [], []
    for c in cs:
        full = os.path.join(PHOTO_ROOT, c["사진폴더(상대경로)"])
        csv_ok = any((m, c["사진폴더(상대경로)"]) in user_ok for m in p["모델명들"].split(", "))
        if c["확인(O/X)"].startswith("O") or csv_ok or c["찾은방식"] == "사용자 지정" or auto_single:
            ok.append(full)
        else:
            pending.append(full)
    note = next((notes[m] for m in p["모델명들"].split(", ") if m in notes), "")
    if note:
        state = note
    elif not cs:
        state = "못 찾음" if p["모델명들"] else "모델명 없음"
    elif not pending:
        state = "확정"
    elif ok:
        state = "일부 미확인"
    else:
        state = "미확인"
    photo[code] = (state, ok, pending)

J = "\n"
out = openpyxl.Workbook()


def sheet(title, headers, data, first=False, wide=()):
    ws = out.active if first else out.create_sheet(title)
    ws.title = title
    ws.append(headers)
    for row in data:
        ws.append(row)
    for c_ in ws[1]:
        c_.font, c_.fill = Font(bold=True), PatternFill("solid", fgColor="DDEBF7")
    for col in ws.iter_cols(min_row=2):
        for c_ in col:
            c_.number_format = "@"
    for n_, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(n_)].width = 70 if h in wide else max(10, min(30, len(h) * 2 + 2))
    ws.freeze_panes = "A2"
    if data:
        ws.auto_filter.ref = ws.dimensions


sheet("00_안내", ["내용"], [
    ["NOID-B 상품 연결표 v6 (2026-09-22) — SKU ID 하나로 모델명·옵션·사진 폴더를 찾는 표"],
    ["세트상품(ws 등)은 자기 폴더가 없으면 같은 번호의 구성품 폴더(wp·we·wn 등)를 '미확인 후보'로 보여줍니다."],
    ["사용법: 10_SKU조회 탭에서 Ctrl+F 로 SKU ID(또는 모델명·바코드·옵션ID)를 검색 → 같은 행에 모델명·사진 폴더가 나옵니다."],
    ["같은 제품의 다른 옵션은 '제품코드'가 같습니다. 제품코드로 필터하면 모든 옵션이 한 번에 보입니다."],
    ["사진상태: 확정(확인됨) / 일부 미확인 / 미확인(후보만 있음) / 못 찾음 / 사진없음·사진불필요(사용자 확인)"],
    ["사진폴더(확정) = 사용자 O 확인, 사용자 지정, 또는 폴더명으로 찾은 폴더가 1개뿐인 경우."],
    ["이 파일은 검토용이며 운영 시트·사이트에 연결되어 있지 않습니다. 원본 Excel·사진 폴더는 변경하지 않았습니다."],
    [f"입력: {os.path.basename(STAGING)}, {os.path.basename(PHOTO)}, {os.path.basename(CONFIRM)}"],
], first=True)

sku_hdr = ["SKU ID", "제품코드", "모델명", "모델SKU", "옵션접미사", "바코드", "옵션ID", "추가옵션ID", "노출상품ID",
           "재등록구분", "사진상태", "사진폴더(확정)", "사진폴더(미확인 후보)", "현재상태(원본)", "발주상태(쿠팡)"]
sku_rows = []
for s in skus:
    st, ok, pending = photo.get(s["제품코드"], ("", [], []))
    sku_rows.append([s["SKU ID"], s["제품코드"], s["모델명(원본)"], s["모델SKU"], s["옵션접미사(색상코드)"], s["바코드"],
                     s["옵션ID"], s["추가옵션ID"], s["노출상품ID"], s["재등록구분"], st, J.join(ok), J.join(pending),
                     s["현재상태(원본)"], s["발주상태(쿠팡)"]])
sheet("10_SKU조회", sku_hdr, sku_rows, wide=("사진폴더(확정)", "사진폴더(미확인 후보)"))

sku_by_code = defaultdict(list)
for s in skus:
    sku_by_code[s["제품코드"]].append(s)
prod_hdr = ["제품코드", "대표모델명", "모델명들", "재등록구분(요약)", "SKU수", "SKU ID들", "모델SKU들", "사진상태",
            "사진폴더(확정)", "사진폴더(미확인 후보)"]
prod_rows = []
for p in prods:
    st, ok, pending = photo[p["제품코드"]]
    ss = sku_by_code[p["제품코드"]]
    prod_rows.append([p["제품코드"], p["대표모델명"], p["모델명들"], p["재등록구분(요약)"], p["SKU수"],
                      ", ".join(s["SKU ID"] for s in ss), ", ".join(sorted({s["모델SKU"] for s in ss if s["모델SKU"]})),
                      st, J.join(ok), J.join(pending)])
sheet("20_제품", prod_hdr, prod_rows, wide=("사진폴더(확정)", "사진폴더(미확인 후보)"))

task = [r for r in prod_rows if "1차_판매중지" in r[3]]
sheet("30_1차재등록_작업목록", prod_hdr, task, wide=("사진폴더(확정)", "사진폴더(미확인 후보)"))
task2 = [r for r in prod_rows if "2차_판매량저조" in r[3] and "1차_판매중지" not in r[3]]
sheet("31_2차재등록_작업목록", prod_hdr, task2, wide=("사진폴더(확정)", "사진폴더(미확인 후보)"))

al = [[a["제품코드"], a["종류"], a["값"], a["출처"], ""] for a in aliases]
for code, (st, ok, pending) in photo.items():
    al += [[code, "사진폴더", f, "사진스캔", "확정"] for f in ok]
    al += [[code, "사진폴더", f, "사진스캔", "미확인"] for f in pending]
al.sort(key=lambda r: (r[0], r[1], r[2]))
sheet("40_별칭", ["제품코드", "종류", "값", "출처", "비고"], al, wide=("값",))

out.save(OUT)
print("저장:", OUT)
print("제품 사진상태", Counter(v[0] for v in photo.values()).most_common())
print("1차 작업목록", len(task), Counter(r[7] for r in task).most_common())
print("2차 작업목록", len(task2), Counter(r[7] for r in task2).most_common())
print("SKU행", len(sku_rows), "| 별칭행", len(al), "| 사용자 지정 폴더 추가", added_manual)
