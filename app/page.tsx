"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Product = {
  supplier: string; category: string; gender: string; material: string;
  colors: string; sizes: string; modelNo: string; keyword: string;
  cost: string; price: string;
};

type Analysis = {
  visualFeatures?: string[];
  engraving?: string;
  counterfeitRisk?: string;
  counterfeitReason?: string;
  confidence?: number;
};

const codeMap: Record<string, string> = {
  반지:"wr", 귀걸이:"we", 목걸이:"wn", 팔찌:"wb",
  발찌:"wa", 피어싱:"wp", 브로치:"wc", 세트:"wx",
};

export default function Home() {
  const [product, setProduct] = useState<Product>({
    supplier:"부산", category:"반지", gender:"여성", material:"써지컬스틸",
    colors:"로즈골드,골드,실버", sizes:"9호,11호,14호,20호",
    modelNo:"12", keyword:"큐빅 투라인 레이어드", cost:"", price:"",
  });
  const [preview, setPreview] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const model = useMemo(() => {
    const no = product.modelNo.replace(/\D/g,"").padStart(4,"0");
    return product.modelNo ? `${codeMap[product.category] ?? "wx"}${no}` : "";
  }, [product.category, product.modelNo]);

  const title = useMemo(
    () => [product.material, product.keyword, product.gender, product.category].filter(Boolean).join(" "),
    [product]
  );

  const tags = useMemo(() => {
    const words = product.keyword.split(/\s+/).filter(Boolean);
    const candidates = [
      `${product.material}${product.category}`, `${product.gender}${product.category}`,
      ...words.map(w => `${w}${product.category}`),
      `레이어드${product.category}`, `데일리${product.category}`,
      `패션${product.category}`, `선물용${product.category}`,
      ...product.colors.split(",").map(v => `${v.trim()}${product.category}`)
    ];
    return [...new Set(candidates.filter(Boolean))].slice(0,10).join(",");
  }, [product]);

  const ready = Boolean(
    product.supplier && product.category && product.material && product.colors &&
    product.sizes && product.modelNo && product.keyword && product.price
  );

  const update = (key:keyof Product, value:string) =>
    setProduct(prev => ({...prev,[key]:value}));

  const onImage = (e:ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
    setAnalysis({});
    setMessage("");
  };

  const analyzeImage = async () => {
    if (!imageDataUrl) {
      setMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setLoading(true);
    setMessage("AI가 제품 디자인과 각인을 분석하고 있습니다...");
    try {
      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({imageDataUrl,current:product}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");

      setProduct(prev => ({
        ...prev,
        category:data.category || prev.category,
        gender:data.gender || prev.gender,
        material:data.material || prev.material,
        colors:data.colors || prev.colors,
        keyword:data.keyword || prev.keyword,
      }));
      setAnalysis(data);
      setMessage("AI 사진분석이 완료되었습니다. 결과를 확인하고 필요한 부분만 수정하세요.");
    } catch (e) {
      setMessage(`오류: ${e instanceof Error ? e.message : "분석에 실패했습니다."}`);
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = () => {
    localStorage.setItem("noidb-product-draft", JSON.stringify({product,analysis,model,title,tags}));
    setMessage("현재 기기에 임시저장했습니다.");
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({
      ...product, model, title, tags, analysis,
      status:ready ? "등록가능":"정보확인"
    },null,2)], {type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`${model || "noidb-product"}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">NOID-B OS V3</p><h1>AI 상품등록 도우미</h1>
        <p className="sub">사진을 분석해 상품 핵심키워드와 가품 주의점을 자동 생성합니다.</p></div>
        <span className="pill">AI 사진분석</span>
      </header>

      <section className="grid">
        <div className="card">
          <h2>1. 제품사진</h2>
          <label className="upload">
            <input type="file" accept="image/*" onChange={onImage}/>
            {preview ? <img src={preview} alt="제품 미리보기"/> :
              <div><strong>사진을 클릭해서 선택하세요</strong><span>JPG 또는 PNG</span></div>}
          </label>
          <button className="aiButton" onClick={analyzeImage} disabled={loading}>
            {loading ? "AI 분석 중..." : "✨ AI 사진분석"}
          </button>
          {message && <p className={message.startsWith("오류") ? "error" : "message"}>{message}</p>}
        </div>

        <div className="card">
          <h2>2. 기본정보</h2>
          <div className="formGrid">
            <Field label="거래처"><select value={product.supplier} onChange={e=>update("supplier",e.target.value)}>
              <option>부산</option><option>광주</option><option>서울</option><option>중국직수입</option><option>자체제작</option><option>기타</option>
            </select></Field>
            <Field label="카테고리"><select value={product.category} onChange={e=>update("category",e.target.value)}>
              {Object.keys(codeMap).map(v=><option key={v}>{v}</option>)}
            </select></Field>
            <Field label="성별"><select value={product.gender} onChange={e=>update("gender",e.target.value)}>
              <option>여성</option><option>남성</option><option>남녀공용</option>
            </select></Field>
            <Field label="소재"><select value={product.material} onChange={e=>update("material",e.target.value)}>
              <option>써지컬스틸</option><option>925실버</option><option>티타늄</option><option>신주</option><option>14K</option><option>18K</option><option>기타</option>
            </select></Field>
            <Field label="색상옵션"><input value={product.colors} onChange={e=>update("colors",e.target.value)}/></Field>
            <Field label="사이즈"><input value={product.sizes} onChange={e=>update("sizes",e.target.value)}/></Field>
            <Field label="모델번호 숫자"><input value={product.modelNo} onChange={e=>update("modelNo",e.target.value)}/></Field>
            <Field label="핵심키워드"><input value={product.keyword} onChange={e=>update("keyword",e.target.value)}/></Field>
            <Field label="원가"><input inputMode="numeric" value={product.cost} onChange={e=>update("cost",e.target.value)} placeholder="예: 1900"/></Field>
            <Field label="쿠팡 판매가"><input inputMode="numeric" value={product.price} onChange={e=>update("price",e.target.value)} placeholder="예: 14900"/></Field>
          </div>
        </div>

        <div className="card full">
          <h2>3. AI 분석 결과</h2>
          <div className="results">
            <Result label="사진 특징" value={analysis.visualFeatures?.join(", ") || "AI 사진분석 버튼을 눌러주세요."}/>
            <Result label="확인된 각인" value={analysis.engraving || "-"}/>
            <Result label="가품 위험도" value={analysis.counterfeitRisk || "-"}/>
            <Result label="검토 이유" value={analysis.counterfeitReason || "-"}/>
            <Result label="분석 신뢰도" value={analysis.confidence != null ? `${analysis.confidence}%` : "-"}/>
          </div>
        </div>

        <div className="card full">
          <h2>4. 자동생성 결과</h2>
          <div className="results">
            <Result label="모델명" value={model || "-"}/>
            <Result label="쿠팡 상품명" value={title || "-"}/>
            <Result label="검색태그 10개" value={tags || "-"}/>
            <Result label="등록상태" value={ready ? "등록가능":"판매가를 입력하면 등록가능"} status={ready}/>
          </div>
          <div className="actions">
            <button className="dark" onClick={saveDraft}>임시저장</button>
            <button className="green" onClick={download}>상품정보 파일 저장</button>
          </div>
        </div>

        <div className="card full">
          <h2>다음 이미지 제작 단계</h2>
          <div className="steps"><span>① 옵션별 1000×1000 썸네일</span><span>② 780px 상세페이지</span><span>③ 제품표시사항 라벨</span></div>
        </div>
      </section>
    </main>
  );
}

function Field({label,children}:{label:string;children:React.ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Result({label,value,status}:{label:string;value:string;status?:boolean}) {
  return <div className="result"><span>{label}</span><strong className={status===undefined?"":status?"good":"warn"}>{value}</strong></div>;
}
