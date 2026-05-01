import { useEffect, useState } from "react";
import anglerBanner from "../assets/angler-banner.png";
import { challengeConfig } from "../challengeConfig.js";
import heroImage from "../assets/hero-offshore.png";
import mahiCard from "../assets/mahi-card.png";

const emptyForm = { name: "", email: "" };
const TERMS_VERSION = "2026-05-01";

export default function ChallengePage({ auth, navigate }) {
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/challenge")
      .then((res) => res.json())
      .then(setChallenge)
      .catch(() => setError("Challenge details are unavailable right now."));

    fetch("/api/leaderboard")
      .then((res) => res.json())
      .then((data) => setLeaderboard(data.entries || []))
      .catch(() => {});
  }, []);

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const joinChallenge = async (event) => {
    event.preventDefault();
    setError("");

    if (challenge?.status === "cancelled") {
      setError(challenge?.cancellationReason || "This challenge is currently cancelled.");
      return;
    }

    if (!rulesAccepted) {
      setError("Accept the challenge rules before checkout.");
      return;
    }

    if (!legalAccepted) {
      setError("Accept Terms and Privacy before checkout.");
      return;
    }

    if (!auth.token) {
      navigate("/auth");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          acceptedTerms: legalAccepted,
          termsVersion: TERMS_VERSION
        })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Could not start checkout.");

      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    ["01", "Join", "Pay entry and receive your unique challenge code."],
    ["02", "Catch", "Land your best legal fish during the live window."],
    ["03", "Submit", "Upload one continuous video with code and measurement visible."],
    ["04", "Win", "Top verified length takes the winner payout."]
  ];
  const participantCount = challenge?.participants ?? 0;
  const prizePool = challenge?.prizePool ?? 0;
  const ctaCopy =
    participantCount > 0
      ? `${participantCount} angler${participantCount === 1 ? "" : "s"} entered. Prize pool is $${prizePool}.`
      : "Be the first verified angler in this Tampa challenge.";
  const rules = [
    "Must be 18+ and inside the Tampa challenge zone during the competition window.",
    "One entry per person and one entry per payment method.",
    "Pay before close; your personal code is issued after Stripe confirms payment.",
    "Target species only. Wrong species or catches outside the window are rejected.",
    "One continuous video submission: code, full fish, measurement, your presence, and environment visible.",
    "Fish must be alive and intact at measurement. Catch-and-release or keep are both valid."
  ];

  return (
    <main className="home">
      <section className="hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="pill">Tampa weekend challenge</p>
            <h1 className="hero-title">
              <span>Compete.</span>
              <span>Catch.</span>
              <span>Win.</span>
            </h1>
            <p>One weekend. One leaderboard. Real-money skill competition for serious offshore anglers.</p>
            <div className="hero-kpis">
              <span>Tampa</span>
              <span>{challenge?.species || challengeConfig.species}</span>
              <span>${challenge?.entryFee ?? 30} Entry</span>
            </div>
            <button className="primary-btn hero-btn" type="button" onClick={() => document.getElementById("join-form")?.scrollIntoView({ behavior: "smooth" })}>
              Enter Now - ${challenge?.entryFee ?? 30}
            </button>
            <div className="trust-row">
              <span>Secure Payment</span>
              <span>Verified Submissions</span>
              <span>Winners Paid</span>
            </div>
          </div>

          <article className="event-card">
            <div className="event-topline">
              <span className="live-dot">Live</span>
              <strong>{challenge?.title || challengeConfig.title}</strong>
            </div>
            <div className="event-stats">
              <div>
                <span className="event-icon">Players</span>
                <strong>{challenge?.participants ?? 0}</strong>
                <small>joining</small>
              </div>
              <div>
                <span className="event-icon">Prize pool</span>
                <strong>${challenge?.prizePool ?? 0}</strong>
                <small>dynamic</small>
              </div>
              <div>
                <span className="event-icon">Ends in</span>
                <strong>{challenge?.countdown || "72h 00m"}</strong>
                <small>challenge window</small>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="section value-strip" aria-label="Challenge highlights">
        <article>
          <strong>80%</strong>
          <span>Winner payout share</span>
        </article>
        <article>
          <strong>1 video</strong>
          <span>Continuous proof required</span>
        </article>
        <article>
          <strong>Ranked live</strong>
          <span>Verified leaderboard updates</span>
        </article>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>4 steps. Simple.</h2>
        </div>
        <div className="steps-grid">
          {steps.map(([number, title, copy]) => (
            <article className="step-card" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section feature-grid">
        <article className="image-card">
          <img src={mahiCard} alt="Mahi-mahi offshore catch" />
          <span>This weekend's challenge</span>
        </article>

        <article className="panel challenge-detail">
          <h2>{challenge?.title || challengeConfig.title}</h2>
          <dl>
            <div>
              <dt>Species</dt>
              <dd>{challenge?.species || challengeConfig.species}</dd>
            </div>
            <div>
              <dt>Metric</dt>
              <dd>Longest Catch Wins</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{challenge?.location || challengeConfig.location}</dd>
            </div>
            <div>
              <dt>Prize</dt>
              <dd>80% of total pool</dd>
            </div>
          </dl>
          <form id="join-form" className="join-form" onSubmit={joinChallenge}>
            {!auth.user && (
              <p className="checkout-note">Create an account or log in before checkout. Your code is issued after payment.</p>
            )}
            <input name="name" value={auth.user?.name || form.name} onChange={updateField} placeholder="Name" disabled={Boolean(auth.user)} required />
            <input name="email" type="email" value={auth.user?.email || form.email} onChange={updateField} placeholder="Email" disabled={Boolean(auth.user)} required />
            <label className="checkbox-row legal-accept">
              <input
                checked={legalAccepted}
                onChange={(event) => setLegalAccepted(event.target.checked)}
                type="checkbox"
              />
              I agree to the
              <button type="button" className="inline-link-btn" onClick={() => navigate("/terms")}>Terms</button>
              and
              <button type="button" className="inline-link-btn" onClick={() => navigate("/privacy")}>Privacy Policy</button>
              before payment.
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary-btn" disabled={loading} type="submit">
              {loading
                ? "Opening checkout..."
                : challenge?.status === "cancelled"
                  ? "Challenge Cancelled"
                  : auth.user
                    ? `Continue to Stripe - $${challenge?.entryFee ?? 30}`
                    : "Create account to enter"}
            </button>
          </form>
        </article>

        <article className="panel rules-card">
          <p className="eyebrow">Before you pay</p>
          <h3>Challenge rules</h3>
          <ul>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <label className="checkbox-row rules-accept">
            <input
              checked={rulesAccepted}
              onChange={(event) => setRulesAccepted(event.target.checked)}
              type="checkbox"
            />
            I understand and accept these challenge rules.
          </label>
        </article>

        <article className="panel live-leaderboard">
          <div className="mini-heading">
            <h3>Live Leaderboard</h3>
            <button type="button" onClick={() => navigate("/leaderboard")}>View Full Leaderboard</button>
          </div>
          {leaderboard.length === 0 && <p className="empty-state">No verified catches yet.</p>}
          {leaderboard.slice(0, 5).map((entry, index) => (
            <div className="mini-row" key={entry.id}>
              <strong>{index + 1}</strong>
              <span>{entry.display_name}</span>
              <b>{Number(entry.length).toFixed(1)} cm</b>
              <em>Verified</em>
            </div>
          ))}
        </article>
      </section>

      <section className="section about-banner" style={{ backgroundImage: `url(${anglerBanner})` }}>
        <div>
          <p className="eyebrow">What is Offshore League?</p>
          <h2>A global platform for fishing challenges.</h2>
          <p>New locations. New species. New winners. Every week.</p>
        </div>
        <div className="about-badges">
          <span>Real Fish.</span>
          <span>Real Competition.</span>
          <span>Real Prizes.</span>
        </div>
      </section>

      <section className="section final-cta" style={{ backgroundImage: `url(${heroImage})` }}>
        <div>
          <h2>
            Fishing this weekend?
            <br />
            <span>Play to win.</span>
          </h2>
          <p>{ctaCopy}</p>
        </div>
        <button className="primary-btn landing-final-btn" type="button" onClick={() => document.getElementById("join-form")?.scrollIntoView({ behavior: "smooth" })}>
          Join the Tampa Challenge
        </button>
      </section>
    </main>
  );
}
