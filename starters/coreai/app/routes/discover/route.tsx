// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Navigate, Outlet, useLocation } from 'react-router';

export default function Discover() {
  const location = useLocation();

  // If at the exact /discover route, redirect to /discover/tools
  if (location.pathname === '/discover') {
    return <Navigate to="/discover/tools" replace />;
  }

  return <Outlet />;
}
