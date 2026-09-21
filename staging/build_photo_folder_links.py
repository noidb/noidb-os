"""제품 ↔ 사진 폴더 연결 후보 생성 (읽기 전용).

- N:\\개인\\★전체제품사진 은 목록만 읽는다. 사진 복사·이동·이름변경·삭제 없음.
- 입력: staging v3 의 10_제품 탭. 출력: staging/ 의 새 xlsx (기존 파일 있으면 중단).
"""
import sys, io, os, re
from collections import defaultdict, Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = r"N:\개인\★전체제품사진"
HERE = os.path.dirname(os.path.abspath(__file__))
# v2(2026-09-22): 제품번호 정확히 일치(앞자리 0 포함)만 매칭, 사용자 확인 결과 반영. v1 결과 파일은 보존.
# v3: staging v5 기준, 사용자 지정 폴더 추가(wa00268), wr00059 복원 폴더 포함.
STAGING = os.path.join(HERE, "NOIDB_상품마스터_staging_20260922_v5.xlsx")
OUT = os.path.join(HERE, "NOIDB_사진폴더연결후보_20260922_v3.xlsx")
# v4: 세트상품(2번째 글자 s)은 폴더가 없으면 같은 성별글자+같은 숫자의 구성품 폴더를 후보로 (ws011406 → wp011406).
OUT = os.path.join(HERE, "NOIDB_사진폴더연결후보_20260922_v4.xlsx")
CONFIRM = os.path.join(HERE, "input_사진폴더확인_20260922.csv")
IMG = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")

if os.path.exists(OUT):
    sys.exit(f"결과 파일이 이미 있습니다. 덮어쓰지 않고 중단합니다: {OUT}")

TOK = re.compile(r"([a-zA-Z]{2,4})[-_ ]?(\d{4,8})(?:\s*~\s*(\d{1,6}))?")


def keys_in(text):
    """'mr011708~713' 같은 범위 표기도 펼친다. 앞자리 0 개수까지 정확히 일치해야 같은 번호
    (we00130 != we000130, mn000009 != mn0009 — 사용자 확인 2026-09-22)."""
    out = set()
    for a, n, end in TOK.findall(text):
        a = a.lower()
        out.add(a + n)
        if end and len(end) < len(n):
            start = int(n)
            stop = int(n[: len(n) - len(end)] + end)
            if 0 < stop - start <= 20:
                for k in range(start + 1, stop + 1):
                    out.add(a + str(k).zfill(len(n)))
    return out


# ---------- 제품 읽기 ----------
wb = openpyxl.load_workbook(STAGING, read_only=True)
it = wb["10_제품"].iter_rows(values_only=True)
H = list(next(it))
products = []
for r in it:
    d = dict(zip(H, r))
    models = [m.strip() for m in (d.get("모델명들") or "").split(",") if m.strip()]
    ks = set()
    for m in models:
        ks |= keys_in(m)
    products.append({"code": d["제품코드"], "model": d.get("대표모델명") or "", "models": models, "keys": ks,
                     "cat": d.get("재등록구분(요약)") or ""})
wb.close()
key2prod = defaultdict(set)
for p in products:
    for k in p["keys"]:
        key2prod[k].add(p["code"])

# ---------- 폴더 훑기 (읽기 전용) ----------
folders = []  # (relpath, depth, image_count, file_keys)
errors = 0
for dirpath, dirnames, filenames in os.walk(ROOT, onerror=lambda e: None):
    rel = os.path.relpath(dirpath, ROOT)
    if rel == ".":
        rel = ""
    imgs = [f for f in filenames if f.lower().endswith(IMG)]
    fkeys = set()
    for f in imgs:
        fkeys |= keys_in(os.path.splitext(f)[0])
    folders.append((rel, 0 if not rel else rel.count(os.sep) + 1, len(imgs), fkeys))

# ---------- 매칭 ----------
links = defaultdict(dict)  # code -> {relpath: 방식}
folder_hit = set()
for rel, depth, n_img, fkeys in folders:
    if not rel:
        continue
    name = os.path.basename(rel)
    for k in keys_in(name):
        for c in key2prod.get(k, ()):
            links[c][rel] = "폴더명"
            folder_hit.add(rel)
