// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PageBody, PageHeader, PageLayout, ResourceNotFound } from '~/components/common';

export default function Docs() {
  return (
    <PageLayout header={<PageHeader title="Documentation" />}>
      <PageBody>
        <ResourceNotFound title={'Not Implemented'} description={undefined} />
      </PageBody>
    </PageLayout>
  );
}
