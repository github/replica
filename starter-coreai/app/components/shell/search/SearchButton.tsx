// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { bundleIcon, SearchFilled, SearchRegular } from '@fluentui/react-icons';
import React from 'react';
import { Button, type ButtonProps } from '@coreai-ds/react-components';

const SearchIcon = bundleIcon(SearchFilled, SearchRegular);

export const SearchButton: React.FC<ButtonProps> = ({ ...props }) => {
  return <Button appearance="subtle" icon={<SearchIcon aria-hidden={true} />} {...props} />;
};
