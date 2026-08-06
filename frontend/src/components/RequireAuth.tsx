import { Navigate, Outlet } from "react-router";
import { useAuth } from "../context/AuthContext";
import { FullPageSpinner } from "./FullPageSpinner";

export function RequireAuth() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

export function RequireAdmin() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  return <Outlet />;
}
