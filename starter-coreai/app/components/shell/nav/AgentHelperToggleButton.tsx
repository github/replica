// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { bundleIcon, ChatSparkleFilled, ChatSparkleRegular } from '@fluentui/react-icons';
import React from 'react';
import { Button, type ButtonProps } from '@coreai-ds/react-components';

const ChatSparkleIcon = bundleIcon(ChatSparkleFilled, ChatSparkleRegular);

export const AgentHelperToggleButton: React.FC<ButtonProps> = ({ ...props }) => {
  return (
    // should be ToggleButton when functionality is added
    <Button appearance="subtle" icon={<ChatSparkleIcon />} {...props} />
  );
};
