// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { generatePath, matchPath } from 'react-router';
import featureData from '../features.json';

export interface FeatureVariant {
  id: string;
  label: string;
}

export interface Feature {
  id: string;
  label: string;
  notes: string;
  defaultRoute: string;
  defaultParams?: Record<string, string>;
  routes: string[];
  variants?: FeatureVariant[];
}

export interface FeatureConfig {
  features: Feature[];
}

export const featureConfig: FeatureConfig = featureData;

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const featureIds = new Set<string>();

for (const feature of featureConfig.features) {
  if (!identifier.test(feature.id) || featureIds.has(feature.id) || !feature.label.trim()) {
    throw new Error(`Invalid or duplicate prototype feature: "${feature.id}".`);
  }
  featureIds.add(feature.id);

  if (
    !feature.routes.length ||
    !feature.routes.includes(feature.defaultRoute) ||
    feature.routes.some(
      (route) => !route.startsWith('/') || route.includes('?') || route.includes('#'),
    )
  ) {
    throw new Error(`Feature "${feature.id}" needs route patterns that include its defaultRoute.`);
  }

  const variantIds = new Set<string>();
  for (const variant of feature.variants ?? []) {
    if (!identifier.test(variant.id) || variantIds.has(variant.id) || !variant.label.trim()) {
      throw new Error(`Invalid or duplicate variant "${variant.id}" in feature "${feature.id}".`);
    }
    variantIds.add(variant.id);
  }

  // Resolve defaults now so the menu cannot navigate to a route with missing parameters.
  generatePath(feature.defaultRoute, feature.defaultParams);
}

export function getApplicableFeatures(pathname: string): Feature[] {
  return featureConfig.features.filter((feature) =>
    feature.routes.some((path) => matchPath({ path, end: true }, pathname)),
  );
}

export function getActiveVariants(
  features: Feature[],
  searchParams: URLSearchParams,
  remembered: Record<string, string>,
): Record<string, string> {
  const selections = new Map<string, string>();
  for (const value of searchParams.getAll('variant')) {
    const parts = value.split('--');
    if (parts.length === 2 && identifier.test(parts[0]) && identifier.test(parts[1])) {
      selections.set(parts[0], parts[1]);
    }
  }
  const active: Record<string, string> = {};

  for (const feature of features) {
    if (!feature.variants?.length) continue;
    const fromUrl = selections.get(feature.id);
    const last = remembered[feature.id];
    active[feature.id] =
      feature.variants.find((variant) => variant.id === fromUrl)?.id ??
      feature.variants.find((variant) => variant.id === last)?.id ??
      feature.variants[0].id;
  }
  return active;
}

export function withVariants(
  current: URLSearchParams,
  activeVariants: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('variant');
  for (const [featureId, variantId] of Object.entries(activeVariants)) {
    next.append('variant', `${featureId}--${variantId}`);
  }
  return next;
}

export function getFeature(featureId: string): Feature {
  const feature = featureConfig.features.find((candidate) => candidate.id === featureId);
  if (!feature) throw new Error(`Unknown prototype feature: "${featureId}".`);
  return feature;
}

export function validateVariant(feature: Feature, variantId: string): void {
  if (!feature.variants?.some((variant) => variant.id === variantId)) {
    throw new Error(`Unknown variant "${variantId}" in feature "${feature.id}".`);
  }
}

export function getFeaturePath(feature: Feature, pathname: string): string {
  if (feature.routes.some((path) => matchPath({ path, end: true }, pathname))) {
    return pathname;
  }
  return generatePath(feature.defaultRoute, feature.defaultParams);
}
