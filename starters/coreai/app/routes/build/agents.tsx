import { Badge, Button } from '@coreai-ds/react-components';
import { TabbedPageLayout } from '~/components/common';

export default function BuildAgents() {
  return (
    <TabbedPageLayout
      headerProps={{
        title: 'Agents',
        titleBadge: (
          <Badge appearance="tint" shape="rounded" size="small">
            Preview
          </Badge>
        ),
        headerActions: (
          <>
            <Button appearance="primary">Create agent</Button>
            <Button>Browse templates</Button>
          </>
        ),
      }}
      tabLinkListProps={{
        'aria-label': 'Agent list navigation',
        links: [
          { label: 'All Agents', to: '/build/agents', end: true },
          { label: 'Drafts', to: '/build/agents/drafts' },
          { label: 'Published', to: '/build/agents/published' },
        ],
      }}
    />
  );
}
