// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Navigate, Outlet, useLocation } from 'react-router';

export default function Operate() {
  const location = useLocation();

  // If at the exact /operate route, redirect to /operate/dashboard
  if (location.pathname === '/operate') {
    return <Navigate to="/operate/dashboard" replace />;
  }

  return <Outlet />;
}
