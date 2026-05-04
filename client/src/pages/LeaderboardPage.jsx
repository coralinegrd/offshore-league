import { useEffect, useState } from "react";

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export default function LeaderboardPage({ navigate }) {
  const [entries, setEntries] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [error, setError] = useState("");
  const initialChallengeId = (() => {
    const params = new URLSearchParams(window.location.search);
    const value = Number(params.get("challengeId"));
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const [challenge, setChallenge] = useState(initialChallengeId);

  useEffect(() => {
    fetch("/api/leaderboard/history")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not load challenges.");
        const challengeHistory = Array.isArray(data.challenges) ? data.challenges : [];
        setChallenges(challengeHistory);
        if (!challenge && challengeHistory.length > 0) {
          const active = challengeHistory.find((item) => item.status === "active" && !item.archived_at);
          setChallenge(Number(active?.id || challengeHistory[0].id));
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!challenge) return;

    setError("");
    fetch(`/api/leaderboard?challengeId=${encodeURIComponent(String(challenge))}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not load leaderboard.");
        setEntries(data.entries || []);
      })
      .catch((err) => setError(err.message));
  }, [challenge]);

  const selectedChallenge = challenges.find((item) => Number(item.id) === Number(challenge));

  return (
    <main className="page">
      <section className="page-heading split-heading">
        <div>
        <p className="eyebrow">Verified catches only</p>
        <h1>Leaderboard</h1>
          <p className="page-intro">Approved submissions are ranked by longest catch. No simulated entries.</p>
        </div>
        <div className="leaderboard-controls">
          <label>
            Challenge
            <select
              value={challenge ? String(challenge) : ""}
              onChange={(event) => setChallenge(Number(event.target.value) || null)}
            >
              {challenges.length === 0 && <option value="">No challenges</option>}
              {challenges.map((challengeOption) => (
                <option key={challengeOption.id} value={String(challengeOption.id)}>
                  {challengeOption.title}
                </option>
              ))}
            </select>
          </label>
          {entries.length > 0 && (
            <div className="metric-chip">
              <strong>{entries.length}</strong>
              <span>Verified</span>
            </div>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {selectedChallenge?.id && (
        <section className="panel challenge-history-summary">
          <article>
            <span>Date</span>
            <strong>{selectedChallenge.date_range || "-"}</strong>
          </article>
          <article>
            <span>Participants</span>
            <strong>{Number(selectedChallenge.participant_count || 0)}</strong>
          </article>
          <article>
            <span>Prize Pool</span>
            <strong>{formatCurrency(selectedChallenge.prize_pool)}</strong>
          </article>
          <article>
            <span>Winner</span>
            <strong>{selectedChallenge.winner_name || "-"}</strong>
          </article>
        </section>
      )}
      <section className="panel leaderboard">
        {entries.length === 0 && (
          <div className="empty-state empty-panel">
            <strong>No verified catches yet.</strong>
            <span>First verified catch takes the top spot.</span>
          </div>
        )}
        {entries.map((entry, index) => (
          <div className="leader-row" key={entry.id}>
            <strong className="rank">#{index + 1}</strong>
            <span>{entry.display_name}</span>
            <strong>{Number(entry.length).toFixed(1)} cm</strong>
            <span className="verified">Verified</span>
            <small className="leader-meta">
              {entry.species}
              {entry.media_path ? (
                <a href={entry.media_path} target="_blank" rel="noreferrer">
                  View catch proof
                </a>
              ) : ""}
            </small>
          </div>
        ))}
      </section>
      {selectedChallenge?.id && (
        <section className="page-actions">
          <button className="primary-btn" type="button" onClick={() => navigate(`/challenges/${selectedChallenge.id}`)}>
            View Challenge
          </button>
        </section>
      )}
    </main>
  );
}
