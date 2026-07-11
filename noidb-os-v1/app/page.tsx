"use client";

import { useMemo, useState } from "react";

const codeMap: Record<string, string> = {
  반지: "wr",
  귀걸이: "we",
  목걸이: "wn",
  팔찌: "wb",
  발찌: "wa",
  피어싱: "wp",
  브로치: "wc",
  세트: "wx"
};

export default function Home() {
  const [category, setCategory] = useState("반지");
  const [number, setNumber] = useState("12");
  const [keyword, setKeyword] = useState("큐빅 투라인");
  const [size, setSize] = useState("9,11,14,20호");
  const [price, setPrice] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const model = useMemo(() => {
    const digits = number.replace(/\D/g, "");
    return digits ? `${codeMap[category]}${digits.padStart(4, "0")}` : "-";
  }, [category, number]);

  const title = `써지컬스틸 ${keyword} 여성 ${category}`.trim();
  const tags = [
    keyword,
    category,
    "써지컬스틸",
    `여성${category}`,
    `써지컬스틸${category}`,
    `${keyword}${category}`,
    `데일리${category}`,
    `알러지방지${category}`,
    `선물용${category}`,
    "패션주얼리"
  ].join(",");

  function onFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">NOID-B OS</p>
          <h1>AI 상품등록</h1>
          <p className="sub">모바일과 노트북에서 사용하는 노이드비 상품등록 화면</p>
        </div>
        <span className="badge">V1</span>
      </header>

      <section className="panel upload">
        <label htmlFor="photo" className="dropzone">
          {preview ? <img src={preview} alt="제품 미리보기" /> : <span>제품사진을 눌러서 선택하세요</span>}
        </label>
        <input id="photo" type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} hidden />
      </section>

      <section className="grid">
        <div className="panel">
          <h2>제품정보</h2>
          <label>거래처<select defaultValue="부산"><option>부산</option><option>광주</option><option>서울</option><option>중국직수입</option></select></label>
          <label>카테고리<select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.keys(codeMap).map((v) => <option key={v}>{v}</option>)}</select></label>
          <label>성별<select defaultValue="여성"><option>여성</option><option>남성</option><option>남녀공용</option></select></label>
          <label>소재<select defaultValue="써지컬스틸"><option>써지컬스틸</option><option>925실버</option><option>티타늄</option><option>신주</option></select></label>
          <label>옵션<input defaultValue="로즈골드,골드,실버" /></label>
          <label>사이즈<input value={size} onChange={(e) => setSize(e.target.value)} /></label>
          <label>모델번호 숫자<input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" /></label>
          <label>핵심키워드<input value={keyword} onChange={(e) => setKeyword(e.target.value)} /></label>
          <label>쿠팡 판매가<input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="예: 12900" /></label>
        </div>

        <div className="panel result">
          <h2>자동생성 결과</h2>
          <article><span>모델명</span><strong>{model}</strong></article>
          <article><span>쿠팡 상품명</span><strong>{title}</strong></article>
          <article><span>검색태그 10개</span><p>{tags}</p></article>
          <article><span>사이즈</span><strong>{size || "-"}</strong></article>
          <article><span>등록상태</span><strong className={price ? "ok" : "warn"}>{price ? "등록가능" : "판매가 입력 필요"}</strong></article>
          <button type="button" onClick={() => alert("다음 단계에서 AI 사진분석과 이미지 생성을 연결합니다.")}>AI 상품 생성</button>
        </div>
      </section>
    </main>
  );
}
