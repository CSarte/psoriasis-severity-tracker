import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { storage, db, auth } from "../firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";
import DinoGame from "../components/DinoGame";

// ── Step identifiers ──────────────────────────────────────────────────────────
const STEP = {
  IDLE: "idle",
  UPLOADING: "uploading",
  SELECT_SEG: "select_seg",
  SEGMENTING: "segmenting",
  SELECT_CLASS: "select_class",
  CLASSIFYING: "classifying",
  REVIEW: "review",
  DONE: "done",
};

// ── Loading message banks ─────────────────────────────────────────────────────
const SEG_MESSAGES = [
  "Preprocessing image for the segmentation model...",
  "Resizing and normalizing input...",
  "Running the encoder pass...",
  "Running the decoder pass...",
  "Applying sigmoid activation to logits...",
  "Thresholding the probability map...",
  "Calculating affected Body Surface Area (BSA)...",
  "Generating segmentation overlay...",
  "Almost done — uploading mask...",
];

const CLASS_MESSAGES = [
  "Loading AlexNet severity classifier...",
  "Extracting features from segmented region...",
  "Scoring erythema (redness intensity)...",
  "Scoring induration (plaque thickness)...",
  "Scoring desquamation (scaling)...",
  "Scoring plaque extent and coverage...",
  "Averaging PGA component scores...",
  "Computing confidence interval...",
  "Preparing your assessment report...",
];

// ── Model options ─────────────────────────────────────────────────────────────
const SEG_MODELS = [
  { id: "unetpp",    label: "UNet++",    sub: "ResNet-34 encoder",          active: true },
  { id: "medsam",    label: "MedSAM",    sub: "SAM ViT-B (medical)",        active: true },
  { id: "panderm",   label: "PanDerm",   sub: "CAE ViT-B (dermatology)",    active: true },
  { id: "batformer", label: "BATFormer", sub: "ResNet-34 + boundary attn",  active: true },
];

const CLASS_MODELS = [
  { id: "alexnet_reg",         label: "AlexNet",         sub: "Regression on 3 PGA components", active: true },
  { id: "efficientnet_b0_reg", label: "EfficientNet-B0", sub: "Regression on 3 PGA components", active: true },
  { id: "resnet50_reg",        label: "ResNet-50",       sub: "Regression on 3 PGA components", active: true },
];

// ── Body area presets ─────────────────────────────────────────────────────────
const BODY_AREAS = [
  "Scalp",
  "Face",
  "Neck",
  "Chest",
  "Upper Back",
  "Lower Back",
  "Abdomen",
  "Left Elbow",
  "Right Elbow",
  "Left Arm",
  "Right Arm",
  "Left Hand",
  "Right Hand",
  "Left Knee",
  "Right Knee",
  "Left Leg",
  "Right Leg",
  "Left Foot",
  "Right Foot",
];

// ── Severity helpers ──────────────────────────────────────────────────────────
// 5-tier scale on 0-100: Clear / Mild / Moderate / Severe / Very Severe
function severityLabel(score) {
  if (score < 5)  return { label: "Clear",       color: "#86efac" };
  if (score < 20) return { label: "Mild",        color: "#22c55e" };
  if (score < 50) return { label: "Moderate",    color: "#eab308" };
  if (score < 75) return { label: "Severe",      color: "#f97316" };
  return                 { label: "Very Severe", color: "#ef4444" };
}

