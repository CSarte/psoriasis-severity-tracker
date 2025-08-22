import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth } from "../firebase";

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <p className="text-center mt-8">Checking authentication...</p>;

  if (!user) return <Navigate to="/login" replace />;

  return children;
}