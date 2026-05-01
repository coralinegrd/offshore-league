const eligibleStates = ["Florida"];

export default function TermsPage({ navigate }) {
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
        <h1>Terms & Conditions</h1>
        <p className="page-intro">
          These terms are a product-ready draft for Offshore League and should be reviewed by qualified counsel before launch.
        </p>
      </section>

      <section className="panel legal-panel">
        <h2>1. Nature of the Competition</h2>
        <p>
          Offshore League entry fees are paid for access to a structured skill-based fishing competition. No element of chance determines the outcome. Prizes are awarded based solely on verified measurable performance under the published challenge rules. Offshore League is not gambling, betting, a sweepstakes, a raffle, or a lottery.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          Participants must be 18 years of age or older and must be legal residents of the United States in an eligible operating state. Current eligible states: {eligibleStates.join(", ")}. Employees, partners, contractors, vendors, and immediate family members of Offshore League are ineligible. Each person may maintain only one account. Duplicate accounts, account sharing, or identity misrepresentation may result in permanent disqualification.
        </p>

        <h2>3. Entry Fee & Refund Policy</h2>
        <p>
          Entry fees are non-refundable once the challenge window opens. If Offshore League cancels a challenge, affected participants will receive a full refund. No refunds are issued for rejected submissions, missed submission windows, failure to submit, disqualification, or technical issues outside Offshore League's reasonable control.
        </p>

        <h2>4. Prize Distribution</h2>
        <p>
          Prize pools are dynamic and scale with paid participation. Unless a challenge states otherwise, 80% of the total entry pool is awarded to the verified winner and 20% is retained by Offshore League as the platform fee. Approved prizes are paid within 14 business days after verification closes. Payouts may be made by bank transfer, check, or another approved payment method. Winners are solely responsible for taxes on prizes received. Prizes of $600 or more may require tax reporting, including Form 1099 under U.S. tax law.
        </p>

        <h2>5. Submission Rules & Verification</h2>
        <p>
          Each entry receives one video submission. Videos must be continuous with no cuts. The challenge code, full fish, measurement, participant presence, and water or boat environment must be visible. Submissions must be made within the challenge window. Wrong species, missing code, unclear measurement, edited media, partial fish, mutilated fish, fish not alive and intact at measurement, or submissions outside the window may be automatically rejected. Participants cannot resubmit after rejection.
        </p>
        <p>
          Offshore League may reject any submission that fails protocol. Top entries are subject to human integrity review. Appeals must be submitted within 24 hours of rejection. Appeals are reviewed by a second reviewer where practical, and the final platform decision is binding on all integrity matters.
        </p>

        <h2>6. Conduct & Disqualification</h2>
        <p>
          Fraudulent submissions, manipulated media, false identity, duplicate accounts, harassment, threats, or attempts to manipulate results may result in immediate disqualification, permanent ban, and forfeiture of the entry fee. Offshore League reserves the right to disqualify entries at its discretion when applying the written challenge criteria.
        </p>

        <h2>7. Liability Limitations</h2>
        <p>
          Participants fish at their own risk. Offshore League is not responsible for injuries, accidents, boating incidents, weather events, equipment loss, wildlife encounters, or other incidents occurring before, during, or after fishing. Offshore League is not liable for internet outages, upload failures, device problems, or submission failures beyond its reasonable control. To the maximum extent permitted by law, Offshore League's liability is capped at the entry fee paid for the applicable challenge.
        </p>

        <h2>8. Governing Law & Disputes</h2>
        <p>
          These terms are governed by the laws of the State of Florida, USA. Any dispute must first be raised with Offshore League in writing. If unresolved, disputes will be resolved by binding individual arbitration in Florida, unless prohibited by law. Participants waive the right to participate in class actions, class arbitrations, or representative proceedings.
        </p>
      </section>
    </main>
  );
}