# 세트상품: 폴더명으로 못 찾았으면 구성품 폴더(같은 성별글자 + 같은 숫자, 2번째 글자만 다름)를 후보로
SET_KEY = re.compile(r"^([a-z])s(\d+)$")
dir_by_key = defaultdict(set)
for rel, depth, n_img, fkeys in folders:
    if rel:
        for k in keys_in(os.path.basename(rel)):
            dir_by_key[k].add(rel)
sibling_index = defaultdict(set)  # (성별글자, 숫자) -> 폴더
for k, rels in dir_by_key.items():
    m_ = re.match(r"^([a-z])([a-z])(\d+)$", k)
    if m_ and m_.group(2) != "s":
        sibling_index[(m_.group(1), m_.group(3))] |= rels
set_added = 0
for p in products:
    if links.get(p["code"]):
        continue
    for k in p["keys"]:
        m_ = SET_KEY.match(k)
        if m_:
            for rel in sibling_index.get((m_.group(1), m_.group(2)), ()):
                links[p["code"]][rel] = "세트구성품 폴더"
                folder_hit.add(rel)
                set_added += 1

# 상위 폴더가 이미 같은 제품에 연결됐으면 하위 폴더는 생략
for c, m in links.items():
    for rel in sorted(m, key=len):
        if rel in m and any(rel != o and rel.startswith(o + os.sep) for o in m):
            del m[rel]
# 파일명 일치: 폴더명으로 못 찾은 제품만
img_count = {rel: n for rel, _, n, _ in folders}
for rel, depth, n_img, fkeys in folders:
    for k in fkeys:
        for c in key2prod.get(k, ()):
            if not links.get(c) or all(v in ("파일명", "세트구성품 폴더") for v in links[c].values()):
                links[c].setdefault(rel or "(최상위)", "파일명")
                folder_hit.add(rel)


# 사용자 확인 결과: X·삭제됨은 연결에서 빼고, O는 확인 칸에 표시
import csv
confirm = {}
with open(CONFIRM, encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        confirm[(row["모델명"].strip(), row["사진폴더(상대경로)"].strip())] = (row["판정"].strip(), row["비고"].strip())
code_models = {p["code"]: set(p["models"]) for p in products}
removed = 0
for c, m in links.items():
    for rel in list(m):
        for mdl in code_models.get(c, ()):
            v = confirm.get((mdl, rel))
            if v and v[0] in ("X", "삭제됨"):
                del m[rel]
                removed += 1
                break


# 번호가 달라 자동으로 못 찾았지만 사용자가 O로 지정한 폴더는 직접 추가 (예: wa000268 ↔ wa00268 폴더)
model2code = {mdl: c for c, ms in code_models.items() for mdl in ms}
known = {rel for rel, *_ in folders}
added = 0
for (mdl, rel), (verdict, _) in confirm.items():
    c = model2code.get(mdl)
    if verdict == "O" and c and rel in known and rel not in links[c]:
        links[c][rel] = "사용자 지정"
        added += 1


def confirmed(code, rel):
    for mdl in code_models.get(code, ()):
        v = confirm.get((mdl, rel))
        if v and v[0] == "O":
            return "O (사용자 확인)"
    return ""


def img_total(rel):
    """해당 폴더와 하위 폴더의 이미지 수."""
    if rel == "(최상위)":
        return img_count.get("", 0)
    return sum(n for r, n in img_count.items() if r == rel or r.startswith(rel + os.sep))


# ---------- 결과 ----------
def prio(p):
    c = p["cat"]
    return 0 if "1차_판매중지" in c else 1 if "2차_판매량저조" in c else 3 if "영구제외" in c else 2


summary, cand, missing = [], [], []
for p in sorted(products, key=lambda p: (prio(p), p["code"])):
    m = links.get(p["code"], {})
    kinds = set(m.values())
    if not p["models"]:
        state = "모델명 없음"
    elif not m:
        state = "못 찾음"
    elif len(m) == 1:
        state = "1개" + (" (파일명으로 찾음)" if kinds == {"파일명"} else "")
    else:
        state = f"{len(m)}개 (확인 필요)" + (" (파일명으로 찾음)" if kinds == {"파일명"} else "")
    pr = ["1차_판매중지", "2차_판매량저조", "일반", "영구제외"][prio(p)]
    summary.append([p["code"], p["model"], pr, p["cat"], str(len(m)), state])
    for rel, how in sorted(m.items()):
        shared = [c for c in links if c != p["code"] and rel in links[c]]
        cand.append([p["code"], p["model"], pr, rel, how, str(img_total(rel)),
                     ", ".join(sorted(shared))[:200], confirmed(p["code"], rel)])
    if not m and p["models"]:
        missing.append([p["code"], p["model"], pr, ", ".join(p["models"])])

unlinked = []
for rel, depth, n_img, fkeys in folders:
    if rel and depth == 1 and rel not in folder_hit and not any(h.startswith(rel + os.sep) for h in folder_hit):
        unlinked.append([rel, str(img_total(rel))])

out = openpyxl.Workbook()


def sheet(title, headers, data, first=False):
    ws = out.active if first else out.create_sheet(title)
    ws.title = title
    ws.append(headers)
    for row in data:
        ws.append(row)
    for c_ in ws[1]:
        c_.font, c_.fill = Font(bold=True), PatternFill("solid", fgColor="DDEBF7")
    for n_, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(n_)].width = 60 if "폴더" in h else max(10, len(h) * 2 + 2)
    ws.freeze_panes = "A2"
    if data:
        ws.auto_filter.ref = ws.dimensions


