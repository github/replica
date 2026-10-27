// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import { useMemo } from 'react';
import { Theme } from '~/theme/ThemeContext';
import { useThemeContext } from '~/theme/useThemeContext';
import { Dropdown, Field, Option } from '@coreai-ds/react-components';

interface IDropdownItem {
  key: Theme;
  value: Theme;
  text: string;
}

export function ThemePicker({ className }: { className?: string }): JSX.Element {
  const { savedTheme, setTheme } = useThemeContext();

  const options: IDropdownItem[] = useMemo(
    () => [
      {
        key: 'Light',
        value: 'Light',
        text: 'Light',
      },
      {
        key: 'Dark',
        value: 'Dark',
        text: 'Dark',
      },
      {
        key: 'System',
        value: 'System',
        text: 'System',
      },
    ],
    [],
  );

  return (
    <Field className={className} label="Theme">
      <Dropdown
        appearance="filled-darker"
        onOptionSelect={(_, { optionValue }) => {
          if (optionValue !== undefined) {
            setTheme(optionValue as Theme);
          }
        }}
        selectedOptions={[savedTheme]}
        truncateTextOverflow={false}
        value={savedTheme}
      >
        {options.map((option) => (
          <Option key={option.key} value={option.value}>
            {option.text}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
