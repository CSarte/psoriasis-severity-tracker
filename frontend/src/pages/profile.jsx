import { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";

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
    linkedDerms: [],
  });

  const [newMedication, setNewMedication] = useState({ name: "", startDate: "", endDate: "" });
  const [newDermatologist, setNewDermatologist] = useState({ name: "", notes: "" });
  const [newNote, setNewNote] = useState("");

  // Linking state
  const [dermCode, setDermCode] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [linking, setLinking] = useState(false);

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
        setProfile((prev) => ({ ...prev, ...docSnap.data() }));
      }

      setLoading(false);
    };

    fetchProfile();
  }, [uid, navigate]);

  const saveProfile = async (updatedProfile) => {
    const docRef = doc(db, "users", uid, "profile", "mainDoc");
    await setDoc(docRef, { ...updatedProfile, updatedAt: serverTimestamp() }, { merge: true });
    setProfile(updatedProfile);
  };

  // ── Add / Delete helpers ────────────────────────────────────────────────

  const addMedication = () => {
    if (!newMedication.name) return;
    saveProfile({ ...profile, medications: [...profile.medications, newMedication] });
    setNewMedication({ name: "", startDate: "", endDate: "" });
  };

  const addDermatologist = () => {
    if (!newDermatologist.name) return;
    saveProfile({ ...profile, dermatologists: [...profile.dermatologists, newDermatologist] });
    setNewDermatologist({ name: "", notes: "" });
  };

  const addNote = () => {
    if (!newNote) return;
    saveProfile({
      ...profile,
      notebook: [...profile.notebook, { date: new Date().toISOString(), notes: newNote }],
    });
    setNewNote("");
  };

  const deleteMedication = (index) => {
    saveProfile({ ...profile, medications: profile.medications.filter((_, i) => i !== index) });
  };

  const deleteDermatologist = (index) => {
    saveProfile({ ...profile, dermatologists: profile.dermatologists.filter((_, i) => i !== index) });
  };

  const deleteNote = (index) => {
    saveProfile({ ...profile, notebook: profile.notebook.filter((_, i) => i !== index) });
  };

  // ── Link dermatologist by code ──────────────────────────────────────────

  const linkDermatologistByCode = async (e) => {
    e.preventDefault();
    setLinkMsg("");

    const patientUid = auth.currentUser?.uid;
    if (!patientUid) { setLinkMsg("You must be logged in."); return; }

    const code = dermCode.trim().toUpperCase();
    if (!code) { setLinkMsg("Enter a code."); return; }

    setLinking(true);

    try {
      // 1. Lookup code → dermUid
      const codeSnap = await getDoc(doc(db, "dermCodes", code));
      if (!codeSnap.exists()) throw new Error("That dermatologist code doesn't exist.");

      const { dermUid } = codeSnap.data();
      if (!dermUid) throw new Error("Invalid code. Ask your dermatologist for a new code.");

      // 2. Check for existing link (active or disconnected)
      const existing = (profile.linkedDerms || []).find((x) => x?.dermUid === dermUid);

      if (existing?.status === "active") {
        setLinkMsg("You are already linked to this dermatologist.");
        setDermCode("");
        setLinking(false);
        return;
      }

      // 3. Create / restore the access grant under the patient
      await setDoc(doc(db, "users", patientUid, "dermAccess", dermUid), {
        dermUid,
        code,
        status: "active",
        createdAt: serverTimestamp(),
      });

      // 4. Mirror doc so dermatologist can list patients
      await setDoc(doc(db, "dermatologists", dermUid, "patients", patientUid), {
        patientUid,
        status: "active",
        createdAt: serverTimestamp(),
      });

      // 5. Update linkedDerms: re-activate existing or add new
      let updatedLinked;
      if (existing) {
        // Re-activate a previously disconnected link
        updatedLinked = (profile.linkedDerms || []).map((x) =>
          x?.dermUid === dermUid
            ? { ...x, status: "active", linkedAt: new Date().toISOString(), disconnectedAt: x.disconnectedAt }
            : x
        );
      } else {
        // Brand-new link
        updatedLinked = [
          ...(profile.linkedDerms || []),
          { dermUid, code, status: "active", linkedAt: new Date().toISOString() },
        ];
      }

      await saveProfile({ ...profile, linkedDerms: updatedLinked });
      setLinkMsg(existing ? "Re-linked! Your dermatologist can view your data again." : "Linked! Your dermatologist can now view your photo log.");
      setDermCode("");
    } catch (err) {
      console.error(err);
      setLinkMsg(err.message || "Failed to link dermatologist.");
    } finally {
      setLinking(false);
    }
  };

  // ── Unlink dermatologist (keeps history) ────────────────────────────────

  const unlinkDermatologist = async (dermUid) => {
    setLinkMsg("");
    const patientUid = auth.currentUser?.uid;
    if (!patientUid) return;

    try {
      // Revoke access
      await deleteDoc(doc(db, "users", patientUid, "dermAccess", dermUid)).catch(() => {});
      await deleteDoc(doc(db, "dermatologists", dermUid, "patients", patientUid)).catch(() => {});

      // Mark as disconnected in history (don't remove)
      const updatedLinked = (profile.linkedDerms || []).map((x) =>
        x?.dermUid === dermUid
          ? { ...x, status: "disconnected", disconnectedAt: new Date().toISOString() }
          : x
      );

      await saveProfile({ ...profile, linkedDerms: updatedLinked });
      setLinkMsg("Dermatologist unlinked. The connection history is preserved below.");
    } catch (err) {
      console.error(err);
      setLinkMsg(err.message || "Failed to unlink dermatologist.");
    }
  };

  if (loading) return <p>Loading profile...</p>;

  // Split links into active and disconnected for display
  const activeLinks = (profile.linkedDerms || []).filter((x) => x?.status === "active");
  const disconnectedLinks = (profile.linkedDerms || []).filter(
    (x) => x?.status === "disconnected"
  );
  // Backward compat: entries without status are treated as active
  const legacyLinks = (profile.linkedDerms || []).filter((x) => !x?.status);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Your Profile</h1>

      {/* ── Personal Info ──────────────────────────────────────────────── */}
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

      {/* ── Medications ────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Medications</h2>
        {profile.medications.map((med, i) => (
          <div key={i} className="flex justify-between items-center mb-1 border-b pb-1">
            <span>{med.name} ({med.startDate} - {med.endDate})</span>
            <button onClick={() => deleteMedication(i)} className="text-red-500 hover:text-red-700 font-bold px-2">
              Delete
            </button>
          </div>
        ))}
        <div className="flex gap-2 mt-2 flex-wrap">
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
          <button onClick={addMedication} className="bg-blue-600 text-white px-4 py-2 rounded">
            Add
          </button>
        </div>
      </div>

      {/* ── Dermatologists (manual history) ────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Dermatologists (History)</h2>
        <p className="text-sm text-gray-600 mb-2">Your personal tracking list of past/current dermatologists.</p>

        {profile.dermatologists.map((docItem, i) => (
          <div key={i} className="flex justify-between items-center mb-1 border-b pb-1">
            <span><strong>{docItem.name}</strong>: {docItem.notes}</span>
            <button onClick={() => deleteDermatologist(i)} className="text-red-500 hover:text-red-700 font-bold px-2">
              Delete
            </button>
          </div>
        ))}

        <div className="flex gap-2 mt-2 flex-wrap">
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
            className="border p-2 rounded flex-1 min-w-[200px]"
          />
          <button onClick={addDermatologist} className="bg-blue-600 text-white px-4 py-2 rounded">
            Add
          </button>
        </div>
      </div>

      {/* ── Linked Dermatologist Accounts ───────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Linked Dermatologist Account</h2>
        <p className="text-sm text-gray-600">
          Linking lets a dermatologist view your photo log in their dashboard.
        </p>

        <form onSubmit={linkDermatologistByCode} className="flex gap-2 mt-3 flex-wrap">
          <input
            value={dermCode}
            onChange={(e) => setDermCode(e.target.value)}
            placeholder="Enter dermatologist code (e.g., DERM-7KQ2P9)"
            className="border rounded p-2 flex-1 font-mono min-w-[240px]"
          />
          <button
            disabled={linking}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
          >
            {linking ? "Linking..." : "Link"}
          </button>
        </form>

        {linkMsg && <p className="mt-2 text-sm">{linkMsg}</p>}

        {/* Active connections */}
        <div className="mt-4">
          {[...activeLinks, ...legacyLinks].length === 0 && disconnectedLinks.length === 0 && (
            <p className="text-gray-500 text-sm">No linked dermatologist accounts yet.</p>
          )}

          {[...activeLinks, ...legacyLinks].map((x) => (
            <div
              key={x.dermUid}
              className="flex items-center justify-between border-b py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{x.code}</span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    Active
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Linked on {x.linkedAt ? new Date(x.linkedAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <button
                onClick={() => unlinkDermatologist(x.dermUid)}
                className="text-red-500 hover:text-red-700 font-bold px-2 text-sm"
              >
                Unlink
              </button>
            </div>
          ))}

          {/* Disconnected history */}
          {disconnectedLinks.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">
                Connection History
              </p>
              {disconnectedLinks.map((x) => (
                <div
                  key={x.dermUid}
                  className="flex items-center justify-between border-b py-3 opacity-60"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{x.code}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                        Disconnected
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Linked: {x.linkedAt ? new Date(x.linkedAt).toLocaleDateString() : "—"}
                      {x.disconnectedAt && (
                        <> · Disconnected: {new Date(x.disconnectedAt).toLocaleDateString()}</>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Notebook ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Personal Notes</h2>
        {profile.notebook.map((entry, i) => (
          <div key={i} className="flex justify-between items-start mb-1 border-b pb-1">
            <div>
              <small>{new Date(entry.date).toLocaleDateString()}</small>
              <p>{entry.notes}</p>
            </div>
            <button onClick={() => deleteNote(i)} className="text-red-500 hover:text-red-700 font-bold px-2">
              Delete
            </button>
          </div>
        ))}
        <textarea
          placeholder="Write a new note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="border p-2 rounded w-full mb-2"
        />
        <button onClick={addNote} className="bg-blue-600 text-white px-4 py-2 rounded">
          Add Note
        </button>
      </div>
    </div>
  );
}
