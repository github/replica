// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { bundleIcon, EmojiSmileSlightFilled, EmojiSmileSlightRegular } from '@fluentui/react-icons';
import React from 'react';
import { Button, type ButtonProps } from '@coreai-ds/react-components';

const FeedbackIcon = bundleIcon(EmojiSmileSlightFilled, EmojiSmileSlightRegular);

export const FeedbackButton: React.FC<ButtonProps> = ({ ...props }) => {
  return <Button appearance="subtle" icon={<FeedbackIcon aria-hidden={true} />} {...props} />;
};
