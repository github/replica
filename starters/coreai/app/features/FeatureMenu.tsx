// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Fragment } from 'react';
import {
  InteractionTag,
  InteractionTagPrimary,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
} from '@coreai-ds/react-components';
import packageMetadata from '../../package.json';
import { useFeatureConfig } from './FeatureContext';
import styles from './FeatureMenu.module.css';

export function FeatureMenu() {
  const {
    allFeatures,
    activeVariants,
    featureUIVisible,
    setFeatureUIVisible,
    navigateToFeature,
    storageError,
  } = useFeatureConfig();
  const checkedValues = Object.fromEntries(
    Object.entries(activeVariants).map(([featureId, variantId]) => [featureId, [variantId]]),
  );
  checkedValues['__selector-visibility'] = featureUIVisible ? ['visible'] : [];

  return (
    <Menu checkedValues={checkedValues} positioning={{ autoSize: true }}>
      <InteractionTag appearance="brand" size="extra-small">
        <MenuTrigger disableButtonEnhancement>
          <InteractionTagPrimary aria-label="Prototype features">Prototype</InteractionTagPrimary>
        </MenuTrigger>
      </InteractionTag>
      <MenuPopover className={styles.menu}>
        <MenuList>
          <MenuGroupHeader>Prototype Features</MenuGroupHeader>
          <MenuDivider />
          {allFeatures.length === 0 && (
            <MenuItem disabled>No prototype features are linked.</MenuItem>
          )}
          {allFeatures.map((feature, index) => (
            <Fragment key={feature.id}>
              {index > 0 && <MenuDivider />}
              {feature.variants?.length ? (
                <MenuGroup>
                  <MenuGroupHeader>{feature.label}</MenuGroupHeader>
                  {feature.variants.map((variant) => (
                    <MenuItemRadio
                      key={variant.id}
                      name={feature.id}
                      value={variant.id}
                      onClick={() => navigateToFeature(feature.id, variant.id)}
                    >
                      {variant.label}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
              ) : (
                <MenuItem onClick={() => navigateToFeature(feature.id)}>{feature.label}</MenuItem>
              )}
            </Fragment>
          ))}
          <MenuDivider />
          <MenuItemCheckbox
            name="__selector-visibility"
            value="visible"
            onClick={() => setFeatureUIVisible(!featureUIVisible)}
          >
            Show feature selector
          </MenuItemCheckbox>
        </MenuList>
        <div className={styles.footer}>
          {storageError && (
            <Text preset="bodyS" foreground={2} role="status">
              {storageError}
            </Text>
          )}
          <Text preset="bodyXS" foreground={3}>
            CoreAI Sandbox v{packageMetadata.version}
          </Text>
        </div>
      </MenuPopover>
    </Menu>
  );
}
