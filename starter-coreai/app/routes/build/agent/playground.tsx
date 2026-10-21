import type { JSX } from 'react';

import { useState, useCallback } from 'react';
import {
  Button,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Dropdown,
  Option,
  Textarea,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Text,
  Tab,
  TabList,
  type AccordionItemProps,
  CodeBlock,
  DropdownButton,
  type TextareaOnChangeData,
} from '@coreai-ds/react-components';
import { ExternalLink, SidebarLayout } from '~/components/common';
import {
  bundleIcon,
  SettingsRegular,
  SettingsFilled,
  SendRegular,
  SendFilled,
  AttachRegular,
  AttachFilled,
  OptionsRegular,
  OptionsFilled,
  ChatAddRegular,
  ChatAddFilled,
} from '@fluentui/react-icons';

import styles from './playground.module.css';
import { useChat } from '~/hooks/useChat';
import { ChatMessages } from './ChatMessages';

const SettingsIcon = bundleIcon(SettingsFilled, SettingsRegular);
const SendIcon = bundleIcon(SendFilled, SendRegular);
const AttachIcon = bundleIcon(AttachFilled, AttachRegular);
const OptionsIcon = bundleIcon(OptionsFilled, OptionsRegular);
const ChatAddIcon = bundleIcon(ChatAddFilled, ChatAddRegular);

