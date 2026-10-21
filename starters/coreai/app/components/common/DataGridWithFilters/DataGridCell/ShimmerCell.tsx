// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import { Skeleton, SkeletonItem } from '@coreai-ds/react-components';

import styles from './ShimmerCell.module.css';

export function ShimmerCell(): JSX.Element {
  return (
    <Skeleton
      animation="wave"
      appearance="translucent"
      aria-busy={true}
      aria-hidden="true"
      className={styles.skeleton}
      data-testid="data-grid-shimmer-cell"
    >
      <SkeletonItem />
    </Skeleton>
  );
}