sheet("00_안내", ["내용"], [
    ["제품 ↔ 사진 폴더 연결 후보 (2026-09-21, 읽기 전용 스캔)"],
    [f"사진 루트: {ROOT} (폴더 경로는 이 루트 기준 상대경로)"],
    ["사진은 복사·이동·이름변경·삭제하지 않았습니다. 폴더 경로만 기록했습니다."],
    ["매칭: 폴더 이름(또는 사진 파일 이름) 안의 모델번호가 앞자리 0까지 정확히 같을 때만 (we00130 ≠ we000130). mr011708~713 범위 포함"],
    ["사용자 확인 결과(input_사진폴더확인_20260922.csv) 반영: X·삭제됨은 제외, O는 확인 칸에 표시"],
    ["확인 순서: 10_제품별요약에서 우선순위=1차_판매중지 → '확인 필요'/'못 찾음' 부터"],
    ["20_연결후보의 '확인' 칸에 O(맞음) / X(아님) 을 적어주시면 연결표에 반영합니다."],
    ["'다른제품과 공유' 칸이 있으면 한 폴더에 여러 제품 사진이 섞인 폴더입니다."],
], first=True)
sheet("10_제품별요약", ["제품코드", "대표모델명", "우선순위", "재등록구분", "폴더수", "상태"], summary)
sheet("20_연결후보", ["제품코드", "대표모델명", "우선순위", "사진폴더(상대경로)", "찾은방식", "이미지수", "다른제품과 공유", "확인(O/X)"], cand)
sheet("30_못찾은제품", ["제품코드", "대표모델명", "우선순위", "모델명들"], missing)
sheet("40_어느제품과도안맞은폴더", ["최상위 폴더", "이미지수"], unlinked)
out.save(OUT)

print("저장:", OUT)
print("스캔 폴더", len(folders), "| 이미지", sum(img_count.values()))
print("제품 상태", Counter(s[5].split(" (")[0] if "확인" not in s[5] else "2개 이상" for s in summary).most_common())
print("파일명으로만 찾음", sum(1 for s in summary if "파일명" in s[5]))
for pr in ["1차_판매중지", "2차_판매량저조"]:
    print(pr, Counter(("2개 이상" if "확인" in s[5] else s[5].split(" (")[0]) for s in summary if s[2] == pr).most_common())
print("연결후보 행", len(cand), "| 공유폴더 행", sum(1 for c in cand if c[6]))
print("어느 제품과도 안 맞은 최상위 폴더", len(unlinked))
print("세트구성품 폴더로 추가된 연결", set_added, "| ws011406:", links.get(next((p["code"] for p in products if "ws011406" in p["models"]), ""), {}))
print("사용자 지정으로 추가된 연결", added, "| 사용자 확인으로 제외된 연결", removed, "| O 표시", sum(1 for c in cand if c[7]))
print("1차 확인필요 제품", [s[1] for s in summary if s[2] == "1차_판매중지" and "확인" in s[5]])
