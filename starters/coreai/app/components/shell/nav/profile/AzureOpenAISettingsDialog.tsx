// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  InfoLabel,
  InfoLabelProps,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
} from '@coreai-ds/react-components';
import {
  Checkmark16Regular,
  Dismiss16Regular,
  Dismiss24Regular,
  ChatSettingsFilled,
  ChatSettingsRegular,
  bundleIcon,
} from '@fluentui/react-icons';
import { useAzureOpenAISettings, DEFAULT_API_VERSION } from '~/hooks/useAzureOpenAISettings';

const ChatSettingsIcon = bundleIcon(ChatSettingsFilled, ChatSettingsRegular);
import { createAzureOpenAIClient } from '~/core/utils/azureOpenAI';

import styles from './AzureOpenAISettingsDialog.module.css';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface AzureOpenAISettingsDialogProps {
  className?: string;
}

export function AzureOpenAISettingsDialog({
  className,
}: AzureOpenAISettingsDialogProps): JSX.Element {
  const { settings, setSettings, isConfigured } = useAzureOpenAISettings();

  // Local state for form inputs
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [deployment, setDeployment] = useState(settings.deployment);
  const [apiKey, setApiKey] = useState(settings.apiKey);

  // Test connection state
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isDialogOpenRef = useRef(false);
  const testGeneration = useRef(0);
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const dialogTriggerRef = useRef<HTMLButtonElement>(null);

  const cancelTest = useCallback(() => {
    testGeneration.current += 1;
    clearTimeout(testTimeoutRef.current);
    testTimeoutRef.current = undefined;
  }, []);

  const resetTest = useCallback(() => {
    cancelTest();
    setTestStatus('idle');
    setTestError(null);
  }, [cancelTest]);

  const closeDialog = useCallback(() => {
    isDialogOpenRef.current = false;
    resetTest();
    setEndpoint(settings.endpoint);
    setDeployment(settings.deployment);
    setApiKey(settings.apiKey);
    setIsDialogOpen(false);
    dialogTriggerRef.current?.focus();
  }, [resetTest, settings]);

  // Sync local state when settings change (e.g., on mount)
  useEffect(() => {
    resetTest();
    setEndpoint(settings.endpoint);
    setDeployment(settings.deployment);
    setApiKey(settings.apiKey);
  }, [settings, resetTest]);

  const canTest = endpoint.trim() !== '' && deployment.trim() !== '' && apiKey.trim() !== '';

  const runTest = useCallback(async () => {
    if (!isDialogOpenRef.current || !canTest) return;

    cancelTest();
    const generation = testGeneration.current;
    const isCurrentTest = () => isDialogOpenRef.current && generation === testGeneration.current;

    setTestStatus('testing');
    setTestError(null);

    try {
      const { client, deployment: model } = createAzureOpenAIClient({
        endpoint: endpoint.trim(),
        deployment: deployment.trim(),
        apiKey: apiKey.trim(),
        apiVersion: DEFAULT_API_VERSION,
      });

      const completion = await client.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: 'Say "Hello, connection successful!" in exactly those words.',
          },
        ],
        model,
      });

      if (!isCurrentTest()) return;

      const response = completion.choices[0]?.message?.content;
      if (response) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        setTestError('Received empty response from the API');
      }
    } catch (err) {
      if (!isCurrentTest()) return;

      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Unknown error occurred');
    }
  }, [canTest, endpoint, deployment, apiKey, cancelTest]);

  // Auto-test when inputs change (debounced)
  useEffect(() => {
    if (!isDialogOpen || !canTest) return cancelTest;

    // Debounce the auto-test - only run after user stops typing
    testTimeoutRef.current = setTimeout(() => {
      runTest();
    }, 800);

    return cancelTest;
  }, [isDialogOpen, canTest, runTest, cancelTest]);

  const handleTest = useCallback(() => {
    runTest();
  }, [runTest]);

  const handleSave = useCallback(() => {
    setSettings({
      endpoint: endpoint.trim(),
      deployment: deployment.trim(),
      apiKey: apiKey.trim(),
      apiVersion: DEFAULT_API_VERSION,
    });
  }, [endpoint, deployment, apiKey, setSettings]);

  const handleClear = useCallback(() => {
    resetTest();
    setEndpoint('');
    setDeployment('');
    setApiKey('');
    setSettings({
      endpoint: '',
      deployment: '',
      apiKey: '',
      apiVersion: DEFAULT_API_VERSION,
    });
  }, [setSettings, resetTest]);

  return (
    <Dialog
      onOpenChange={(_event, data) => {
        if (data.open) {
          resetTest();
          setEndpoint(settings.endpoint);
          setDeployment(settings.deployment);
          setApiKey(settings.apiKey);
          isDialogOpenRef.current = true;
          setIsDialogOpen(true);
        } else {
          closeDialog();
        }
      }}
      open={isDialogOpen}
    >
      <DialogTrigger disableButtonEnhancement={true}>
        <Button
          appearance="subtle"
          className={className}
          icon={<ChatSettingsIcon aria-hidden={true} />}
          ref={dialogTriggerRef}
          shape="rounded"
        >
          Chat Simulation Settings
        </Button>
      </DialogTrigger>
      <DialogSurface className={styles.dialogSurface}>
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                aria-label="Close"
                icon={<Dismiss24Regular aria-hidden={true} />}
                onClick={closeDialog}
              />
            }
            className={styles.dialogTitle}
          >
            Azure OpenAI Settings
          </DialogTitle>
          <DialogContent className={styles.dialogContent}>
            <Text preset="body" as="p" className={styles.description} foreground={2}>
              Configure your Azure OpenAI connection to enable the chat simulation feature. These
              settings are stored locally in your browser.
            </Text>
            <div className={styles.fieldStack}>
              <div className={styles.statusRow}>
                <div className={styles.statusMessage}>
                  {testStatus === 'testing' ? (
                    <>
                      <Spinner size="extra-tiny" />
                      <Text preset="body" foreground={3}>
                        Testing connection...
                      </Text>
                    </>
                  ) : testStatus === 'success' ? (
                    <>
                      <Checkmark16Regular className={styles.configuredIcon} />
                      <Text preset="body" foreground={3}>
                        Connection test successful
                      </Text>
                    </>
                  ) : testStatus === 'error' ? (
                    <>
                      <Dismiss16Regular className={styles.notConfiguredIcon} />
                      <Text preset="body" foreground={3}>
                        Connection test failed
                      </Text>
                    </>
                  ) : isConfigured ? (
                    <>
                      <Checkmark16Regular className={styles.configuredIcon} />
                      <Text preset="body" foreground={3}>
                        Settings saved (test to verify)
                      </Text>
                    </>
                  ) : (
                    <>
                      <Dismiss16Regular className={styles.notConfiguredIcon} />
                      <Text preset="body" foreground={3}>
                        Azure OpenAI is not configured
                      </Text>
                    </>
                  )}
                </div>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={handleTest}
                  disabled={!canTest || testStatus === 'testing'}
                  className={styles.testButton}
                >
                  Test
                </Button>
              </div>

              {testStatus === 'error' && testError && (
                <MessageBar aria-live="polite" intent="error" role="alert">
                  <MessageBarBody>
                    <Text className={styles.inheritForeground} preset="bodyS">
                      {testError}
                    </Text>
                  </MessageBarBody>
                </MessageBar>
              )}

              <Field
                label={{
                  children: (_Component: unknown, labelProps: InfoLabelProps) => (
                    <InfoLabel
                      {...labelProps}
                      info="The Azure OpenAI endpoint URL (e.g., https://your-resource.openai.azure.com). NOT the model inference endpoint "
                    >
                      Azure OpenAI endpoint
                    </InfoLabel>
                  ),
                }}
              >
                <Input
                  placeholder="https://your-resource.openai.azure.com"
                  value={endpoint}
                  onChange={(_e, data) => {
                    resetTest();
                    setEndpoint(data.value);
                  }}
                />
              </Field>

              <Field
                label={{
                  children: (_Component: unknown, labelProps: InfoLabelProps) => (
                    <InfoLabel
                      {...labelProps}
                      info="The name of your deployed model (e.g., gpt-4o, gpt-4)"
                    >
                      Deployment
                    </InfoLabel>
                  ),
                }}
              >
                <Input
                  placeholder="gpt-4o"
                  value={deployment}
                  onChange={(_e, data) => {
                    resetTest();
                    setDeployment(data.value);
                  }}
                />
              </Field>

              <Field
                label={{
                  children: (_Component: unknown, labelProps: InfoLabelProps) => (
                    <InfoLabel {...labelProps} info="Your Azure OpenAI API key">
                      API Key
                    </InfoLabel>
                  ),
                }}
              >
                <Input
                  type="password"
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(_e, data) => {
                    resetTest();
                    setApiKey(data.value);
                  }}
                />
              </Field>
            </div>
          </DialogContent>
          <div className={styles.divider} />
          <DialogActions className={styles.dialogActions} fluid={true}>
            <Button
              appearance="primary"
              onClick={() => {
                handleSave();
                closeDialog();
              }}
            >
              Save
            </Button>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button appearance="subtle" onClick={handleClear}>
              Clear Settings
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
