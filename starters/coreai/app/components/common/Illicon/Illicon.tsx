// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import type { FluentIcon } from '@fluentui/react-icons';
import {
  Agents24Regular,
  ArrowFlowSquareMultiple24Regular,
  Book24Regular,
  BrainCircuit24Regular,
  Code24Regular,
  Cube24Regular,
  Database24Regular,
  ErrorCircle24Regular,
  FlowArrow24Regular,
  LockClosed24Regular,
  Options24Regular,
  Settings24Regular,
  ShieldCheckmark24Regular,
  TaskListSquareLtr24Regular,
} from '@fluentui/react-icons';

export type IlliconName =
  | 'agents'
  | 'azureAI'
  | 'code'
  | 'data'
  | 'error'
  | 'evaluations'
  | 'fineTune'
  | 'guardrails'
  | 'knowledge'
  | 'modelFlows'
  | 'models'
  | 'noAccess'
  | 'tools'
  | 'workflows';

export interface IlliconProps {
  icon?: IlliconName;
  width?: number;
  alt?: string;
  className?: string;
}

function getIcon(icon: IlliconName): FluentIcon {
  switch (icon) {
    case 'agents':
      return Agents24Regular;
    case 'azureAI':
      return BrainCircuit24Regular;
    case 'code':
      return Code24Regular;
    case 'data':
      return Database24Regular;
    case 'error':
      return ErrorCircle24Regular;
    case 'evaluations':
      return TaskListSquareLtr24Regular;
    case 'fineTune':
      return Options24Regular;
    case 'guardrails':
      return ShieldCheckmark24Regular;
    case 'knowledge':
      return Book24Regular;
    case 'modelFlows':
      return FlowArrow24Regular;
    case 'models':
      return Cube24Regular;
    case 'noAccess':
      return LockClosed24Regular;
    case 'tools':
      return Settings24Regular;
    case 'workflows':
      return ArrowFlowSquareMultiple24Regular;
  }
}

/** Illustration icon. */
export function Illicon({
  icon = 'azureAI',
  // width = 24 * 3,
  alt,
  className,
}: IlliconProps): JSX.Element {
  const Icon = getIcon(icon);
  const isDecorative = !alt;

  return (
    <Icon
      aria-hidden={isDecorative}
      aria-label={isDecorative ? undefined : alt}
      className={className}
      role={isDecorative ? undefined : 'img'}
      // style={{ height: width, width }}
    />
  );
}
