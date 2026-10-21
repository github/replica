// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState, useCallback, useEffect, useMemo } from 'react';

const STORAGE_KEY = 'azure-openai-settings';
const SETTINGS_EVENT = 'azure-openai-settings-change';

export const DEFAULT_API_VERSION = '2025-04-01-preview';

export interface AzureOpenAISettings {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}

const DEFAULT_SETTINGS: AzureOpenAISettings = {
  endpoint: '',
  deployment: '',
  apiKey: '',
  apiVersion: DEFAULT_API_VERSION,
};

function loadSettings(): AzureOpenAISettings {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Stored Azure OpenAI settings must be an object.');
      }
      const settings = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AzureOpenAISettings)[]) {
        if (!(key in parsed)) continue;
        const value: unknown = Reflect.get(parsed, key);
        if (typeof value !== 'string') {
          throw new Error(`Stored Azure OpenAI setting "${key}" must be a string.`);
        }
        settings[key] = value;
      }
      return settings;
    }
  } catch (error: unknown) {
    console.warn('Failed to load Azure OpenAI settings; using defaults:', error);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: AzureOpenAISettings): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  // Dispatch custom event so other hook instances in the same tab know about the change
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

function clearStoredSettings(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: DEFAULT_SETTINGS }));
}

export interface UseAzureOpenAISettingsReturn {
  settings: AzureOpenAISettings;
  setSettings: (settings: AzureOpenAISettings) => void;
  clearSettings: () => void;
  isConfigured: boolean;
}

export function useAzureOpenAISettings(): UseAzureOpenAISettingsReturn {
  const [settings, setSettingsState] = useState<AzureOpenAISettings>(loadSettings);

  // Re-sync with localStorage on mount (for SSR hydration)
  useEffect(() => {
    setSettingsState(loadSettings());
  }, []);

  // Listen for settings changes from other hook instances
  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent<AzureOpenAISettings>;
      setSettingsState(customEvent.detail);
    };

    window.addEventListener(SETTINGS_EVENT, handleSettingsChange);
    return () => window.removeEventListener(SETTINGS_EVENT, handleSettingsChange);
  }, []);

  const setSettings = useCallback((newSettings: AzureOpenAISettings) => {
    setSettingsState(newSettings);
    saveSettings(newSettings);
  }, []);

  const clearSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    clearStoredSettings();
  }, []);

  const isConfigured = useMemo(
    () =>
      settings.endpoint.trim() !== '' &&
      settings.deployment.trim() !== '' &&
      settings.apiKey.trim() !== '' &&
      settings.apiVersion.trim() !== '',
    [settings],
  );

  return {
    settings,
    setSettings,
    clearSettings,
    isConfigured,
  };
}
