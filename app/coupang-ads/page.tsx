import AppNavigation from "../AppNavigation";
import CoupangAdsAnalyzer from "./CoupangAdsAnalyzer";
import styles from "./coupang-ads.module.css";

export default function CoupangAdsPage() {
  return (
    <main className={`shell ${styles.shell}`}>
      <AppNavigation active="coupang-ads" />
      <header className={styles.hero}>
        <p className="eyebrow">COUPANG ADS</p>
        <h1>쿠팡 광고 분석</h1>
        <p>광고센터 데이터를 안전하게 수집하고, ROAS 1,000% 목표 후보를 표본 신뢰도와 함께 분류합니다.</p>
      </header>
      <CoupangAdsAnalyzer />
    </main>
  );
}
