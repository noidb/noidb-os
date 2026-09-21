"""NOID-B 상품마스터 staging 생성 (로컬 xlsx 전용).

- 원본 Excel은 읽기 전용으로만 연다. 원본에 쓰지 않는다.
- Google Sheets에 쓰지 않는다. 결과는 staging/ 폴더의 새 xlsx로만 저장한다.
- 기존 결과 파일이 있으면 덮어쓰지 않고 중단한다.
"""
import sys, io, re, os
from collections import defaultdict, Counter
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

SRC = r"G:\내 드라이브\쿠팡데이터\SKU_ID_상품명_기준_통합정리.xlsx"
HERE = os.path.dirname(os.path.abspath(__file__))
LOW_SALES_LIST = os.path.join(HERE, "input_판매량저조영구정지_20260921.txt")
# v1(NOIDB_상품마스터_staging_20260921.xlsx)은 그대로 보존. v2: 가품·판매량저조도 모델 전체 적용, 옵션접미사, 옵션ID 후보.
# v3: 한 SKU에 옵션ID 여러 개 허용(추가옵션ID), 사용자 확인값 반영, 출처별 옵션ID 불일치 검토.
OUT = os.path.join(HERE, "NOIDB_상품마스터_staging_20260921_v3.xlsx")
# v4: 사용자가 가품(재등록불가)으로 추가 지정한 모델명 반영.
OUT = os.path.join(HERE, "NOIDB_상품마스터_staging_20260922_v4.xlsx")
# v5: 가품 추가지정 목록 갱신(mb011243 추가).
OUT = os.path.join(HERE, "NOIDB_상품마스터_staging_20260922_v5.xlsx")
FAKE_MODELS_LIST = os.path.join(HERE, "input_가품추가_20260922.txt")

# 사용자가 서플라이허브에서 직접 확인한 옵션ID (SKU ID → 옵션ID 목록). 첫 번째가 대표 옵션ID.
CONFIRMED_OPTION_IDS = {
    "50277710": (["91058736384", "91058740631"], "사용자 서플라이허브 확인 2026-09-21 (같은 노출상품ID, 원본의 22자리 값은 무관한 번호가 붙은 손상값)"),
}

if os.path.exists(OUT):
    sys.exit(f"결과 파일이 이미 있습니다. 덮어쓰지 않고 중단합니다: {OUT}")


def txt(v):
    """모든 값을 텍스트로. 정수형 float는 소수점 제거."""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def norm(v):
    return re.sub(r"\s+", "", txt(v)).lower()


# ---------- 원본 읽기 ----------
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
it = wb["01_마스터"].iter_rows(values_only=True)
HDR = [txt(h) for h in next(it)]
rows = []
for i, r in enumerate(it, start=2):
    if not r or r[0] in (None, ""):
        continue
    d = {h: txt(v) for h, v in zip(HDR, r) if h}
    d["_row"] = i
    rows.append(d)

# 옵션ID 후보: 00_통합데이터의 로켓리스트·전수조사 값
it = wb["00_통합데이터"].iter_rows(values_only=True)
UH = [txt(h) for h in next(it)]
alt_cols = [i for i, h in enumerate(UH) if h in ("옵션ID_로켓리스트", "Vendoritemid_전수조사")]
opt_alt = defaultdict(dict)
for r in it:
    if not r or r[0] in (None, ""):
        continue
    for i in alt_cols:
        v = txt(r[i]) if i < len(r) else ""
        if v:
            opt_alt[txt(r[0])][UH[i]] = v
wb.close()

low_sales = [l.strip() for l in open(LOW_SALES_LIST, encoding="utf-8") if l.strip()]
low_sales_set = set(low_sales)

N = len(rows)
sku = [r["SKU ID"] for r in rows]
model = [r.get("모델명", "") for r in rows]
pid = [r.get("노출상품ID", "") for r in rows]
msku = [r.get("모델SKU", "") for r in rows]
wh = [r.get("창고번호", "") for r in rows]

