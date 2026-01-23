import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { signOut } from "firebase/auth";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  getDocs,
  orderBy,
  query,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

function makeCode() {
  // Avoid confusing characters (O/0, I/1)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `DERM-${s}`;
}

export default function DermDashboard() {
  const navigate = useNavigate();

  const dermUid = auth.currentUser?.uid;

  const [patientsLoading, setPatientsLoading] = useState(true);
  const [codeLoading, setCodeLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [code, setCode] = useState(null);
  const [error, setError] = useState("");

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  // ✅ Ensure dermatologist has a code (generate if missing)
  const ensureCode = async () => {
    if (!dermUid) return;
    setError("");
    setCodeLoading(true);

    try {
      const dermRef = doc(db, "dermatologists", dermUid);
      const dermSnap = await getDoc(dermRef);

      // Already has a code
      if (dermSnap.exists() && dermSnap.data()?.code) {
        setCode(dermSnap.data().code);
        setCodeLoading(false);
        return;
      }

      // Generate + reserve unique code using transaction
      for (let attempt = 1; attempt <= 10; attempt++) {
        const newCode = makeCode();

        try {
          await runTransaction(db, async (tx) => {
            const freshDermSnap = await tx.get(dermRef);
            if (freshDermSnap.exists() && freshDermSnap.data()?.code) {
              // Another tab already created it
              setCode(freshDermSnap.data().code);
              return;
            }

            const codeRef = doc(db, "dermCodes", newCode);
            const codeSnap = await tx.get(codeRef);

            if (codeSnap.exists()) {
              throw new Error("__TAKEN__");
            }

            // Reserve this code globally
            tx.set(codeRef, {
              dermUid,
              createdAt: serverTimestamp(),
            });

            // Save code on dermatologist profile
            tx.set(
              dermRef,
              {
                code: newCode,
                ownerUid: dermUid,
                createdAt: serverTimestamp(),
              },
              { merge: true }
            );

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

  const fetchPatients = async () => {
    setError("");
    if (!dermUid) return;

    setPatientsLoading(true);
    try {
      const q = query(
        collection(db, "dermatologists", dermUid, "patients"),
        orderBy("createdAt", "desc")
      );

      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPatients(rows);
    } catch (e) {
      console.error(e);
      // If orderBy fails (missing createdAt/index), fallback:
      try {
        const snap = await getDocs(collection(db, "dermatologists", dermUid, "patients"));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPatients(rows);
      } catch (e2) {
        console.error(e2);
        setError("Failed to load linked patients.");
      }
    } finally {
      setPatientsLoading(false);
    }
  };

  useEffect(() => {
    if (!dermUid) return;
    // On first load: ensure code exists, then fetch patients
    ensureCode();
    fetchPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dermUid]);

  if (!dermUid) {
    return <p className="text-center mt-8">You must be logged in.</p>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dermatologist Dashboard</h1>
          <p className="text-gray-600 text-sm mt-1">
            Patients link to you using your code.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={async () => {
              await ensureCode();
              await fetchPatients();
            }}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Refresh
          </button>

        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded text-red-700">
          {error}
        </div>
      )}

      {/* ✅ Code card ALWAYS shown */}
      <div className="bg-white rounded shadow p-6 mb-6">
        <h2 className="text-lg font-semibold">Your dermatologist code</h2>

        {codeLoading ? (
          <p className="mt-2 text-gray-600">Loading / generating your code…</p>
        ) : code ? (
          <>
            <p className="mt-2 text-gray-700">
              Patients enter this in their Profile to link you.
            </p>
            <div className="mt-3 p-4 border rounded bg-gray-50 flex items-center justify-between">
              <span className="text-xl font-mono font-bold">{code}</span>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                  } catch {}
                }}
                className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Copy
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-gray-600">
            No code found. Click refresh to try again.
          </p>
        )}
      </div>

      {/* Patients list */}
      <div className="bg-white rounded shadow p-6">
        <h2 className="text-lg font-semibold">Linked Patients</h2>

        {patientsLoading ? (
          <p className="mt-4 text-gray-600">Loading patients…</p>
        ) : patients.length === 0 ? (
          <p className="mt-4 text-gray-600">
            No patients linked yet. Ask a patient to enter your code in their profile.
          </p>
        ) : (
          <div className="mt-4 divide-y">
            {patients.map((p) => {
              const patientUid = p.patientUid || p.id;
              const linkedDate = p.createdAt?.toDate?.() ? p.createdAt.toDate() : null;

              return (
                <div key={patientUid} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-mono font-semibold">{patientUid}</div>
                    <div className="text-xs text-gray-500">
                      Linked: {linkedDate ? linkedDate.toLocaleDateString() : "—"}
                    </div>
                  </div>

                  <Link
                    to={`/derm/patient/${patientUid}`}
                    className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200"
                  >
                    View photo history →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

