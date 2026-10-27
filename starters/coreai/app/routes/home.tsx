// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState } from 'react';

import type { DataGridProps, TableColumnDefinition } from '@coreai-ds/react-components';
import {
  Button,
  CardHeader,
  Carousel,
  CarouselButton,
  CarouselCard,
  CarouselSlider,
  CarouselViewport,
  CopyButton,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Field,
  Input,
  Tab,
  TabList,
  Text,
  createTableColumn,
} from '@coreai-ds/react-components';
import type { IlliconProps } from '~/components/common';
import {
  Card,
  DiscordIcon,
  GitHubIcon,
  Illicon,
  Link,
  PaginationControls,
} from '~/components/common';
import type { HomeModelActionIcon, RecentWorkItem } from '~/data';
import { useHomeData } from '~/hooks/useHomeData';
import {
  AgentsFilled,
  AgentsRegular,
  BookFilled,
  BookRegular,
  ChartMultipleFilled,
  ChartMultipleRegular,
  ChatFilled,
  ChatRegular,
  CodeFilled,
  CodeRegular,
  CubeFilled,
  CubeRegular,
  bundleIcon,
} from '@fluentui/react-icons';
import { clsx } from 'clsx';

import styles from './home.module.css';

type WorkFilter = 'all' | 'agents' | 'models';

const BoxIcon = bundleIcon(AgentsFilled, AgentsRegular);
const DocsIcon = bundleIcon(BookFilled, BookRegular);
const ChatIcon = bundleIcon(ChatFilled, ChatRegular);
const CodeIcon = bundleIcon(CodeFilled, CodeRegular);
const CompareIcon = bundleIcon(ChartMultipleFilled, ChartMultipleRegular);
const ModelIcon = bundleIcon(CubeFilled, CubeRegular);
const RECENT_WORK_PAGE_SIZE = 10;

const modelActionIcons: Record<HomeModelActionIcon, React.ReactNode> = {
  chat: <ChatIcon />,
  compare: <CompareIcon />,
  model: <ModelIcon />,
};

