// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PageBody, PageHeader, PageLayout, ResourceNotFound } from '~/components/common';

export default function OperateDashboard() {
  return (
    <PageLayout header={<PageHeader title="Dashboard" />}>
      <PageBody>
        <ResourceNotFound title={'Not Implemented'} description={undefined} />
      </PageBody>
    </PageLayout>
  );
}
