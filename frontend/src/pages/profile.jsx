import { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { useNavigate } from "react-router-dom";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Profile() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({
    name: "",
    journeyStart: "",
    reason: "",
    medications: [],
    dermatologists: [],
    notebook: [],
  });

  const [newMedication, setNewMedication] = useState({ name: "", startDate: "", endDate: "" });
  const [newDermatologist, setNewDermatologist] = useState({ name: "", notes: "" });
  const [newNote, setNewNote] = useState("");

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) {
      navigate("/login");
      return;
    }

    const fetchProfile = async () => {
      const docRef = doc(db, "users", uid, "profile", "mainDoc");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      }
      setLoading(false);
    };

    fetchProfile();
  }, [uid, navigate]);

  const saveProfile = async (updatedProfile) => {
    const docRef = doc(db, "users", uid, "profile", "mainDoc");
    await setDoc(docRef, { ...updatedProfile, updatedAt: serverTimestamp() });
    setProfile(updatedProfile);
  };

  // Add functions
  const addMedication = () => {
    if (!newMedication.name) return;
    const updated = { ...profile, medications: [...profile.medications, newMedication] };
    saveProfile(updated);
    setNewMedication({ name: "", startDate: "", endDate: "" });
  };

  const addDermatologist = () => {
    if (!newDermatologist.name) return;
    const updated = { ...profile, dermatologists: [...profile.dermatologists, newDermatologist] };
    saveProfile(updated);
    setNewDermatologist({ name: "", notes: "" });
  };

  const addNote = () => {
    if (!newNote) return;
    const updated = {
      ...profile,
      notebook: [...profile.notebook, { date: new Date().toISOString(), notes: newNote }],
    };
    saveProfile(updated);
    setNewNote("");
  };

  // Delete functions
  const deleteMedication = (index) => {
    const updated = { ...profile, medications: profile.medications.filter((_, i) => i !== index) };
    saveProfile(updated);
  };

  const deleteDermatologist = (index) => {
    const updated = { ...profile, dermatologists: profile.dermatologists.filter((_, i) => i !== index) };
    saveProfile(updated);
  };

  const deleteNote = (index) => {
    const updated = { ...profile, notebook: profile.notebook.filter((_, i) => i !== index) };
    saveProfile(updated);
  };

  if (loading) return <p>Loading profile...</p>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Your Profile</h1>

      {/* Personal Info */}
      <div className="mb-6">
        <label className="block mb-1 font-semibold">Name</label>
        <input
          type="text"
          value={profile.name}
          onChange={(e) => saveProfile({ ...profile, name: e.target.value })}
          className="border p-2 rounded w-full mb-2"
        />

        <label className="block mb-1 font-semibold">Journey Start</label>
        <input
          type="text"
          value={profile.journeyStart}
          onChange={(e) => saveProfile({ ...profile, journeyStart: e.target.value })}
          className="border p-2 rounded w-full mb-2"
        />

        <label className="block mb-1 font-semibold">Reason for Using App</label>
        <textarea
          value={profile.reason}
          onChange={(e) => saveProfile({ ...profile, reason: e.target.value })}
          className="border p-2 rounded w-full"
        />
      </div>

      {/* Medications */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Medications</h2>
        {profile.medications.map((med, i) => (
          <div key={i} className="flex justify-between items-center mb-1 border-b pb-1">
            <span>{med.name} ({med.startDate} - {med.endDate})</span>
            <button onClick={() => deleteMedication(i)} className="text-red-500 hover:text-red-700 font-bold px-2">Delete</button>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            placeholder="Name"
            value={newMedication.name}
            onChange={(e) => setNewMedication({ ...newMedication, name: e.target.value })}
            className="border p-2 rounded"
          />
          <input
            type="date"
            value={newMedication.startDate}
            onChange={(e) => setNewMedication({ ...newMedication, startDate: e.target.value })}
            className="border p-2 rounded"
          />
          <input
            type="date"
            value={newMedication.endDate}
            onChange={(e) => setNewMedication({ ...newMedication, endDate: e.target.value })}
            className="border p-2 rounded"
          />
          <button onClick={addMedication} className="bg-primary text-white px-4 py-2 rounded">Add</button>
        </div>
      </div>

      {/* Dermatologists */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Dermatologists</h2>
        {profile.dermatologists.map((doc, i) => (
          <div key={i} className="flex justify-between items-center mb-1 border-b pb-1">
            <span><strong>{doc.name}</strong>: {doc.notes}</span>
            <button onClick={() => deleteDermatologist(i)} className="text-red-500 hover:text-red-700 font-bold px-2">Delete</button>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            placeholder="Name"
            value={newDermatologist.name}
            onChange={(e) => setNewDermatologist({ ...newDermatologist, name: e.target.value })}
            className="border p-2 rounded"
          />
          <input
            placeholder="Notes"
            value={newDermatologist.notes}
            onChange={(e) => setNewDermatologist({ ...newDermatologist, notes: e.target.value })}
            className="border p-2 rounded flex-1"
          />
          <button onClick={addDermatologist} className="bg-primary text-white px-4 py-2 rounded">Add</button>
        </div>
      </div>

      {/* Notebook */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Personal Notes</h2>
        {profile.notebook.map((entry, i) => (
          <div key={i} className="flex justify-between items-start mb-1 border-b pb-1">
            <div>
              <small>{new Date(entry.date).toLocaleDateString()}</small>
              <p>{entry.notes}</p>
            </div>
            <button onClick={() => deleteNote(i)} className="text-red-500 hover:text-red-700 font-bold px-2">Delete</button>
          </div>
        ))}
        <textarea
          placeholder="Write a new note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="border p-2 rounded w-full mb-2"
        />
        <button onClick={addNote} className="bg-primary text-white px-4 py-2 rounded">Add Note</button>
      </div>
    </div>
  );
}


