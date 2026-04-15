import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, orderBy, query, doc, getDoc } from "firebase/firestore";

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

export default function DermPatient() {
  const { patientUid } = useParams();

  // ── Reactive auth ──────────────────────────────────────────────────────
  const [dermUid, setDermUid] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setDermUid(u?.uid ?? null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Data state ─────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [maskVisible, setMaskVisible] = useState(new Set());

  // ── Fetch patient data ─────────────────────────────────────────────────
  useEffect(() => {
    if (!dermUid || !patientUid) return;

    const load = async () => {
      setError("");
      setLoading(true);

      try {
        // ── Photos ────────────────────────────────────────────────────
        let rows = [];
        try {
          const q = query(
            collection(db, "users", patientUid, "photos"),
            orderBy("createdAt", "desc")
          );
          const snap = await getDocs(q);
          rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch {
          const snap = await getDocs(collection(db, "users", patientUid, "photos"));
          rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        // Fallback: single "photo list" doc
        if (rows.length === 0) {
          const listSnap = await getDoc(doc(db, "users", patientUid, "photos", "photo list"));
          if (listSnap.exists()) {
            const data = listSnap.data();
            const arr = data?.photos || data?.photoList || [];
            rows = arr.map((p, idx) => ({ id: `list-${idx}`, ...p }));
          }
        }

        // Only show saved photos (backward compat: missing field = show)
        setPhotos(rows.filter((p) => p.saved !== false));

        // ── Profile (medications, notes, name) ────────────────────────
        try {
          const profSnap = await getDoc(doc(db, "users", patientUid, "profile", "mainDoc"));
          if (profSnap.exists()) setProfile(profSnap.data());
        } catch {
          // non-fatal
        }
      } catch (e) {
        console.error(e);
        setError("Failed to load this patient's data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [dermUid, patientUid]);

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));
  const toggleMask = (id) =>
    setMaskVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Render ─────────────────────────────────────────────────────────────

  if (authLoading) return <p className="text-center mt-8 text-gray-500">Loading...</p>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/derm" className="text-blue-600 hover:underline text-sm">
          ← Back to patient list
        </Link>
        <h1 className="text-2xl font-bold mt-2">Patient History</h1>
        {profile?.name && (
          <p className="text-gray-700 mt-1">
            Name: <strong>{profile.name}</strong>
          </p>
        )}
        <p className="text-gray-500 text-xs mt-1 font-mono">{patientUid}</p>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading patient data...</p>
      ) : (
        <>
          {/* ── Patient info cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Medications */}
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="text-lg font-semibold mb-3">Medications</h2>
              {(profile?.medications || []).length === 0 ? (
                <p className="text-gray-400 text-sm">No medications recorded.</p>
              ) : (
                <div className="divide-y">
                  {profile.medications.map((med, i) => (
                    <div key={i} className="py-2">
                      <p className="font-medium">{med.name}</p>
                      <p className="text-xs text-gray-500">
                        {med.startDate || "?"} — {med.endDate || "present"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="text-lg font-semibold mb-3">Patient Notes</h2>
              {(profile?.notebook || []).length === 0 ? (
                <p className="text-gray-400 text-sm">No notes recorded.</p>
              ) : (
                <div className="divide-y max-h-64 overflow-y-auto">
                  {profile.notebook.map((entry, i) => (
                    <div key={i} className="py-2">
                      <p className="text-xs text-gray-400">
                        {entry.date ? new Date(entry.date).toLocaleDateString() : "—"}
                      </p>
                      <p className="text-sm text-gray-700">{entry.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Photo history ──────────────────────────────────────────── */}
          <h2 className="text-lg font-semibold mb-3">Photo Assessments</h2>

          {photos.length === 0 ? (
            <p className="text-gray-400">No saved photos for this patient.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {photos.map((photo) => {
                const isExpanded = expandedId === photo.id;
                const isMaskOn = maskVisible.has(photo.id);
                const maskUrl = photo.segmentation?.maskUrl;
                const url = photo.url || photo.imageUrl || photo.downloadURL;
                const hasSeverity = photo.severity != null;

                return (
                  <div
                    key={photo.id}
                    className={`bg-white rounded-xl shadow-md overflow-hidden transition-all ${
                      isExpanded ? "shadow-xl ring-2 ring-blue-200" : "hover:shadow-lg"
                    }`}
                  >
                    {/* Image (click to expand) */}
                    <div className="relative cursor-pointer" onClick={() => toggleExpand(photo.id)}>
                      <div className="relative w-full h-48">
                        {url ? (
                          <img src={url} alt="Patient upload" className="w-full h-48 object-cover" />
                        ) : (
                          <div className="w-full h-48 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                            No image
                          </div>
                        )}
                        {isMaskOn && maskUrl && (
                          <img
                            src={maskUrl}
                            alt="Mask"
                            className="absolute inset-0 w-full h-48 object-cover pointer-events-none"
                          />
                        )}
                      </div>

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

                      <div className="absolute bottom-2 right-2 bg-white bg-opacity-80 rounded-full w-6 h-6 flex items-center justify-center text-gray-500 text-xs shadow">
                        {isExpanded ? "▲" : "▼"}
                      </div>
                    </div>

                    {/* Date row */}
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-xs text-gray-500">
                        {photo.createdAt
                          ? new Date(photo.createdAt?.toDate?.() || photo.createdAt).toLocaleDateString()
                          : "Unknown date"}
                      </p>
                    </div>

                    {/* ── Expanded assessment ──────────────────────────── */}
                    {isExpanded && (
                      <div className="p-4 flex flex-col gap-3">
                        {/* PGA component scores (3 = new regression; 4 = legacy TTA display) */}
                        {photo.pgaScores && (photo.pgaScores.length === 3 || photo.pgaScores.length === 4) && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">PGA Components</p>
                            <div className={`grid gap-1 text-center ${photo.pgaScores.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
                              {(photo.pgaScores.length === 3 ? ["Redness", "Thickness", "Scaling"] : ["P1", "P2", "P3", "P4"]).map((name, i) => (
                                <div key={name} className="bg-gray-50 rounded p-1.5">
                                  <p className="text-xs text-gray-400">{name}</p>
                                  <p className="text-sm font-bold" style={{ color: severityColor((photo.pgaScores[i] / 4) * 100) }}>
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
                          onClick={(e) => { e.stopPropagation(); toggleMask(photo.id); }}
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
        </>
      )}
    </div>
  );
}