issues = []  # (유형, 제품코드placeholder idx, SKU ID, 내용)


def issue(kind, idx, detail):
    issues.append((kind, idx, detail))


# ---------- 제품 묶기 (union-find) ----------
parent = list(range(N))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[max(ra, rb)] = min(ra, rb)


reason = [""] * N
by_model = defaultdict(list)
by_pid = defaultdict(list)
for i in range(N):
    if model[i]:
        by_model[model[i]].append(i)
    if pid[i]:
        by_pid[pid[i]].append(i)

# 규칙1: 모델명이 같으면 같은 제품
for m, ix in by_model.items():
    for j in ix[1:]:
        union(ix[0], j)
    for j in ix:
        reason[j] = "규칙1 모델명"

# 규칙2: 모델명 빈값 → 노출상품ID로 연결
for p, ix in by_pid.items():
    blanks = [j for j in ix if not model[j]]
    if not blanks:
        continue
    models = {model[j] for j in ix if model[j]}
    if len(models) == 1:
        anchor = next(j for j in ix if model[j])
        for j in blanks:
            union(anchor, j)
            reason[j] = "규칙2 노출상품ID(모델명 빈값)"
    elif not models:
        for j in blanks[1:]:
            union(blanks[0], j)
        for j in blanks:
            reason[j] = "규칙2 노출상품ID(모델명 없음)"
    else:
        for j in blanks:
            reason[j] = "단독(판단불가)"
            issue("모델명 빈값+노출상품ID에 모델명 여러개", j, f"노출상품ID {p}: {', '.join(sorted(models))}")

# 제품코드 부여: 제품별 최소 SKU ID 오름차순 (재현 가능)
groups = defaultdict(list)
for i in range(N):
    groups[find(i)].append(i)


def skukey(i):
    return int(sku[i]) if sku[i].isdigit() else 10**12


ordered = sorted(groups.values(), key=lambda ix: min(skukey(i) for i in ix))
code = [""] * N
products = []
for n, ix in enumerate(ordered, start=1):
    c = f"P{n:05d}"
    for i in ix:
        code[i] = c
    products.append((c, sorted(ix, key=skukey)))

# 규칙3: 노출상품ID 같은데 모델명(제품) 다름 → 별칭 후보, 자동 합치지 않음
for p, ix in by_pid.items():
    codes = sorted({code[j] for j in ix})
    if len(codes) > 1:
        ms = sorted({model[j] or "(빈값)" for j in ix})
        for j in ix:
            issue("노출상품ID 같음·모델명 다름(별칭후보)", j, f"노출상품ID {p} / 제품 {', '.join(codes)} / 모델명 {', '.join(ms)}")

# 규칙4: 창고번호 A(B) → 같은 제품 후보
first_num = defaultdict(list)
for i in range(N):
    m_ = re.match(r"^(\d+)", wh[i])
    if m_:
        first_num[m_.group(1)].append(i)
for i in range(N):
    m_ = re.match(r"^(\d+)\((\d+(?:,\d+)*)\)$", wh[i])
    if not m_:
        continue
    others = []
    for n_ in [m_.group(1)] + m_.group(2).split(","):
        for j in first_num.get(n_, []):
            if j != i:
                others.append(f"{sku[j]}({code[j]})")
    issue("창고번호 복수(같은제품 후보)", i, f"창고번호 {wh[i]} → 연결후보: {', '.join(sorted(set(others))) or '마스터에서 못 찾음'}")

# ---------- 재등록구분 ----------
fake_models = {l.strip() for l in open(FAKE_MODELS_LIST, encoding="utf-8") if l.strip()}
fake_manual = [model[i] in fake_models for i in range(N)]
fake = [any("가품" in v for k, v in r.items() if k != "_row") or fake_manual[i] for i, r in enumerate(rows)]
goldsilver = [norm(r.get("현재상태")) in ("14k", "순은") or norm(r.get("카테고리(표준)")) == "14k" for r in rows]
stop_direct = ["판매중지" in r.get("현재상태", "") for r in rows]
overstock = ["과재고" in r.get("현재상태", "") for r in rows]

