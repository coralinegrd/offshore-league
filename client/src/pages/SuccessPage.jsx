import { useEffect, useState } from "react";
import { loadAuth } from "../authStorage.js";

export default function SuccessPage({ navigate }) {
  const params = new URLSearchParams(window.location.search);
  const legacyCode = params.get("code") || "";
  const sessionId = params.get("session_id") || "";
  const initialChallengeId = params.get("challenge_id") || "";
  const [code, setCode] = useState(legacyCode);
  const [paymentId, setPaymentId] = useState(sessionId);
  const [challengeId, setChallengeId] = useState(initialChallengeId);
  const [status, setStatus] = useState(sessionId ? "Checking Stripe payment..." : "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;

    const { token } = loadAuth();
    if (!token) {
      setError("Log in to retrieve your paid challenge code.");
      return;
    }

    fetch(`/api/checkout-session/${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not verify payment.");
        if (data.failed) {
          setError(data.error || "Payment failed. Try another card.");
          setStatus("Payment not completed.");
          return;
        }
        if (data.refunded) {
          setError(data.error || "Payment was refunded.");
          setStatus("Entry not active.");
          return;
        }
        if (!data.paid) {
          setStatus("Stripe has not confirmed this payment yet.");
          return;
        }
        setCode(data.challengeCode);
        setPaymentId(data.paymentId || sessionId);
        if (data.challengeId) {
          setChallengeId(String(data.challengeId));
        }
        setStatus("Stripe payment confirmed.");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("");
      });
  }, [sessionId]);

  const copyCode = async () => {
    if (!code || !navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
  };

  return (
    <main className="page narrow-page">
      <section className="panel success-panel flow-card">
        <span className="success-badge">Payment confirmed</span>
        <p className="eyebrow">Challenge entry secured</p>
        <h1>You're in</h1>
        {status && <p className="success">{status}</p>}
        {error && <p className="error">{error}</p>}
        <p className="page-intro">
          Keep this code visible in your catch media. It is how the review team verifies your entry.
        </p>
        <button className="code-box" type="button" onClick={copyCode} title="Copy challenge code">
          {code || "Code unavailable"}
          <small>Tap to copy</small>
        </button>
        <p className="page-intro">Payment ID: {paymentId || "Unavailable"}</p>
        <div className="instruction-list">
          <span>Show the code in one continuous video.</span>
          <span>Keep the full fish and measurement visible.</span>
          <span>Submit before the challenge countdown ends.</span>
        </div>
        <button
          className="primary-btn"
          disabled={!code || !paymentId}
          type="button"
          onClick={() =>
            navigate(
              `/submit?code=${encodeURIComponent(code)}&payment_id=${encodeURIComponent(paymentId)}${challengeId ? `&challenge_id=${encodeURIComponent(challengeId)}` : ""}`
            )
          }
        >
          Submit Catch
        </button>
      </section>
    </main>
  );
}
