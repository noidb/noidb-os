import Link from "next/link";
import styles from "./flow-preview.module.css";

const stages = [
  {
    number: "01",
    title: "신규 발주서",
    description: "쿠팡에서 직접 내려받은 발주서리스트 파일을 한 번 불러옵니다.",
    detail: "새 발주서만 표시하고, 이미 출고완료·입고완료된 발주서는 이 목록에 다시 나오지 않습니다.",
    action: "발주서리스트 파일 불러오기",
  },
  {
    number: "02",
    title: "쿠팡 발주 확정",
    description: "쿠팡에서 업로드 양식을 내려받아 그대로 다시 올리는 실제 업무를 진행합니다.",
    detail: "NOID-B는 파일을 억지로 생성하거나 자동 업로드하지 않고, 완료 여부만 기록합니다.",
    action: "발주확정 완료 기록",
  },
  {
    number: "03",
    title: "출고 준비",
    description: "택배파일, 쉽먼트 생성, 쉽먼트 출력세트를 순서대로 준비합니다.",
    detail: "각 파일을 만들기 전에는 대상 발주서와 수량을 미리 확인합니다.",
    action: "출고 준비 열기",
  },
  {
    number: "04",
    title: "출고완료 · 쉽먼트 대기",
    description: "출고완료를 누른 발주서만 자동으로 쉽먼트 대기 목록에 들어옵니다.",
    detail: "발주번호를 직접 입력하지 않습니다. 이 목록 전체를 한 번에 조회합니다.",
    action: "대기 쉽먼트 전체 조회",
  },
  {
    number: "05",
    title: "입고결과 처리",
    description: "모든 쉽먼트가 마감된 발주서만 초도입고와 미납 SKU로 나눕니다.",
    detail: "단종·거래처발주·미납분 재발주는 이 다음 화면에서 사용자 검토 후 이동합니다.",
    action: "입고결과 검토 열기",
  },
] as const;

export default function WorkflowPreviewPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>UI 미리보기 · 데이터 변경 없음</p>
        <h1>물류 작업센터</h1>
        <p>오늘 해야 할 단계만 위에서 아래 순서대로 처리합니다. 자동 새로고침과 자동 단계 이동은 사용하지 않습니다.</p>
      </header>

      <section className={styles.summary} aria-label="업무 현황 미리보기">
        <div><strong>신규 발주</strong><span>파일을 불러오면 표시</span></div>
        <div><strong>출고 준비</strong><span>발주확정 후 표시</span></div>
        <div><strong>쉽먼트 대기</strong><span>출고완료 후 자동 등록</span></div>
        <div><strong>입고결과</strong><span>마감 후 검토</span></div>
      </section>

      <ol className={styles.stages}>
        {stages.map((stage, index) => (
          <li key={stage.number} className={styles.stage}>
            <div className={styles.number}>{stage.number}</div>
            <div className={styles.content}>
              <h2>{stage.title}</h2>
              <p>{stage.description}</p>
              <small>{stage.detail}</small>
            </div>
            <button type="button" className={index === 0 ? styles.primaryButton : styles.secondaryButton} disabled>
              {stage.action}
              <span>연결 전</span>
            </button>
          </li>
        ))}
      </ol>

      <section className={styles.rules}>
        <h2>이 화면의 원칙</h2>
        <ul>
          <li>한 번에 하나의 단계만 처리합니다.</li>
          <li>조회·파일 생성·다음 단계 이동은 사용자가 누른 버튼에서만 실행합니다.</li>
          <li>처리 완료된 발주서는 작업 목록에서 숨기고 누적 이력에만 남깁니다.</li>
        </ul>
      </section>

      <Link href="/wms/work-center" className={styles.back}>현재 작업센터로 돌아가기</Link>
    </main>
  );
}
