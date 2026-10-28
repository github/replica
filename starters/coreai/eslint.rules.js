// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const libraryFiles = ['app/components/common/**', 'app/core/**', 'app/features/**'];

const fluentBoundary = {
  group: ['@fluentui/*', '!@fluentui/react-icons'],
  message:
    'Import components from "@coreai-ds/react-components" instead of @fluentui directly. ' +
    'Import app-owned adapters from "~/components/common".',
};

const forbiddenElements = [
  ['button', 'Use <Button> from "@coreai-ds/react-components".'],
  ['input', 'Use <Input> from "@coreai-ds/react-components".'],
  ['textarea', 'Use <Textarea> from "@coreai-ds/react-components".'],
  ['select', 'Use <Dropdown> from "@coreai-ds/react-components".'],
  [
    'a',
    'Use Link for app navigation or ExternalLink for external URLs from "~/components/common".',
  ],
  ['label', 'Use <Field label="..."> or a standalone <Label> from "@coreai-ds/react-components".'],
  [
    'img',
    'Use the react-components skill and published CoreAI documentation to select an image component; use @fluentui/react-icons for Fluent icons.',
  ],
  ['style', 'Write styles in CSS Modules (*.module.css), not <style> tags.'],
  ['h1', 'Use <Text as="h1" block preset="heading1"> from "@coreai-ds/react-components".'],
  ['h2', 'Use <Text as="h2" block preset="heading2"> from "@coreai-ds/react-components".'],
  ['h3', 'Use <Text as="h3" block preset="heading3"> from "@coreai-ds/react-components".'],
  ['h4', 'Use <Text as="h4" block preset="heading4"> from "@coreai-ds/react-components".'],
  ['h5', 'Use <Text as="h5" block preset="heading5"> from "@coreai-ds/react-components".'],
  ['h6', 'Use <Text as="h6" block preset="heading6"> from "@coreai-ds/react-components".'],
  ['p', 'Use <Text as="p" block preset="body"> from "@coreai-ds/react-components".'],
  ['strong', 'Use <Text as="strong" preset="bodyStrong"> from "@coreai-ds/react-components".'],
  ['em', 'Use <Text as="em" italic> from "@coreai-ds/react-components".'],
  ['b', 'Use <Text as="b" preset="bodyStrong"> from "@coreai-ds/react-components".'],
  ['i', 'Use <Text as="i" italic> from "@coreai-ds/react-components".'],
  ['small', 'Use <Text as="small" preset="bodyS"> from "@coreai-ds/react-components".'],
];

export default [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      'no-restricted-imports': ['error', { patterns: [fluentBoundary] }],
    },
  },
  {
    files: ['app/**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['Card', 'Image', 'Link'].map((name) => ({
            name: '@coreai-ds/react-components',
            importNames: [name],
            message:
              name === 'Link'
                ? 'Use Link from "~/components/common" for app navigation or ExternalLink for external URLs.'
                : `Use ${name} from "~/components/common".`,
          })),
          patterns: [fluentBoundary],
        },
      ],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    ignores: libraryFiles,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="style"]',
          message:
            'Use CSS Modules instead of inline styles. For JavaScript-driven values only, use a targeted eslint-disable-next-line no-restricted-syntax with a reason.',
        },
        ...forbiddenElements.map(([element, message]) => ({
          selector: `JSXOpeningElement[name.type="JSXIdentifier"][name.name="${element}"]`,
          message: `${message} Consult the react-components and coreai-ds-fluentui-react skills.`,
        })),
      ],
      'max-lines': ['warn', { max: 1000, skipBlankLines: true, skipComments: true }],
    },
  },
  ...['Card', 'Image', 'Link'].map((adapter) => ({
    files: [`app/components/common/${adapter}/${adapter}.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['Card', 'Image', 'Link']
            .filter((name) => name !== adapter)
            .map((name) => ({
              name: '@coreai-ds/react-components',
              importNames: [name],
              message: `Use ${name} from "~/components/common".`,
            })),
          patterns: [fluentBoundary],
        },
      ],
    },
  })),
];
