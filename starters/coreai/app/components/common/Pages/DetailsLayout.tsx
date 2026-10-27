// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode, RefObject } from 'react';

import { useState } from 'react';

import { PageBody } from './PageBody';
import { ResponsivePanel } from './ResponsivePanel';
import styles from './PanelLayouts.module.css';

/** Caller-owned content for a labelled details panel. */
export interface PanelDetails {
  title: string;
  content: ReactNode;
  headerActions?: ReactNode;
  /** Details body inset; defaults to default. Use none for edge-to-edge content. */
  padding?: 'default' | 'none';
  width?: number;
}

/** Main content and optional right details; undefined details closes the panel. */
export interface DetailsLayoutProps {
  children: ReactNode;
  details?: PanelDetails;
  onClose: () => void;
  /** Opener to refocus after dismissal. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  contentPadding?: 'default' | 'none';
}

/** Composes a scrolling body and responsive right panel, retaining outgoing content
 * during dismissal animations but not persisting state within drawer subtrees.
 */
export function DetailsLayout({
  children,
  details,
  onClose,
  returnFocusRef,
  contentPadding = 'default',
}: DetailsLayoutProps) {
  const [lastDetails, setLastDetails] = useState(details);
  if (details !== undefined && lastDetails !== details) setLastDetails(details);

  return (
    <div className={styles.layout}>
      <PageBody padding={contentPadding} scrollable>
        {children}
      </PageBody>
      <ResponsivePanel
        title={lastDetails?.title ?? 'Details'}
        position="end"
        open={details !== undefined}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        returnFocusRef={returnFocusRef}
        headerActions={lastDetails?.headerActions}
        padding={lastDetails?.padding}
        width={lastDetails?.width}
      >
        {lastDetails?.content}
      </ResponsivePanel>
    </div>
  );
}
