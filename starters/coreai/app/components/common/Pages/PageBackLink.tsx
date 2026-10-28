// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { To } from 'react-router';

import { LinkButton } from '@coreai-ds/react-components';
import { useHref, useLinkClickHandler } from 'react-router';
import { ArrowLeftFilled, ArrowLeftRegular, bundleIcon } from '@fluentui/react-icons';

import styles from './PageHeader.module.css';

const BackIcon = bundleIcon(ArrowLeftFilled, ArrowLeftRegular);

export function PageBackLink({ to, label }: { to: To; label: string }) {
  const href = useHref(to);
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to);

  return (
    <LinkButton
      appearance="subtle"
      className={styles.linkButton}
      aria-label={label}
      title={label}
      icon={<BackIcon />}
      href={href}
      onClick={onClick}
    />
  );
}
