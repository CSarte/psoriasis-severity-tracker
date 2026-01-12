import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { signOut } from "firebase/auth";
import { useNavigate, Link } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

export default function DermDashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [error, setError] = useState("");

  const dermUid = auth.currentUser?.uid;

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  const fetchPatients = async () => {
    setError("");
    if (!dermUid) return;

    setLoading(true);
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
      setError("Failed to load linked patients.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
            View patients who linked your dermatologist code.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={fetchPatients}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Refresh
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900"
          >
            Log out
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow p-6">
        <h2 className="text-lg font-semibold">Linked Patients</h2>

        {error && (
          <div className="mt-3 p-3 border border-red-300 bg-red-50 rounded text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="mt-4 text-gray-600">Loading patients…</p>
        ) : patients.length === 0 ? (
          <p className="mt-4 text-gray-600">
            No patients linked yet. Ask a patient to enter your code in their profile.
          </p>
        ) : (
          <div className="mt-4 divide-y">
            {patients.map((p) => {
              const patientUid = p.patientUid || p.id; // id is patientUid if you used doc(..., patientUid)
              const linkedDate =
                p.createdAt?.toDate?.() ? p.createdAt.toDate() : null;

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

