import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  getDocs,
  orderBy,
  query,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `DERM-${s}`;
}

export default function DermDashboard() {
  const navigate = useNavigate();

  // ── Reactive auth state (fixes code disappearing on refresh) ──────────
  const [dermUid, setDermUid] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setDermUid(u?.uid ?? null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const [patientsLoading, setPatientsLoading] = useState(true);
  const [codeLoading, setCodeLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [code, setCode] = useState(null);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState(null);

  // ── Ensure dermatologist has a code (generate if missing) ───────────── (generate if missing) ─────────────
  const ensureCode = async (uid) => {
    const id = uid || dermUid;
    if (!id) return;
    setError("");
    setCodeLoading(true);

    try {
      const dermRef = doc(db, "dermatologists", id);
      const dermSnap = await getDoc(dermRef);

      if (dermSnap.exists() && dermSnap.data()?.code) {
        setCode(dermSnap.data().code);
        setCodeLoading(false);
        return;
      }

      // Generate + reserve unique code via transaction
      for (let attempt = 1; attempt <= 10; attempt++) {
        const newCode = makeCode();

        try {
          await runTransaction(db, async (tx) => {
            const freshSnap = await tx.get(dermRef);
            if (freshSnap.exists() && freshSnap.data()?.code) {
              setCode(freshSnap.data().code);
              return;
            }

            const codeRef = doc(db, "dermCodes", newCode);
            const codeSnap = await tx.get(codeRef);
            if (codeSnap.exists()) throw new Error("__TAKEN__");

            tx.set(codeRef, { dermUid: id, createdAt: serverTimestamp() });
            tx.set(dermRef, { code: newCode, ownerUid: id, createdAt: serverTimestamp() }, { merge: true });
            setCode(newCode);
          });

          setCodeLoading(false);
          return;
        } catch (e) {
          if (e?.message === "__TAKEN__") continue;
          throw e;
        }
      }

      setError("Could not generate a unique code. Please refresh and try again.");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to load/generate your dermatologist code.");
    } finally {
      setCodeLoading(false);
    }
  };

  // ── Fetch linked patients ─────────────────────────────────────────────
  const fetchPatients = async (uid) => {
    const id = uid || dermUid;
    if (!id) return;
    setError("");
    setPatientsLoading(true);

    try {
      const q = query(collection(db, "dermatologists", id, "patients"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setPatients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch {
      try {
        const snap = await getDocs(collection(db, "dermatologists", id, "patients"));
        setPatients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e2) {
        console.error(e2);
        setError("Failed to load linked patients.");
      }
    } finally {
      setPatientsLoading(false);
    }
  };

  // ── Load code + patients when auth resolves ───────────────────────────
  useEffect(() => {
    if (!dermUid) return;
    ensureCode(dermUid);
    fetchPatients(dermUid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dermUid]);

  // ── Remove a patient ──────────────────────────────────────────────────
  const removePatient = async (patientUid) => {
    if (!dermUid) return;
    setRemovingId(patientUid);

    try {
      // 1. Delete the mirror doc under the dermatologist
      await deleteDoc(doc(db, "dermatologists", dermUid, "patients", patientUid));

      // 2. Delete the access grant under the patient
      await deleteDoc(doc(db, "users", patientUid, "dermAccess", dermUid)).catch(() => {});

      // 3. Mark the link as disconnected in the patient's profile history
      try {
        const profileRef = doc(db, "users", patientUid, "profile", "mainDoc");
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const data = profileSnap.data();
          const linkedDerms = (data.linkedDerms || []).map((entry) => {
            if (entry?.dermUid === dermUid && entry?.status !== "disconnected") {
              return { ...entry, status: "disconnected", disconnectedAt: new Date().toISOString() };
            }
            return entry;
          });
          await setDoc(profileRef, { linkedDerms, updatedAt: serverTimestamp() }, { merge: true });
        }
      } catch {
        // non-fatal — patient profile update is best-effort
      }

      // 4. Remove from local state
      setPatients((prev) => prev.filter((p) => (p.patientUid || p.id) !== patientUid));
    } catch (e) {
      console.error(e);
      setError("Failed to remove patient.");
    } finally {
      setRemovingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (authLoading) {
    return <p className="text-center mt-8 text-gray-500">Loading...</p>;
  }

  if (!dermUid) {
    return <p className="text-center mt-8">You must be logged in.</p>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dermatologist Dashboard</h1>
          <p className="text-gray-600 text-sm mt-1">Patients link to you using your code.</p>
        </div>
        <button
          onClick={() => { ensureCode(); fetchPatients(); }}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded text-red-700">{error}</div>
      )}

      {/* Code card */}
      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <h2 className="text-lg font-semibold">Your Dermatologist Code</h2>

        {codeLoading ? (
          <p className="mt-2 text-gray-500">Loading your code...</p>
        ) : code ? (
          <>
            <p className="mt-2 text-gray-600 text-sm">
              Share this code with patients so they can link to you from their Profile page.
            </p>
            <div className="mt-3 p-4 border rounded-lg bg-gray-50 flex items-center justify-between">
              <span className="text-2xl font-mono font-bold tracking-wider">{code}</span>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(code); } catch {}
                }}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">This code is permanent and will always stay the same.</p>
          </>
        ) : (
          <p className="mt-2 text-gray-500">No code found. Click Refresh to try again.</p>
        )}
      </div>

      {/* Patients list */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold">Linked Patients</h2>

        {patientsLoading ? (
          <p className="mt-4 text-gray-500">Loading patients...</p>
        ) : patients.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No patients linked yet. Ask a patient to enter your code in their profile.
          </p>
        ) : (
          <div className="mt-4 divide-y">
            {patients.map((p) => {
              const patientUid = p.patientUid || p.id;
              const linkedDate = p.createdAt?.toDate?.() ? p.createdAt.toDate() : null;
              const isRemoving = removingId === patientUid;

              return (
                <div key={patientUid} className="py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-sm truncate">{patientUid}</div>
                    <div className="text-xs text-gray-500">
                      Linked: {linkedDate ? linkedDate.toLocaleDateString() : "—"}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <Link
                      to={`/derm/patient/${patientUid}`}
                      className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-sm"
                    >
                      View history
                    </Link>
                    <button
                      onClick={() => removePatient(patientUid)}
                      disabled={isRemoving}
                      className="px-3 py-2 rounded text-red-600 border border-red-200 hover:bg-red-50 text-sm disabled:opacity-50"
                    >
                      {isRemoving ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
