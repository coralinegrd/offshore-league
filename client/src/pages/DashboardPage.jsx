import { useEffect, useState } from "react";
import heroImage from "../assets/hero-offshore.png";
import { saveAuth } from "../authStorage.js";

function getApiUrl(path) {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const apiBase = import.meta.env.VITE_API_URL || (isLocalHost ? "http://localhost:4000" : "");
  return `${apiBase}${path}`;
}

export default function DashboardPage({ auth, navigate, onAuth }) {
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const hasUnreadNotifications = false;
  const firstName = auth.user?.name?.split(" ")[0] || "Angler";

  useEffect(() => {
    fetch(getApiUrl("/api/challenge"))
      .then((res) => res.json())
      .then(setChallenge)
      .catch(() => {});

    fetch(getApiUrl("/api/leaderboard"))
      .then((res) => res.json())
      .then((data) => setLeaderboard(data.entries || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!auth?.token) return;

    fetch(getApiUrl("/api/auth/me"), {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.user) return;
        const nextAuth = { token: auth.token, user: data.user };
        saveAuth(nextAuth);
        if (typeof onAuth === "function") onAuth(nextAuth);
      })
      .catch(() => {});
  }, [auth?.token, onAuth]);

  return (
    <main className="page app-screen dashboard-page">
      <section className="dashboard-header">
        <button className="profile-dot" type="button" aria-label="Open profile settings" onClick={() => navigate("/profile")}>
          {auth.user?.avatarUrl ? <img src={auth.user.avatarUrl} alt="" /> : firstName.slice(0, 1).toUpperCase()}
        </button>
        <div>
          <span>Welcome back,</span>
          <strong>{firstName}</strong>
        </div>
        <div className="notification-menu">
          <button
            className="notification-button"
            type="button"
            aria-expanded={notificationsOpen}
            aria-label="Notifications"
            onClick={() => setNotificationsOpen((isOpen) => !isOpen)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M18 10a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M10 22h4" />
            </svg>
            {hasUnreadNotifications && <span />}
          </button>
          {notificationsOpen && (
            <div className="notification-panel">
              <strong>Notifications</strong>
              <p>No new alerts right now.</p>
              <button type="button" onClick={() => navigate("/challenges")}>
                View challenge
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="dashboard-section-title">
        <h2>Active Challenge</h2>
        <button type="button" onClick={() => navigate("/challenges")}>View All</button>
      </section>

      <article className="dashboard-challenge" style={{ backgroundImage: `url(${heroImage})` }}>
        <div>
          <h3>Tampa Weekend <span>Challenge</span></h3>
          <div className="dashboard-meta">
            <span>Ends in <b>{challenge?.countdown || "72h 00m"}</b></span>
            <span>Prize Pool <b>${challenge?.prizePool ?? 0}</b></span>
          </div>
          <button className="primary-btn" type="button" onClick={() => navigate("/challenges")}>
            Join Challenge - ${challenge?.entryFee ?? 30}
          </button>
        </div>
      </article>

      <section className="dashboard-section-title">
        <h2>Your Stats</h2>
        <span>This Season</span>
      </section>

      <section className="stat-grid">
        <article>
          <strong>0</strong>
          <span>Challenges</span>
        </article>
        <article>
          <strong>$0</strong>
          <span>Winnings</span>
        </article>
        <article>
          <strong>-</strong>
          <span>Best Catch</span>
        </article>
      </section>

      <section className="dashboard-section-title">
        <h2>Leaderboard</h2>
        <button type="button" onClick={() => navigate("/leaderboard")}>View All</button>
      </section>

      <section className="panel dashboard-leaderboard">
        {leaderboard.length === 0 && <p className="empty-state">First verified catch takes the top spot.</p>}
        {leaderboard.slice(0, 3).map((entry, index) => (
          <div className="mini-row" key={entry.id}>
            <strong>{index + 1}</strong>
            <span>{entry.display_name}</span>
            <b>{Number(entry.length).toFixed(1)} cm</b>
          </div>
        ))}
      </section>
    </main>
  );
}