low_direct = [sku[i] in low_sales_set for i in range(N)]
fake_codes = {code[i] for i in range(N) if fake[i]}
low_codes = {code[i] for i in range(N) if low_direct[i]}
stop_codes = {code[i] for i in range(N) if stop_direct[i]}
stop_pids = {pid[i] for i in range(N) if stop_direct[i] and pid[i]}
stop_basis = [""] * N
for i in range(N):
    if stop_direct[i]:
        stop_basis[i] = "직접표시"
    elif code[i] in stop_codes:
        stop_basis[i] = "같은모델 전파"
    elif pid[i] in stop_pids:
        stop_basis[i] = "같은노출상품ID 전파"

cat = [""] * N
cat_basis = [""] * N
for i in range(N):
    if code[i] in fake_codes:
        cat[i], cat_basis[i] = "영구제외_가품", ("사용자 지정(가품위험) 2026-09-22" if fake_manual[i] else "직접표시") if fake[i] else "같은모델 전파"
    elif goldsilver[i]:
        cat[i], cat_basis[i] = "영구제외_금은시세", "14k/순은 표시"
    elif stop_basis[i]:
        cat[i], cat_basis[i] = "1차_판매중지", stop_basis[i]
    elif code[i] in low_codes:
        cat[i], cat_basis[i] = "2차_판매량저조영구정지", "직접표시(사용자 목록 20260921)" if low_direct[i] else "같은모델 전파"
    # 겹침 확인
    if low_direct[i] and cat[i] != "2차_판매량저조영구정지":
        issue("판매량저조 목록과 다른 구분 겹침", i, f"판매량저조 목록에 있으나 '{cat[i]}'가 우선 적용됨")

master_skus = set(sku)
missing_low = [s for s in low_sales if s not in master_skus]
dup_low = [s for s, c in Counter(low_sales).items() if c > 1]

# ---------- ID 검사 ----------
bad_opt = set()
for name, col, pat in [("SKU ID", sku, r"^\d{8}$"), ("옵션ID", [r.get("옵션ID", "") for r in rows], r"^\d{11}$"),
                       ("바코드", [r.get("바코드", "") for r in rows], r"^[A-Z]\d{12}$")]:
    cnt = Counter(v for v in col if v)
    for i, v in enumerate(col):
        if not v:
            if name != "SKU ID":
                issue(f"{name} 빈값", i, "")
        elif "e" in v.lower() and name != "바코드":
            issue(f"{name} 지수표기 손상", i, f"값 {v} (원본 확인 필요)")
        elif name == "옵션ID" and sku[i] in CONFIRMED_OPTION_IDS:
            pass  # 사용자 확인값으로 대체
        elif not re.match(pat, v):
            extra = ""
            if name == "옵션ID":
                bad_opt.add(i)
                alts = opt_alt.get(sku[i], {})
                extra = " / 후보: " + (", ".join(f"{k}={a}" for k, a in alts.items()) or "없음") + " → 서플라이허브에서 확인 필요"
            issue(f"{name} 형식 확인", i, f"값 {v}{extra}")
        if v and cnt[v] > 1:
            issue(f"{name} 중복", i, f"값 {v} ({cnt[v]}행)")

# ---------- 한 SKU의 옵션ID들 ----------
opt_ids = {}
opt_note = {}
for i in range(N):
    if sku[i] in CONFIRMED_OPTION_IDS:
        opt_ids[i], opt_note[i] = CONFIRMED_OPTION_IDS[sku[i]]
        continue
    base = "" if i in bad_opt else rows[i].get("옵션ID", "")
    ids = [base] if base else []
    alts = opt_alt.get(sku[i], {})
    for a in alts.values():
        if re.match(r"^\d{11}$", a) and a not in ids:
            ids.append(a)
    opt_ids[i] = ids
    if len(set(alts.values())) > 1 or (base and any(a != base for a in alts.values())):
        opt_note[i] = "출처별 옵션ID 다름 → 서플라이허브 확인 필요"
        issue("옵션ID 출처별 불일치(한 SKU 복수 옵션ID 가능성)", i,
              f"01_마스터={base or '(빈값)'} / " + ", ".join(f"{k}={a}" for k, a in alts.items()))