function computeAssessment(bsa, pgaScores, savedHistory, bodyLabel, serverConfidence) {
  // pgaScores = [redness, thickness, scaling] each on 0-4 scale
  const [redness, thickness, scaling] = pgaScores;
  const pga = (redness + thickness + scaling) / 3;
  // Normalize: BSA(0-100) × PGA(0-4) / 4 → 0-100
  const severity = Math.round((bsa * pga) / 4 * 10) / 10;
  const { label, color } = severityLabel(severity);

  // Server provides TTA-based confidence; fall back to 100 if missing.
  const confidence = serverConfidence ?? 100;

  // Filter history to the SAME body area for trend comparison
  const sameAreaHistory = bodyLabel
    ? savedHistory.filter((p) => p.bodyLabel === bodyLabel)
    : savedHistory;
  const lastPhoto = sameAreaHistory.length > 0 ? sameAreaHistory[0] : null;

  const areaName = bodyLabel || "this area";

  // ── Deltas vs. last report for same body area ─────────────────────
  let trend = "first";
  let severityDelta = null, bsaDelta = null, pgaDelta = null;
  if (lastPhoto?.severity != null) {
    severityDelta = Math.round((severity - lastPhoto.severity) * 10) / 10;
    trend = severityDelta <= -5 ? "improved" : severityDelta >= 5 ? "worsened" : "stable";
  }
  if (lastPhoto?.bsa != null) {
    bsaDelta = Math.round((bsa - lastPhoto.bsa) * 10) / 10;
  }
  if (lastPhoto?.pga != null) {
    pgaDelta = Math.round((pga - lastPhoto.pga) * 100) / 100;
  }

  // ── Clinical tier labels for each metric ──────────────────────────
  const bsaCoverage =
    bsa < 3 ? "Minimal" : bsa < 10 ? "Limited" : bsa < 30 ? "Moderate" : "Extensive";
  const pgaClinical =
    pga < 0.5 ? "Clear"
      : pga < 1.5 ? "Almost Clear"
      : pga < 2.5 ? "Mild"
      : pga < 3.5 ? "Moderate"
      : "Severe";

  // ── Short headline dialog (shown at top of Review card) ───────────
  let dialog = "";
  if (trend === "first") {
    dialog = `First assessment for ${areaName}. Severity: ${severity}/100 (${label}).`;
  } else if (trend === "improved") {
    dialog = `${areaName}: Improved by ${Math.abs(severityDelta)} pts since last report (${lastPhoto.severity} → ${severity}).`;
  } else if (trend === "worsened") {
    dialog = `${areaName}: Worsened by ${severityDelta} pts since last report (${lastPhoto.severity} → ${severity}).`;
  } else {
    dialog = `${areaName}: Stable compared to last report (${lastPhoto.severity} → ${severity}).`;
  }

  const recommendation =
    severity < 5
      ? "Your skin appears clear in this photo. Keep up your current routine and continue tracking any changes."
      : severity < 20
      ? "Mild symptoms. Continue your current treatment plan and monitor for changes."
      : severity < 50
      ? "Moderate symptoms. Consider discussing treatment adjustments with your dermatologist at your next visit."
      : severity < 75
      ? "Severe symptoms. Contact your dermatologist promptly to review your treatment plan."
      : "Very severe symptoms. Seek prompt dermatology care to evaluate and adjust your treatment.";
  const reportLine = `Report to doctor: ${recommendation}`;

  // ── Change-line builders ──────────────────────────────────────────
  const bsaChangeLine =
    bsaDelta === null
      ? `Change: First report for ${areaName} — no BSA comparison yet.`
      : bsaDelta > 0.5
      ? `Change: ↑ Increased by ${Math.abs(bsaDelta).toFixed(1)}% since last report (${lastPhoto.bsa.toFixed(1)}% → ${bsa.toFixed(1)}%). More skin is affected.`
      : bsaDelta < -0.5
      ? `Change: ↓ Decreased by ${Math.abs(bsaDelta).toFixed(1)}% since last report (${lastPhoto.bsa.toFixed(1)}% → ${bsa.toFixed(1)}%). Less skin is affected.`
      : `Change: → About the same as last report (${lastPhoto.bsa.toFixed(1)}% → ${bsa.toFixed(1)}%).`;

  const pgaChangeLine =
    pgaDelta === null
      ? `Change: First report for ${areaName} — no PGA comparison yet.`
      : pgaDelta > 0.15
      ? `Change: ↑ Increased by ${Math.abs(pgaDelta).toFixed(2)} since last report (${lastPhoto.pga.toFixed(2)} → ${pga.toFixed(2)}). The lesion looks worse overall.`
      : pgaDelta < -0.15
      ? `Change: ↓ Decreased by ${Math.abs(pgaDelta).toFixed(2)} since last report (${lastPhoto.pga.toFixed(2)} → ${pga.toFixed(2)}). The lesion looks better overall.`
      : `Change: → About the same as last report (${lastPhoto.pga.toFixed(2)} → ${pga.toFixed(2)}).`;

  const severityChangeLine =
    severityDelta === null
      ? `Change: First report for ${areaName}.`
      : trend === "improved"
      ? `Change: ↓ Improved by ${Math.abs(severityDelta)} pts since last report (${lastPhoto.severity} → ${severity}).`
      : trend === "worsened"
      ? `Change: ↑ Worsened by ${Math.abs(severityDelta)} pts since last report (${lastPhoto.severity} → ${severity}).`
      : `Change: → Stable since last report (${lastPhoto.severity} → ${severity}).`;

  // ── Per-component deltas (redness / thickness / scaling) ──────────
  const lastScores = lastPhoto?.pgaScores;
  const hasLastComponents = Array.isArray(lastScores) && lastScores.length === 3;
  const componentMeta = [
    { name: "Redness",   value: redness,   last: hasLastComponents ? lastScores[0] : null },
    { name: "Thickness", value: thickness, last: hasLastComponents ? lastScores[1] : null },
    { name: "Scaling",   value: scaling,   last: hasLastComponents ? lastScores[2] : null },
  ];
  const pgaDelta3 = componentMeta.map((c) => ({
    ...c,
    delta: c.last != null ? Math.round((c.value - c.last) * 100) / 100 : null,
  }));

  const componentLines = pgaDelta3.map((c) => {
    if (c.delta === null) return `• ${c.name}: ${c.value.toFixed(2)}/4 (first reading)`;
    if (c.delta > 0.15) return `• ${c.name}: ${c.value.toFixed(2)}/4 — ↑ up ${Math.abs(c.delta).toFixed(2)} (was ${c.last.toFixed(2)})`;
    if (c.delta < -0.15) return `• ${c.name}: ${c.value.toFixed(2)}/4 — ↓ down ${Math.abs(c.delta).toFixed(2)} (was ${c.last.toFixed(2)})`;
    return `• ${c.name}: ${c.value.toFixed(2)}/4 — → stable (was ${c.last.toFixed(2)})`;
  });

  // ── Build detailed doctor summary ─────────────────────────────────
  const doctorSummary = [
    `${areaName} — Overall Severity: ${severity}/100 (${label})`,
    ``,
    `📐 Body Surface Area (BSA): ${bsa.toFixed(1)}% — ${bsaCoverage} coverage`,
    `What it means: BSA is the percentage of skin in the photo that shows psoriasis lesions. Higher BSA means more skin is affected.`,
    bsaChangeLine,
    ``,
    `🔴 Physician Global Assessment (PGA): ${pga.toFixed(2)}/4 — ${pgaClinical}`,
    `What it means: PGA is a 0–4 score that captures how the lesion looks overall. The model predicts three individual qualities on the same 0–4 scale, and averages them:`,
    ...componentLines,
    `Average of the three = PGA (${pga.toFixed(2)}/4). If any one goes up, PGA goes up.`,
    `Model confidence: ${confidence}% (from agreement across augmented views).`,
    pgaChangeLine,
    ``,
    `⚖️ Combined Severity: ${severity}/100 — ${label}`,
    `Formula: (BSA × PGA) ÷ 4 = (${bsa.toFixed(1)} × ${pga.toFixed(2)}) ÷ 4 = ${severity}`,
    `Why both: A small area with intense lesions and a large area with mild lesions can score similarly. BSA captures "how much", PGA captures "how bad" — multiplying them gives a single number that reflects both.`,
    severityChangeLine,
    ``,
    `📋 ${reportLine}`,
  ].join("\n");

  return {
    pga: Math.round(pga * 100) / 100,
    severity,
    confidence,
    trend,
    trendDelta: severityDelta,
    bsaDelta,
    pgaDelta,
    label,
    color,
    dialog,
    reportLine,
    doctorSummary,
  };
}

