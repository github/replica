import { Navigate, Outlet, useLocation } from 'react-router';

export default function Build() {
  const location = useLocation();

  // If at the exact /build route, redirect to /build/agents
  if (location.pathname === '/build') {
    return <Navigate to="/build/agents" replace />;
  }

  return <Outlet />;
}
