// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IlliconProps } from '../Illicon/Illicon';
import type { JSX, PropsWithChildren, ReactNode } from 'react';

import { Button, Popover, PopoverSurface, PopoverTrigger, Text } from '@coreai-ds/react-components';
import { Info20Regular } from '@fluentui/react-icons';
import { clsx } from 'clsx';
import { Illicon } from '../Illicon/Illicon';

import styles from './ResourceNotFound.module.css';

export type ResourceNotFoundProps = PropsWithChildren<{
  /** The illustration icon to use. */
  illicon?: IlliconProps['icon'];
  title: string;
  description: ReactNode;
  /**
   * The heading level to use for the title. Defaults to "h2".
   */
  headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  className?: string;
  contentClassName?: string;
  topContent?: ReactNode;
  /**
   * Optional info content to display in a Popover below the description
   */
  infoContent?: ReactNode;
  /**
   * Optional accessible label for the info button
   */
  infoButtonLabel?: string;
}>;

export function ResourceNotFound({
  illicon,
  title,
  description,
  children,
  headingLevel = 'h2',
  className,
  contentClassName,
  topContent,
  infoContent,
  infoButtonLabel,
}: ResourceNotFoundProps): JSX.Element {
  return (
    <div className={clsx(styles.container, className)} data-testid="resource-not-found-container">
      <div className={clsx(styles.content, contentClassName)}>
        <Illicon icon={illicon} />
        {topContent ?? null}
        <Text foreground={1} as={headingLevel} className={styles.title} preset="heading3">
          {title}
        </Text>
        <div>
          <Text foreground={2} className={styles.description} preset="body">
            {description}
          </Text>
          {infoContent == null ? null : (
            <Popover trapFocus={true} withArrow={true}>
              <PopoverTrigger disableButtonEnhancement={true}>
                <Button
                  appearance="subtle"
                  aria-label={infoButtonLabel}
                  className={styles.popoverButton}
                  icon={<Info20Regular aria-hidden="true" />}
                  size="small"
                />
              </PopoverTrigger>
              <PopoverSurface>{infoContent}</PopoverSurface>
            </Popover>
          )}
        </div>
        {children == null ? null : <div className={styles.actions}>{children}</div>}
      </div>
    </div>
  );
}
