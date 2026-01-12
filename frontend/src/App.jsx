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
import DermDashboard from "./pages/DermDashboard";
import DermPatient from "./pages/DermPatient.jsx";
import { useUserRole } from "./hooks/fetchUserRole.jsx";

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

function DashboardRouter() {
  const { loading, user, role } = useUserRole();

  if (loading) return <p className="text-center mt-8">Loading dashboard...</p>;
  if (!user) return <Navigate to="/" replace />;

  if (role === "dermatologist") return <Navigate to="/derm" replace />;
  return <Navigate to="/patient" replace />; // default patient
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
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <DashboardRouter />
          </ProtectedRoute>
        }
        />
        <Route
          path="/patient"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/derm"
          element={
            <ProtectedRoute>
              <DermDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/derm/patient/:patientUid"
          element={
            <ProtectedRoute>
              <DermPatient />
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








