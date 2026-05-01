import { useEffect, useState } from "react";

export default function LeaderboardPage() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState("tampa-mahi-mahi");

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Could not load leaderboard.");
        setEntries(data.entries);
      })
      .catch((err) => setError(err.message));
  }, []);

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
            <select value={challenge} onChange={(event) => setChallenge(event.target.value)}>
              <option value="tampa-mahi-mahi">Tampa Mahi-Mahi Challenge</option>
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
      <section className="panel leaderboard">
        {entries.length === 0 && (
          <div className="empty-state empty-panel">
            <strong>No verified catches yet.</strong>
            <span>Challenge opens Friday. First verified catch takes the top spot.</span>
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
    </main>
  );
}
