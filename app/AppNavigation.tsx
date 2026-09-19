import Image from "next/image";
import Link from "next/link";

type AppSection = "product-registration" | "work-center" | "coupang-ads";

interface AppNavigationProps {
  active: AppSection;
}

const navigationItems: Array<{ id: AppSection; href: string; label: string }> = [
  { id: "product-registration", href: "/", label: "AI 상품등록" },
  { id: "work-center", href: "/wms/work-center", label: "입고센터" },
  { id: "coupang-ads", href: "/coupang-ads", label: "쿠팡 광고 분석" },
];

export default function AppNavigation({ active }: AppNavigationProps) {
  return (
    <div className="appNavigation">
      <Link className="appNavigationBrand" href="/" aria-label="NOID-B OS AI 상품등록 홈">
        <Image
          className="brandMark"
          src="/icons/noidb-icon-192-v3.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={48}
          priority
        />
        <span className="appNavigationWordmark">
          <strong className="brandWordmark">NOID-B OS</strong>
          <span>Seller Workspace</span>
        </span>
      </Link>

      <nav className="appNavigationMenu" aria-label="NOID-B OS 주요 메뉴">
        {navigationItems.map(item => {
          const isActive = item.id === active;
          return (
            <Link
              key={item.id}
              className={`appNavigationLink${isActive ? " isActive" : ""}`}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
