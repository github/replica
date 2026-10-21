// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX, Key, ReactNode } from 'react';

import { Text } from '@coreai-ds/react-components';
import { clsx } from 'clsx';

import styles from './DetailsList.module.css';

interface DetailsListProps {
  items: {
    key?: Key;
    label: string | ReactNode;
    value: string | ReactNode;
  }[];
  className?: string;
  itemClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
}

export function DetailsList({
  items,
  className,
  itemClassName,
  labelClassName,
  valueClassName,
}: DetailsListProps): JSX.Element {
  return (
    <dl className={clsx(styles.detailsList, className)}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className={itemClassName}>
          <dt className={styles.label}>
            <Text
              foreground={1}
              className={labelClassName}
              data-testid="details-label"
              preset="bodySStrong"
            >
              {item.label}
            </Text>
          </dt>
          <dd className={styles.value}>
            <Text
              preset="body"
              foreground={2}
              className={valueClassName}
              data-testid="details-value"
            >
              {item.value}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}
