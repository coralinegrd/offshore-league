import { useEffect, useState } from "react";
import heroImage from "../assets/hero-offshore.png";

const liveChallenge = {
  id: "tampa-mahi-mahi",
  title: "Tampa Mahi-Mahi Challenge",
  status: "Live",
  schedule: "Fri - Sun",
  payout: "80% Payout",
  fee: 30,
  image: heroImage,
  isOpen: true
};

const upcomingChallenges = [
  {
    id: "key-west-deep-water",
    title: "Key West Deep Water Challenge",
    status: "Coming soon",
    schedule: "Saturday",
    payout: "Prize pool opens soon",
    fee: 25,
    image: heroImage,
    isOpen: false
  }
];

export default function ChallengesPage({ navigate }) {
  const [activeTab, setActiveTab] = useState("live");
  const [primaryChallenge, setPrimaryChallenge] = useState(null);

  useEffect(() => {
    fetch("/api/challenge")
      .then((res) => res.json())
      .then(setPrimaryChallenge)
      .catch(() => {});
  }, []);

  const activeChallenge = {
    ...liveChallenge,
    fee: primaryChallenge?.entryFee ?? liveChallenge.fee,
    prize: `$${primaryChallenge?.prizePool ?? 0}+ Prizes`
  };
  const visibleChallenges =
    activeTab === "live" ? [activeChallenge] : activeTab === "upcoming" ? upcomingChallenges : [];

  return (
    <main className="page app-screen challenges-screen">
      <section className="app-page-title">
        <h1>Challenges</h1>
      </section>

      <div className="segmented-tabs">
        {["live", "upcoming", "my joined"].map((tab) => (
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
        {visibleChallenges.length === 0 && (
          <div className="panel empty-panel">
            <strong>No challenges here yet.</strong>
            <span>Live Tampa events will appear as they open.</span>
          </div>
        )}
        {visibleChallenges.map((challenge) => {
          return (
            <article className="challenge-list-card" key={challenge.id} style={{ backgroundImage: `url(${challenge.image})` }}>
              <div>
                <span className={challenge.isOpen ? "live-badge" : "live-badge muted-badge"}>{challenge.status}</span>
                <h2>{challenge.title}</h2>
                <div className="challenge-card-meta">
                  <span>{challenge.schedule}</span>
                  <span>{challenge.payout}</span>
                  {challenge.prize && <span>{challenge.prize}</span>}
                </div>
                <button
                  className="primary-btn"
                  disabled={!challenge.isOpen}
                  type="button"
                  onClick={() => challenge.isOpen && navigate("/")}
                >
                  {challenge.isOpen ? `Join - $${challenge.fee}` : "Opening Soon"}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
