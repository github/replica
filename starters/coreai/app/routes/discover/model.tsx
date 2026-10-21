// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import type { Route } from './+types/model';

import { BrainCircuitRegular } from '@fluentui/react-icons';

import { PageBody, PageHeader, PageLayout, ResourceNotFound } from '~/components/common';
import { CatalogItemDetails } from './catalog/CatalogItemDetails';
import { models } from '~/data';

export function meta({ params }: Route.MetaArgs) {
  const model = models.find((item) => item.id === params.model);

  return [
    { title: model ? `${model.name} - Model` : 'Model not found' },
    { name: 'description', content: model?.description ?? 'Model details' },
  ];
}

export default function DiscoverModel({ params }: Route.ComponentProps): JSX.Element {
  const model = models.find((item) => item.id === params.model);

  if (!model) {
    return (
      <PageLayout
        header={<PageHeader title="Models" backTo="/discover/models" backLabel="Back to models" />}
      >
        <PageBody>
          <ResourceNotFound
            description="The requested model is not available in this catalog."
            title="Model not found"
          />
        </PageBody>
      </PageLayout>
    );
  }

  return (
    <CatalogItemDetails
      backButtonTarget="/discover/models"
      description={model.description}
      details={[
        { label: 'Provider', value: model.provider },
        { label: 'Category', value: model.category },
        { label: 'Version', value: model.version },
        {
          label: 'Context window',
          value:
            model.contextWindow === 0 ? 'Not applicable' : model.contextWindow.toLocaleString(),
        },
        {
          label: 'Release date',
          value: new Intl.DateTimeFormat('en-US', {
            dateStyle: 'long',
          }).format(new Date(`${model.releaseDate}T00:00:00`)),
        },
        { label: 'Model ID', value: model.id },
      ]}
      icon={<BrainCircuitRegular />}
      isPublished={model.isPublished}
      title={model.name}
    />
  );
}
