import { useEffect, useState } from "react";
import heroImage from "../assets/hero-offshore.png";

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function normalizeStatus(challenge) {
  if (challenge?.status === "active") return "Live";
  if (challenge?.status === "draft") return "Coming soon";
  if (challenge?.status === "paused") return "Paused";
  if (challenge?.status === "closed") return "Closed";
  if (challenge?.status === "cancelled") return "Cancelled";
  return "Unavailable";
}

function isChallengeJoinable(challenge) {
  return challenge?.status === "active";
}

function challengeScheduleText(challenge) {
  if (!challenge?.closesAt) return "Window set by admin";
  return `Ends ${new Date(challenge.closesAt).toLocaleString()}`;
}

export default function ChallengesPage({ navigate, auth }) {
  const [activeTab, setActiveTab] = useState("live");
  const [challenges, setChallenges] = useState([]);
  const [historyChallenges, setHistoryChallenges] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/challenges")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not load challenges.");
        setChallenges(Array.isArray(data.challenges) ? data.challenges : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/leaderboard/history")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not load challenge history.");
        const history = Array.isArray(data?.challenges) ? data.challenges : [];
        setHistoryChallenges(history);
      })
      .catch(() => {
        setHistoryChallenges([]);
      });
  }, []);

  const visibleChallenges = challenges.filter((challenge) => {
    if (activeTab === "live") return challenge.status === "active";
    if (activeTab === "upcoming") return ["draft", "paused"].includes(challenge.status);
    if (activeTab === "past") return false;
    return false;
  });

  const pastChallenges = historyChallenges.filter((challenge) => {
    const status = String(challenge?.status || "").toLowerCase();
    return status === "closed" || status === "cancelled" || Boolean(challenge?.archived_at);
  });

  return (
    <main className="page app-screen challenges-screen">
      <section className="app-page-title">
        <h1>Challenges</h1>
      </section>

      <div className="segmented-tabs">
        {["live", "upcoming", "past"].map((tab) => (
          <button
            className={activeTab === tab ? "active" : ""}
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="challenge-list">
        {error && <p className="error">{error}</p>}
        {loading && (
          <div className="panel empty-panel">
            <strong>Loading challenges...</strong>
            <span>Pulling latest events and prize pools.</span>
          </div>
        )}
        {activeTab === "past" && pastChallenges.length === 0 && (
          <div className="panel empty-panel">
            <strong>No past challenges available yet.</strong>
            <span>Past challenge history will appear here.</span>
          </div>
        )}
        {activeTab === "past" && pastChallenges.length > 0 && (
          <div className="history-list">
            {pastChallenges.map((challenge) => (
              <article className="panel history-card" key={challenge.id}>
                <div className="history-card-head">
                  <strong>{challenge.title}</strong>
                  <span>{challenge.date_range || "Completed"}</span>
                </div>
                <div className="history-card-grid">
                  <span>
                    Species
                    <b>{challenge.species || "-"}</b>
                  </span>
                  <span>
                    Region
                    <b>{challenge.location || "-"}</b>
                  </span>
                  <span>
                    Participants
                    <b>{Number(challenge.participant_count || 0)}</b>
                  </span>
                  <span>
                    Prize Pool
                    <b>{formatCurrency(challenge.prize_pool)}</b>
                  </span>
                  <span>
                    Winner
                    <b>{challenge.winner_name || "-"}</b>
                  </span>
                </div>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => navigate(`/leaderboard?challengeId=${encodeURIComponent(String(challenge.id))}`)}
                >
                  View Results
                </button>
              </article>
            ))}
          </div>
        )}
        {activeTab !== "past" && visibleChallenges.length === 0 && (
          <div className="panel empty-panel">
            <strong>No challenges here yet.</strong>
            <span>Challenges will appear here as they open.</span>
          </div>
        )}
        {activeTab !== "past" && visibleChallenges.map((challenge) => {
          const joinable = isChallengeJoinable(challenge);
          return (
            <article className="challenge-list-card" key={challenge.id} style={{ backgroundImage: `url(${heroImage})` }}>
              <div>
                <span className={joinable ? "live-badge" : "live-badge muted-badge"}>{normalizeStatus(challenge)}</span>
                <h2>{challenge.title}</h2>
                <div className="challenge-card-meta">
                  <span>{challengeScheduleText(challenge)}</span>
                  <span>80% Payout</span>
                  <span>${challenge.prizePool ?? 0} Prize Pool</span>
                  <span>{challenge.location}</span>
                </div>
                <button
                  className="primary-btn"
                  disabled={!joinable}
                  type="button"
                  onClick={() => joinable && navigate(`/challenges/${challenge.id}`)}
                >
                  {joinable ? `Join - $${challenge.entryFee}` : normalizeStatus(challenge)}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
