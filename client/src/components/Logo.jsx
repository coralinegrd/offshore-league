export default function Logo({ compact = false, tagline = false }) {
  return (
    <span className={compact ? "logo logo-compact" : "logo"}>
      <svg className="logo-icon" viewBox="0 0 80 80" aria-hidden="true">
        <path
          d="M68 9 24 27l15 5-16 12c-12 9-15 24-7 33 3-14 11-24 24-29l-7-7 24-10-6 12c12 6 16 17 9 27-6 9-19 12-30 6 13 2 23-3 27-12 4-10-1-19-12-24l-8 15 12-4c-2 10-11 19-23 19-14 0-23-12-18-26 3-9 11-17 22-22l-7-2L68 9Z"
          fill="currentColor"
        />
        <path
          d="M12 48c3-17 18-31 41-43C30 12 12 29 8 51c-1 7 0 13 3 18-1-7-1-14 1-21Z"
          fill="currentColor"
          opacity="0.72"
        />
      </svg>
      {!compact && (
        <span className="logo-type">
          <span className="logo-main">Offshore</span>
          <span className="logo-league">League</span>
          {tagline && <span className="logo-tagline">Compete. Catch. Win.</span>}
        </span>
      )}
    </span>
  );
}
