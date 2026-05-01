import { useState } from "react";

export default function CheckoutPage({ auth, navigate }) {
  return (
    <main className="page checkout-page">
      <section className="panel success-panel flow-card">
        <p className="eyebrow">Stripe Checkout</p>
        <h1>Use hosted Stripe</h1>
        <p className="page-intro">
          Real payments happen on Stripe's hosted checkout page. Start from the challenge registration CTA to create a fresh Checkout Session.
        </p>
        <button className="primary-btn" type="button" onClick={() => navigate("/")}>
          Back to Challenge
        </button>
      </section>
    </main>
  );
}
