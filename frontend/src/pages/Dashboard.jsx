import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth, db, storage } from "../firebase";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [pastPhotos, setPastPhotos] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let unsubscribeAuth = null;
    let unsubscribeSnap = null;

    unsubscribeAuth = auth.onAuthStateChanged((currentUser) => {
      if (!currentUser || !currentUser.uid) {
        navigate("/login");
        setUser(null);
        setPastPhotos([]);
        return;
      }

      setUser(currentUser);
      const uid = currentUser.uid;
      const photosCollection = collection(db, "users", uid, "photos");

      unsubscribeSnap = onSnapshot(
        photosCollection,
        (snapshot) => {
          const photos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          setPastPhotos(photos);

          // Update severity history dynamically
          const sevHistory = photos.map((p) => p.severity);
          setHistory(sevHistory);
        },
        (error) => {
          console.error("Firestore listener error:", error);
        }
      );
    });

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
      if (unsubscribeSnap) unsubscribeSnap();
    };
  }, [navigate]);

  const deletePhoto = async (photo) => {
    if (!user) return;

    try {
        // Delete from Firestore
        const docRef = doc(db, "users", user.uid, "photos", photo.id);
        await deleteDoc(docRef);

        // Delete from Storage
        const storageRef = ref(storage, photo.url.split("?")[0].split("/o/")[1]);
        await deleteObject(storageRef);

        // Update local state
        const updatedPhotos = pastPhotos.filter((p) => p.id !== photo.id);
        setPastPhotos(updatedPhotos);

        // Recalculate history
        const updatedHistory = updatedPhotos.map((p) => Number(p.severity));
        setHistory(updatedHistory);

    } catch (err) {
        console.error("Failed to delete photo:", err);
    }
};


  const sortedPhotos = [...pastPhotos].sort(
    (a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt)
  );

  // Calculate average severity and trend
  const severities = history;
  const averageSeverity =
  severities.length > 0
        ? (severities.reduce((sum, s) => sum + s, 0) / severities.length).toFixed(1)
        : 0;
  const trend =
    severities.length > 1
      ? severities[severities.length - 1] > severities[0]
        ? "increasing"
        : severities[severities.length - 1] < severities[0]
        ? "decreasing"
        : "stable"
      : "stable";

  const severityToColor = (severity) =>
    severity <= 3 ? "#22c55e" : severity <= 6 ? "#eab308" : "#ef4444";

  const Speedometer = ({ severity }) => {
    const radius = 40;
    const centerX = 50;
    const centerY = 50;
    const angleDeg = (severity / 10) * 180;
    const angleRad = (Math.PI * angleDeg) / 180;
    const x = centerX + radius * Math.cos(Math.PI - angleRad);
    const y = centerY - radius * Math.sin(angleRad);
    const largeArcFlag = angleDeg > 180 ? 1 : 0;

    return (
      <svg width="100" height="60">
        <path
          d="M10 50 A40 40 0 0 1 90 50"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
        />
        <path
          d={`M10 50 A40 40 0 ${largeArcFlag} 1 ${x} ${y}`}
          fill="none"
          stroke={severityToColor(severity)}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <text
          x="50"
          y="40"
          textAnchor="middle"
          fontSize="14"
          fill={severityToColor(severity)}
          fontWeight="bold"
        >
          {severity}/10
        </text>
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-primary text-white py-8 px-6 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold">Your Progress</h1>
          <p className="mt-2 text-lg">
            Track your past photos and AI-generated severity summaries.
          </p>
        </div>
        <div className="flex flex-col items-center">
          <Speedometer severity={parseFloat(averageSeverity)} />
          <p className="text-sm mt-1 text-white">Trend: {trend}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        <div className="flex justify-end mb-6">
          <Link
            to="/upload"
            className="bg-secondary text-white px-6 py-3 rounded-lg shadow hover:bg-blue-600 transition"
          >
            Upload New Photo
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {sortedPhotos.length > 0 ? (
            sortedPhotos.map((photo, idx) => (
              <div
                key={photo.id || idx}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition relative"
              >
                <img
                  src={photo.url}
                  alt={`Past upload ${idx}`}
                  className="w-full h-48 object-cover"
                />
                <button
                  onClick={() => deletePhoto(photo)}
                  className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                >
                  Delete
                </button>
                <div className="p-4">
                  <p className="font-semibold">Severity: {photo.severity}</p>
                  <p className="text-sm text-gray-600">
                    Date:{" "}
                    {photo.createdAt
                      ? new Date(photo.createdAt?.toDate?.() || photo.createdAt).toLocaleDateString()
                      : "Unknown"}
                  </p>
                  <p className="mt-2 text-gray-700">{photo.summary}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="col-span-full text-center text-gray-500 mt-8">
              No uploads yet. Start by uploading a photo!
            </p>
          )}
        </div>
      </div>
    </div>
  );
}





