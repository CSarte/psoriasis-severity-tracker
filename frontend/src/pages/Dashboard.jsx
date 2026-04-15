import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth, db, storage } from "../firebase";
import { collection, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

// 5-tier scale on 0-100: Clear / Mild / Moderate / Severe / Very Severe
function severityColor(score) {
  if (score < 5)  return "#86efac";
  if (score < 20) return "#22c55e";
  if (score < 50) return "#eab308";
  if (score < 75) return "#f97316";
  return "#ef4444";
}

function severityLabel(score) {
  if (score < 5)  return "Clear";
  if (score < 20) return "Mild";
  if (score < 50) return "Moderate";
  if (score < 75) return "Severe";
  return "Very Severe";
}

function Speedometer({ severity, size = "sm" }) {
  const radius = size === "sm" ? 36 : 56;
  const cx = size === "sm" ? 46 : 70;
  const cy = size === "sm" ? 46 : 70;
  const sw = size === "sm" ? 7 : 11;
  const fs = size === "sm" ? 12 : 18;
  const svgW = size === "sm" ? 92 : 140;
  const svgH = size === "sm" ? 56 : 84;

  const clamped = Math.min(100, Math.max(0, severity || 0));
  const angleDeg = (clamped / 100) * 180;
  const angleRad = (Math.PI * angleDeg) / 180;
  const x = cx + radius * Math.cos(Math.PI - angleRad);
  const y = cy - radius * Math.sin(angleRad);
  const laf = angleDeg > 180 ? 1 : 0;
  const color = severityColor(clamped);

  return (
    <svg width={svgW} height={svgH}>
      <path
        d={`M${cx - radius} ${cy} A${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={sw}
      />
      {clamped > 0 && (
        <path
          d={`M${cx - radius} ${cy} A${radius} ${radius} 0 ${laf} 1 ${x} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )}
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={fs} fill={color} fontWeight="bold">
        {clamped}
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize={9} fill="#9ca3af">
        /100
      </text>
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [pastPhotos, setPastPhotos] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [maskVisible, setMaskVisible] = useState(new Set());
  const [areaFilter, setAreaFilter] = useState("all");

  useEffect(() => {
    let unsubscribeAuth = null;
    let unsubscribeSnap = null;

    unsubscribeAuth = auth.onAuthStateChanged((currentUser) => {
      if (!currentUser?.uid) {
        navigate("/login");
        setUser(null);
        setPastPhotos([]);
        return;
      }

      setUser(currentUser);
      const uid = currentUser.uid;

      unsubscribeSnap = onSnapshot(
        collection(db, "users", uid, "photos"),
        (snapshot) => {
          const photos = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            // Only show saved reports (saved: true), treat missing field as saved for backward compat
            .filter((p) => p.saved !== false);

          setPastPhotos(photos);
        },
        (error) => console.error("Firestore listener error:", error)
      );
    });

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
      if (unsubscribeSnap) unsubscribeSnap();
    };
  }, [navigate]);

  const deletePhoto = async (photo) => {
    if (!user?.uid) return;
    try {
      if (photo.storagePath) {
        await deleteObject(ref(storage, photo.storagePath)).catch(() => {});
      }
      if (photo.segmentation?.maskPath) {
        await deleteObject(ref(storage, photo.segmentation.maskPath)).catch(() => {});
      }
      await deleteDoc(doc(db, "users", user.uid, "photos", photo.id));
      setExpandedId((prev) => (prev === photo.id ? null : prev));
    } catch (err) {
      console.error("Failed to delete photo:", err);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const toggleMask = (id) => {
    setMaskVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sortedPhotos = [...pastPhotos].sort(
    (a, b) =>
      new Date(b.createdAt?.toDate?.() || b.createdAt) -
      new Date(a.createdAt?.toDate?.() || a.createdAt)
  );

  // Unique body-area labels for the filter bar
  const allLabels = [...new Set(sortedPhotos.map((p) => p.bodyLabel).filter(Boolean))].sort();

  // Apply area filter
  const filteredPhotos =
    areaFilter === "all"
      ? sortedPhotos
      : sortedPhotos.filter((p) => p.bodyLabel === areaFilter);

  const severities = filteredPhotos.map((p) => Number(p.severity)).filter((n) => !isNaN(n));
  const averageSeverity =
    severities.length > 0
      ? Math.round((severities.reduce((s, v) => s + v, 0) / severities.length) * 10) / 10
      : 0;

  const trend =
    severities.length > 1
      ? severities[0] < severities[severities.length - 1]
        ? "improving ↓"
        : severities[0] > severities[severities.length - 1]
        ? "worsening ↑"
        : "stable →"
      : "—";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-primary text-white py-8 px-6 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold">Your Progress</h1>
          <p className="mt-2 text-lg">Track your photo history and AI severity assessments.</p>
        </div>
        <div className="flex flex-col items-center">
          <Speedometer severity={averageSeverity} size="lg" />
          <p className="text-sm mt-1 text-white opacity-80">Avg trend: {trend}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          {/* Body area filter */}
          {allLabels.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500 font-medium">Filter:</span>
              <button
                onClick={() => setAreaFilter("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  areaFilter === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                All
              </button>
              {allLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => setAreaFilter(label)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    areaFilter === label
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <Link
            to="/upload"
            className="bg-secondary text-white px-6 py-3 rounded-lg shadow hover:bg-blue-600 transition"
          >
            Upload New Photo
          </Link>
        </div>

        {filteredPhotos.length === 0 ? (
          <p className="text-center text-gray-500 mt-12">
            No saved reports yet. Upload a photo to get started!
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPhotos.map((photo) => {
              const isExpanded = expandedId === photo.id;
              const isMaskOn = maskVisible.has(photo.id);
              const maskUrl = photo.segmentation?.maskUrl;
              const hasSeverity = photo.severity != null;

              return (
                <div
                  key={photo.id}
                  className={`bg-white rounded-xl shadow-md overflow-hidden transition-all duration-200 ${
                    isExpanded ? "shadow-xl ring-2 ring-blue-200" : "hover:shadow-lg"
                  }`}
                >
                  {/* ── Collapsed header (always visible) ───────────── */}
                  <div className="relative cursor-pointer" onClick={() => toggleExpand(photo.id)}>
                    {/* Image with optional mask overlay */}
                    <div className="relative w-full h-48">
                      <img
                        src={photo.url}
                        alt="Upload"
                        className="w-full h-48 object-cover"
                      />
                      {isMaskOn && maskUrl && (
                        <img
                          src={maskUrl}
                          alt="Segmentation mask"
                          className="absolute inset-0 w-full h-48 object-cover pointer-events-none"
                        />
                      )}
                    </div>

                    {/* Severity badge */}
                    {hasSeverity && (
                      <span
                        className="absolute top-2 left-2 text-white text-xs font-bold px-2 py-1 rounded-full shadow"
                        style={{ background: severityColor(photo.severity) }}
                      >
                        {severityLabel(photo.severity)} · {photo.severity}/100
                      </span>
                    )}

                    {/* Body area label */}
                    {photo.bodyLabel && (
                      <span className="absolute bottom-2 left-2 bg-white bg-opacity-90 text-gray-700 text-xs font-medium px-2 py-0.5 rounded-full shadow">
                        {photo.bodyLabel}
                      </span>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePhoto(photo); }}
                      className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700"
                    >
                      Delete
                    </button>

                    {/* Expand indicator */}
                    <div className="absolute bottom-2 right-2 bg-white bg-opacity-80 rounded-full w-6 h-6 flex items-center justify-center text-gray-500 text-xs shadow">
                      {isExpanded ? "▲" : "▼"}
                    </div>
                  </div>

                  {/* Brief info row */}
                  <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
                    <p className="text-xs text-gray-500">
                      {photo.createdAt
                        ? new Date(photo.createdAt?.toDate?.() || photo.createdAt).toLocaleDateString()
                        : "Unknown date"}
                    </p>
                    {hasSeverity && <Speedometer severity={photo.severity} size="sm" />}
                  </div>

                  {/* ── Expanded details ─────────────────────────────── */}
                  {isExpanded && (
                    <div className="p-4 flex flex-col gap-4 border-t border-gray-100">

                      {/* PGA component scores (3 = new regression; 4 = legacy TTA display) */}
                      {photo.pgaScores && (photo.pgaScores.length === 3 || photo.pgaScores.length === 4) && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">PGA Components</p>
                          <div className={`grid gap-1 text-center ${photo.pgaScores.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
                            {(photo.pgaScores.length === 3 ? ["Redness", "Thickness", "Scaling"] : ["P1", "P2", "P3", "P4"]).map((name, i) => (
                              <div key={name} className="bg-gray-50 rounded p-2">
                                <p className="text-xs text-gray-400">{name}</p>
                                <p
                                  className="text-base font-bold"
                                  style={{ color: severityColor((photo.pgaScores[i] / 4) * 100) }}
                                >
                                  {photo.pgaScores[i].toFixed(2)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Score breakdown */}
                      <div className="grid grid-cols-3 gap-2 text-center text-sm">
                        {photo.bsa != null && (
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-xs text-gray-400">BSA</p>
                            <p className="font-bold text-gray-800">{Number(photo.bsa).toFixed(1)}%</p>
                          </div>
                        )}
                        {photo.pga != null && (
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-xs text-gray-400">Avg PGA</p>
                            <p className="font-bold text-gray-800">{Number(photo.pga).toFixed(2)} / 4</p>
                          </div>
                        )}
                        {photo.confidenceScore != null && (
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-xs text-gray-400">Confidence</p>
                            <p className="font-bold text-gray-800">{photo.confidenceScore}%</p>
                          </div>
                        )}
                      </div>

                      {/* Doctor summary */}
                      {photo.doctorSummary && (
                        <div
                          className="rounded-lg p-3 text-sm border-l-4"
                          style={{ borderColor: severityColor(photo.severity), background: "#f9fafb" }}
                        >
                          <p className="font-semibold text-gray-700 mb-2 text-xs uppercase tracking-wide">Assessment</p>
                          <p className="text-gray-700 whitespace-pre-line leading-relaxed">{photo.doctorSummary}</p>
                        </div>
                      )}

                      {/* Models used */}
                      {(photo.segmentationModel || photo.classificationModel) && (
                        <p className="text-xs text-gray-400">
                          {photo.segmentationModel && <>Seg: <strong>{photo.segmentationModel}</strong></>}
                          {photo.segmentationModel && photo.classificationModel && " · "}
                          {photo.classificationModel && <>Class: <strong>{photo.classificationModel}</strong></>}
                        </p>
                      )}

                      {/* Segmentation toggle */}
                      <button
                        onClick={() => toggleMask(photo.id)}
                        disabled={!maskUrl}
                        className="w-full border border-blue-200 text-blue-600 text-sm py-2 rounded-lg hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isMaskOn ? "Hide segmentation overlay" : "Show segmentation overlay"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
