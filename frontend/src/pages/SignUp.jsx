import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { useNavigate, Link } from "react-router-dom";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";


export default function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("patient"); // ✅ NEW
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log("Trying to create account with:", email, password, role);

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      console.log("User created:", userCredential);

      const user = userCredential.user;

      // ✅ Create a user profile doc with role
      const baseUserDoc = {
        email: user.email,
        role, // "patient" | "dermatologist"
        createdAt: serverTimestamp(),
      };

      // Keep your existing photos array for patients (optional)
      // Dermatologists might not need it
      if (role === "patient") {
        baseUserDoc.photos = [];
        baseUserDoc.dermatologists = []; // optional: if you want to store their added derms
      } else {
        baseUserDoc.patients = []; // optional placeholder
      }

      await setDoc(doc(db, "users", user.uid), baseUserDoc);
      console.log("Firestore doc created for:", user.uid);

      alert("Account created! Please login.");
      navigate("/login");
    } catch (err) {
      console.error("Signup error:", err);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Sign Up</h2>

        <form onSubmit={handleSignUp} className="flex flex-col gap-4">
          {/* ✅ NEW: role selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account type
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="border p-2 rounded w-full"
            >
              <option value="patient">Patient</option>
              <option value="dermatologist">Dermatologist</option>
            </select>
          </div>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2 rounded"
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border p-2 rounded"
            required
          />

          <button
            className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="mt-4 text-center text-gray-600">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}



