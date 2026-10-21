// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import appRules from './eslint.rules.js';

export default tseslint.config(
  { ignores: ['build/**', '.react-router/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  { files: ['*.{js,ts}'], languageOptions: { globals: globals.node } },
  { files: ['app/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['app/**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  ...appRules,
);
