"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        setError(result?.error || "로그인에 실패했습니다.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell" style={{ maxWidth: 360 }}>
      <div className="hero">
        <div>
          <p className="eyebrow">NOID-B OS</p>
          <h1 style={{ fontSize: 22 }}>로그인</h1>
        </div>
      </div>
      <div className="card">
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
          <div className="actions">
            <button type="submit" className="aiButton dark" disabled={submitting || !password}>
              {submitting ? "확인 중…" : "로그인"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
