import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { auth, db } from "../firebase";
import { collection, getDocs, orderBy, query, doc, getDoc } from "firebase/firestore";

export default function DermPatient() {
  const { patientUid } = useParams();
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");

  const dermUid = auth.currentUser?.uid;

  useEffect(() => {
    const load = async () => {
      setError("");
      setLoading(true);

      try {
        // Try Option A: users/{uid}/photos/{photoId}
        let rows = [];
        try {
          const q = query(
            collection(db, "users", patientUid, "photos"),
            orderBy("createdAt", "desc")
          );
          const snap = await getDocs(q);
          rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (e) {
          // If createdAt doesn't exist or not indexed, this can throw.
          // Fallback: fetch without orderBy.
          const snap = await getDocs(collection(db, "users", patientUid, "photos"));
          rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        // If Option A returns nothing, try Option B: users/{uid}/photos/"photo list"
        if (rows.length === 0) {
          const listSnap = await getDoc(doc(db, "users", patientUid, "photos", "photo list"));
          if (listSnap.exists()) {
            const data = listSnap.data();
            const arr = data?.photos || data?.photoList || [];
            // normalize to same shape
            rows = arr.map((p, idx) => ({ id: `list-${idx}`, ...p }));
          }
        }

        setPhotos(rows);
      } catch (e) {
        console.error(e);
        setError("Failed to load this patient's photos.");
      } finally {
        setLoading(false);
      }
    };

    if (dermUid && patientUid) load();
  }, [dermUid, patientUid]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link to="/derm" className="text-blue-600 hover:underline">
          ← Back to patient list
        </Link>
        <h1 className="text-2xl font-bold mt-2">Patient Photo History</h1>
        <p className="text-gray-600 text-sm mt-1">
          Patient UID: <span className="font-mono">{patientUid}</span>
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-600">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="text-gray-600">No photos found for this patient.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {photos.map((p) => {
            const url = p.imageUrl || p.url || p.downloadURL;
            return (
              <div key={p.id} className="border rounded bg-white shadow-sm overflow-hidden">
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                  {url ? (
                    <img src={url} alt="Patient upload" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-500 text-sm p-4 text-center">
                      No image URL field found on this item.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
