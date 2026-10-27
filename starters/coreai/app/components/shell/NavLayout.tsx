// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import clsx from 'clsx';
import styles from './NavLayout.module.css';
import type { JSX, PropsWithChildren } from 'react';
import { Outlet, useLocation } from 'react-router';
import { TopNav } from './nav/TopNav';
import { LeftNav } from './nav/LeftNav';

function NavLayoutContent({ children }: PropsWithChildren): JSX.Element {
  const location = useLocation();
  // Add data attribute for route-specific styling (case-insensitive)
  const isDiscoverPage = /\/discover(?:\/|$)/i.test(location.pathname);
  const isHomePage = location.pathname === '/';
  const isDocsPage = /\/docs(?:\/|$)/i.test(location.pathname);

  // const showRightPanel = rightPanelContext.rightPanelId !== null;

  return (
    <div
      className={styles.layout}
      data-discover-page={isDiscoverPage || undefined}
      data-docs-page={isDocsPage || undefined}
      data-home-page={isHomePage || undefined}
    >
      <TopNav />
      <div className={styles.content}>
        <LeftNav className={styles.leftNav} />
        <main
          className={clsx(
            styles.main,
            // showRightPanel ? styles.mainInMiddle : null,
          )}
        >
          {children}
        </main>
        {/* {showRightPanel ? (
            <RightPanel className={styles.rightPanel} />
          ) : null} */}
      </div>
      {/* {showFooter ? <Footer /> : null} */}
    </div>
  );
}

export default function NavLayout(): JSX.Element {
  return (
    <NavLayoutContent>
      <Outlet />
    </NavLayoutContent>
  );
}

// export function ErrorBoundary({ error }: IShellErrorProps): JSX.Element {
//   return (
//     <NavLayoutContent>
//       <ShellError canLeaveFeedback={true} error={error} />
//     </NavLayoutContent>
//   );
// }
