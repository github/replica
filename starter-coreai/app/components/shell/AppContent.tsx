// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX, PropsWithChildren } from 'react';
import { ContainerQueryProvider } from '~/components/common';
import { AppThemeProvider } from '~/theme/AppThemeProvider';
import { FeatureProvider } from '~/features/FeatureProvider';

import styles from './AppContent.module.css';

export function AppContent({ children }: PropsWithChildren): JSX.Element {
  return (
    <AppThemeProvider>
      <FeatureProvider>
        <ContainerQueryProvider className={styles.fullscreenContainer}>
          {children}
        </ContainerQueryProvider>
      </FeatureProvider>
    </AppThemeProvider>
  );
}

export default AppContent;