export default function Home() {
  const { data: homeData } = useHomeData();
  const [workFilter, setWorkFilter] = useState<WorkFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortState, setSortState] = useState<NonNullable<DataGridProps['sortState']>>({
    sortColumn: 'lastViewed',
    sortDirection: 'descending',
  });
  const endpoints = homeData?.endpoints ?? [];
  const modelActions = homeData?.modelActions ?? [];
  const models = homeData?.models ?? [];
  const recentWork = homeData?.recentWork ?? [];
  const filteredWork = recentWork.filter(
    (item) => workFilter === 'all' || item.type.toLowerCase() === workFilter.slice(0, -1),
  );
  const sortColumn = recentWorkColumns.find((column) => column.columnId === sortState.sortColumn);
  const sortedWork = [...filteredWork].sort((first, second) => {
    const direction = sortState.sortDirection === 'ascending' ? 1 : -1;
    return sortColumn ? sortColumn.compare(first, second) * direction : 0;
  });
  const totalPages = Math.max(1, Math.ceil(filteredWork.length / RECENT_WORK_PAGE_SIZE));
  const pageStartIndex = (currentPage - 1) * RECENT_WORK_PAGE_SIZE;
  const paginatedWork = sortedWork.slice(pageStartIndex, pageStartIndex + RECENT_WORK_PAGE_SIZE);
  const rangeStart = filteredWork.length === 0 ? 0 : pageStartIndex + 1;
  const rangeEnd = Math.min(pageStartIndex + RECENT_WORK_PAGE_SIZE, filteredWork.length);

  return (
    <main className={styles.main}>
      {/* Hero Section */}
      <div className={styles.hero}>
        <Text as="h1" className={styles.header} preset="heading2">
          <span className={styles.headerPrimary}>CoreAI DS Sandbox</span>
          <span className={styles.headerSpacer}>{' / '}</span>
          <span className={styles.headerTagline}>Alpha</span>
        </Text>

        <section aria-label="Get started" className={styles.getStarted}>
          <div className={styles.bentoGrid}>
            <StartTile
              action={
                <Button appearance="primary" className={styles.startButton}>
                  View deployments
                </Button>
              }
              className={styles.useModelTile}
              description="Manage your existing endpoints or deploy a new model."
              icon={<ModelIcon />}
              illicon="models"
              title="Use a model"
            />
            <StartTile
              action={<Button className={styles.startButton}>Start building</Button>}
              description="Create an AI agent by configuring instructions, tools, and knowledge without writing code."
              icon={<BoxIcon />}
              illicon="agents"
              title="Build an agent"
            />
            <StartTile
              action={<Button className={styles.startButton}>Start coding</Button>}
              description="Define and deploy an agent in code using Microsoft Agent Framework for full control and customization."
              icon={<CodeIcon />}
              illicon="code"
              title="Code an agent"
            />
          </div>

          <div className={styles.credentials}>
            <div className={styles.credentialFields}>
              {endpoints.map((endpoint) => (
                <Field
                  className={styles.credentialField}
                  key={endpoint.label}
                  label={endpoint.label}
                >
                  <Input
                    className={styles.endpointInput}
                    contentAfter={
                      <CopyButton
                        aria-label={`Copy ${endpoint.label}`}
                        contentToCopy={endpoint.value}
                        size="small"
                      />
                    }
                    readOnly={true}
                    truncateTextOverflow={true}
                    value={endpoint.value}
                  />
                </Field>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Announcements Section */}
      <section aria-labelledby="model-selection-heading" className={styles.announcementsContainer}>
        <div className={styles.announcementsHeader}>
          <Text as="h2" foreground={1} id="model-selection-heading" preset="heading4">
            Model selection
          </Text>
        </div>

        <div className={styles.modelActions}>
          {modelActions.map((action) => (
            <Card appearance="filled" key={action.title} size="large" type="button">
              <CardHeader
                description={
                  <Text foreground={3} preset="bodyS">
                    {action.description}
                  </Text>
                }
                header={
                  <Text foreground={1} preset="heading4">
                    {action.title}
                  </Text>
                }
                image={<span className={styles.actionIcon}>{modelActionIcons[action.icon]}</span>}
              />
            </Card>
          ))}
        </div>

        <Carousel align="start" className={styles.modelCarousel} groupSize="auto">
          <div className={styles.modelCarouselRow}>
            <CarouselButton
              aria-label="Previous models"
              className={styles.modelArrow}
              navType="prev"
            />
            <div className={styles.modelViewportWrapper}>
              <CarouselViewport className={styles.modelViewport}>
                <CarouselSlider cardFocus={true} className={styles.modelList}>
                  {models.map((model) => (
                    <CarouselCard autoSize={true} key={model.name} className={styles.carouselCard}>
                      <Card appearance="subtle" className={styles.modelItem} type="button">
                        <CardHeader
                          header={
                            <Text foreground={1} preset="heading5" truncate block>
                              {model.name}
                            </Text>
                          }
                          description={
                            <Text foreground={3} preset="bodyS" truncate block>
                              {model.publisher}
                            </Text>
                          }
                          image={
                            <span
                              className={styles.modelIcon}
                              // eslint-disable-next-line no-restricted-syntax -- color comes from model data
                              style={{ color: model.initialsColor }}
                            >
                              {model.mark}
                            </span>
                          }
                        />
                      </Card>
                    </CarouselCard>
                  ))}
                </CarouselSlider>
              </CarouselViewport>
            </div>
            <CarouselButton aria-label="Next models" className={styles.modelArrow} navType="next" />
          </div>
        </Carousel>
      </section>

      {/* Recent Resources Section */}
      <section aria-labelledby="recent-work-heading" className={styles.recentResourcesContainer}>
        <div className={styles.recentResourcesHeaderRow}>
          <Text as="h2" foreground={1} id="recent-work-heading" preset="heading4">
            Recent work
          </Text>
        </div>
        <TabList
          appearance="subtle-circular"
          aria-label="Filter recent work"
          onTabSelect={(_event, data) => {
            setWorkFilter(data.value as WorkFilter);
            setCurrentPage(1);
          }}
          selectedValue={workFilter}
          size="small"
        >
          {workFilters.map((filter) => (
            <Tab key={filter.value} value={filter.value}>
              {filter.label}
            </Tab>
          ))}
        </TabList>
        <div className={styles.tableFrame}>
          <DataGrid
            aria-label="Recent work"
            className={styles.dataGrid}
            columns={recentWorkColumns}
            columnFlexOptions={{
              name: {
                flexBasis: 0,
                flexGrow: 1,
                flexShrink: 1,
                minWidth: '20ch',
              },
              version: {
                flexBasis: 0,
                flexGrow: 1,
                flexShrink: 1,
                minWidth: '20ch',
              },
              type: { flexBasis: 100, flexGrow: 0, flexShrink: 0 },
              lastViewed: {
                flexBasis: 0,
                flexGrow: 0.5,
                flexShrink: 1,
                minWidth: '10ch',
              },
              endpoint: { flexBasis: 120, flexGrow: 0, flexShrink: 0 },
            }}
            focusMode="composite"
            getRowId={(item) => item.name}
            items={paginatedWork}
            noNativeElements={true}
            onSortChange={(_event, nextSortState) => {
              setSortState(nextSortState);
              setCurrentPage(1);
            }}
            size="small"
            sortable={true}
            sortState={sortState}
          >
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell }) => (
                  <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody<RecentWorkItem>>
              {({ item, rowId }) => (
                <DataGridRow<RecentWorkItem> key={rowId}>
                  {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        </div>
        <div className={styles.pagination}>
          <Text foreground={3} preset="bodyS">
            {rangeStart}-{rangeEnd} of {filteredWork.length}
          </Text>
          <PaginationControls
            isNextDisabled={currentPage >= totalPages}
            isPrevDisabled={currentPage <= 1}
            onNextClicked={() => {
              setCurrentPage((page) => Math.min(totalPages, page + 1));
            }}
            onPrevClicked={() => {
              setCurrentPage((page) => Math.max(1, page - 1));
            }}
          />
        </div>
      </section>

      <section aria-labelledby="resources-heading" className={styles.exploreMoreContainer}>
        <Text as="h2" foreground={1} id="resources-heading" preset="heading4" block>
          Learning and resources
        </Text>
        <div className={styles.resources}>
          <ResourceCard
            description="Explore our detailed docs for all the info you need."
            icon={<DocsIcon />}
            title="Docs"
          />
          <ResourceCard
            description="Get the latest SDK updates and code samples on GitHub."
            icon={<GitHubIcon aria-hidden={true} />}
            title="GitHub"
          />
          <ResourceCard
            description="Have questions? Join and connect with our Discord community."
            icon={<DiscordIcon />}
            title="Discord"
          />
        </div>
      </section>
    </main>
  );
}

function StartTile({ title, description, action, icon, className, illicon }: StartTileProps) {
  return (
    <div className={clsx(styles.startTile, className)}>
      <span className={styles.startIcon}>{icon}</span>
      <span className={styles.startText}>
        <Text as="h2" foreground={1} preset="heading3" block>
          {title}
        </Text>
        <Text as="p" foreground={3} preset="body" block>
          {description}
        </Text>
      </span>
      {action}
      <Illicon className={styles.startIllicon} icon={illicon} />
    </div>
  );
}

interface StartTileProps {
  title: string;
  description: string;
  action: React.ReactNode;
  icon: React.ReactNode;
  className?: string;
  illicon: IlliconProps['icon'];
}

function ResourceCard({ icon, title, description }: ResourceCardProps) {
  return (
    <Card appearance="subtle" className={styles.resourceCard} type="button">
      <div className={styles.resourceCardContent}>
        <span className={styles.resourceIcon}>{icon}</span>
        <Text foreground={1} preset="bodyStrong" block>
          {title}
        </Text>
        <Text className={styles.resourceDescription} foreground={3} preset="bodyS" block>
          {description}
        </Text>
      </div>
    </Card>
  );
}

interface ResourceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

const workFilters: Array<{ label: string; value: WorkFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Agents', value: 'agents' },
  { label: 'Models', value: 'models' },
];

const recentWorkColumns: TableColumnDefinition<RecentWorkItem>[] = [
  createTableColumn<RecentWorkItem>({
    columnId: 'name',
    compare: (first, second) => first.name.localeCompare(second.name),
    renderHeaderCell: () => 'Name',
    renderCell: (item) => <Link to={''}>{item.name}</Link>,
  }),
  createTableColumn<RecentWorkItem>({
    columnId: 'version',
    compare: (first, second) => first.version.localeCompare(second.version),
    renderHeaderCell: () => 'Version',
    renderCell: (item) => item.version,
  }),
  createTableColumn<RecentWorkItem>({
    columnId: 'type',
    compare: (first, second) => first.type.localeCompare(second.type),
    renderHeaderCell: () => 'Type',
    renderCell: (item) => item.type,
  }),
  createTableColumn<RecentWorkItem>({
    columnId: 'lastViewed',
    compare: (first, second) => Date.parse(first.lastViewed) - Date.parse(second.lastViewed),
    renderHeaderCell: () => 'Last viewed',
    renderCell: (item) => item.lastViewed,
  }),
  createTableColumn<RecentWorkItem>({
    columnId: 'endpoint',
    compare: (first, second) => first.name.localeCompare(second.name),
    renderHeaderCell: () => 'Endpoint',
    renderCell: () => (
      <Button appearance="outline" shape="circular" size="small">
        View endpoint
      </Button>
    ),
  }),
];
