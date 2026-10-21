import type { JSX } from 'react';
import type { Route } from './+types/route';

import { Navigate, useLocation } from 'react-router';
import {
  DropdownButton,
  Option,
  Button,
  Menu,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@coreai-ds/react-components';
import { TabbedPageLayout } from '~/components/common';
import { MoreVerticalRegular } from '@fluentui/react-icons';
import { agents } from '~/data';

export function meta({ params }: Route.MetaArgs) {
  const agent = agents.find((a) => a.id === params.agent);
  return [
    { title: agent ? `${agent.name} - Agent` : 'Agent' },
    { name: 'description', content: 'Agent details' },
  ];
}

export default function AgentRoute({ params }: Route.ComponentProps): JSX.Element {
  const location = useLocation();
  const agent = agents.find((a) => a.id === params.agent);

  // If at the exact /:agent route, redirect to playground
  if (location.pathname === `/build/agents/${params.agent}`) {
    return <Navigate to={`/build/agents/${params.agent}/playground`} replace />;
  }

  if (!agent) {
    return <div>Agent not found</div>;
  }

  return (
    <TabbedPageLayout
      tabLinkListProps={{
        'aria-label': 'Agent details navigation',
        links: [
          { label: 'Playground', to: 'playground' },
          { label: 'Traces', to: 'traces' },
          { label: 'Monitor', to: 'monitor' },
          { label: 'Evaluation', to: 'evaluation' },
        ],
      }}
      headerProps={{
        title: agent.name,
        backTo: '/build/agents',
        backLabel: 'Back to agents',
        headerActions: (
          <>
            <DropdownButton
              placeholder="Select version"
              label="Select version"
              // defaultValue="v1"
              size="small"
              onOptionSelect={() => null}
              appearance="subtle"
              aria-label="version"
            >
              <Option value="v1">v1 saved 12/4/2025 3:06 PM</Option>
            </DropdownButton>
            <Button appearance="primary" disabled>
              Save
            </Button>
            <Menu positioning={{ autoSize: true }}>
              <MenuTrigger>
                <MenuButton appearance="secondary" shape="circular">
                  Preview
                </MenuButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuGroup>
                    <MenuGroupHeader>Last saved: 00/00/0000 00:00</MenuGroupHeader>
                    <MenuDivider />
                    <MenuItem>Preview agent</MenuItem>
                    <MenuItem>View sample app code</MenuItem>
                  </MenuGroup>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu positioning={{ autoSize: true }}>
              <MenuTrigger>
                <MenuButton appearance="secondary" shape="circular">
                  Publish
                </MenuButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem>Publish updates</MenuItem>
                  <MenuItem>View details</MenuItem>
                  <MenuDivider />
                  <MenuItem>Publish to Teams &amp; Copilot</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu positioning={{ autoSize: true }}>
              <MenuTrigger>
                <MenuButton
                  appearance="subtle"
                  aria-label="More agent actions"
                  icon={<MoreVerticalRegular aria-hidden={true} />}
                  shape="circular"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem>Delete</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </>
        ),
      }}
    />
  );
}
