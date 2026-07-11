"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Product = {
  supplier: string;
  category: string;
  gender: string;
  material: string;
  colors: string;
  sizes: string;
  modelNo: string;
  keyword: string;
  cost: string;
  price: string;
};

const codeMap: Record<string, string> = {
  반지: "wr",
  귀걸이: "we",
  목걸이: "wn",
  팔찌: "wb",
  발찌: "wa",
  피어싱: "wp",
  브로치: "wc",
  세트: "wx",
};

export default function Home() {
  const [product, setProduct] = useState<Product>({
    supplier: "부산",
    category: "반지",
    gender: "여성",
    material: "써지컬스틸",
    colors: "로즈골드,골드,실버",
    sizes: "9호,11호,14호,20호",
    modelNo: "12",
    keyword: "큐빅 투라인 레이어드",
    cost: "",
    price: "",
  });

  const [preview, setPreview] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const model = useMemo(() => {
    const code = codeMap[product.category] ?? "wx";
    const no = product.modelNo.replace(/\D/g, "").padStart(4, "0");
    return product.modelNo ? `${code}${no}` : "";
  }, [product.category, product.modelNo]);

  const title = useMemo(() => {
    return [product.material, product.keyword, product.gender, product.category]
      .filter(Boolean)
      .join(" ");
  }, [product]);

  const tags = useMemo(() => {
    const k = product.keyword.trim();
    const c = product.category;
    const m = product.material;
    const raw = [
      "써지컬반지",
      "여성반지",
      "큐빅반지",
      "레이어드반지",
      "투라인반지",
      "데일리반지",
      "패션반지",
      "오픈링",
      "로즈골드반지",
      "골드반지",
    ];
    return raw.slice(0, 10).join(",");
  }, [product]);

  const ready =
    product.supplier &&
    product.category &&
    product.material &&
    product.colors &&
    product.sizes &&
    product.modelNo &&
    product.keyword &&
    product.price;

  const update = (key: keyof Product, value: string) => {
    setProduct((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const onImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const saveDraft = () => {
    localStorage.setItem(
      "noidb-product-draft",
      JSON.stringify({ ...product, model, title, tags })
    );
    setSaved(true);
  };

  const download = () => {
    const data = {
      ...product,
      model,
      title,
      tags,
      status: ready ? "등록가능" : "정보확인",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model || "noidb-product"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">NOID-B OS V2</p>
          <h1>쿠팡 상품등록 도우미</h1>
          <p className="sub">사진과 기본정보를 넣으면 모델명·상품명·검색태그를 자동 생성합니다.</p>
        </div>
        <span className="pill">모바일·노트북 공용</span>
      </header>

      <section className="grid">
        <div className="card">
          <h2>1. 제품사진</h2>
          <label className="upload">
            <input type="file" accept="image/*" onChange={onImage} />
            {preview ? (
              <img src={preview} alt="제품 미리보기" />
            ) : (
              <div>
                <strong>사진을 클릭해서 선택하세요</strong>
                <span>JPG 또는 PNG</span>
              </div>
            )}
          </label>
        </div>

        <div className="card">
          <h2>2. 기본정보</h2>
          <div className="formGrid">
            <Field label="거래처">
              <select value={product.supplier} onChange={(e) => update("supplier", e.target.value)}>
                <option>부산</option><option>광주</option><option>서울</option>
                <option>중국직수입</option><option>자체제작</option><option>기타</option>
              </select>
            </Field>

            <Field label="카테고리">
              <select value={product.category} onChange={(e) => update("category", e.target.value)}>
                {Object.keys(codeMap).map((v) => <option key={v}>{v}</option>)}
              </select>
            </Field>

            <Field label="성별">
              <select value={product.gender} onChange={(e) => update("gender", e.target.value)}>
                <option>여성</option><option>남성</option><option>남녀공용</option>
              </select>
            </Field>

            <Field label="소재">
              <select value={product.material} onChange={(e) => update("material", e.target.value)}>
                <option>써지컬스틸</option><option>925실버</option><option>티타늄</option>
                <option>신주</option><option>14K</option><option>18K</option><option>기타</option>
              </select>
            </Field>

            <Field label="색상옵션">
              <input value={product.colors} onChange={(e) => update("colors", e.target.value)} />
            </Field>

            <Field label="사이즈">
              <input value={product.sizes} onChange={(e) => update("sizes", e.target.value)} />
            </Field>

            <Field label="모델번호 숫자">
              <input value={product.modelNo} onChange={(e) => update("modelNo", e.target.value)} />
            </Field>

            <Field label="핵심키워드">
              <input value={product.keyword} onChange={(e) => update("keyword", e.target.value)} />
            </Field>

            <Field label="원가">
              <input inputMode="numeric" value={product.cost} onChange={(e) => update("cost", e.target.value)} placeholder="예: 2000" />
            </Field>

            <Field label="쿠팡 판매가">
              <input inputMode="numeric" value={product.price} onChange={(e) => update("price", e.target.value)} placeholder="예: 16900" />
            </Field>
          </div>
        </div>

        <div className="card full">
          <h2>3. 자동생성 결과</h2>
          <div className="results">
            <Result label="모델명" value={model || "-"} />
            <Result label="쿠팡 상품명" value={title || "-"} />
            <Result label="검색태그 10개" value={tags || "-"} />
            <Result label="가품 위험 검토" value="주의 필요: 제품 전면의 LOVE FOREVER / EST.1981 각인이 특정 브랜드 표식처럼 보일 수 있어 등록 전 유사상표 검색 권장" />
            <Result label="등록상태" value={ready ? "등록가능" : "판매가를 입력하면 등록가능"} status={ready} />
          </div>

          <div className="actions">
            <button className="dark" onClick={saveDraft}>임시저장</button>
            <button className="green" onClick={download}>상품정보 파일 저장</button>
          </div>
          {saved && <p className="saved">현재 기기에 임시저장했습니다.</p>}
        </div>

        <div className="card full">
          <h2>다음 이미지 제작 단계</h2>
          <div className="steps">
            <span>① 옵션별 1000×1000 썸네일</span>
            <span>② 가로 780px 상세페이지</span>
            <span>③ 제품표시사항 라벨</span>
          </div>
          <p className="note">V2는 배포 확인용입니다. 배포 성공 후 AI 이미지 생성 버튼을 연결합니다.</p>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Result({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return (
    <div className="result">
      <span>{label}</span>
      <strong className={status === undefined ? "" : status ? "good" : "warn"}>{value}</strong>
    </div>
  );
}