# ---------- 제품 단위 판정: 옵션결합 / 중복등록 ----------
prod_rows = []
merge_tasks = []
for c, ix in products:
    pids = defaultdict(set)
    blank_msku_pid = False
    for i in ix:
        if pid[i]:
            if msku[i]:
                pids[pid[i]].add(msku[i])
            else:
                pids[pid[i]]
                blank_msku_pid = True
    # 같은 모델SKU에 SKU ID 여러개 → 중복등록
    ms_count = defaultdict(set)
    for i in ix:
        if msku[i]:
            ms_count[msku[i]].add(sku[i])
    dup_ms = [m for m, s in ms_count.items() if len(s) > 1]
    for m in dup_ms:
        for i in ix:
            if msku[i] == m:
                issue("중복등록(같은 모델SKU에 SKU ID 여러개)", i, f"모델SKU {m}: {', '.join(sorted(ms_count[m]))}")
    need_merge = ""
    if len(pids) > 1:
        sets = list(pids.values())
        overlap = any(sets[a] & sets[b] for a in range(len(sets)) for b in range(a + 1, len(sets)))
        if blank_msku_pid:
            need_merge = "판단불가(모델SKU 빈값)"
            issue("옵션결합 판단불가(모델SKU 빈값)", ix[0], f"노출상품ID {', '.join(sorted(pids))}")
        elif overlap:
            need_merge = "아니오(중복등록)"
        else:
            need_merge = "예"
            main_pid = max(pids, key=lambda p: len(pids[p]))
            for p, ms in sorted(pids.items()):
                if p != main_pid:
                    merge_tasks.append((c, model[ix[0]] or "(빈값)", main_pid, ", ".join(sorted(pids[main_pid])), p, ", ".join(sorted(ms))))
    cats = Counter(cat[i] for i in ix if cat[i])
    prod_rows.append({
        "제품코드": c,
        "대표모델명": next((model[i] for i in ix if model[i]), ""),
        "모델명들": ", ".join(sorted({model[i] for i in ix if model[i]})),
        "노출상품ID수": str(len({pid[i] for i in ix if pid[i]})),
        "노출상품ID들": ", ".join(sorted({pid[i] for i in ix if pid[i]})),
        "SKU수": str(len(ix)),
        "모델SKU수": str(len({msku[i] for i in ix if msku[i]})),
        "창고번호들": ", ".join(sorted({wh[i] for i in ix if wh[i]})),
        "재등록구분(요약)": ", ".join(f"{k} {v}" for k, v in cats.most_common()),
        "판매중지(모델)": "Y" if c in stop_codes else "",
        "판매량저조(모델)": "Y" if c in low_codes else "",
        "가품(모델)": "Y" if c in fake_codes else "",
        "과재고": "Y" if any(overstock[i] for i in ix) else "",
        "옵션결합필요": need_merge,
        "중복등록의심": "Y" if dup_ms else "",
        "묶음근거": ", ".join(sorted({reason[i] for i in ix})),
    })

# ---------- 시트 작성 ----------
out = openpyxl.Workbook()
HEAD_FONT = Font(bold=True)
HEAD_FILL = PatternFill("solid", fgColor="DDEBF7")


def sheet(title, headers, data):
    ws = out.create_sheet(title)
    ws.append(headers)
    for row in data:
        ws.append([txt(v) for v in row])
    for c_ in ws[1]:
        c_.font, c_.fill = HEAD_FONT, HEAD_FILL
    for col in ws.iter_cols():
        for c_ in col:
            c_.number_format = "@"
    for n_, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(n_)].width = max(10, min(40, len(h) * 2 + 2))
    ws.freeze_panes = "A2"
    if data:
        ws.auto_filter.ref = ws.dimensions
    return ws


