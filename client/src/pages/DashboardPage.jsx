import { useEffect, useState } from "react";
import heroImage from "../assets/hero-offshore.png";
import { saveAuth } from "../authStorage.js";

function toCompassDirection(degrees) {
  if (!Number.isFinite(degrees)) return "-";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

function toKnots(kmh) {
  if (!Number.isFinite(kmh)) return null;
  return kmh * 0.539957;
}

function formatOneDecimal(value) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(1);
}

function toTimeLabel(submittedAt) {
  if (!submittedAt) return "recently";
  const submittedMs = new Date(submittedAt).getTime();
  if (!Number.isFinite(submittedMs)) return "recently";
  const diffMs = Date.now() - submittedMs;
  if (diffMs <= 0) return "just now";
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function toDateLabel(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "soon";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function getBrowserCoordinates() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Near You"
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 300000
      }
    );
  });
}

async function getOpenMeteoConditions({ locationText, browserCoordinates }) {
  const fallback = {
    latitude: 27.9506,
    longitude: -82.4572,
    label: "Tampa"
  };

  const searchName = (locationText || "Tampa").split(",")[0].trim() || "Tampa";
  let coordinates = browserCoordinates || fallback;

  if (!browserCoordinates) {
    try {
      const geocodeResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchName)}&count=1&language=en&format=json`
      );
      const geocodeData = await geocodeResponse.json().catch(() => ({}));
      const place = Array.isArray(geocodeData?.results) ? geocodeData.results[0] : null;

      if (place?.latitude && place?.longitude) {
        coordinates = {
          latitude: place.latitude,
          longitude: place.longitude,
          label: place.name || searchName
        };
      }
    } catch {
      // Fallback coordinates keep dashboard useful if geocoding fails.
    }
  }

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(coordinates.latitude))}&longitude=${encodeURIComponent(String(coordinates.longitude))}&current=wind_speed_10m,wind_direction_10m&timezone=auto`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${encodeURIComponent(String(coordinates.latitude))}&longitude=${encodeURIComponent(String(coordinates.longitude))}&current=wave_height,sea_surface_temperature&timezone=auto`;

  const [weatherResponse, marineResponse] = await Promise.all([fetch(weatherUrl), fetch(marineUrl)]);
  const weatherData = await weatherResponse.json().catch(() => ({}));
  const marineData = await marineResponse.json().catch(() => ({}));

  const windKmh = Number(weatherData?.current?.wind_speed_10m);
  const windKnots = toKnots(windKmh);
  const windDirection = Number(weatherData?.current?.wind_direction_10m);
  const waveHeight = Number(marineData?.current?.wave_height);
  const waterTemp = Number(marineData?.current?.sea_surface_temperature);
  const fishable = Number.isFinite(windKnots) && Number.isFinite(waveHeight)
    ? windKnots <= 18 && waveHeight <= 2.2
    : null;

  return {
    label: coordinates.label,
    windKnots,
    windDirection,
    waveHeight,
    waterTemp,
    fishable
  };
}

function getApiUrl(path) {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const apiBase = import.meta.env.VITE_API_URL || (isLocalHost ? "http://localhost:4000" : "");
  return `${apiBase}${path}`;
}

export default function DashboardPage({ auth, navigate, onAuth }) {
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [activityEvents, setActivityEvents] = useState([]);
  const [editorialCard, setEditorialCard] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [conditions, setConditions] = useState({
    isLoading: true,
    hasError: false,
    label: "Tampa",
    windKnots: null,
    windDirection: null,
    waveHeight: null,
    waterTemp: null,
    fishable: null
  });
  const hasUnreadNotifications = false;
  const firstName = auth.user?.name?.split(" ")[0] || "Angler";

  useEffect(() => {
    fetch(getApiUrl("/api/challenges?status=active"))
      .then((res) => res.json())
      .then((data) => {
        const nextChallenge = Array.isArray(data?.challenges) ? data.challenges[0] : null;
        setChallenge(nextChallenge || null);
        if (!nextChallenge?.id) return;
        return fetch(getApiUrl(`/api/leaderboard?challengeId=${encodeURIComponent(String(nextChallenge.id))}`))
          .then((leaderboardResponse) => leaderboardResponse.json())
          .then((leaderboardData) => setLeaderboard(leaderboardData.entries || []));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    setConditions((prev) => ({
      ...prev,
      isLoading: true,
      hasError: false
    }));

    getBrowserCoordinates()
      .then((browserCoordinates) => {
        if (cancelled) return null;
        const locationText = auth?.user?.location || challenge?.location;
        return getOpenMeteoConditions({
          locationText,
          browserCoordinates
        });
      })
      .then((nextConditions) => {
        if (cancelled || !nextConditions) return;
        setConditions({
          ...nextConditions,
          isLoading: false,
          hasError: false
        });
      })
      .catch(() => {
        if (cancelled) return;
        setConditions((prev) => ({
          ...prev,
          isLoading: false,
          hasError: true
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [auth?.user?.location, challenge?.location]);

  useEffect(() => {
    const challengeId = Number(challenge?.id);
    if (!Number.isFinite(challengeId) || challengeId <= 0) {
      setActivityEvents([]);
      return;
    }

    const regionHint = String(auth?.user?.region || auth?.user?.location || challenge?.location || "").trim();
    const params = new URLSearchParams();
    params.set("challengeId", String(challengeId));
    params.set("limit", "8");
    if (regionHint) {
      params.set("region", regionHint);
    }

    fetch(getApiUrl(`/api/activity-feed?${params.toString()}`))
      .then((res) => res.json())
      .then((data) => {
        const events = Array.isArray(data?.events) ? data.events : [];
        setActivityEvents(events);
      })
      .catch(() => {
        setActivityEvents([]);
      });
  }, [challenge?.id, challenge?.location, auth?.user?.region, auth?.user?.location]);

  useEffect(() => {
    const challengeId = Number(challenge?.id);
    if (!Number.isFinite(challengeId) || challengeId <= 0) {
      setEditorialCard(null);
      return;
    }

    fetch(getApiUrl(`/api/zone-chaude?challengeId=${encodeURIComponent(String(challengeId))}`))
      .then((res) => res.json())
      .then((data) => {
        setEditorialCard(data?.card || null);
      })
      .catch(() => {
        setEditorialCard(null);
      });
  }, [challenge?.id]);

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

      <article className="dashboard-conditions" aria-live="polite">
        <div className="dashboard-conditions-head">
          <strong>MORNING CONDITIONS</strong>
          <span>{conditions.label}</span>
        </div>
        {conditions.isLoading ? (
          <p>Loading marine conditions...</p>
        ) : conditions.hasError ? (
          <p>Conditions temporarily unavailable.</p>
        ) : (
          <>
            <div className="dashboard-conditions-grid">
              <span>
                Wind
                <b>{formatOneDecimal(conditions.windKnots)} kts {toCompassDirection(conditions.windDirection)}</b>
              </span>
              <span>
                Waves
                <b>{formatOneDecimal(conditions.waveHeight)} m</b>
              </span>
              <span>
                Water temp
                <b>{formatOneDecimal(conditions.waterTemp)} C</b>
              </span>
              <span>
                Sea state
                <b className={conditions.fishable === true ? "ok" : conditions.fishable === false ? "warn" : ""}>
                  {conditions.fishable === true ? "Fishable" : conditions.fishable === false ? "Rough" : "Check local report"}
                </b>
              </span>
            </div>
          </>
        )}
      </article>

      {editorialCard && (
        <article className="dashboard-editorial">
          <div className="dashboard-editorial-head">
            <strong>Zone chaude cette semaine</strong>
            <span>{editorialCard.label}</span>
          </div>
          <div className="dashboard-editorial-grid">
            <span>
              Region
              <b>{editorialCard.region || "-"}</b>
            </span>
            <span>
              Active species
              <b>{editorialCard.activeSpecies || "-"}</b>
            </span>
            <span>
              Conditions
              <b>{editorialCard.conditionsNote || "-"}</b>
            </span>
            <span>
              Expires
              <b>{toDateLabel(editorialCard.expiresAt)}</b>
            </span>
          </div>
        </article>
      )}

      <article className="dashboard-challenge" style={{ backgroundImage: `url(${heroImage})` }}>
        <div>
          <h3>{challenge?.location || "Weekend"} <span>Challenge</span></h3>
          <div className="dashboard-meta">
            <span>Ends in <b>{challenge?.countdown || "72h 00m"}</b></span>
            <span>Prize Pool <b>${challenge?.prizePool ?? 0}</b></span>
          </div>
          <button
            className="primary-btn"
            type="button"
            onClick={() =>
              challenge?.id ? navigate(`/challenges/${challenge.id}`) : navigate("/challenges")
            }
          >
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

      <section className="dashboard-activity panel">
        <div className="dashboard-activity-head">
          <h2>Recent Activity</h2>
        </div>
        {activityEvents.slice(0, 3).map((event) => (
          <p key={event.id}>{event.message} · {toTimeLabel(event.occurredAt)}</p>
        ))}
        {activityEvents.length === 0 && <p>No recent activity yet. Be the first to join.</p>}
      </section>

      <section className="dashboard-section-title">
        <h2>Leaderboard</h2>
        <button
          type="button"
          onClick={() =>
            navigate(
              challenge?.id
                ? `/leaderboard?challengeId=${encodeURIComponent(String(challenge.id))}`
                : "/leaderboard"
            )
          }
        >
          View All
        </button>
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
