import { useEffect, useState } from "react";
import MediaPreview from "../components/MediaPreview.jsx";

const reasons = [
  "missing code",
  "unclear measurement",
  "invalid media",
  "wrong species",
  "video has cuts",
  "fish not fully visible",
  "environment not visible"
];

export default function AdminPage({ auth, navigate }) {
  const [metrics, setMetrics] = useState(null);
  const [challengeState, setChallengeState] = useState(null);
  const [challengeForm, setChallengeForm] = useState({
    title: "",
    location: "",
    species: "",
    entryFee: "30",
    autoEnrollDemo: true
  });
  const [submissions, setSubmissions] = useState([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState([]);
  const [managedUsers, setManagedUsers] = useState([]);
  const [flags, setFlags] = useState([]);
  const [reviewLogs, setReviewLogs] = useState([]);
  const [payoutHistory, setPayoutHistory] = useState({ pending: [], paid: [] });
  const [payments, setPayments] = useState([]);
  const [refundingCheckoutId, setRefundingCheckoutId] = useState(0);
  const [cancellingChallenge, setCancellingChallenge] = useState(false);
  const [updatingCloseTime, setUpdatingCloseTime] = useState(false);
  const [managingChallenge, setManagingChallenge] = useState(false);
  const [flaggingParticipantId, setFlaggingParticipantId] = useState(0);
  const [bulkFlagging, setBulkFlagging] = useState(false);
  const [bulkRefunding, setBulkRefunding] = useState(false);
  const [error, setError] = useState("");
  const [selectedReasons, setSelectedReasons] = useState({});
  const [verifiedLengths, setVerifiedLengths] = useState({});
  const [closeTimeInput, setCloseTimeInput] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState({});

  const toLocalInputValue = (isoValue) => {
    if (!isoValue) return "";
    const date = new Date(isoValue);
    if (!Number.isFinite(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const escapeCsv = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/\r?\n|\r/g, " ").trim();
    return `"${text.replace(/"/g, '""')}"`;
  };

  const toCsv = (rows, headers) => {
    const lines = [headers.map((header) => escapeCsv(header.label)).join(",")];
    for (const row of rows) {
      lines.push(headers.map((header) => escapeCsv(row[header.key])).join(","));
    }
    return lines.join("\n");
  };

  const downloadCsv = (filename, rows, headers) => {
    const csv = toCsv(rows, headers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportReviewLogs = () => {
    const rows = reviewLogs.map((log) => ({
      id: log.id,
      submissionId: log.submission_id,
      participantName: log.name,
      challengeCode: log.challenge_code,
      previousStatus: log.previous_status || "",
      newStatus: log.new_status,
      rejectionReason: log.rejection_reason || "",
      verifiedLength: log.verified_length || "",
      reviewedBy: log.reviewed_by || "",
      createdAt: log.created_at || ""
    }));

    downloadCsv(`review-logs-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { key: "id", label: "Log ID" },
      { key: "submissionId", label: "Submission ID" },
      { key: "participantName", label: "Participant Name" },
      { key: "challengeCode", label: "Challenge Code" },
      { key: "previousStatus", label: "Previous Status" },
      { key: "newStatus", label: "New Status" },
      { key: "rejectionReason", label: "Rejection Reason" },
      { key: "verifiedLength", label: "Verified Length (cm)" },
      { key: "reviewedBy", label: "Reviewed By" },
      { key: "createdAt", label: "Created At" }
    ]);
  };

  const exportPayoutHistory = () => {
    const rows = [
      ...payoutHistory.pending.map((row) => ({
        payoutStatus: "pending",
        submissionId: row.submissionId,
        participantName: row.name,
        challengeCode: row.challengeCode,
        amount: row.amount || 0,
        verificationEndsAt: row.verificationEndsAt || "",
        paidAt: ""
      })),
      ...payoutHistory.paid.map((row) => ({
        payoutStatus: "paid",
        submissionId: row.submissionId,
        participantName: row.name,
        challengeCode: row.challengeCode,
        amount: row.amount || 0,
        verificationEndsAt: row.verificationEndsAt || "",
        paidAt: row.paidAt || ""
      }))
    ];

    downloadCsv(`payout-history-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { key: "payoutStatus", label: "Payout Status" },
      { key: "submissionId", label: "Submission ID" },
      { key: "participantName", label: "Participant Name" },
      { key: "challengeCode", label: "Challenge Code" },
      { key: "amount", label: "Amount" },
      { key: "verificationEndsAt", label: "Verification Ends At" },
      { key: "paidAt", label: "Paid At" }
    ]);
  };

  const exportPayments = () => {
    const rows = payments.map((payment) => ({
      id: payment.id,
      email: payment.email,
      challengeCode: payment.challenge_code || "",
      status: payment.status,
      amountPaidCents: payment.amount_paid_cents || 0,
      stripePaymentIntentId: payment.stripe_payment_intent_id || "",
      paidAt: payment.paid_at || "",
      refundedAt: payment.refunded_at || "",
      failureReason: payment.failure_reason || "",
      createdAt: payment.created_at || ""
    }));

    downloadCsv(`payments-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { key: "id", label: "Checkout ID" },
      { key: "email", label: "Email" },
      { key: "challengeCode", label: "Challenge Code" },
      { key: "status", label: "Status" },
      { key: "amountPaidCents", label: "Amount Paid (cents)" },
      { key: "stripePaymentIntentId", label: "Stripe Payment Intent" },
      { key: "paidAt", label: "Paid At" },
      { key: "refundedAt", label: "Refunded At" },
      { key: "failureReason", label: "Failure Reason" },
      { key: "createdAt", label: "Created At" }
    ]);
  };

  if (!auth?.token) {
    return (
      <main className="page">
        <section className="panel empty-panel">
          <strong>Admin access requires login.</strong>
          <span>Log in with your admin account to continue.</span>
          <button className="primary-btn" type="button" onClick={() => navigate("/auth")}>
            Log In
          </button>
        </section>
      </main>
    );
  }

  if (auth?.user?.isAdmin === false) {
    return (
      <main className="page">
        <section className="panel empty-panel">
          <strong>Admin access denied.</strong>
          <span>This account is not authorized to open the admin dashboard.</span>
        </section>
      </main>
    );
  }

  const loadSubmissions = async () => {
    try {
      const response = await fetch("/api/admin/submissions", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load submissions.");
      setSubmissions(data.submissions);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadChallengeState = async () => {
    try {
      const response = await fetch("/api/admin/challenge", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load challenge settings.");
      const challenge = data.challenge || null;
      setChallengeState(challenge);
      setCloseTimeInput(toLocalInputValue(challenge?.closesAt));
      setChallengeForm({
        title: challenge?.title || "",
        location: challenge?.location || "",
        species: challenge?.species || "",
        entryFee: String(challenge?.entryFee || 30),
        autoEnrollDemo: challenge?.autoEnrollDemo !== false
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const loadLeaderboardEntries = async () => {
    try {
      const response = await fetch("/api/admin/leaderboard", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load leaderboard entries.");
      setLeaderboardEntries(data.entries || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadManagedUsers = async () => {
    try {
      const response = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load user management list.");
      setManagedUsers(data.users || []);
      setSelectedParticipantIds((current) => {
        const next = {};
        for (const user of data.users || []) {
          if (current[user.participantId]) {
            next[user.participantId] = true;
          }
        }
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const loadFlags = async () => {
    try {
      const response = await fetch("/api/admin/flags", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load participant flags.");
      setFlags(data.flags || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadMetrics = async () => {
    try {
      const response = await fetch("/api/admin/metrics", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load admin metrics.");
      setMetrics(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadReviewLogs = async () => {
    try {
      const response = await fetch("/api/admin/review-logs", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load review logs.");
      setReviewLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadPayoutHistory = async () => {
    try {
      const response = await fetch("/api/admin/payout-history", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load payout history.");
      setPayoutHistory({
        pending: data.pending || [],
        paid: data.paid || []
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const loadPayments = async () => {
    try {
      const response = await fetch("/api/admin/payments", {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load payments.");
      setPayments(data.payments || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadChallengeState();
    loadMetrics();
    loadSubmissions();
    loadLeaderboardEntries();
    loadManagedUsers();
    loadFlags();
    loadReviewLogs();
    loadPayoutHistory();
    loadPayments();
  }, [auth.token]);

  const manageChallenge = async (action) => {
    setError("");
    setManagingChallenge(true);
    try {
      const response = await fetch("/api/admin/challenge/manage", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          action,
          title: challengeForm.title,
          location: challengeForm.location,
          species: challengeForm.species,
          entryFee: Number(challengeForm.entryFee),
          autoEnrollDemo: Boolean(challengeForm.autoEnrollDemo),
          closesAt: closeTimeInput ? new Date(closeTimeInput).toISOString() : ""
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not manage challenge.");
      const challenge = data.challenge || null;
      setChallengeState(challenge);
      setCloseTimeInput(toLocalInputValue(challenge?.closesAt));
      await loadMetrics();
    } catch (err) {
      setError(err.message);
    } finally {
      setManagingChallenge(false);
    }
  };

  const flagDuplicate = async (participantId) => {
    setError("");
    setFlaggingParticipantId(participantId);
    try {
      const response = await fetch(`/api/admin/participants/${participantId}/flag-duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ notes: "Flagged from admin dashboard" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not flag duplicate.");
      await loadManagedUsers();
      await loadFlags();
    } catch (err) {
      setError(err.message);
    } finally {
      setFlaggingParticipantId(0);
    }
  };

  const selectedUsers = managedUsers.filter((user) => selectedParticipantIds[user.participantId]);
  const selectedParticipantIdList = selectedUsers.map((user) => user.participantId);
  const selectedCheckoutIds = selectedUsers
    .filter((user) => user.checkoutId && user.paymentStatus === "paid")
    .map((user) => user.checkoutId);

  const toggleSelectedUser = (participantId, checked) => {
    setSelectedParticipantIds((current) => ({
      ...current,
      [participantId]: checked
    }));
  };

  const selectAllUsers = () => {
    const all = {};
    for (const user of managedUsers) {
      all[user.participantId] = true;
    }
    setSelectedParticipantIds(all);
  };

  const clearSelectedUsers = () => {
    setSelectedParticipantIds({});
  };

  const bulkFlagDuplicates = async () => {
    if (selectedParticipantIdList.length === 0) {
      setError("Select at least one user entry first.");
      return;
    }

    setError("");
    setBulkFlagging(true);
    try {
      const response = await fetch("/api/admin/participants/flags/bulk-duplicate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          participantIds: selectedParticipantIdList,
          notes: "Flagged in bulk from admin dashboard"
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create duplicate flags.");
      await loadManagedUsers();
      await loadFlags();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkFlagging(false);
    }
  };

  const bulkRefund = async () => {
    if (selectedCheckoutIds.length === 0) {
      setError("Select at least one paid entry with a checkout ID.");
      return;
    }

    setError("");
    setBulkRefunding(true);
    try {
      const response = await fetch("/api/admin/refunds/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ checkoutIds: selectedCheckoutIds })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not run bulk refunds.");
      await loadMetrics();
      await loadManagedUsers();
      await loadPayments();
      await loadPayoutHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkRefunding(false);
    }
  };

  const saveCloseTime = async () => {
    setError("");
    if (!closeTimeInput) {
      setError("Set a close date and time first.");
      return;
    }

    setUpdatingCloseTime(true);
    try {
      const response = await fetch("/api/admin/challenge/close-time", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ closesAt: new Date(closeTimeInput).toISOString() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update challenge close time.");
      const challenge = data.challenge || null;
      setChallengeState(challenge);
      setCloseTimeInput(toLocalInputValue(challenge?.closesAt));
      await loadMetrics();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingCloseTime(false);
    }
  };

  const reviewSubmission = async (id, status) => {
    setError("");
    const rejectionReason = status === "rejected" ? selectedReasons[id] : "";
    const verifiedLength = verifiedLengths[id];

    if (status === "rejected" && !rejectionReason) {
      setError("Choose a rejection reason first.");
      return;
    }

    if (status === "approved" && (!verifiedLength || Number(verifiedLength) <= 0)) {
      setError("Enter the verified length before approving.");
      return;
    }

    try {
      const response = await fetch(`/api/admin/submissions/${id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ status, rejectionReason, verifiedLength })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update submission.");
      await loadSubmissions();
      await loadMetrics();
      await loadReviewLogs();
      await loadPayoutHistory();
      await loadPayments();
    } catch (err) {
      setError(err.message);
    }
  };

  const refundPayment = async (checkoutId) => {
    setError("");
    setRefundingCheckoutId(checkoutId);
    try {
      const response = await fetch(`/api/admin/refunds/${checkoutId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not issue refund.");
      await loadMetrics();
      await loadPayments();
      await loadPayoutHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefundingCheckoutId(0);
    }
  };

  const cancelChallenge = async () => {
    setError("");
    setCancellingChallenge(true);
    try {
      const response = await fetch("/api/admin/challenge/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ reason: "Cancelled by admin" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not cancel challenge.");
      await loadChallengeState();
      await loadMetrics();
      await loadPayments();
      await loadPayoutHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingChallenge(false);
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

  return (
    <main className="page">
      <section className="page-heading split-heading">
        <div>
        <p className="eyebrow">Admin review</p>
        <h1>Submissions</h1>
          <p className="page-intro">Review media quality, visible challenge codes, species, and measurement clarity.</p>
        </div>
        <div className="admin-actions">
          <div className="metric-chip">
            <strong>{submissions.filter((item) => item.status === "pending").length}</strong>
            <span>Pending</span>
          </div>
          <label className="compact-field admin-close-time-field">
            Challenge closes
            <input
              type="datetime-local"
              value={closeTimeInput}
              onChange={(event) => setCloseTimeInput(event.target.value)}
            />
          </label>
          <button
            className="primary-btn"
            type="button"
            onClick={saveCloseTime}
            disabled={updatingCloseTime || !closeTimeInput}
          >
            {updatingCloseTime ? "Saving..." : "Set Close Time"}
          </button>
          <button className="danger-btn" type="button" onClick={cancelChallenge} disabled={cancellingChallenge}>
            {cancellingChallenge ? "Cancelling..." : "Cancel Challenge + Auto Refund"}
          </button>
          {challengeState?.closesAt && (
            <small className="admin-close-meta">
              Current: {formatDate(challengeState.closesAt)}
              {challengeState.status ? ` - ${challengeState.status}` : ""}
            </small>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Challenge Management</h3>
          <span>{challengeState?.status || "unknown"}</span>
        </div>
        <div className="admin-form-grid">
          <label className="compact-field">
            Title
            <input
              value={challengeForm.title}
              onChange={(event) =>
                setChallengeForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <label className="compact-field">
            Location
            <input
              value={challengeForm.location}
              onChange={(event) =>
                setChallengeForm((current) => ({ ...current, location: event.target.value }))
              }
            />
          </label>
          <label className="compact-field">
            Species
            <input
              value={challengeForm.species}
              onChange={(event) =>
                setChallengeForm((current) => ({ ...current, species: event.target.value }))
              }
            />
          </label>
          <label className="compact-field">
            Entry fee (USD)
            <input
              min="1"
              step="1"
              type="number"
              value={challengeForm.entryFee}
              onChange={(event) =>
                setChallengeForm((current) => ({ ...current, entryFee: event.target.value }))
              }
            />
          </label>
          <label className="compact-field">
            Demo auto-enroll
            <select
              value={challengeForm.autoEnrollDemo ? "on" : "off"}
              onChange={(event) =>
                setChallengeForm((current) => ({ ...current, autoEnrollDemo: event.target.value === "on" }))
              }
            >
              <option value="on">On (auto-enroll 3-6 demo users)</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
        <div className="admin-inline-buttons">
          <button className="primary-btn" type="button" onClick={() => manageChallenge("create")} disabled={managingChallenge}>
            {managingChallenge ? "Saving..." : "Create / Reset"}
          </button>
          <button className="primary-btn" type="button" onClick={() => manageChallenge("edit")} disabled={managingChallenge}>
            Save Edits
          </button>
          <button type="button" onClick={() => manageChallenge("pause")} disabled={managingChallenge}>
            Pause
          </button>
          <button type="button" onClick={() => manageChallenge("resume")} disabled={managingChallenge}>
            Resume
          </button>
          <button className="danger-btn" type="button" onClick={() => manageChallenge("close")} disabled={managingChallenge}>
            Close Challenge
          </button>
        </div>
      </section>

      <section className="admin-metrics-grid" aria-label="Admin KPIs">
        <article>
          <strong>{metrics?.entriesCollected ?? 0}</strong>
          <span>Entries Collected</span>
        </article>
        <article>
          <strong>${Number(metrics?.grossCollected || 0).toFixed(2)}</strong>
          <span>Collected</span>
        </article>
        <article>
          <strong>${Number(metrics?.refundedTotal || 0).toFixed(2)}</strong>
          <span>Refunded</span>
        </article>
        <article>
          <strong>${Number(metrics?.netCollected || 0).toFixed(2)}</strong>
          <span>Net</span>
        </article>
        <article>
          <strong>${Number(metrics?.platformCut || 0).toFixed(2)}</strong>
          <span>Platform Cut</span>
        </article>
        <article>
          <strong>${Number(metrics?.prizeOwed || 0).toFixed(2)}</strong>
          <span>Owed in Prizes</span>
        </article>
        <article>
          <strong>{metrics?.pendingSubmissions ?? 0}</strong>
          <span>Pending Reviews</span>
        </article>
        <article>
          <strong>{metrics?.realUsers ?? 0}</strong>
          <span>Real Users</span>
        </article>
        <article>
          <strong>{metrics?.demoUsers ?? 0}</strong>
          <span>Demo Users</span>
        </article>
        <article>
          <strong>{metrics?.submissionRateLimited ?? 0}</strong>
          <span>Submission Blocks</span>
        </article>
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Leaderboard Management</h3>
          <span>{leaderboardEntries.length} verified entries</span>
        </div>
        {leaderboardEntries.length === 0 && <p className="empty-state">No approved verified entries yet.</p>}
        {leaderboardEntries.map((entry) => (
          <article className="profile-list-item" key={entry.submissionId}>
            <div>
              <strong>#{entry.rank} {entry.name}</strong>
              <span>{entry.challengeCode}</span>
            </div>
            <b>{Number(entry.verifiedLength || 0).toFixed(1)} cm</b>
            <small>{entry.species} - auto-ranked from approved verified lengths</small>
          </article>
        ))}
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>User Management</h3>
          <span>{managedUsers.length} entries ({selectedParticipantIdList.length} selected)</span>
        </div>
        <div className="admin-inline-buttons admin-bulk-actions">
          <button type="button" onClick={selectAllUsers} disabled={managedUsers.length === 0}>
            Select All
          </button>
          <button type="button" onClick={clearSelectedUsers} disabled={selectedParticipantIdList.length === 0}>
            Clear Selection
          </button>
          <button type="button" onClick={bulkFlagDuplicates} disabled={bulkFlagging || selectedParticipantIdList.length === 0}>
            {bulkFlagging ? "Flagging..." : "Bulk Flag Duplicate"}
          </button>
          <button type="button" className="primary-btn" onClick={bulkRefund} disabled={bulkRefunding || selectedCheckoutIds.length === 0}>
            {bulkRefunding ? "Refunding..." : "Bulk Refund Paid"}
          </button>
        </div>
        {managedUsers.length === 0 && <p className="empty-state">No users or entries yet.</p>}
        {managedUsers.map((user) => (
          <article className="profile-list-item" key={user.participantId}>
            <label className="select-row-checkbox">
              <input
                type="checkbox"
                checked={Boolean(selectedParticipantIds[user.participantId])}
                onChange={(event) => toggleSelectedUser(user.participantId, event.target.checked)}
              />
              <span>Select</span>
            </label>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            <b>{user.paymentStatus}</b>
            <small>
              Code: {user.challengeCode} - Submission: {user.submissionStatus}
              {user.potentialDuplicate ? " - Potential duplicate" : ""}
              {user.openFlags ? ` - Open flags: ${user.openFlags}` : ""}
            </small>
            <div className="inline-actions">
              <button
                type="button"
                onClick={() => flagDuplicate(user.participantId)}
                disabled={flaggingParticipantId === user.participantId}
              >
                {flaggingParticipantId === user.participantId ? "Flagging..." : "Flag Duplicate"}
              </button>
              {user.checkoutId && user.paymentStatus === "paid" && (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => refundPayment(user.checkoutId)}
                  disabled={refundingCheckoutId === user.checkoutId}
                >
                  {refundingCheckoutId === user.checkoutId ? "Refunding..." : "Issue Refund"}
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Duplicate Flags</h3>
          <span>{flags.length} records</span>
        </div>
        {flags.length === 0 && <p className="empty-state">No duplicate flags yet.</p>}
        {flags.slice(0, 20).map((flag) => (
          <article className="profile-list-item" key={flag.id}>
            <div>
              <strong>{flag.name}</strong>
              <span>{flag.email}</span>
            </div>
            <b>{flag.status}</b>
            <small>{flag.flag_type} - {flag.notes || "No notes"} - by {flag.created_by}</small>
          </article>
        ))}
      </section>

      <section className="submission-list">
        {submissions.length === 0 && (
          <div className="panel empty-panel">
            <strong>No submissions yet.</strong>
            <span>Catch uploads will appear here as soon as participants submit them.</span>
          </div>
        )}
        {submissions.map((submission) => (
          <article className="panel submission-card" key={submission.id}>
            <MediaPreview path={submission.media_url} token={auth.token} />
            <div className="submission-details">
              <div>
                <span className="label">Name</span>
                <strong>{submission.name}</strong>
              </div>
              <div>
                <span className="label">Claimed Weight</span>
                <strong>
                  {submission.claimed_weight
                    ? `${Number(submission.claimed_weight).toFixed(1)} ${submission.claimed_weight_unit}`
                    : "Not provided"}
                </strong>
              </div>
              <div>
                <span className="label">Verified Length</span>
                <strong>
                  {submission.verified_length ? `${Number(submission.verified_length).toFixed(1)} cm` : "Not set"}
                </strong>
              </div>
              <div>
                <span className="label">Status</span>
                <strong className={`status ${submission.status}`}>{submission.status}</strong>
              </div>
              {submission.rejection_reason && (
                <div>
                  <span className="label">Reason</span>
                  <strong>{submission.rejection_reason}</strong>
                </div>
              )}
            </div>
            <div className="review-actions">
              <label className="compact-field">
                Verified length (cm)
                <input
                  min="1"
                  onChange={(event) =>
                    setVerifiedLengths((current) => ({
                      ...current,
                      [submission.id]: event.target.value
                    }))
                  }
                  placeholder="Verified cm"
                  step="0.1"
                  type="number"
                  value={verifiedLengths[submission.id] || submission.verified_length || ""}
                />
              </label>
              <button type="button" onClick={() => reviewSubmission(submission.id, "approved")}>
                Approve
              </button>
              <select
                value={selectedReasons[submission.id] || ""}
                onChange={(event) =>
                  setSelectedReasons((current) => ({
                    ...current,
                    [submission.id]: event.target.value
                  }))
                }
              >
                <option value="">Rejection reason</option>
                {reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => reviewSubmission(submission.id, "rejected")}>
                Reject
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Review Logs</h3>
          <div className="inline-actions">
            <span>{reviewLogs.length} records</span>
            <button type="button" onClick={exportReviewLogs} disabled={reviewLogs.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        {reviewLogs.length === 0 && <p className="empty-state">No review events recorded yet.</p>}
        {reviewLogs.slice(0, 20).map((log) => (
          <article className="profile-list-item" key={log.id}>
            <div>
              <strong>{log.name}</strong>
              <span>{log.challenge_code}</span>
            </div>
            <b>{log.new_status}</b>
            <small>
              {log.previous_status || "none"} -&gt; {log.new_status}
              {log.rejection_reason ? ` - ${log.rejection_reason}` : ""}
              {log.verified_length ? ` - ${Number(log.verified_length).toFixed(1)} cm` : ""}
              {` - by ${log.reviewed_by} on ${formatDate(log.created_at)}`}
            </small>
          </article>
        ))}
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Payout History</h3>
          <div className="inline-actions">
            <span>{payoutHistory.pending.length + payoutHistory.paid.length} winner records</span>
            <button
              type="button"
              onClick={exportPayoutHistory}
              disabled={payoutHistory.pending.length + payoutHistory.paid.length === 0}
            >
              Export CSV
            </button>
          </div>
        </div>

        <h3 className="profile-subheading">Pending Winnings</h3>
        {payoutHistory.pending.length === 0 && <p className="empty-state">No pending winner payouts.</p>}
        {payoutHistory.pending.map((row) => (
          <article className="profile-list-item" key={`pending-${row.submissionId}`}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.challengeCode}</span>
            </div>
            <b>${Number(row.amount || 0).toFixed(2)}</b>
            <small>Awaiting verification window until {formatDate(row.verificationEndsAt)}</small>
          </article>
        ))}

        <h3 className="profile-subheading">Paid Out</h3>
        {payoutHistory.paid.length === 0 && <p className="empty-state">No paid winner payouts yet.</p>}
        {payoutHistory.paid.map((row) => (
          <article className="profile-list-item" key={`paid-${row.submissionId}`}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.challengeCode}</span>
            </div>
            <b>${Number(row.amount || 0).toFixed(2)}</b>
            <small>Paid on {formatDate(row.paidAt)}</small>
          </article>
        ))}
      </section>

      <section className="panel admin-secondary">
        <div className="mini-heading">
          <h3>Payments</h3>
          <div className="inline-actions">
            <span>{payments.length} records</span>
            <button type="button" onClick={exportPayments} disabled={payments.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        {payments.length === 0 && <p className="empty-state">No payment records yet.</p>}
        {payments.map((payment) => (
          <article className="profile-list-item" key={payment.id}>
            <div>
              <strong>{payment.email}</strong>
              <span>{payment.challenge_code || "No code"}</span>
            </div>
            <b>{payment.status}</b>
            <small>
              Paid: {formatDate(payment.paid_at || payment.created_at)}
              {payment.refunded_at ? ` - Refunded: ${formatDate(payment.refunded_at)}` : ""}
              {payment.failure_reason ? ` - ${payment.failure_reason}` : ""}
            </small>
            {payment.status === "paid" && (
              <button
                type="button"
                className="primary-btn"
                onClick={() => refundPayment(payment.id)}
                disabled={refundingCheckoutId === payment.id}
              >
                {refundingCheckoutId === payment.id ? "Refunding..." : "Issue Refund"}
              </button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
