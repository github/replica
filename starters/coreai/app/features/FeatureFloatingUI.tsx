// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Button, Text } from '@coreai-ds/react-components';
import { ReOrderDotsVerticalRegular } from '@fluentui/react-icons';
import { clsx } from 'clsx';
import { TabLinkList } from '~/components/common';
import { useFeatureConfig } from './FeatureContext';
import { useFloatingPosition } from './useFloatingPosition';
import styles from './FeatureFloatingUI.module.css';

export function FeatureFloatingUI() {
  const { applicableFeatures, getVariantPath } = useFeatureConfig();
  const { ref, style, dragging, storageError, dragProps } = useFloatingPosition();

  return (
    <div
      ref={ref}
      className={styles.floating}
      style={style}
      role="region"
      aria-label="Prototype feature variants"
    >
      <div className={styles.bar}>
        <Button
          {...dragProps}
          appearance="transparent"
          shape="rounded"
          size="small"
          className={clsx(styles.dragHandle, dragging && styles.dragging)}
          aria-label="Move feature selector"
          title="Drag to move. Arrow keys move the selector; Home resets its position."
          icon={<ReOrderDotsVerticalRegular />}
        />
        <div className={styles.features}>
          {applicableFeatures.map((feature) =>
            feature.variants?.length ? (
              <div key={feature.id} className={styles.feature}>
                <Text preset="bodySStrong" foreground={2}>
                  {feature.label}
                </Text>
                <TabLinkList
                  aria-label={feature.label}
                  appearance="elevated"
                  size="small"
                  preventScrollReset
                  alignContent={false}
                  className={styles.variants}
                  links={feature.variants.map((variant) => ({
                    to: getVariantPath(feature.id, variant.id),
                    label: variant.label,
                    end: true,
                  }))}
                />
              </div>
            ) : null,
          )}
        </div>
      </div>
      {storageError && (
        <Text preset="bodyS" foreground={2} role="status">
          {storageError}
        </Text>
      )}
    </div>
  );
}
