import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import { auth } from "./firebase";
import { useEffect, useState } from "react";
import Profile from "./pages/profile";

// Wrapper for protected routes
function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <p className="text-center mt-8">Checking authentication...</p>;

  if (!user) return <Navigate to="/" replace />; // redirect to landing

  return children;
}

function Layout() {
  const location = useLocation();
  const showNavbar = location.pathname !== "/";

  return (
    <>
      {showNavbar && <Navbar />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload"
          element={
            <ProtectedRoute>
              <Upload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}








