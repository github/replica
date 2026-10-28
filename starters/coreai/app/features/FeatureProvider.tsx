// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { createPath, useLocation, useNavigate, type Path } from 'react-router';
import { FeatureContext } from './FeatureContext';
import { FeatureFloatingUI } from './FeatureFloatingUI';
import {
  featureConfig,
  getActiveVariants,
  getApplicableFeatures,
  getFeature,
  getFeaturePath,
  validateVariant,
  withVariants,
} from './featureConfig';

const STORAGE_KEY = 'coreai-prototype-feature-ui-visible';

export function FeatureProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const remembered = useRef<Record<string, string>>({});
  const [featureUIVisible, setVisible] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const applicableFeatures = useMemo(
    () => getApplicableFeatures(location.pathname),
    [location.pathname],
  );
  const activeVariants = useMemo(
    () => getActiveVariants(applicableFeatures, searchParams, remembered.current),
    [applicableFeatures, searchParams],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const visible: unknown = JSON.parse(saved);
        if (typeof visible !== 'boolean')
          throw new Error('Saved selector visibility is not a boolean.');
        setVisible(visible);
      }
    } catch (error) {
      console.warn('Unable to read feature selector visibility.', error);
      setStorageError('The saved selector visibility could not be loaded.');
    }
  }, []);

  useEffect(() => {
    Object.assign(remembered.current, activeVariants);
    const next = withVariants(searchParams, activeVariants);
    if (next.toString() === searchParams.toString()) return;

    const valid = new Set(next.getAll('variant'));
    const supplied = searchParams.getAll('variant');
    if (supplied.some((value) => !valid.has(value)) || new Set(supplied).size !== supplied.length) {
      console.warn('Normalizing invalid, duplicate, or off-route prototype variants.', supplied);
    }
    navigate(
      { pathname: location.pathname, search: next.toString(), hash: location.hash },
      { replace: true, preventScrollReset: true },
    );
  }, [activeVariants, searchParams, location.pathname, location.hash, navigate]);

  const setFeatureUIVisible = useCallback((visible: boolean) => {
    setVisible(visible);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
      setStorageError(null);
    } catch (error) {
      console.warn('Unable to save feature selector visibility.', error);
      setStorageError('Selector visibility changed, but could not be saved.');
    }
  }, []);

  const getFeatureDestination = useCallback(
    (featureId: string, variantId?: string): Path => {
      const feature = getFeature(featureId);
      if (variantId !== undefined) validateVariant(feature, variantId);
      const pathname = getFeaturePath(feature, location.pathname);
      const targetFeatures = getApplicableFeatures(pathname);
      const targetVariants = getActiveVariants(targetFeatures, searchParams, remembered.current);
      if (variantId !== undefined) targetVariants[featureId] = variantId;
      const next = withVariants(searchParams, targetVariants);
      return {
        pathname,
        search: next.toString(),
        hash: pathname === location.pathname ? location.hash : '',
      };
    },
    [location.pathname, location.hash, searchParams],
  );

  const getVariantPath = useCallback(
    (featureId: string, variantId: string) =>
      createPath(getFeatureDestination(featureId, variantId)),
    [getFeatureDestination],
  );

  const navigateToFeature = useCallback(
    (featureId: string, variantId?: string) => {
      const destination = getFeatureDestination(featureId, variantId);
      navigate(destination, { preventScrollReset: destination.pathname === location.pathname });
    },
    [getFeatureDestination, location.pathname, navigate],
  );

  const selectVariant = useCallback(
    (featureId: string, variantId: string) => {
      if (!applicableFeatures.some((feature) => feature.id === featureId)) {
        throw new Error(`Feature "${featureId}" does not apply to this route.`);
      }
      navigateToFeature(featureId, variantId);
    },
    [applicableFeatures, navigateToFeature],
  );

  return (
    <FeatureContext.Provider
      value={{
        allFeatures: featureConfig.features,
        applicableFeatures,
        activeVariants,
        selectVariant,
        getVariantPath,
        navigateToFeature,
        featureUIVisible,
        setFeatureUIVisible,
        storageError,
      }}
    >
      {children}
      {featureUIVisible && applicableFeatures.some((feature) => feature.variants?.length) && (
        <FeatureFloatingUI />
      )}
    </FeatureContext.Provider>
  );
}