// ── Step progress indicator ───────────────────────────────────────────────────
function StepBar({ step }) {
  const labels = ["Upload", "Segment", "Classify", "Review"];
  const idx =
    step === STEP.IDLE || step === STEP.UPLOADING ? 0
    : step === STEP.SELECT_SEG || step === STEP.SEGMENTING ? 1
    : step === STEP.SELECT_CLASS || step === STEP.CLASSIFYING ? 2
    : 3;

  return (
    <div className="flex items-center gap-0 mb-8 w-full max-w-lg">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                i < idx
                  ? "bg-green-500 border-green-500 text-white"
                  : i === idx
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-300 text-gray-400"
              }`}
            >
              {i < idx ? "✓" : i + 1}
            </div>
            <span className={`text-xs mt-1 ${i === idx ? "text-blue-600 font-semibold" : "text-gray-400"}`}>
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div className={`flex-1 h-0.5 mb-5 mx-1 ${i < idx ? "bg-green-400" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Model radio buttons ───────────────────────────────────────────────────────
function ModelPicker({ models, selected, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          disabled={!m.active}
          onClick={() => m.active && onChange(m.id)}
          className={`relative p-3 rounded-lg border-2 text-left transition-all ${
            !m.active
              ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
              : selected === m.id
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 bg-white hover:border-blue-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                selected === m.id && m.active
                  ? "border-blue-500 bg-blue-500"
                  : "border-gray-300"
              }`}
            />
            <span className="font-semibold text-sm">{m.label}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-6">{m.sub}</p>
          {!m.active && (
            <span className="absolute top-2 right-2 text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">
              Coming Soon
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Loading section with dino game ────────────────────────────────────────────
function LoadingSection({ messages, msgIdx }) {
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg">
      <div className="bg-white rounded-xl shadow p-6 w-full text-center">
        <div className="flex justify-center mb-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-blue-700 font-semibold text-base">{messages[msgIdx]}</p>
        <p className="text-gray-400 text-sm mt-1">This may take 15–30 seconds...</p>
      </div>
      <DinoGame active={true} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Upload() {
  const navigate = useNavigate();

  const [step, setStep] = useState(STEP.IDLE);
  const [file, setFile] = useState(null);
  const [localPreview, setLocalPreview] = useState(null);
  const [bodyLabel, setBodyLabel] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  // Set after upload
  const [photoData, setPhotoData] = useState(null); // { photoId, downloadURL, storagePath }

  // Segmentation
  const [segModel, setSegModel] = useState("unetpp");
  const [segResult, setSegResult] = useState(null); // { maskUrl, bsa }

  // Classification
  const [classModel, setClassModel] = useState("alexnet_reg");
  const [classResult, setClassResult] = useState(null); // { pgaScores, pga }

  // Computed assessment (only in REVIEW)
  const [assessment, setAssessment] = useState(null);

  // UI
  const [showMask, setShowMask] = useState(false);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [currentMsgs, setCurrentMsgs] = useState([]);

  // History for trend comparison (saved photos only)
  const [savedHistory, setSavedHistory] = useState([]);

  // Snapshot listener refs
  const segSnapRef = useRef(null);
  const classSnapRef = useRef(null);
  const msgTimerRef = useRef(null);

  // ── Fetch saved history on mount ─────────────────────────────────────────
  useEffect(() => {
    const fetchHistory = async () => {
      if (!auth.currentUser?.uid) return;
      const uid = auth.currentUser.uid;
      try {
        const snap = await getDocs(
          query(collection(db, "users", uid, "photos"), orderBy("createdAt", "desc"))
        );
        const saved = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.saved === true && p.severity != null);
        setSavedHistory(saved);
      } catch {
        // non-fatal
      }
    };
    fetchHistory();
  }, []);

  // ── Cycle loading messages ────────────────────────────────────────────────
  useEffect(() => {
    if (step === STEP.SEGMENTING) {
      setCurrentMsgs(SEG_MESSAGES);
      setMsgIdx(0);
      msgTimerRef.current = setInterval(
        () => setMsgIdx((p) => (p + 1) % SEG_MESSAGES.length),
        2200
      );
    } else if (step === STEP.CLASSIFYING) {
      setCurrentMsgs(CLASS_MESSAGES);
      setMsgIdx(0);
      msgTimerRef.current = setInterval(
        () => setMsgIdx((p) => (p + 1) % CLASS_MESSAGES.length),
        2200
      );
    } else {
      clearInterval(msgTimerRef.current);
    }
    return () => clearInterval(msgTimerRef.current);
  }, [step]);

  // ── Compute assessment when entering REVIEW ───────────────────────────────
  useEffect(() => {
    if (step !== STEP.REVIEW || !segResult || !classResult) return;
    const resolvedLabel = bodyLabel === "__custom__" ? customLabel.trim() : bodyLabel;
    setAssessment(
      computeAssessment(
        segResult.bsa,
        classResult.pgaScores,
        savedHistory,
        resolvedLabel,
        classResult.confidence,
      )
    );
  }, [step, segResult, classResult, savedHistory, bodyLabel, customLabel]);

  // ── Cleanup listeners on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (segSnapRef.current) segSnapRef.current();
      if (classSnapRef.current) classSnapRef.current();
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setLocalPreview(URL.createObjectURL(f));
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) { setError("Please select an image first."); return; }
    if (!auth.currentUser?.uid) { setError("You must be logged in."); return; }

    const resolvedLabel = bodyLabel === "__custom__" ? customLabel.trim() : bodyLabel;
    if (!resolvedLabel) { setError("Please select a body area label."); return; }

    setStep(STEP.UPLOADING);
    setError(null);

    try {
      const uid = auth.currentUser.uid;
      const safeName = file.name.replace(/\//g, "_");
      const storagePath = `users/${uid}/photos/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      // Create a draft doc (saved: false — won't appear on dashboard until saved)
      const photosRef = collection(db, "users", uid, "photos");
      const docRef = await addDoc(photosRef, {
        url: downloadURL,
        storagePath,
        bodyLabel: resolvedLabel,
        saved: false,
        createdAt: serverTimestamp(),
      });

      setPhotoData({ photoId: docRef.id, downloadURL, storagePath });
      setStep(STEP.SELECT_SEG);
    } catch (e) {
      setError(e.message || "Upload failed.");
      setStep(STEP.IDLE);
    }
  };

  const startSegmentation = async () => {
    if (!photoData) return;
    setError(null);
    setSegResult(null);
    setClassResult(null);
    setAssessment(null);
    setShowMask(false);

    const { photoId } = photoData;
    const uid = auth.currentUser.uid;
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    if (!backendUrl) { setError("Missing VITE_BACKEND_URL."); return; }

    // Set up Firestore listener first
    if (segSnapRef.current) segSnapRef.current();
    segSnapRef.current = onSnapshot(
      doc(db, "users", uid, "photos", photoId),
      (snap) => {
        if (!snap.exists()) return;
        const seg = snap.data().segmentation;
        if (!seg) return;

        if (seg.status === "done") {
          if (segSnapRef.current) { segSnapRef.current(); segSnapRef.current = null; }
          setSegResult({ maskUrl: seg.maskUrl, bsa: seg.bsa ?? 0 });
          setStep(STEP.SELECT_CLASS);
        } else if (seg.status === "error") {
          if (segSnapRef.current) { segSnapRef.current(); segSnapRef.current = null; }
          setError(`Segmentation failed: ${seg.error}`);
          setStep(STEP.SELECT_SEG);
        }
      }
    );

    setStep(STEP.SEGMENTING);

    try {
      const resp = await fetch(`${backendUrl}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, photoId, segmentationModel: segModel }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Segmentation request failed.");
      }
    } catch (e) {
      if (segSnapRef.current) { segSnapRef.current(); segSnapRef.current = null; }
      setError(e.message);
      setStep(STEP.SELECT_SEG);
    }
  };

  const startClassification = async () => {
    if (!photoData) return;
    setError(null);
    setClassResult(null);
    setAssessment(null);

    const { photoId } = photoData;
    const uid = auth.currentUser.uid;
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    if (!backendUrl) { setError("Missing VITE_BACKEND_URL."); return; }

    // Set up Firestore listener first
    if (classSnapRef.current) classSnapRef.current();
    classSnapRef.current = onSnapshot(
      doc(db, "users", uid, "photos", photoId),
      (snap) => {
        if (!snap.exists()) return;
        const cls = snap.data().classification;
        if (!cls) return;

        if (cls.status === "done") {
          if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
          setClassResult({
            pgaScores: cls.pgaScores,      // [redness, thickness, scaling]
            pga: cls.pga,
            confidence: cls.confidence ?? null,
          });
          setStep(STEP.REVIEW);
        } else if (cls.status === "error") {
          if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
          setError(`Classification failed: ${cls.error}`);
          setStep(STEP.SELECT_CLASS);
        }
      }
    );

    setStep(STEP.CLASSIFYING);

    try {
      const resp = await fetch(`${backendUrl}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, photoId, classificationModel: classModel }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Classification request failed.");
      }
    } catch (e) {
      if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
      setError(e.message);
      setStep(STEP.SELECT_CLASS);
    }
  };

  // ── Back navigation ───────────────────────────────────────────────────────

  const goBackToSelectSeg = () => {
    if (segSnapRef.current) { segSnapRef.current(); segSnapRef.current = null; }
    if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
    setSegResult(null);
    setClassResult(null);
    setAssessment(null);
    setShowMask(false);
    setError(null);
    setStep(STEP.SELECT_SEG);
  };

  const goBackToSelectClass = () => {
    if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
    setClassResult(null);
    setAssessment(null);
    setError(null);
    setStep(STEP.SELECT_CLASS);
  };

  // ── Save / Discard ────────────────────────────────────────────────────────

  const saveReport = async () => {
    if (!photoData || !assessment || !segResult || !classResult) return;
    const { photoId } = photoData;
    const uid = auth.currentUser.uid;

    try {
      const resolvedLabel = bodyLabel === "__custom__" ? customLabel.trim() : bodyLabel;
      await setDoc(
        doc(db, "users", uid, "photos", photoId),
        {
          saved: true,
          bodyLabel: resolvedLabel,
          segmentationModel: segModel,
          classificationModel: classModel,
          bsa: segResult.bsa,
          pgaScores: classResult.pgaScores,
          pga: classResult.pga,
          severity: assessment.severity,
          severityLabel: assessment.label,
          confidenceScore: assessment.confidence,
          doctorSummary: assessment.doctorSummary,
          trend: assessment.trend,
          trendDelta: assessment.trendDelta,
          bsaDelta: assessment.bsaDelta,
          pgaDelta: assessment.pgaDelta,
          summary: assessment.doctorSummary,
        },
        { merge: true }
      );
      setStep(STEP.DONE);
    } catch (e) {
      setError("Failed to save report: " + e.message);
    }
  };

  const discardReport = async () => {
    if (!photoData) { resetAll(); return; }
    const { photoId, storagePath } = photoData;
    const uid = auth.currentUser.uid;

    try {
      await deleteObject(ref(storage, storagePath)).catch(() => {});
      const maskPath = `users/${uid}/photos/${photoId}/mask.png`;
      await deleteObject(ref(storage, maskPath)).catch(() => {});
      await deleteDoc(doc(db, "users", uid, "photos", photoId));
    } catch {
      // non-fatal
    }
    resetAll();
  };

  const resetAll = () => {
    if (segSnapRef.current) { segSnapRef.current(); segSnapRef.current = null; }
    if (classSnapRef.current) { classSnapRef.current(); classSnapRef.current = null; }
    setStep(STEP.IDLE);
    setFile(null);
    setLocalPreview(null);
    setPhotoData(null);
    setBodyLabel("");
    setCustomLabel("");
    setSegModel("unetpp");
    setSegResult(null);
    setClassModel("alexnet_reg");
    setClassResult(null);
    setAssessment(null);
    setShowMask(false);
    setError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const previewSrc = photoData?.downloadURL || localPreview;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 flex flex-col items-center">
      <h2 className="text-3xl font-bold text-primary mb-2">Upload & Analyze</h2>
      <p className="text-gray-500 mb-6 text-sm">Follow each step to generate your severity assessment.</p>

      <StepBar step={step} />

      {error && (
        <div className="mb-4 w-full max-w-lg bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {/* ── STEP: IDLE ─────────────────────────────────────────────────── */}
      {step === STEP.IDLE && (
        <div className="bg-white rounded-xl shadow p-6 w-full max-w-lg flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Step 1 — Upload a photo</h3>
          <p className="text-sm text-gray-500">Select a clear photo of the affected skin area.</p>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="border p-2 rounded w-full text-sm"
          />
          {localPreview && (
            <img src={localPreview} alt="Preview" className="w-full h-56 object-cover rounded-lg border" />
          )}

          {/* Body area label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body Area Label</label>
            <p className="text-xs text-gray-400 mb-2">
              Tag where this photo was taken so severity trends are tracked per area.
            </p>
            <select
              value={bodyLabel}
              onChange={(e) => setBodyLabel(e.target.value)}
              className="border p-2 rounded w-full text-sm"
            >
              <option value="">— Select body area —</option>
              {BODY_AREAS.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
              <option value="__custom__">Other (custom)</option>
            </select>
            {bodyLabel === "__custom__" && (
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Enter custom body area label"
                className="border p-2 rounded w-full text-sm mt-2"
              />
            )}
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || (!bodyLabel || (bodyLabel === "__custom__" && !customLabel.trim()))}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-40"
          >
            Upload Photo
          </button>
        </div>
      )}

      {/* ── STEP: UPLOADING ───────────────────────────────────────────── */}
      {step === STEP.UPLOADING && (
        <div className="bg-white rounded-xl shadow p-6 w-full max-w-lg text-center flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-blue-700 font-semibold">Uploading photo to secure storage...</p>
          <p className="text-gray-400 text-sm">Just a moment</p>
        </div>
      )}

      {/* ── STEP: SELECT_SEG ─────────────────────────────────────────── */}
      {step === STEP.SELECT_SEG && (
        <div className="flex flex-col gap-5 w-full max-w-lg">
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Uploaded photo</p>
            <img src={previewSrc} alt="Uploaded" className="w-full h-56 object-cover rounded-lg" />
          </div>
          <div className="bg-white rounded-xl shadow p-5 flex flex-col gap-4">
            <h3 className="text-lg font-semibold">Step 2 — Choose segmentation model</h3>
            <p className="text-sm text-gray-500">
              The model will identify psoriasis lesion regions and calculate your BSA.
            </p>
            <ModelPicker models={SEG_MODELS} selected={segModel} onChange={setSegModel} />
            <button
              onClick={startSegmentation}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition w-full mt-1"
            >
              Run Segmentation
            </button>
            <button onClick={discardReport} className="text-sm text-gray-400 hover:text-red-500 transition text-center">
              ✕ Discard and start over
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: SEGMENTING ─────────────────────────────────────────── */}
      {step === STEP.SEGMENTING && (
        <div className="flex flex-col items-center gap-5 w-full max-w-lg">
          <div className="bg-white rounded-xl shadow p-4 w-full">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Running: {SEG_MODELS.find(m => m.id === segModel)?.label}</p>
            <img src={previewSrc} alt="Uploaded" className="w-full h-40 object-cover rounded-lg opacity-75" />
          </div>
          <LoadingSection messages={SEG_MESSAGES} msgIdx={msgIdx} />
        </div>
      )}

      {/* ── STEP: SELECT_CLASS ───────────────────────────────────────── */}
      {step === STEP.SELECT_CLASS && segResult && (
        <div className="flex flex-col gap-5 w-full max-w-lg">
          {/* Segmentation result card */}
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Segmentation result</p>
            <div className="relative w-full h-56">
              <img src={previewSrc} alt="Uploaded" className="w-full h-56 object-cover rounded-lg" />
              {showMask && segResult.maskUrl && (
                <img
                  src={segResult.maskUrl}
                  alt="Mask"
                  className="absolute inset-0 w-full h-56 object-cover rounded-lg pointer-events-none"
                />
              )}
            </div>
            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-4 text-sm">
                <span className="text-gray-600">BSA: <strong className="text-gray-900">{segResult.bsa.toFixed(1)}%</strong></span>
                <span className="text-gray-600">Model: <strong className="text-gray-900">{SEG_MODELS.find(m => m.id === segModel)?.label}</strong></span>
              </div>
              <button
                onClick={() => setShowMask((p) => !p)}
                disabled={!segResult.maskUrl}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition disabled:opacity-40"
              >
                {showMask ? "Hide mask" : "Show mask"}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-5 flex flex-col gap-4">
            <h3 className="text-lg font-semibold">Step 3 — Choose severity classification model</h3>
            <p className="text-sm text-gray-500">
              The classifier will score 4 PGA components (erythema, induration, desquamation, extent) on a 0–4 scale.
            </p>
            <ModelPicker models={CLASS_MODELS} selected={classModel} onChange={setClassModel} />
            <button
              onClick={startClassification}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition w-full mt-1"
            >
              Run Classification
            </button>
            <button
              onClick={goBackToSelectSeg}
              className="text-sm text-blue-500 hover:text-blue-700 transition text-center"
            >
              ← Change segmentation model
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: CLASSIFYING ────────────────────────────────────────── */}
      {step === STEP.CLASSIFYING && (
        <div className="flex flex-col items-center gap-5 w-full max-w-lg">
          <div className="bg-white rounded-xl shadow p-4 w-full">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Running: {CLASS_MODELS.find(m => m.id === classModel)?.label}</p>
            <div className="relative w-full h-40">
              <img src={previewSrc} alt="Uploaded" className="w-full h-40 object-cover rounded-lg opacity-75" />
              {segResult?.maskUrl && (
                <img
                  src={segResult.maskUrl}
                  alt="Mask"
                  className="absolute inset-0 w-full h-40 object-cover rounded-lg pointer-events-none"
                />
              )}
            </div>
          </div>
          <LoadingSection messages={CLASS_MESSAGES} msgIdx={msgIdx} />
        </div>
      )}

      {/* ── STEP: REVIEW ─────────────────────────────────────────────── */}
      {step === STEP.REVIEW && assessment && segResult && classResult && (
        <div className="flex flex-col gap-5 w-full max-w-2xl">
          {/* Image + mask */}
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Assessment image</p>
            <div className="relative w-full h-64">
              <img src={previewSrc} alt="Uploaded" className="w-full h-64 object-cover rounded-lg" />
              {showMask && segResult.maskUrl && (
                <img
                  src={segResult.maskUrl}
                  alt="Mask"
                  className="absolute inset-0 w-full h-64 object-cover rounded-lg pointer-events-none"
                />
              )}
            </div>
            <button
              onClick={() => setShowMask((p) => !p)}
              disabled={!segResult.maskUrl}
              className="mt-2 text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition disabled:opacity-40"
            >
              {showMask ? "Hide segmentation" : "Show segmentation"}
            </button>
          </div>

          {/* Scores breakdown */}
          <div className="bg-white rounded-xl shadow p-5 grid grid-cols-3 gap-4 text-center">
            {["Redness", "Thickness", "Scaling"].map((name, i) => (
              <div key={name} className="flex flex-col items-center">
                <p className="text-xs text-gray-500 mb-1">{name}</p>
                <p className="text-2xl font-bold" style={{ color: severityLabel((classResult.pgaScores[i] / 4) * 100).color }}>
                  {classResult.pgaScores[i].toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">/ 4.0</p>
              </div>
            ))}
          </div>

          {/* Main result */}
          <div className="bg-white rounded-xl shadow p-6 flex flex-col items-center gap-3">
            {/* Gauge */}
            <svg width="200" height="115">
              <path d="M10 105 A90 90 0 0 1 190 105" fill="none" stroke="#e5e7eb" strokeWidth="18" />
              {(() => {
                const r = 90, cx = 100, cy = 105;
                const deg = (assessment.severity / 100) * 180;
                const rad = (Math.PI * deg) / 180;
                const x = cx + r * Math.cos(Math.PI - rad);
                const y = cy - r * Math.sin(rad);
                const laf = deg > 180 ? 1 : 0;
                return (
                  <path
                    d={`M10 105 A90 90 0 ${laf} 1 ${x} ${y}`}
                    fill="none"
                    stroke={assessment.color}
                    strokeWidth="18"
                    strokeLinecap="round"
                  />
                );
              })()}
              <text x="100" y="88" textAnchor="middle" fontSize="22" fill={assessment.color} fontWeight="bold">
                {assessment.severity}
              </text>
              <text x="100" y="104" textAnchor="middle" fontSize="11" fill="#9ca3af">out of 100</text>
            </svg>

            <div className="text-center">
              <span
                className="inline-block px-4 py-1 rounded-full text-white font-bold text-sm mb-2"
                style={{ background: assessment.color }}
              >
                {assessment.label}
              </span>
              <div className="grid grid-cols-3 gap-4 text-sm mt-1">
                <div><p className="text-gray-400 text-xs">BSA</p><p className="font-semibold">{segResult.bsa.toFixed(1)}%</p></div>
                <div><p className="text-gray-400 text-xs">Avg PGA</p><p className="font-semibold">{assessment.pga} / 4</p></div>
                <div><p className="text-gray-400 text-xs">Confidence</p><p className="font-semibold">{assessment.confidence}%</p></div>
              </div>
            </div>
          </div>

          {/* Severity dialog + detailed breakdown */}
          <div className="bg-white rounded-xl shadow p-5 border-l-4" style={{ borderColor: assessment.color }}>
            <h4 className="font-semibold text-gray-800 mb-2">Your Assessment</h4>
            <p className="text-gray-700 text-sm mb-4 font-medium">{assessment.dialog}</p>

            {/* Educational breakdown */}
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line leading-relaxed">
              {assessment.doctorSummary}
            </div>

            <div className="mt-3 text-xs text-gray-400">
              Area: <strong>{bodyLabel === "__custom__" ? customLabel.trim() : bodyLabel}</strong> &nbsp;·&nbsp;
              Segmentation: <strong>{SEG_MODELS.find(m => m.id === segModel)?.label}</strong> &nbsp;·&nbsp;
              Classifier: <strong>{CLASS_MODELS.find(m => m.id === classModel)?.label}</strong>
            </div>
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl shadow p-5 flex flex-col gap-3">
            <button
              onClick={saveReport}
              className="bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition w-full"
            >
              ✓ Save Report
            </button>
            <div className="flex gap-3">
              <button
                onClick={goBackToSelectClass}
                className="flex-1 border border-blue-300 text-blue-600 px-4 py-2 rounded-lg text-sm hover:bg-blue-50 transition"
              >
                ← Change classification model
              </button>
              <button
                onClick={goBackToSelectSeg}
                className="flex-1 border border-blue-300 text-blue-600 px-4 py-2 rounded-lg text-sm hover:bg-blue-50 transition"
              >
                ← Change segmentation model
              </button>
            </div>
            <button
              onClick={discardReport}
              className="text-sm text-gray-400 hover:text-red-500 transition text-center"
            >
              ✕ Discard this report
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ───────────────────────────────────────────────── */}
      {step === STEP.DONE && (
        <div className="bg-white rounded-xl shadow p-8 w-full max-w-lg text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-3xl">✓</div>
          <h3 className="text-xl font-bold text-green-700">Report Saved!</h3>
          <p className="text-gray-600 text-sm">
            Your assessment has been saved to your profile. You can view it anytime on your dashboard.
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => navigate("/patient")}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              Go to Dashboard
            </button>
            <button
              onClick={resetAll}
              className="border border-gray-300 text-gray-600 px-5 py-2 rounded-lg hover:bg-gray-50 transition"
            >
              Upload another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