guide = out.active
guide.title = "00_안내"
for line in [
    ["NOID-B 상품마스터 staging (로컬 초안) — 생성일 2026-09-21"],
    ["원본: " + SRC + " / 01_마스터 (읽기 전용으로 읽음, 원본 변경 없음)"],
    ["이 파일은 검토용 초안입니다. 운영 시트·사이트에는 연결되어 있지 않습니다."],
    [""],
    ["제품코드 규칙: 모델명이 같으면 같은 제품(1순위) → 모델명 빈값은 노출상품ID로 연결 → 불확실한 것은 합치지 않고 50_검토필요로."],
    ["제품코드는 P00001 형식, 제품별 가장 작은 SKU ID 순서로 부여. 한 번 부여 후 변경·재사용 금지. 파일·폴더 이름에는 쓰지 않음."],
    ["재등록구분 우선순위: 영구제외_가품(모델 전체) > 영구제외_금은시세(14k/순은 수동표시) > 1차_판매중지(모델 전체) > 2차_판매량저조영구정지(모델 전체)"],
    ["'모델 전체' = 옵션 중 하나라도 표시되면 같은 제품코드의 모든 옵션에 적용. 근거 칸에 직접표시/같은모델 전파 구분."],
    ["옵션ID가 손상된 행은 옵션ID를 비워두고 50_검토필요에 후보값을 적어둠 (서플라이허브에서 확인 후 확정)."],
    ["한 SKU ID에 옵션ID가 2개 이상일 수 있음(같은 노출상품ID). 대표 옵션ID는 '옵션ID', 나머지는 '추가옵션ID'에 적음. 사용자 확인값이 최우선."],
    ["모든 ID는 텍스트로 저장(지수표기 손상 방지)."],
]:
    guide.append(line)
guide.column_dimensions["A"].width = 140

link_hdr = ["제품코드", "재등록구분", "재등록구분_근거", "SKU ID", "바코드", "옵션ID", "추가옵션ID", "옵션ID_비고", "노출상품ID", "모델명(원본)", "모델SKU",
            "옵션접미사(색상코드)", "창고번호(원본)", "상품명(참고)", "색상/옵션(모델전체·참고)", "현재상태(원본)", "진행상태", "발주상태(내부)",
            "발주상태(쿠팡)", "과재고", "가품표시", "금은시세제외", "판매중지표시(직접)", "판매량저조영구정지", "이미지작업",
            "거래처", "제품링크", "묶음근거", "원본행"]
link = []
for c, ix in products:
    for i in ix:
        r = rows[i]
        suffix = msku[i][len(model[i]):] if model[i] and msku[i].lower().startswith(model[i].lower()) else ""
        ids = opt_ids[i]  # 손상값은 제외됨. 사용자 확인값 우선
        link.append([c, cat[i], cat_basis[i], sku[i], r.get("바코드"), ids[0] if ids else "", ", ".join(ids[1:]),
                     opt_note.get(i, ""), pid[i], model[i], msku[i], suffix, wh[i],
                     r.get("상품명"), r.get("색상/옵션"), r.get("현재상태"), r.get("진행상태"), r.get("발주상태(내부)"),
                     r.get("발주상태(쿠팡)"), "Y" if overstock[i] else "", "Y" if fake[i] else "", "Y" if goldsilver[i] else "",
                     "Y" if stop_direct[i] else "", "Y" if sku[i] in low_sales_set else "", r.get("이미지작업"),
                     r.get("거래처"), r.get("제품링크"), reason[i], r["_row"]])

ph = list(prod_rows[0].keys())
sheet("10_제품", ph, [[p[k] for k in ph] for p in prod_rows])
sheet("20_연결표", link_hdr, link)

