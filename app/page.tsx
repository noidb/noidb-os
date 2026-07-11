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

type ThumbnailMap = Record<string, string>;

const codeMap: Record<string, string> = {
  반지:"wr", 귀걸이:"we", 목걸이:"wn", 팔찌:"wb",
  발찌:"wa", 피어싱:"wp", 브로치:"wc", 세트:"wx",
};

function normalizeKeyword(value: string, product: Product) {
  const banned = new Set([
    product.category, product.gender, product.material,
    "여성용", "남성용", "남녀공용", "주얼리", "쥬얼리",
    "반지", "귀걸이", "목걸이", "팔찌", "발찌", "피어싱", "브로치", "세트"
  ]);
  const words = value
    .replace(/[,.，、/|+()[\]{}:;·_-]+/g, " ")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !banned.has(v));
  return [...new Set(words)].slice(0, 5).join(" ");
}

function uniqueWords(values: string[]) {
  return [...new Set(values.flatMap(v => v.split(/\s+/)).map(v => v.trim()).filter(Boolean))];
}

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
  const [thumbnails, setThumbnails] = useState<ThumbnailMap>({});
  const [thumbnailLoading, setThumbnailLoading] = useState("");

  const model = useMemo(() => {
    const no = product.modelNo.replace(/\D/g,"").padStart(4,"0");
    return product.modelNo ? `${codeMap[product.category] ?? "wx"}${no}` : "";
  }, [product.category, product.modelNo]);

  const cleanedKeyword = useMemo(
    () => normalizeKeyword(product.keyword, product),
    [product]
  );

  const title = useMemo(() => {
    const words = uniqueWords([
      product.material,
      cleanedKeyword,
      product.gender,
      product.category,
    ]);
    return words.join(" ").replace(/[,，]+/g, " ").replace(/\s+/g, " ").trim();
  }, [product, cleanedKeyword]);

  const tags = useMemo(() => {
    const designWords = cleanedKeyword.split(/\s+/).filter(Boolean);
    const colors = product.colors.split(",").map(v => v.trim()).filter(Boolean);
    const candidates = [
      `${product.material}${product.category}`,
      `${product.gender}${product.category}`,
      ...designWords.map(word => `${word}${product.category}`),
      `데일리${product.category}`,
      `패션${product.category}`,
      `선물용${product.category}`,
      ...colors.map(color => `${color}${product.category}`),
    ];
    return [...new Set(candidates.filter(Boolean))].slice(0, 10).join(",");
  }, [product, cleanedKeyword]);

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
        keyword:normalizeKeyword(data.keyword || prev.keyword, {
          ...prev,
          category:data.category || prev.category,
          gender:data.gender || prev.gender,
          material:data.material || prev.material,
        }),
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

  const generateThumbnail = async (option: string) => {
    if (!imageDataUrl) {
      setMessage("먼저 제품사진을 선택해주세요.");
      return;
    }
    setThumbnailLoading(option);
    setMessage(`${option} 썸네일을 생성하고 있습니다. 약 20~60초 걸릴 수 있습니다.`);
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          option,
          category: product.category,
          keyword: cleanedKeyword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "썸네일 생성 실패");
      setThumbnails(prev => ({ ...prev, [option]: data.imageDataUrl }));
      setMessage(`${option} 썸네일 생성이 완료되었습니다.`);
    } catch (e) {
      setMessage(`오류: ${e instanceof Error ? e.message : "썸네일 생성 실패"}`);
    } finally {
      setThumbnailLoading("");
    }
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const downloadLabel = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 3;
    ctx.strokeRect(35, 35, 830, 1130);

    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.font = "bold 34px Arial, sans-serif";
    ctx.fillText("전기용품 및 생활용품 안전관리법에 의한표시", 450, 105);

    const now = new Date();
    const ym = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lines = [
      `1. 모델명 : ${model}`,
      `2. 제조연월 : ${ym}`,
      "3. 제조자명 : 노이드비 협력사",
      "4. 수입자명 : 노이드비(수입품에 한함)",
      "5. 주소 및 전화번호 : 경기도 파주시 소라지로 150-2",
      "   / 010-5769-5602",
      "6. 제조국명 : 중국",
      "7. 사용연령 : 14세 이상",
      "8. 주의사항 : 분실, 파손주의",
    ];

    ctx.textAlign = "left";
    ctx.font = "29px Arial, sans-serif";
    let y = 220;
    for (const line of lines) {
      ctx.fillText(line, 85, y);
      y += 100;
    }
    downloadDataUrl(canvas.toDataURL("image/png"), `${model}_제품표시사항.png`);
  };

  const options = product.colors.split(",").map(v => v.trim()).filter(Boolean);

  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">NOID-B OS V4</p><h1>AI 상품등록 도우미</h1>
        <p className="sub">상품명을 깔끔하게 정리하고 옵션별 썸네일과 제품표시사항을 생성합니다.</p></div>
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
            <Field label="핵심키워드"><input
              value={product.keyword}
              onChange={e=>update("keyword",e.target.value)}
              onBlur={()=>update("keyword", normalizeKeyword(product.keyword, product))}
              placeholder="예: 굵은 하트 체인 볼드"
            /></Field>
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
          <h2>5. 옵션별 1000×1000 썸네일</h2>
          <p className="note">옵션 하나씩 생성 버튼을 누르세요. 생성할 때마다 API 이미지 비용이 발생합니다.</p>
          <div className="thumbnailGrid">
            {options.map(option => (
              <div className="thumbnailCard" key={option}>
                <h3>{option}</h3>
                {thumbnails[option] ? (
                  <img src={thumbnails[option]} alt={`${option} 썸네일`} />
                ) : (
                  <div className="thumbnailEmpty">아직 생성되지 않음</div>
                )}
                <button
                  className="purple"
                  disabled={Boolean(thumbnailLoading)}
                  onClick={()=>generateThumbnail(option)}
                >
                  {thumbnailLoading === option ? "생성 중..." : `${option} 썸네일 생성`}
                </button>
                {thumbnails[option] && (
                  <button
                    className="green"
                    onClick={()=>downloadDataUrl(thumbnails[option], `${model}_${option}_1000x1000.png`)}
                  >
                    이미지 다운로드
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card full">
          <h2>6. 제품표시사항 라벨</h2>
          <p className="note">현재 모델명과 이번 달 제조연월이 자동으로 들어간 3:4 흰 배경 PNG입니다.</p>
          <button className="dark labelButton" onClick={downloadLabel}>제품표시사항 라벨 다운로드</button>
        </div>

        <div className="card full">
          <h2>다음 단계</h2>
          <div className="steps"><span>완료: 상품명 정리</span><span>진행: 옵션별 썸네일</span><span>다음: 가로 780px 상세페이지</span></div>
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
