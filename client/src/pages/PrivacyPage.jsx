export default function PrivacyPage({ navigate }) {
  const goBackToSettings = () => {
    if (typeof navigate === "function") {
      navigate("/profile");
      return;
    }
    window.history.back();
  };

  return (
    <main className="page legal-page">
      <section className="page-heading">
        <button className="section-back legal-back" type="button" onClick={goBackToSettings} aria-label="Back to settings">
          <span>‹</span>
          Back to Settings
        </button>
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="page-intro">
          This policy explains what Offshore League collects, why it is collected, and how participants can make privacy requests.
        </p>
      </section>

      <section className="panel legal-panel">
        <h2>1. What We Collect</h2>
        <p>
          Offshore League collects name, email, account credentials, challenge entry records, payment status, submission videos, claimed fish weight, selected weight unit, review metadata, device and browser data when analytics are used, and location data if collected for challenge-zone validation. Payment card data is processed by Stripe; Offshore League does not store card numbers.
        </p>

        <h2>2. Why We Collect It</h2>
        <p>
          Name and email are used for account access, challenge administration, code delivery, review communication, and prize distribution. Payment information is processed by Stripe under Stripe's privacy policy. Submission videos and metadata are used only for verification, integrity review, appeals, and dispute handling. Analytics data may be used to improve platform reliability and user experience. Location data, where enabled, is used to validate eligibility and zone compliance.
        </p>

        <h2>3. How We Store It</h2>
        <p>
          MVP data is stored in the application database and local media storage. In production, data should be stored in secured cloud infrastructure with access controls. Account and transaction records are retained for up to seven years where needed for tax, audit, dispute, or legal purposes. Submission videos are retained for up to 180 days after a challenge closes, unless needed for disputes, fraud review, legal compliance, or winner verification. Users may request deletion, subject to legal, tax, anti-fraud, and dispute-retention obligations.
        </p>

        <h2>4. What We Share and With Who</h2>
        <p>
          Offshore League does not sell personal data. Payment data is shared with Stripe for payment processing. Winning submissions may be displayed publicly in limited form, including participant display name, catch details, verified measurement, and challenge result. Offshore League may share data with service providers that support hosting, analytics, storage, email, security, or legal compliance. Users will be notified of a confirmed data breach within 72 hours where legally required or otherwise as soon as reasonably practicable.
        </p>

        <h2>5. User Rights</h2>
        <p>
          Users may request access to their data, correction of inaccurate data, deletion of eligible data, or opt out of marketing emails. To exercise these rights, contact offshoreleague@gmail.com. Identity verification may be required before fulfilling privacy requests.
        </p>

        <h2>6. Cookies & Tracking</h2>
        <p>
          Offshore League may use essential cookies or local storage for login sessions and application functionality. Third-party analytics may be used to understand usage and improve the product. Users can control browser cookies through their browser settings and may opt out of marketing emails using the unsubscribe link in those emails.
        </p>
      </section>
    </main>
  );
}