alias = []
for c, ix in products:
    seen = set()
    for i in ix:
        for kind, v in [("모델명", model[i]), ("노출상품ID", pid[i]), ("창고번호", wh[i]), ("모델SKU", msku[i])]:
            if v and (kind, v) not in seen:
                seen.add((kind, v))
                alias.append([c, kind, v, "01_마스터", ""])
sheet("30_별칭", ["제품코드", "종류", "값", "출처", "비고(사진폴더 등 추후 추가)"], alias)

task1 = [l for l in link if l[1] == "1차_판매중지"]
task2 = [l for l in link if l[1] == "2차_판매량저조영구정지"]
sheet("40_업무_1차재등록_판매중지", link_hdr, task1)
sheet("41_업무_2차재등록_판매량저조", link_hdr, task2)
sheet("42_업무_옵션결합요청", ["제품코드", "모델명", "기준 노출상품ID", "기준 페이지 모델SKU", "분리된 노출상품ID", "분리된 모델SKU"], merge_tasks)
sheet("43_영구제외", link_hdr, [l for l in link if l[1].startswith("영구제외")])

iss_rows = [[k, code[i], sku[i], model[i], d] for k, i, d in issues]
for s in missing_low:
    iss_rows.append(["판매량저조 목록 SKU가 01_마스터에 없음", "", s, "", "02_물류전용 등 다른 탭 확인 필요"])
for s in dup_low:
    iss_rows.append(["판매량저조 목록 안에서 중복", "", s, "", ""])
iss_rows.sort(key=lambda r: (r[0], r[1], r[2]))
sheet("50_검토필요", ["검토유형", "제품코드", "SKU ID", "모델명", "내용", "처리결과(대표님 기입)"], [r + [""] for r in iss_rows])

sheet("90_원본_01_마스터", HDR, [[r.get(h, "") for h in HDR if h] for r in rows])
sheet("99_이력", ["일시", "작업", "대상", "내용", "작업자"],
      [["2026-09-21", "staging 최초 생성(v1)", "전체", "01_마스터 → 제품코드 부여, 가품·판매량저조는 SKU 단위", "Claude Code"],
       ["2026-09-21", "v2 생성", "전체", "가품·판매량저조 모델 전체 적용 / 옵션접미사 / 옵션ID 후보", "Claude Code"],
       ["2026-09-21", "v3 생성", "전체", "추가옵션ID 칸 / 50277710 옵션ID 사용자 확인값 반영", "Claude Code"],
       ["2026-09-22", "v4 생성", "전체", "가품 추가지정: wa000271", "Claude Code"],
       ["2026-09-22", "v5 생성", "전체", f"01_마스터 {N}행 → 제품 {len(products)}개 / 가품 추가지정: {', '.join(sorted(fake_models))}", "Claude Code"]])

out.save(OUT)

# ---------- 요약 출력 (건수만) ----------
print("저장:", OUT)
print("01_마스터 행", N, "| 제품코드", len(products))
print("재등록구분", Counter(c for c in cat if c).most_common(), "| 미분류", sum(1 for c in cat if not c))
print("판매중지 근거", Counter(b for b in stop_basis if b).most_common())
print("판매량저조 목록", len(low_sales), "| 마스터에 있음", len(low_sales_set & master_skus), "| 없음", len(missing_low), "| 목록내 중복", len(dup_low))
print("판매량저조 적용행", len(task2), "| 모델수 판매중지", len(stop_codes), "판매량저조", len(low_codes), "가품", len(fake_codes))
print("재등록구분 근거", Counter((c, b) for c, b in zip(cat, cat_basis) if c).most_common())
print("옵션접미사 채워진 행", sum(1 for l in link if l[link_hdr.index("옵션접미사(색상코드)")]), "/", len(link))
print("추가옵션ID 있는 SKU행", sum(1 for l in link if l[6]), "| 50277710:", [l[5:8] for l in link if l[3] == "50277710"])
print("옵션결합요청 제품", len({t[0] for t in merge_tasks}), "| 요청행", len(merge_tasks))
print("검토필요", Counter(r[0] for r in iss_rows).most_common())
