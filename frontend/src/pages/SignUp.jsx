import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { useNavigate, Link } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";


export default function SignUp() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSignUp = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            console.log("Trying to create account with:", email, password);

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            console.log("User created:", userCredential);

            const user = userCredential.user;

            await setDoc(doc(db, "users", user.uid), { photos: [] });
            console.log("Firestore doc created for:", user.uid);

            alert("Account created! Please login.");
            navigate("/login");
        } catch (err) {
            console.error("Signup error:", err);
            alert(err.message);
        }
        setLoading(false);
    };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Sign Up</h2>
        <form onSubmit={handleSignUp} className="flex flex-col gap-4">
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



