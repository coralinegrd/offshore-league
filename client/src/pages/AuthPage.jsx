import { useEffect, useState } from "react";
import logoHorizontal from "../assets/logo-horizontal.png";
import { saveAuth } from "../authStorage.js";

export default function AuthPage({ navigate, onAuth }) {
  const [mode, setMode] = useState("register");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const runMagicTokenLogin = async () => {
      const params = new URLSearchParams(window.location.search);
      const magicToken = params.get("magicToken");
      if (!magicToken) return;

      setMode("login");
      setMagicLoading(true);
      setError("");
      setMessage("Verifying your login link...");

      try {
        const response = await fetch("/api/auth/magic-link/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: magicToken })
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Magic link is invalid or expired.");

        saveAuth(data);
        onAuth(data);
        window.history.replaceState({}, "", "/auth");
        navigate("/dashboard");
      } catch (err) {
        setError(err.message);
        setMessage("");
      } finally {
        setMagicLoading(false);
      }
    };

    runMagicTokenLogin();
  }, [navigate, onAuth]);

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (mode === "register" && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Authentication failed.");

      saveAuth(data);
      onAuth(data);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const requestMagicLink = async () => {
    setError("");
    setMessage("");

    if (!form.email?.trim()) {
      setError("Enter your email first.");
      return;
    }

    setMagicLoading(true);
    try {
      const response = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim().toLowerCase() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send login link.");
      setMessage(data.message || "If an account exists, a login link has been sent.");
    } catch (err) {
      setError(err.message);
    } finally {
      setMagicLoading(false);
    }
  };

  return (
    <main className="page narrow-page">
      <form className="panel form-panel flow-card" onSubmit={submitAuth}>
        <img className="auth-logo" src={logoHorizontal} alt="Offshore League" />
        <p className="eyebrow">{mode === "register" ? "Create account" : "Welcome back"}</p>
        <h1>{mode === "register" ? "Join first" : "Log in"}</h1>
        <p className="page-intro">
          You need an account before checkout. Your challenge code is issued only after payment is confirmed.
        </p>
        {mode === "login" && (
          <p className="small-copy">Prefer faster mobile login? Use a one-time email link.</p>
        )}
        <div className="auth-tabs">
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>
            Create account
          </button>
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>
            Log in
          </button>
        </div>
        {mode === "register" && (
          <label>
            Name
            <input name="name" value={form.name} onChange={updateField} placeholder="Your name" required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@example.com" required />
        </label>
        <label>
          Password
          <span className="password-field">
            <input name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={updateField} placeholder="Minimum 8 characters" minLength="8" required />
            <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        {mode === "register" && (
          <label>
            Retype password
            <span className="password-field">
              <input name="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={form.confirmPassword} onChange={updateField} placeholder="Retype your password" minLength="8" required />
              <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
        )}
        {mode === "login" && (
          <button className="secondary-btn" type="button" onClick={requestMagicLink} disabled={magicLoading || loading}>
            {magicLoading ? "Sending login link..." : "Email me a login link"}
          </button>
        )}
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error">{error}</p>}
        <button className="primary-btn" disabled={loading} type="submit">
          {loading ? "Working..." : mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>
    </main>
  );
}
