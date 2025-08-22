import { useState, useEffect } from "react";
import { storage, db, auth } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";

export default function Upload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const [history, setHistory] = useState([]);

  // ✅ On mount, fetch previous severities from Firestore
  useEffect(() => {
    const fetchHistory = async () => {
      if (!auth.currentUser?.uid) return;

      const uid = auth.currentUser.uid;
      const photosRef = collection(db, "users", uid, "photos");

      try {
        const snapshot = await getDocs(photosRef);
        const severities = snapshot.docs
          .map((doc) => doc.data().severity)
          .filter((s) => s !== undefined && s !== null);
        setHistory(severities);
      } catch (err) {
        console.error("Failed to fetch history:", err);
        setHistory([]);
      }
    };

    fetchHistory();
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setSubmitted(false);
    setAiResult(null);
    setUploadError(null);
  };

  const handleUpload = async (file, severity, summary) => {
    if (!auth.currentUser?.uid) throw new Error("No authenticated user.");

    const uid = auth.currentUser.uid;
    const safeName = file.name.replace(/\//g, "_");
    const storageRef = ref(storage, `users/${uid}/photos/${Date.now()}_${safeName}`);

    // Upload file
    await uploadBytes(storageRef, file);

    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    // Save metadata to Firestore
    const photosRef = collection(db, "users", uid, "photos");
    await addDoc(photosRef, {
      url: downloadURL,
      severity,
      summary,
      createdAt: serverTimestamp(),
    });

    return downloadURL;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please select a file.");

    setUploading(true);
    setUploadError(null);

    try {
      // Generate new severity
      const newSeverity = Math.floor(Math.random() * 10) + 1;
      const updatedHistory = [...history, newSeverity];
      setHistory(updatedHistory);

      // Calculate average based on current history
      const average =
        updatedHistory.length === 1
          ? newSeverity
          : (updatedHistory.reduce((sum, val) => sum + val, 0) / updatedHistory.length).toFixed(1);

      // Determine trend
      const trend =
        updatedHistory.length === 1
          ? "stable"
          : updatedHistory[updatedHistory.length - 1] > updatedHistory[0]
          ? "increasing"
          : updatedHistory[updatedHistory.length - 1] < updatedHistory[0]
          ? "decreasing"
          : "stable";

      const summary = `Average severity: ${average}/10. Overall trend: ${trend}.`;

      // Upload file
      const uploadedUrl = await handleUpload(file, newSeverity, summary);

      setPreview(uploadedUrl);
      setAiResult({ severity: newSeverity, summary, url: uploadedUrl });
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const severityToColor = (severity) =>
    severity <= 3 ? "#22c55e" : severity <= 6 ? "#eab308" : "#ef4444";

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center">
      <h2 className="text-3xl font-bold text-primary mb-6">Upload New Photo</h2>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col items-center gap-4 w-full max-w-md mb-4"
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="border p-2 rounded w-full"
        />
        <button
          type="submit"
          className="bg-secondary text-white px-6 py-3 rounded-lg shadow hover:bg-blue-600 transition w-full"
          disabled={uploading}
        >
          Submit
        </button>
        {uploading && <p className="text-blue-500 mt-2">Uploading...</p>}
        {!uploading && submitted && !uploadError && (
          <p className="text-green-500 mt-2">Upload successful!</p>
        )}
        {uploadError && <p className="text-red-500 mt-2">{uploadError}</p>}
      </form>

      {submitted && aiResult && (
        <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl">
          <div className="flex-1 bg-white rounded-lg shadow-md p-4 flex items-center justify-center">
            {aiResult.url ? (
              <img
                src={aiResult.url}
                alt="Uploaded"
                className="w-full h-96 object-cover rounded"
              />
            ) : (
              <div className="w-full h-96 bg-gray-200 flex items-center justify-center rounded">
                <span className="text-gray-500">No image uploaded</span>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col items-center bg-white rounded-lg shadow-md p-4">
            <svg width="200" height="120">
              <path
                d="M10 110 A90 90 0 0 1 190 110"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="20"
              />
              {(() => {
                const radius = 90;
                const centerX = 100;
                const centerY = 110;
                const angleDeg = (aiResult.severity / 10) * 180;
                const angleRad = (Math.PI * angleDeg) / 180;
                const x = centerX + radius * Math.cos(Math.PI - angleRad);
                const y = centerY - radius * Math.sin(angleRad);
                const largeArcFlag = angleDeg > 180 ? 1 : 0;
                return (
                  <path
                    d={`M10 110 A90 90 0 ${largeArcFlag} 1 ${x} ${y}`}
                    fill="none"
                    stroke={severityToColor(aiResult.severity)}
                    strokeWidth="20"
                    strokeLinecap="round"
                  />
                );
              })()}
              <text
                x="100"
                y="80"
                textAnchor="middle"
                fontSize="24"
                fill={severityToColor(aiResult.severity)}
                fontWeight="bold"
              >
                {aiResult.severity}/10
              </text>
            </svg>

            <div className="mt-4 text-center">
              <h3 className="font-semibold text-lg">Current Severity</h3>
              <p className="text-gray-700">{aiResult.summary}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
