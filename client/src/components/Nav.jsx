import logoHorizontal from "../assets/logo-horizontal.png";

export default function Nav({ auth, navigate, route }) {
  const isAuthenticated = Boolean(auth?.token || auth?.user);
  const isLanding = route === "/";
  const hideActions = route === "/auth" || route === "/auth/callback";
  const links = [
    { href: "/", label: "Challenges" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "#how-it-works", label: "How it works" }
  ];

  const goToLink = (href) => {
    if (href === "#how-it-works") {
      if (route !== "/") {
        navigate("/");
        window.setTimeout(() => {
          document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
        }, 80);
        return;
      }

      document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    navigate(href);
  };

  return (
    <header className={`topbar${isLanding ? " topbar-landing" : ""}`}>
      <button className="brand" type="button" onClick={() => navigate("/")}>
        <img className="header-logo-img" src={logoHorizontal} alt="Offshore League" />
      </button>
      <nav aria-label="Primary navigation">
        {links.map((link) => (
          <button
            className={route === link.href ? "active" : ""}
            key={link.href}
            type="button"
            onClick={() => goToLink(link.href)}
          >
            {link.label}
          </button>
        ))}
      </nav>
      {!hideActions && (
        <div className="nav-actions">
          {isAuthenticated ? (
            <>
              <button className="nav-login" type="button" onClick={() => navigate("/dashboard")}>
                Dashboard
              </button>
              <button className="nav-cta" type="button" onClick={() => navigate("/profile")}>
                Profile
              </button>
            </>
          ) : (
            <>
              <button className="nav-login" type="button" onClick={() => navigate("/auth")}>
                Log In
              </button>
              <button className="nav-cta" type="button" onClick={() => navigate("/")}>
                Join the Challenge
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
