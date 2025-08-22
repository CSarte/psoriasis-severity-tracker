// Navbar.jsx
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../firebase";

export default function Navbar() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      navigate("/"); // send user back to landing
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  return (
    <nav className="bg-primary text-white flex justify-between items-center px-6 py-4">
      <div className="text-xl font-bold">
        <Link to="/">Psoriasis App</Link>
      </div>
      <div className="flex gap-4 items-center">
        <Link
          to="/dashboard"
          className="bg-transparent text-white px-4 py-2 rounded border border-transparent hover:border-white transition"
        >
          Dashboard
        </Link>
        <Link
          to="/upload"
          className="bg-transparent text-white px-4 py-2 rounded border border-transparent hover:border-white transition"
        >
          Upload
        </Link>
         <Link
          to="/profile"
          className= "bg-transparent text-white px-4 py-2 rounded border border-transparent hover:border-white transition"
        >
          Profile
        </Link>
        <button
          onClick={handleSignOut}
          className="bg-white-500 hover:bg-red-600 text-white px-4 py-2 rounded"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
}
