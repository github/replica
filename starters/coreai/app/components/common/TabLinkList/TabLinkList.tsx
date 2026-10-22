// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { TabListProps as CoreAITabListProps } from '@coreai-ds/react-components';
import type { JSX, MouseEventHandler } from 'react';

import { TabList } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { useLocation } from 'react-router';

import { isLinkSelected, TabLink } from '../TabLink/TabLink';

import styles from './TabLinkList.module.css';

export interface TabLinkListProps extends Omit<
  CoreAITabListProps,
  'children' | 'onTabSelect' | 'selectedValue'
> {
  'aria-label': string;
  alignContent?: boolean;
  preventScrollReset?: boolean;
  className?: string;
  links: {
    label: string;
    to: string;
    hidden?: boolean;
    end?: boolean;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }[];
}

export function TabLinkList({
  alignContent = true,
  preventScrollReset = false,
  className,
  links,
  ...rest
}: TabLinkListProps): JSX.Element {
  const location = useLocation();
  const visibleLinks = links.filter((link) => !link.hidden);
  const selectedValue = visibleLinks.find((link) =>
    isLinkSelected(link.to, link.end, location.pathname, location.search),
  )?.to;

  return (
    <TabList
      className={clsx(styles.tabList, alignContent && styles.alignContent, className)}
      selectedValue={selectedValue}
      size="small"
      {...rest}
    >
      {visibleLinks.map((link) => (
        <TabLink
          key={link.to}
          end={link.end}
          to={link.to}
          preventScrollReset={preventScrollReset}
          onClick={link.onClick}
        >
          {link.label}
        </TabLink>
      ))}
    </TabList>
  );
}
