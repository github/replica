// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode } from 'react';
import type { To } from 'react-router';

import { Text } from '@coreai-ds/react-components';
import { clsx } from 'clsx';

import { PageBackLink } from './PageBackLink';
import styles from './PageHeader.module.css';

/** Named header regions; callers own actions, banners, and navigation state. */
export interface PageHeaderProps {
  /** Page heading rendered as an h1. */
  title: string;
  /** Caller-rendered status; supply Badge shape explicitly. */
  titleBadge?: ReactNode;
  /** Explicit collection count, including zero; never inferred from content. */
  count?: number;
  description?: ReactNode;
  headerActions?: ReactNode;
  toolbar?: ReactNode;
  navigation?: ReactNode;
  /** Optional router destination for the title-row back link. */
  backTo?: To;
  /** Accessible name for the icon-only back link; defaults to Back. */
  backLabel?: string;
}

/** Renders the page heading, actions, optional content slots, and navigation inset. */
export function PageHeader({
  title,
  titleBadge,
  count,
  description,
  headerActions,
  toolbar,
  navigation,
  backTo,
  backLabel = 'Back',
}: PageHeaderProps) {
  return (
    <header className={clsx(styles.header, navigation != null && styles.withNavigation)}>
      <div className={styles.titleRow}>
        <div className={styles.titleGroup}>
          {backTo !== undefined ? <PageBackLink to={backTo} label={backLabel} /> : null}
          <Text as="h1" preset="heading3" foreground={1} className={styles.title}>
            {title}
            {count === undefined ? null : (
              <Text foreground={3} weight="regular">
                {' '}
                ({count})
              </Text>
            )}
            {titleBadge == null ? null : <span> {titleBadge}</span>}
          </Text>
        </div>
        {headerActions == null ? null : <div className={styles.actions}>{headerActions}</div>}
      </div>
      {description == null ? null : <div className={styles.slot}>{description}</div>}
      {toolbar == null ? null : <div className={styles.slot}>{toolbar}</div>}
      {navigation == null ? null : <div className={styles.navigation}>{navigation}</div>}
    </header>
  );
}
