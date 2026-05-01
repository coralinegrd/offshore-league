function TabIcon({ name }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 11.5 12 5l8 6.5v8a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "challenges") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="11" cy="12.5" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="11" cy="12.5" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="11" cy="12.5" r="1.4" fill="currentColor" />
        <path d="m13.2 10.4 6.1-6.1m-3 .1h3.2v3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m17.3 8.4 2.1-2.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "submit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "leaderboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6.5 19h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 19v-6h3v6M13.5 19v-9h3v9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m7.2 7.5 2.6-1.7 2.3 1.5 4-2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function BottomNav({ navigate, route }) {
  const items = [
    { href: "/dashboard", label: "Home", icon: "home" },
    { href: "/challenges", label: "Challenges", icon: "challenges" },
    { href: "/submit", label: "Submit", icon: "submit" },
    { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
    { href: "/profile", label: "Profile", icon: "profile" }
  ];

  const isActive = (href) => {
    if (href === "/challenges") return route === "/" || route === "/challenges";
    return route === href;
  };

  return (
    <nav className="bottom-nav" aria-label="App navigation">
      {items.map((item) => (
        <button
          className={`${isActive(item.href) ? "active" : ""} ${item.href === "/submit" ? "submit-tab" : ""}`}
          key={item.href}
          type="button"
          onClick={() => navigate(item.href)}
        >
          <span className="tab-icon"><TabIcon name={item.icon} /></span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