export default function AgentPlayground(): JSX.Element {
  const [selectedModel, setSelectedModel] = useState('gpt-4.1-mini');
  const [openSections, setOpenSections] = useState<unknown[]>(['instructions']);
  const [selectedTab, setSelectedTab] = useState<'chat' | 'yaml' | 'code'>('chat');
  const [inputValue, setInputValue] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('python');

  const { messages, isLoading, error, sendMessage, clearMessages } = useChat({
    systemPrompt: systemPrompt || undefined,
  });

  const handleSendMessage = useCallback(() => {
    if (inputValue.trim() && !isLoading) {
      sendMessage(inputValue);
      setInputValue('');
    }
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handleNewChat = useCallback(() => {
    clearMessages();
    setInputValue('');
  }, [clearMessages]);

  return (
    <SidebarLayout
      sidebarTitle="Configuration"
      sidebarPadding="none"
      triggerIcon={<SettingsIcon />}
      contentPadding="none"
      scrollable={false}
      sidebar={
        <>
          {/* Model Selection and Parameters */}
          <div className={styles.parametersSection}>
            <Dropdown
              appearance="filled-darker"
              placeholder="Select model"
              aria-label="Model"
              value={selectedModel}
              selectedOptions={[selectedModel]}
              className={styles.modelDropdown}
              onOptionSelect={(_, data) => {
                if (data.optionValue) setSelectedModel(data.optionValue);
              }}
              truncateTextOverflow={false}
            >
              <Option value="gpt-4.1-mini">gpt-4.1-mini</Option>
              <Option value="gpt-4">gpt-4</Option>
              <Option value="gpt-3.5-turbo">gpt-3.5-turbo</Option>
            </Dropdown>
            <Button
              appearance="subtle"
              icon={<OptionsIcon aria-hidden={true} />}
              aria-label="Parameters"
            />
          </div>

          <Accordion
            multiple
            collapsible
            openItems={openSections}
            onToggle={(_, data) => setOpenSections(data.openItems)}
          >
            {/* Instructions Section */}
            <ConfigurationSection title="Instructions" value="instructions">
              <Textarea
                placeholder="Write your prompt here to give your agent instructions."
                rows={5}
                className={styles.instructionsTextarea}
                resize="vertical"
                value={systemPrompt}
                onChange={(_e: unknown, data: TextareaOnChangeData) => setSystemPrompt(data.value)}
              />
            </ConfigurationSection>

            {/* Tools Section */}
            <ConfigurationSection title="Tools" value="tools">
              <Text preset="bodyS" foreground={2} block className={styles.sectionDescription}>
                Connect tools to your models for faster access to key information and improved
                efficiency.{' '}
                <ExternalLink
                  href="https://aka.ms/foundrytoolbestpractice"
                  rel="noreferrer"
                  target="_blank"
                >
                  Learn more
                </ExternalLink>{' '}
                about best practices. Some tools will require creating an agent.
              </Text>
              <div className={styles.sectionButtonGroup}>
                <Menu positioning={{ autoSize: true }}>
                  <MenuTrigger>
                    <MenuButton appearance="secondary" shape="circular">
                      Add
                    </MenuButton>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem>Azure AI Search</MenuItem>
                      <MenuItem>Bing Search</MenuItem>
                      <MenuItem>Code Interpreter</MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <Button appearance="secondary">Upload files</Button>
              </div>
            </ConfigurationSection>

            {/* Knowledge Section */}
            <ConfigurationSection title="Knowledge" value="knowledge">
              <Text preset="bodyS" foreground={2} block className={styles.sectionDescription}>
                Add knowledge bases for grounding. To use knowledge bases, you'll need to create an
                agent which will automatically use the current model and configuration.
              </Text>
              <Button appearance="secondary">Create an agent</Button>
            </ConfigurationSection>

            {/* Memory Section */}
            <ConfigurationSection title="Memory" value="memory">
              <Text preset="bodyS" foreground={2} block className={styles.sectionDescription}>
                Memory helps your model retain context to personalize and improve interactions. To
                use memory, click Add memory to save your model, prompt, and configuration as an
                agent. A memory-store will be auto-created for you.
              </Text>
              <Button appearance="secondary">Add memory</Button>
            </ConfigurationSection>

            {/* Guardrails Section */}
            <ConfigurationSection title="Guardrails" value="guardrails">
              <Text preset="bodyS" foreground={2} block className={styles.sectionDescription}>
                Add safety and security controls to your guardrail to help reduce risks and support
                deployments.{' '}
                <ExternalLink
                  href="https://aka.ms/GuardrailsLearnMore"
                  rel="noreferrer"
                  target="_blank"
                >
                  Learn more
                </ExternalLink>
              </Text>
              <Text preset="body" foreground={2} block className={styles.sectionDescription}>
                <Text preset="bodyS" foreground={1} block>
                  Name:&nbsp;&nbsp;
                  <Text preset="bodyS" foreground={2} as="span">
                    Microsoft.DefaultV2
                  </Text>
                </Text>
                <Text preset="bodyS" foreground={1} block>
                  Risks with controls:&nbsp;&nbsp;
                  <Text preset="bodyS" foreground={2} as="span">
                    Jailbreak (1), Content safety (4), Protected materials (2)
                  </Text>
                </Text>
                <Text preset="bodyS" foreground={1} block>
                  Risks without controls:&nbsp;&nbsp;
                  <Text preset="bodyS" foreground={2} as="span">
                    Indirect prompt injections, Sensitive data leakage, Task drift
                  </Text>
                </Text>
              </Text>
              <Menu positioning={{ autoSize: true }}>
                <MenuTrigger>
                  <MenuButton appearance="secondary" shape="circular">
                    Manage guardrail
                  </MenuButton>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem>Edit guardrail</MenuItem>
                    <MenuItem>Remove guardrail</MenuItem>
                    <MenuItem>View details</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </ConfigurationSection>
          </Accordion>
        </>
      }
    >
      {(sidebarTrigger) => (
        <div className={styles.rightPanel}>
          <div className={styles.content}>
            {/* Top Bar with Tabs and Actions */}
            <div className={styles.topBar}>
              <div className={styles.tabsContainer}>
                {sidebarTrigger}
                <TabList
                  appearance="elevated"
                  aria-label="Playground view"
                  selectedValue={selectedTab}
                  onTabSelect={(_event, data) => {
                    setSelectedTab(data.value as 'chat' | 'yaml' | 'code');
                  }}
                  size="medium"
                >
                  <Tab id="chat-tab" value="chat">
                    Chat
                  </Tab>
                  <Tab id="yaml-tab" value="yaml">
                    YAML
                  </Tab>
                  <Tab id="code-tab" value="code">
                    Code
                  </Tab>
                </TabList>
              </div>
              <div className={styles.topBarActions}>
                <Menu positioning={{ autoSize: true }}>
                  <MenuTrigger>
                    <MenuButton appearance="subtle" shape="circular" size="small">
                      Metrics
                    </MenuButton>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem>Metrics</MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
                <Button
                  appearance="subtle"
                  icon={<ChatAddIcon aria-hidden={true} />}
                  aria-label="New chat"
                  onClick={handleNewChat}
                />
              </div>
            </div>

            {/* Tab Content */}
            <div
              className={styles.tabContent}
              role="tabpanel"
              aria-labelledby={`${selectedTab}-tab`}
            >
              {selectedTab === 'chat' && (
                <div className={styles.chatContainer}>
                  {/* Chat Messages Area */}
                  <ChatMessages
                    messages={messages}
                    isLoading={isLoading}
                    error={error}
                    className={styles.chatMessages}
                  />

                  {/* Input Container */}
                  <div className={styles.inputContainer}>
                    <div className={styles.inputWrapper}>
                      <Textarea
                        placeholder="Message the agent..."
                        className={styles.inputTextarea}
                        resize="vertical"
                        rows={1}
                        value={inputValue}
                        onChange={(_e: unknown, data: TextareaOnChangeData) =>
                          setInputValue(data.value)
                        }
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                      />
                      <div className={styles.inputActions}>
                        <Button
                          appearance="subtle"
                          icon={<AttachIcon aria-hidden={true} />}
                          aria-label="Attach files"
                        />
                        <Button
                          appearance="subtle"
                          icon={<SendIcon aria-hidden={true} />}
                          aria-label="Send"
                          onClick={handleSendMessage}
                          disabled={isLoading || !inputValue.trim()}
                        />
                      </div>
                    </div>
                    <Text preset="bodyS" foreground={3} className={styles.disclaimer}>
                      AI-generated content may be incorrect
                    </Text>
                  </div>
                </div>
              )}

              {selectedTab === 'yaml' && (
                <div className={styles.codeContainer}>
                  <CodeBlock
                    className={styles.codeBlock}
                    code={yamlExample}
                    header={
                      <DropdownButton
                        appearance="subtle"
                        aria-label="Code language"
                        label="Code language"
                        selectedOptions={['yaml']}
                        value="YAML"
                      >
                        <Option value="yaml">YAML</Option>
                      </DropdownButton>
                    }
                    language="yaml"
                  />
                </div>
              )}

              {selectedTab === 'code' && (
                <div className={styles.codeContainer}>
                  <CodeBlock
                    className={styles.codeBlock}
                    code={pythonExample}
                    header={
                      <DropdownButton
                        appearance="subtle"
                        aria-label="Code language"
                        label="Code language"
                        onOptionSelect={(_, data) => {
                          if (data.optionValue) {
                            setCodeLanguage(data.optionValue);
                          }
                        }}
                        selectedOptions={[codeLanguage]}
                        value={languageNames[codeLanguage]}
                      >
                        {Object.entries(languageNames).map(([value, name]) => (
                          <Option key={value} value={value}>
                            {name}
                          </Option>
                        ))}
                      </DropdownButton>
                    }
                    language={codeLanguage}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}

const languageNames: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  csharp: 'C#',
};

type ConfigurationSectionProps = {
  title: React.ReactNode;
  value: AccordionItemProps['value'];
  children: React.ReactNode;
};

function ConfigurationSection({ title, value, children }: ConfigurationSectionProps): JSX.Element {
  return (
    <AccordionItem value={value} className={styles.accordion}>
      <AccordionHeader
        expandIconPosition="end"
        button={{ className: styles.accordionHeaderButton }}
      >
        {title}
      </AccordionHeader>
      <AccordionPanel className={styles.accordionPanel}>{children}</AccordionPanel>
    </AccordionItem>
  );
}

const yamlExample = `metadata:
  logo: Avatar_Default.svg
object: agent.version
id: Tool-test-1:1
name: Tool-test-1
version: "1"
description: ""
created_at: 1762540905
definition:
  kind: prompt
  model: gpt-4o
  instructions: ""
`;

const pythonExample = `# Before running the sample:
#    pip install --pre azure-ai-projects>=2.0.0b1
#    pip install azure-identity

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

myEndpoint = "https://user-resource.services.ai.azure.com/api/projects/user-00"

project_client = AIProjectClient(
    endpoint=myEndpoint,
    credential=DefaultAzureCredential(),
)

myAgent = "Tool-test-1"
# Get an existing agent
agent = project_client.agents.get(agent_name=myAgent)
print(f"Retrieved agent: {agent.name}")

openai_client = project_client.get_openai_client()

# Reference the agent to get a response
response = openai_client.responses.create(
    input=[{"role": "user", "content": "Tell me what you can help with."}],
    extra_body={"agent": {"name": agent.name, "type": "agent_reference"}},
)

print(f"Response output: {response.output_text}")
`;
