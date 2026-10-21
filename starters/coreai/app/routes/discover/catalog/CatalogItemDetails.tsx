// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX, ReactNode } from 'react';

import { Badge, Text } from '@coreai-ds/react-components';

import { PageBody, PageHeader, PageLayout } from '~/components/common';

import styles from './CatalogItemDetails.module.css';

export interface CatalogItemDetail {
  label: string;
  value: ReactNode;
}

interface CatalogItemDetailsProps {
  backButtonTarget: string;
  description: string;
  details: CatalogItemDetail[];
  icon: JSX.Element;
  isPublished: boolean;
  title: string;
}

export function CatalogItemDetails({
  backButtonTarget,
  description,
  details,
  icon,
  isPublished,
  title,
}: CatalogItemDetailsProps): JSX.Element {
  return (
    <PageLayout
      header={
        <PageHeader
          backTo={backButtonTarget}
          backLabel="Back to catalog"
          title={title}
          titleBadge={
            <Badge
              appearance="tint"
              color={isPublished ? 'success' : 'informative'}
              shape="rounded"
            >
              {isPublished ? 'Published' : 'Draft'}
            </Badge>
          }
        />
      }
    >
      <PageBody className={styles.content}>
        <div className={styles.summary}>
          {icon}
          <Text as="p" block className={styles.description} foreground={2} preset="body">
            {description}
          </Text>
        </div>
        <dl className={styles.details}>
          {details.map((detail) => (
            <div className={styles.detail} key={detail.label}>
              <dt>
                <Text foreground={3} preset="bodyS">
                  {detail.label}
                </Text>
              </dt>
              <dd>
                <Text block foreground={1} preset="bodyStrong">
                  {detail.value}
                </Text>
              </dd>
            </div>
          ))}
        </dl>
      </PageBody>
    </PageLayout>
  );
}
