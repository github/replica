// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createContext, useContext } from 'react';
import type { Feature } from './featureConfig';

interface FeatureContextValue {
  allFeatures: Feature[];
  applicableFeatures: Feature[];
  activeVariants: Record<string, string>;
  selectVariant: (featureId: string, variantId: string) => void;
  getVariantPath: (featureId: string, variantId: string) => string;
  navigateToFeature: (featureId: string, variantId?: string) => void;
  featureUIVisible: boolean;
  setFeatureUIVisible: (visible: boolean) => void;
  storageError: string | null;
}

export const FeatureContext = createContext<FeatureContextValue | undefined>(undefined);

export function useFeatureConfig(): FeatureContextValue {
  const context = useContext(FeatureContext);
  if (!context) throw new Error('Feature controls must be inside FeatureProvider.');
  return context;
}

/** Returns the active variant, true for an applicable feature without variants, or null off-route. */
export function useFeature(featureId: string): string | true | null {
  const { applicableFeatures, activeVariants } = useFeatureConfig();
  const feature = applicableFeatures.find((candidate) => candidate.id === featureId);
  if (!feature) return null;
  return feature.variants?.length ? activeVariants[feature.id] : true;
}
