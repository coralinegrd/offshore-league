import { useMemo, useState } from "react";
import { challengeConfig } from "../challengeConfig.js";

export default function SubmissionPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [receipt, setReceipt] = useState(null);
  const initialCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("code") || "";
  }, []);
  const initialPaymentId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("payment_id") || params.get("session_id") || "";
  }, []);
  const initialChallengeId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("challenge_id") || "";
  }, []);
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    paymentId: initialPaymentId,
    challengeId: initialChallengeId,
    challengeCode: initialCode,
    species: "",
    claimedWeight: "",
    claimedWeightUnit: "lb",
    mediaSelected: false
  });
  const [attestations, setAttestations] = useState({
    codeVisible: false,
    measurementClear: false,
    correctSpecies: false,
    continuousVideo: false,
    fullFishInFrame: false,
    environmentVisible: false
  });
  const allAttestationsChecked = Object.values(attestations).every(Boolean);
  const allFieldsFilled =
    formState.name.trim() &&
    formState.email.trim() &&
    formState.paymentId.trim() &&
    formState.challengeCode.trim() &&
    formState.species.trim() &&
    Number(formState.claimedWeight) > 0 &&
    ["lb", "kg"].includes(formState.claimedWeightUnit) &&
    formState.mediaSelected;
  const canSubmit = Boolean(allFieldsFilled && allAttestationsChecked && !loading);

  const updateField = (event) => {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  };

  const submitCatch = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setReceipt(null);
    setLoading(true);
    setUploadProgress(0);

    try {
      const formElement = event.currentTarget;
      const payload = new FormData(formElement);
      const data = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", "/api/submissions");
        request.timeout = 20 * 60 * 1000;

        request.upload.onprogress = (progressEvent) => {
          if (!progressEvent.lengthComputable) return;
          const percent = Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100));
          setUploadProgress(percent);
        };

        request.onerror = () => {
          reject(new Error("Upload failed due to network issues. Please retry with stronger signal."));
        };

        request.ontimeout = () => {
          reject(new Error("Upload timed out on a weak connection. Retry when signal is stable."));
        };

        request.onload = () => {
          let parsed = {};
          try {
            parsed = JSON.parse(request.responseText || "{}");
          } catch {
            parsed = {};
          }

          if (request.status < 200 || request.status >= 300) {
            reject(new Error(parsed.error || "Could not save submission."));
            return;
          }

          resolve(parsed);
        };

        request.send(payload);
      });

      formElement.reset();
      setFormState({
        name: "",
        email: "",
        paymentId: "",
        challengeId: initialChallengeId,
        challengeCode: "",
        species: "",
        claimedWeight: "",
        claimedWeightUnit: "lb",
        mediaSelected: false
      });
      setAttestations({
        codeVisible: false,
        measurementClear: false,
        correctSpecies: false,
        continuousVideo: false,
        fullFishInFrame: false,
        environmentVisible: false
      });
      setUploadProgress(100);
      setReceipt({
        receiptCode: data.receiptCode,
        receivedAt: data.receivedAt,
        status: data.status,
        fileSizeBytes: data.metadata?.fileSizeBytes,
        deviceType: data.metadata?.uploaderDeviceType,
        storageLocation: data.storage?.location,
        retainedUntil: data.storage?.retainedUntil,
        retentionDays: data.storage?.retentionDays
      });
      setMessage("Submission received and recorded on the server.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page narrow-page">
      <form className="panel form-panel flow-card" onSubmit={submitCatch}>
        <p className="eyebrow">Catch verification</p>
        <h1>Submit Catch</h1>
        <p className="page-intro">
          Upload one continuous measurement video. Your challenge code, full fish, measuring device,
          and water or boat environment must be visible.
        </p>
        <div className="form-grid">
          <label>
            Name
            <input name="name" value={formState.name} onChange={updateField} placeholder="Your name" autoComplete="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" value={formState.email} onChange={updateField} placeholder="you@example.com" autoComplete="email" required />
          </label>
          <label>
            Payment ID
            <input
              name="paymentId"
              value={formState.paymentId}
              onChange={updateField}
              placeholder="cs_test_..."
              required
            />
          </label>
          <input name="challengeId" value={formState.challengeId} type="hidden" readOnly />
          <label>
            Challenge Code
            <input name="challengeCode" value={formState.challengeCode} onChange={updateField} placeholder="CITY-AB12CD34" required />
          </label>
          <label>
            Species
            <input name="species" value={formState.species} onChange={updateField} placeholder={challengeConfig.species} required />
          </label>
          <label>
            Claimed weight
            <div className="unit-input">
              <input name="claimedWeight" value={formState.claimedWeight} onChange={updateField} min="0.1" step="0.1" type="number" inputMode="decimal" placeholder="18.5" required />
              <select name="claimedWeightUnit" value={formState.claimedWeightUnit} onChange={updateField} aria-label="Weight unit">
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </div>
          </label>
          <label className="file-field">
            Video only
            <input
              accept="video/*"
              name="media"
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  mediaSelected: Boolean(event.target.files?.length)
                }))
              }
              type="file"
              required
            />
          </label>
        </div>
        <p className="form-note">
          Claimed weight helps reviewers. Only admin-verified length is used on the leaderboard.
        </p>
        <p className="form-note">
          Uploads support large video files. If signal drops on the water, the upload may fail safely and can be retried without creating duplicate submissions.
        </p>
        {loading && (
          <div className="upload-progress" role="status" aria-live="polite">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            <span>Upload progress: {uploadProgress}%</span>
          </div>
        )}
        <div className="submission-checklist">
          {[
            ["codeVisible", "Code visible"],
            ["measurementClear", "Measurement clear"],
            ["correctSpecies", "Correct species"],
            ["continuousVideo", "Continuous video, no cuts"],
            ["fullFishInFrame", "Full fish in frame"],
            ["environmentVisible", "Environment visible, water or boat"]
          ].map(([name, label]) => (
            <label className="checkbox-row" key={name}>
              <input
                checked={attestations[name]}
                name={name}
                onChange={(event) =>
                  setAttestations((current) => ({ ...current, [name]: event.target.checked }))
                }
                type="checkbox"
                required
              />
              {label}
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        {receipt && (
          <section className="submission-receipt" aria-label="Submission receipt">
            <h3>Server Receipt</h3>
            <p>Receipt code: {receipt.receiptCode}</p>
            <p>Received: {new Date(receipt.receivedAt).toLocaleString()}</p>
            <p>Status: {receipt.status}</p>
            <p>
              Metadata: {Number(receipt.fileSizeBytes || 0).toLocaleString()} bytes, {receipt.deviceType || "unknown"} device
            </p>
            <p>
              Storage: {receipt.storageLocation} - retained for {receipt.retentionDays} days (until {new Date(receipt.retainedUntil).toLocaleString()})
            </p>
          </section>
        )}
        <button className="primary-btn" disabled={!canSubmit} type="submit">
          {loading ? "Uploading..." : canSubmit ? "Submit Catch" : "Complete all required fields"}
        </button>
      </form>
    </main>
  );
}
