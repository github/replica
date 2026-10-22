// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import { Button } from '@coreai-ds/react-components';
import { ChevronLeft24Regular, ChevronRight24Regular } from '@fluentui/react-icons';
import { clsx } from 'clsx';

import styles from './PaginationControls.module.css';

export interface PaginationControlsProps {
  onPrevClicked: () => void;
  onNextClicked: () => void;
  isPrevDisabled: boolean;
  isNextDisabled: boolean;
  className?: string;
}

export function PaginationControls({
  onPrevClicked,
  onNextClicked,
  isPrevDisabled,
  isNextDisabled,
  className,
}: PaginationControlsProps): JSX.Element {
  return (
    <div className={clsx(styles.paginationControls, className)}>
      <Button
        appearance="subtle"
        aria-label={'Previous page'}
        disabled={isPrevDisabled}
        icon={<ChevronLeft24Regular aria-hidden="true" />}
        onClick={onPrevClicked}
        size="small"
      >
        {'Prev'}
      </Button>
      <Button
        appearance="subtle"
        aria-label={'Next page'}
        disabled={isNextDisabled}
        icon={<ChevronRight24Regular aria-hidden="true" />}
        iconPosition="after"
        onClick={onNextClicked}
        size="small"
      >
        {'Next'}
      </Button>
    </div>
  );
}
