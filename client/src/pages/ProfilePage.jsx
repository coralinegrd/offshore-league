import { useEffect, useRef, useState } from "react";
import { clearAuth, saveAuth } from "../authStorage.js";

const LOCATION_SUGGESTIONS = [
  "Tampa, FL",
  "St. Petersburg, FL",
  "Clearwater, FL",
  "Sarasota, FL",
  "Bradenton, FL",
  "Fort Myers, FL",
  "Naples, FL",
  "Miami, FL",
  "Key West, FL",
  "Jacksonville, FL",
  "Destin, FL",
  "Pensacola, FL"
];

function getApiUrl(path) {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const apiBase = import.meta.env.VITE_API_URL || (isLocalHost ? "http://localhost:4000" : "");
  return `${apiBase}${path}`;
}

function formatSubmissionStatus(status) {
  if (status === "approved") return "Verified";
  if (status === "rejected") return "Rejected";
  if (status === "pending") return "Pending Review";
  return "Not Submitted";
}

export default function ProfilePage({ auth, navigate, onAuth }) {
  const user = auth.user;
  const [activeSection, setActiveSection] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    address: user?.address || "",
    location: user?.location || ""
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [avatarMessage, setAvatarMessage] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [challengeOverview, setChallengeOverview] = useState(null);
  const [payoutsData, setPayoutsData] = useState(null);
  const [payoutForm, setPayoutForm] = useState({
    methodType: user?.payoutMethodType || "bank_transfer",
    methodDetails: user?.payoutMethodDetails || ""
  });
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [showPayoutsMenuItem, setShowPayoutsMenuItem] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState({
    challengeClosing: user?.notifications?.challengeClosing ?? true,
    submissionReviewed: user?.notifications?.submissionReviewed ?? true,
    newRegionalChallenges: user?.notifications?.newRegionalChallenges ?? true
  });
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loadingSection, setLoadingSection] = useState("");
  const [sectionError, setSectionError] = useState("");
  const sectionRef = useRef(null);
  const hasAutoLocateAttempted = useRef(false);
  const contactEmail = "offshoreleague@gmail.com";

  const normalizedLocationInput = profileForm.location.trim().toLowerCase();
  const locationOptions = detectedLocation
    ? [detectedLocation, ...LOCATION_SUGGESTIONS.filter((entry) => entry !== detectedLocation)]
    : LOCATION_SUGGESTIONS;

  const filteredLocationSuggestions = locationOptions
    .filter((entry) => entry.toLowerCase().includes(normalizedLocationInput))
    .slice(0, 6);

  const reverseGeocode = async (latitude, longitude) => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error("Could not reverse geocode location.");
    }

    const payload = await response.json();
    const city = payload?.address?.city || payload?.address?.town || payload?.address?.village || payload?.address?.county || "";
    const state = payload?.address?.state || "";
    const country = payload?.address?.country_code?.toUpperCase() || "";

    if (city && state) return `${city}, ${state}`;
    if (city && country) return `${city}, ${country}`;
    return payload?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  };

  const suggestCurrentLocation = async ({ applyIfEmptyOnly = true } = {}) => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Location services are unavailable in this browser.");
      return;
    }

    setIsDetectingLocation(true);
    setLocationStatus("Detecting current location...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        try {
          const resolved = await reverseGeocode(latitude, longitude);
          setDetectedLocation(resolved);
          setLocationStatus(`Suggested: ${resolved}`);

          if (!applyIfEmptyOnly || !profileForm.location.trim()) {
            setProfileForm((current) => ({
              ...current,
              location: resolved
            }));
          }
        } catch {
          const fallback = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          setDetectedLocation(fallback);
          setLocationStatus(`Suggested coordinates: ${fallback}`);

          if (!applyIfEmptyOnly || !profileForm.location.trim()) {
            setProfileForm((current) => ({
              ...current,
              location: fallback
            }));
          }
        } finally {
          setIsDetectingLocation(false);
        }
      },
      () => {
        setIsDetectingLocation(false);
        setLocationStatus("Allow location access to get a local suggestion.");
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  const openSection = (sectionKey) => {
    setSectionError("");
    setProfileMessage("");
    setShowLocationMenu(false);
    setActiveSection(sectionKey);

    if (sectionKey === "account" && !hasAutoLocateAttempted.current) {
      hasAutoLocateAttempted.current = true;
      suggestCurrentLocation({ applyIfEmptyOnly: true });
    }

    window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const logOut = () => {
    clearAuth();
    onAuth({ token: null, user: null });
    navigate("/");
  };

  const goBackFromSettings = () => {
    navigate("/dashboard");
  };

  const updateAvatar = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarMessage("");
    setAvatarError("");

    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const avatarUrl = String(reader.result || "");

      try {
        const response = await fetch(getApiUrl("/api/me/avatar"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({ avatarUrl })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Could not update profile picture.");
        }

        const updatedAuth = {
          token: auth.token,
          user: {
            ...user,
            avatarUrl: data.avatarUrl || avatarUrl
          }
        };
        saveAuth(updatedAuth);
        onAuth(updatedAuth);
        setAvatarMessage("Profile picture updated.");
      } catch (err) {
        setAvatarError(err.message || "Could not update profile picture.");
      }

      event.target.value = "";
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!auth.token || !["challenges", "submissions", "payments", "payouts"].includes(activeSection)) return;

    const endpointMap = {
      challenges: "/api/me/overview",
      submissions: "/api/me/submissions",
      payments: "/api/me/payments",
      payouts: "/api/me/payouts"
    };
    const endpoint = endpointMap[activeSection];
    setLoadingSection(activeSection);
    setSectionError("");

    fetch(getApiUrl(endpoint), {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("Account data is unavailable right now. Make sure the API server is running.");
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load account data.");
        if (activeSection === "challenges") setChallengeOverview(data);
        if (activeSection === "submissions") setSubmissions(data.submissions || []);
        if (activeSection === "payments") setPayments(data.payments || []);
        if (activeSection === "payouts") {
          setPayoutsData(data);
          setShowPayoutsMenuItem(Boolean(data.hasWins));
          if (data.preferredMethod) {
            setPayoutForm({
              methodType: data.preferredMethod.type || "bank_transfer",
              methodDetails: data.preferredMethod.details || ""
            });
          }
        }
      })
      .catch((err) => setSectionError(err.message))
      .finally(() => setLoadingSection(""));
  }, [activeSection, auth.token]);

  useEffect(() => {
    if (!auth.token) {
      setShowPayoutsMenuItem(false);
      return;
    }

    fetch(getApiUrl("/api/me/payouts"), {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    })
      .then((response) => response.json())
      .then((data) => {
        setPayoutsData(data);
        setShowPayoutsMenuItem(Boolean(data.hasWins));
        if (data.preferredMethod) {
          setPayoutForm({
            methodType: data.preferredMethod.type || "bank_transfer",
            methodDetails: data.preferredMethod.details || ""
          });
        }
      })
      .catch(() => {
        setShowPayoutsMenuItem(false);
      });
  }, [auth.token]);

  useEffect(() => {
    setProfileForm({
      name: user?.name || "",
      email: user?.email || "",
      address: user?.address || "",
      location: user?.location || ""
    });
  }, [user?.name, user?.email, user?.address, user?.location]);

  useEffect(() => {
    if (!auth.token) return;

    fetch(getApiUrl("/api/me/notification-preferences"), {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.preferences) {
          setNotificationPrefs(data.preferences);
        }
      })
      .catch(() => {});
  }, [auth.token]);

  const updateProfileField = (event) => {
    const { name, value } = event.target;
    setProfileForm((current) => ({
      ...current,
      [name]: value
    }));

    if (name === "location") {
      setShowLocationMenu(true);
    }
  };

  const chooseLocation = (value) => {
    setProfileForm((current) => ({
      ...current,
      location: value
    }));
    setLocationStatus(`Using: ${value}`);
    setShowLocationMenu(false);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileMessage("");
    setSectionError("");
    setProfileSaving(true);

    try {
      const response = await fetch(getApiUrl("/api/me/profile"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify(profileForm)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not update profile right now.");
      }

      const updatedAuth = {
        token: auth.token,
        user: {
          ...user,
          ...data.user
        }
      };

      saveAuth(updatedAuth);
      onAuth(updatedAuth);
      setProfileMessage("Profile updated.");
    } catch (err) {
      setSectionError(err.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const saveNotificationPreferences = async () => {
    setSectionError("");
    setNotificationSaving(true);

    try {
      const response = await fetch(getApiUrl("/api/me/notification-preferences"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify(notificationPrefs)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save notification preferences.");
      }

      const updatedAuth = {
        token: auth.token,
        user: {
          ...user,
          notifications: data.preferences
        }
      };

      saveAuth(updatedAuth);
      onAuth(updatedAuth);
      setProfileMessage("Notification preferences saved.");
    } catch (err) {
      setSectionError(err.message);
    } finally {
      setNotificationSaving(false);
    }
  };

  const savePayoutMethod = async (event) => {
    event.preventDefault();
    setSectionError("");
    setPayoutSaving(true);

    try {
      const response = await fetch(getApiUrl("/api/me/payout-method"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify(payoutForm)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save payout method.");
      }

      setPayoutsData((current) => ({
        ...(current || {}),
        preferredMethod: data.preferredMethod
      }));
      setProfileMessage("Payout method saved.");
    } catch (err) {
      setSectionError(err.message);
    } finally {
      setPayoutSaving(false);
    }
  };

  const formatDate = (value) => {
    if (!value) return "Not available";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date(value));
  };

  if (!user) {
    return (
      <main className="page narrow-page app-screen">
        <button className="section-back settings-back" type="button" onClick={goBackFromSettings} aria-label="Back">
          <span>‹</span>
          Back
        </button>
        <section className="panel profile-card flow-card">
          <p className="eyebrow">Profile</p>
          <h1>Log in</h1>
          <p className="page-intro">Create an account or log in to enter challenges, receive codes, and submit catches.</p>
          <button className="primary-btn" type="button" onClick={() => navigate("/auth")}>
            Log In
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page app-screen">
      <button className="section-back settings-back" type="button" onClick={goBackFromSettings} aria-label="Back">
        <span>‹</span>
        Back
      </button>
      <section className="panel profile-hero">
        <label className="profile-avatar upload-avatar" aria-label="Upload profile picture">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.slice(0, 1).toUpperCase()}
          <input type="file" accept="image/*" onChange={updateAvatar} />
        </label>
        <h1>{user.name}</h1>
        <p>{user.email}</p>
        <span className="verified">Verified Angler</span>
        {avatarMessage && <p className="success">{avatarMessage}</p>}
        {avatarError && <p className="error-text">{avatarError}</p>}
      </section>

      <section className="profile-menu">
        <button className={activeSection === "account" ? "active" : ""} type="button" onClick={() => openSection("account")}>
          Account Details
        </button>
        <button className={activeSection === "challenges" ? "active" : ""} type="button" onClick={() => openSection("challenges")}>
          My Challenges
        </button>
        <button className={activeSection === "submissions" ? "active" : ""} type="button" onClick={() => openSection("submissions")}>
          My Submissions
        </button>
        <button className={activeSection === "payments" ? "active" : ""} type="button" onClick={() => openSection("payments")}>
          Payment History
        </button>
        {showPayoutsMenuItem && (
          <button className={activeSection === "payouts" ? "active" : ""} type="button" onClick={() => openSection("payouts")}>
            Payouts
          </button>
        )}
        <button className={activeSection === "support" ? "active" : ""} type="button" onClick={() => openSection("support")}>
          Help & Support
        </button>
        <button type="button" onClick={() => navigate("/terms")}>Terms & Conditions</button>
        <button type="button" onClick={() => navigate("/privacy")}>Privacy Policy</button>
        <button className="logout-btn" type="button" onClick={logOut}>Log Out</button>
        {!showPayoutsMenuItem && (
          <p className="settings-note">Payouts will appear here after your first verified winning catch.</p>
        )}
      </section>

      {activeSection && (
      <section className="panel profile-section" ref={sectionRef}>
        <button className="section-back" type="button" onClick={() => setActiveSection("")} aria-label="Back to settings">
          <span>‹</span>
          Back
        </button>
        {sectionError && <p className="error-text">{sectionError}</p>}

        {activeSection === "account" && (
          <>
            <h2>Account Details</h2>
            {profileMessage && <p className="success">{profileMessage}</p>}
            <form className="profile-form" onSubmit={saveProfile}>
              <label htmlFor="profile-name">
                Name
                <input id="profile-name" name="name" value={profileForm.name} onChange={updateProfileField} required />
              </label>
              <label htmlFor="profile-email">
                Email
                <input id="profile-email" type="email" name="email" value={profileForm.email} onChange={updateProfileField} required />
              </label>
              <label htmlFor="profile-location">
                Location
                <div className="location-autocomplete">
                  <input
                    id="profile-location"
                    name="location"
                    value={profileForm.location}
                    onChange={updateProfileField}
                    onFocus={() => setShowLocationMenu(true)}
                    onBlur={() => window.setTimeout(() => setShowLocationMenu(false), 120)}
                    placeholder="City, State"
                    autoComplete="off"
                  />
                  {showLocationMenu && filteredLocationSuggestions.length > 0 && (
                    <div className="location-menu" role="listbox" aria-label="Location suggestions">
                      {filteredLocationSuggestions.map((entry) => (
                        <button
                          key={entry}
                          type="button"
                          onMouseDown={() => chooseLocation(entry)}
                          className="location-menu-item"
                        >
                          {entry}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="location-tools">
                  <button
                    type="button"
                    className="location-refresh"
                    onClick={() => suggestCurrentLocation({ applyIfEmptyOnly: false })}
                    disabled={isDetectingLocation}
                  >
                    {isDetectingLocation ? "Detecting..." : "Use Current Location"}
                  </button>
                  {locationStatus && <small className="location-status">{locationStatus}</small>}
                </div>
              </label>
              <button className="primary-btn" type="submit" disabled={profileSaving}>
                {profileSaving ? "Saving..." : "Save Changes"}
              </button>
            </form>

            <section className="profile-notification-section">
              <h3 className="profile-subheading">Email Notifications</h3>

              <label className="toggle-row" htmlFor="notify-challenge-closing">
                <span>Email when challenge closes soon</span>
                <input
                  id="notify-challenge-closing"
                  type="checkbox"
                  checked={notificationPrefs.challengeClosing}
                  onChange={(event) => setNotificationPrefs((current) => ({
                    ...current,
                    challengeClosing: event.target.checked
                  }))}
                />
              </label>

              <label className="toggle-row" htmlFor="notify-submission-reviewed">
                <span>Email when submission is reviewed</span>
                <input
                  id="notify-submission-reviewed"
                  type="checkbox"
                  checked={notificationPrefs.submissionReviewed}
                  onChange={(event) => setNotificationPrefs((current) => ({
                    ...current,
                    submissionReviewed: event.target.checked
                  }))}
                />
              </label>

              <label className="toggle-row" htmlFor="notify-new-regional-challenges">
                <span>Email about new challenges in your region</span>
                <input
                  id="notify-new-regional-challenges"
                  type="checkbox"
                  checked={notificationPrefs.newRegionalChallenges}
                  onChange={(event) => setNotificationPrefs((current) => ({
                    ...current,
                    newRegionalChallenges: event.target.checked
                  }))}
                />
              </label>

              <button className="primary-btn" type="button" onClick={saveNotificationPreferences} disabled={notificationSaving}>
                {notificationSaving ? "Saving..." : "Save Notification Preferences"}
              </button>
            </section>
          </>
        )}

        {activeSection === "submissions" && (
          <>
            <h2>My Submissions</h2>
            {loadingSection === "submissions" && <p className="empty-state">Loading submissions...</p>}
            {!loadingSection && submissions.length === 0 && <p className="empty-state">No catch submissions yet.</p>}
            {submissions.map((submission) => (
              <article className="profile-list-item" key={submission.id}>
                <div>
                  <strong>{submission.species}</strong>
                  <span>{submission.challenge_code} - {formatDate(submission.created_at)}</span>
                </div>
                <b>{submission.status}</b>
                <small>
                  Claimed {Number(submission.claimed_weight).toFixed(1)} {submission.claimed_weight_unit}
                  {submission.verified_length ? ` - Verified ${Number(submission.verified_length).toFixed(1)} cm` : ""}
                  {submission.rejection_reason ? ` - ${submission.rejection_reason}` : ""}
                </small>
              </article>
            ))}
          </>
        )}

        {activeSection === "challenges" && (
          <>
            <h2>My Challenges</h2>
            {loadingSection === "challenges" && <p className="empty-state">Loading challenge overview...</p>}
            {!loadingSection && (
              <section className="profile-challenge-grid">
                <article>
                  <strong>{challengeOverview?.activeChallengeCount ?? 0}</strong>
                  <span>Active</span>
                </article>
                <article>
                  <strong>{challengeOverview?.activeChallenges?.[0]?.remainingLabel || "--"}</strong>
                  <span>Time Left</span>
                </article>
                <article>
                  <strong>{formatSubmissionStatus(challengeOverview?.latestSubmissionStatus)}</strong>
                  <span>Submission</span>
                </article>
                <article>
                  <strong>
                    {challengeOverview?.ranking?.rank
                      ? `#${challengeOverview.ranking.rank}`
                      : "Unranked"}
                  </strong>
                  <span>Ranking</span>
                </article>
              </section>
            )}

            {!loadingSection && challengeOverview?.activeChallenges?.length === 0 && (
              <p className="empty-state">No active challenges right now. Join one to track countdown and status here.</p>
            )}

            {(challengeOverview?.activeChallenges || []).map((item) => (
              <article className="profile-list-item" key={item.challengeCode}>
                <div>
                  <strong>{item.challengeCode}</strong>
                  <span>Ends {formatDate(item.endsAt)}</span>
                </div>
                <b>{item.remainingLabel}</b>
                <small>{formatSubmissionStatus(item.submissionStatus)}</small>
              </article>
            ))}
          </>
        )}

        {activeSection === "payments" && (
          <>
            <h2>Payment History</h2>
            {loadingSection === "payments" && <p className="empty-state">Loading payments...</p>}
            {!loadingSection && payments.length === 0 && <p className="empty-state">No challenge payments yet.</p>}
            {payments.map((payment) => (
              <article className="profile-list-item" key={payment.id}>
                <div>
                  <strong>{payment.challenge}</strong>
                  <span>{formatDate(payment.paid_at || payment.created_at)}</span>
                </div>
                <b>{payment.status}</b>
                <small>
                  ${payment.amount} {payment.currency}
                  {payment.challenge_code ? ` - Code ${payment.challenge_code}` : ""}
                </small>
              </article>
            ))}
          </>
        )}

        {activeSection === "payouts" && showPayoutsMenuItem && (
          <>
            <h2>Payouts</h2>
            {loadingSection === "payouts" && <p className="empty-state">Loading payouts...</p>}

            {!loadingSection && (
              <>
                <h3 className="profile-subheading">Pending Winnings</h3>
                {payoutsData?.pendingWinnings?.length ? payoutsData.pendingWinnings.map((item) => (
                  <article className="profile-list-item" key={`pending-${item.submissionId}`}>
                    <div>
                      <strong>{item.challengeCode}</strong>
                      <span>{item.challenge}</span>
                    </div>
                    <b>${Number(item.amount || 0).toFixed(2)}</b>
                    <small>Awaiting verification window until {formatDate(item.verificationEndsAt)}</small>
                  </article>
                )) : <p className="empty-state">No pending winnings.</p>}

                <h3 className="profile-subheading">Paid Out</h3>
                {payoutsData?.paidOut?.length ? payoutsData.paidOut.map((item) => (
                  <article className="profile-list-item" key={`paid-${item.submissionId}`}>
                    <div>
                      <strong>{item.challengeCode}</strong>
                      <span>{item.challenge}</span>
                    </div>
                    <b>${Number(item.amount || 0).toFixed(2)}</b>
                    <small>Paid on {formatDate(item.paidAt)}</small>
                  </article>
                )) : <p className="empty-state">No payouts completed yet.</p>}

                <h3 className="profile-subheading">Preferred Payout Method</h3>
                <form className="profile-form" onSubmit={savePayoutMethod}>
                  <label htmlFor="payout-method-type">
                    Method
                    <select
                      id="payout-method-type"
                      value={payoutForm.methodType}
                      onChange={(event) => setPayoutForm((current) => ({ ...current, methodType: event.target.value }))}
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="paypal">PayPal</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  <label htmlFor="payout-method-details">
                    Details
                    <input
                      id="payout-method-details"
                      value={payoutForm.methodDetails}
                      onChange={(event) => setPayoutForm((current) => ({ ...current, methodDetails: event.target.value }))}
                      placeholder="Account/routing or payout email"
                      required
                    />
                  </label>

                  <button className="primary-btn" type="submit" disabled={payoutSaving}>
                    {payoutSaving ? "Saving..." : "Save Payout Method"}
                  </button>
                </form>
              </>
            )}
          </>
        )}

        {activeSection === "support" && (
          <>
            <h2>Help & Support</h2>
            <p className="empty-state">Need help with a payment, code, or submission review? Contact Offshore League support.</p>
            <div className="support-actions">
              <a href={`mailto:${contactEmail}`}>Email support</a>
              <button type="button" onClick={() => navigator.clipboard?.writeText(contactEmail)}>
                Copy email
              </button>
            </div>
          </>
        )}
      </section>
      )}
    </main>
  );
}
