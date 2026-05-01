import logoHorizontal from "../assets/logo-horizontal.png";

export default function Footer({ navigate }) {
  return (
    <footer className="site-footer">
      <button className="footer-logo" type="button" onClick={() => navigate("/")}>
        <img className="footer-logo-img" src={logoHorizontal} alt="Offshore League" />
      </button>
      <p>
        Skill-based recreational competition. Entry fees are for participation only.
        Prizes are awarded based on verified performance.
      </p>
      <div className="footer-links">
        <button type="button" onClick={() => navigate("/terms")}>Terms</button>
        <button type="button" onClick={() => navigate("/privacy")}>Privacy</button>
        <button type="button" onClick={() => window.location.href = "mailto:offshoreleague@gmail.com"}>Contact</button>
      </div>
    </footer>
  );
}
