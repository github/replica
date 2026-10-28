// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AlertFilled, AlertRegular, bundleIcon } from '@fluentui/react-icons';
import React from 'react';
import { Button, type ButtonProps } from '@coreai-ds/react-components';

const AlertIcon = bundleIcon(AlertFilled, AlertRegular);

export const NotificationButton: React.FC<ButtonProps> = ({ ...props }) => {
  return <Button aria-label="Notifications" appearance="subtle" icon={<AlertIcon aria-hidden={true} />} {...props} />;
};
