// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import type { Route } from './+types/tool';

import { WrenchSettingsRegular } from '@fluentui/react-icons';

import { PageBody, PageHeader, PageLayout, ResourceNotFound } from '~/components/common';
import { CatalogItemDetails } from './catalog/CatalogItemDetails';
import { tools } from '~/data';

export function meta({ params }: Route.MetaArgs) {
  const tool = tools.find((item) => item.id === params.tool);

  return [
    { title: tool ? `${tool.name} - Tool` : 'Tool not found' },
    { name: 'description', content: tool?.description ?? 'Tool details' },
  ];
}

export default function DiscoverTool({ params }: Route.ComponentProps): JSX.Element {
  const tool = tools.find((item) => item.id === params.tool);

  if (!tool) {
    return (
      <PageLayout
        header={<PageHeader title="Tools" backTo="/discover/tools" backLabel="Back to tools" />}
      >
        <PageBody>
          <ResourceNotFound
            description="The requested tool is not available in this catalog."
            title="Tool not found"
          />
        </PageBody>
      </PageLayout>
    );
  }

  return (
    <CatalogItemDetails
      backButtonTarget="/discover/tools"
      description={tool.description}
      details={[
        { label: 'Category', value: tool.category },
        { label: 'Tool ID', value: tool.id },
      ]}
      icon={<WrenchSettingsRegular />}
      isPublished={tool.isPublished}
      title={tool.name}
    />
  );
}
