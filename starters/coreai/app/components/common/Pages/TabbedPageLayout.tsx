// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { PageHeaderProps } from './PageHeader';
import type { TabLinkListProps } from '../TabLinkList/TabLinkList';

import { Outlet } from 'react-router';

import { TabLinkList } from '../TabLinkList/TabLinkList';
import { PageHeader } from './PageHeader';
import { PageLayout } from './PageLayout';

/** Header, linked tabs, and optional context for nested route content. */
export interface TabbedPageLayoutProps {
  headerProps: Omit<PageHeaderProps, 'navigation'>;
  tabLinkListProps: TabLinkListProps;
  outletContext?: unknown;
}

/** Composes a fixed header with route-driven tabs and a pane-scrolling outlet.
 * Child routes supply a scrollable PageBody or a layout that owns its scrolling.
 */
export function TabbedPageLayout({
  headerProps,
  tabLinkListProps,
  outletContext,
}: TabbedPageLayoutProps) {
  return (
    <PageLayout
      header={<PageHeader {...headerProps} navigation={<TabLinkList {...tabLinkListProps} />} />}
      scrollMode="panes"
    >
      <Outlet context={outletContext} />
    </PageLayout>
  );
}
