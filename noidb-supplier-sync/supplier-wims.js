(() => {
  const BUTTON_ID = "noidb-wims-transfer-button";
  const STORAGE_KEY = "noidbPendingWimsTransfer";
  if (document.getElementById(BUTTON_ID)) return;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function findWimsTable() {
    return Array.from(document.querySelectorAll("table")).find(table => {
      const headers = Array.from(table.querySelectorAll("th")).map(cell => normalize(cell.innerText));
      return headers.some(header => header.includes("상품명")) && headers.some(header => header === "상태" || header.includes("상태"));
    });
  }

  function tableToTsv(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map(row =>
      Array.from(row.querySelectorAll("th,td")).map(cell => normalize(cell.innerText).replace(/\t/g, " ")).join("\t")
    ).filter(row => row.trim());
    if (rows.length < 2) throw new Error("현재 화면에서 WIMS 상품 행을 찾지 못했습니다.");
    return rows.join("\n");
  }

  function showMessage(message, error = false) {
    let toast = document.getElementById(`${BUTTON_ID}-message`);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = `${BUTTON_ID}-message`;
      Object.assign(toast.style, {
        position: "fixed", right: "20px", bottom: "86px", zIndex: "2147483647",
        maxWidth: "320px", padding: "12px 14px", borderRadius: "10px", color: "white",
        fontSize: "13px", fontWeight: "700", boxShadow: "0 8px 26px rgba(0,0,0,.22)"
      });
      document.body.appendChild(toast);
    }
    toast.style.background = error ? "#b42318" : "#28705d";
    toast.textContent = message;
    window.setTimeout(() => toast.remove(), 5000);
  }

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "NOID-B로 WIMS 전송";
  button.title = "현재 화면에 표시된 WIMS 상품을 NOID-B 작업센터로 전송합니다.";
  Object.assign(button.style, {
    position: "fixed", right: "20px", bottom: "24px", zIndex: "2147483647",
    border: "0", borderRadius: "12px", padding: "14px 18px", background: "#1f4f45",
    color: "white", fontSize: "14px", fontWeight: "800", cursor: "pointer",
    boxShadow: "0 8px 28px rgba(0,0,0,.25)"
  });

  button.addEventListener("click", async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "WIMS 표 확인 중...";
    try {
      const table = findWimsTable();
      if (!table) throw new Error("상품명·상태 머리글이 있는 WIMS 표를 찾지 못했습니다.");
      const text = tableToTsv(table);
      const visibleRowCount = Math.max(0, text.split("\n").length - 1);
      await chrome.storage.local.set({
        [STORAGE_KEY]: { text, capturedAt: new Date().toISOString(), sourceUrl: location.href, visibleRowCount }
      });
      showMessage(`현재 화면 ${visibleRowCount}개 행을 전송합니다.`);
      window.open("https://noidb-os.vercel.app/wms/work-center?source=wims-extension#wims-registration", "_blank");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "WIMS 전송에 실패했습니다.", true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  document.body.appendChild(button);
})();
