import { useEffect, useState } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { ConfirmInput, MultiSelect, Spinner, TextInput, ThemeProvider } from "@inkjs/ui"

import { CloudPicker } from "../../cloud-picker/index.tsx"
import { SearchSelect } from "../../search-select/index.tsx"
import { FieldPrompt } from "../field/index.tsx"
import { Progress } from "../progress/index.tsx"
import { ScrollPanel } from "../scroll-panel/index.tsx"
import { Elapsed } from "../elapsed/index.tsx"
import { Welcome, welcomeHeights } from "../welcome/index.tsx"
import { terminalColors, terminalTheme } from "../theme/index.ts"
import type { TerminalView } from "../view.ts"

export function TerminalShell({
  view,
  cancel,
  fail,
  edit,
  feedback,
  fullscreen,
  configureOnly,
  started,
}: {
  view: TerminalView
  cancel: () => void
  fail: (error: Error) => void
  edit: (value: string) => void
  feedback: () => void
  fullscreen: boolean
  configureOnly: boolean
  started: number
}) {
  const { stdout } = useStdout()
  const dimensions = () => ({
    columns: "columns" in stdout && typeof stdout.columns === "number" ? stdout.columns : 80,
    rows: "rows" in stdout && typeof stdout.rows === "number" ? stdout.rows : 24,
  })
  const [size, setSize] = useState(dimensions)
  useEffect(() => {
    const resize = () => setSize(dimensions())
    stdout.on("resize", resize)
    return () => {
      stdout.off("resize", resize)
    }
  }, [stdout])
  const { question } = view
  const compact = !fullscreen || size.columns < (configureOnly ? 48 : 78)
  const tiny = fullscreen && size.rows < 10
  const art =
    fullscreen && view.welcome && question !== undefined && size.columns >= 60 && size.rows >= 24
  const expandedArt = size.columns >= 80 && size.rows >= 36
  const headerHeight = tiny ? 0 : art ? welcomeHeights[expandedArt ? "expanded" : "compact"] + 2 : 2
  const activity = fullscreen && size.rows >= 30 ? view.history.slice(-3) : []
  const panelHeight = Math.max(
    1,
    size.rows - headerHeight - 1 - 2 - (activity.length ? activity.length + 2 : 0),
  )
  const optionRows =
    question?.kind === "multi-select"
      ? Math.max(
          1,
          ...question.options.map(({ label }) =>
            Math.ceil(label.length / Math.max(1, size.columns - 8)),
          ),
        )
      : 1
  useInput((input, key) => {
    if (key.ctrl && input === "c") cancel()
    if (question?.kind === "wait" && key.return) question.resolve()
  })
  const main = (
    <Box flexDirection="column">
      {view.notice && (
        <Box marginBottom={1}>
          <Text color={terminalColors[view.notice.level]}>
            {view.notice.level[0]!.toUpperCase() + view.notice.level.slice(1)}:{" "}
            {view.notice.message}
          </Text>
        </Box>
      )}
      {!question && (
        <Spinner label={view.complete ? "Complete" : (view.history.at(-1) ?? "Working...")} />
      )}
      {question?.kind === "cloud" && <CloudPicker onSelect={question.resolve} />}
      {question?.kind === "field" && (
        <FieldPrompt
          key={view.revision}
          field={question.field}
          initialValue={question.initial}
          onSubmit={question.resolve}
          onError={fail}
          onEdit={edit}
          onFeedback={feedback}
        />
      )}
      {question?.kind === "text" && (
        <Box flexDirection="column" key={view.revision}>
          <Text bold>{question.message}</Text>
          <Text dimColor>Edit the value, then press Enter.</Text>
          <TextInput defaultValue={question.initial} onChange={edit} onSubmit={question.resolve} />
        </Box>
      )}
      {question?.kind === "select" && (
        <Box flexDirection="column" key={view.revision}>
          <Text bold>{question.message}</Text>
          <SearchSelect options={question.options} onChange={question.resolve} />
        </Box>
      )}
      {question?.kind === "confirm" && (
        <Box flexDirection="column" key={view.revision}>
          <Text bold>{question.message}</Text>
          <ConfirmInput
            defaultChoice="cancel"
            onConfirm={() => question.resolve(true)}
            onCancel={() => question.resolve(false)}
          />
        </Box>
      )}
      {question?.kind === "multi-select" && (
        <Box flexDirection="column" key={view.revision}>
          <Text bold>{question.message}</Text>
          <Text dimColor>Up/Down moves. Space checks/unchecks. Enter submits checked options.</Text>
          <MultiSelect
            options={question.options}
            defaultValue={question.initial}
            visibleOptionCount={Math.max(
              1,
              Math.min(8, Math.floor((panelHeight - 5) / optionRows)),
            )}
            onSubmit={question.resolve}
          />
        </Box>
      )}
      {question?.kind === "wait" && (
        <Box flexDirection="column">
          <Text color={terminalColors.warning}>Action needed: {question.message}</Text>
          <Text>Press Enter to continue, or Ctrl+C to stop.</Text>
        </Box>
      )}
    </Box>
  )
  return (
    <ThemeProvider theme={terminalTheme}>
      <Box
        flexDirection="column"
        width={size.columns}
        height={fullscreen ? size.rows : undefined}
        paddingX={1}
      >
        {art && <Welcome expanded={expandedArt} />}
        {!tiny && (
          <>
            <Text bold color={terminalColors.accent}>
              {view.removing ? "Replica Hub removal" : "Replica Hub installation"}
            </Text>
            {view.removing ? (
              <Text color={terminalColors.warning}>
                {view.complete ? "Removal complete" : "Remove selected deployments (destructive)"}
              </Text>
            ) : (
              <Progress
                phase={view.phase}
                configureOnly={configureOnly}
                complete={view.complete}
                compact={compact}
                blocked={question?.kind === "wait" || view.notice?.level === "error"}
              />
            )}
          </>
        )}
        <Box marginTop={tiny ? 0 : 1} flexDirection="column" flexGrow={fullscreen ? 1 : 0}>
          {fullscreen ? (
            <ScrollPanel height={panelHeight} revision={view.revision} feedback={view.feedback}>
              {main}
            </ScrollPanel>
          ) : (
            main
          )}
        </Box>
        {activity.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Recent activity</Text>
            {activity.map((line, index) => (
              <Text key={index} dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )}
        <Box justifyContent="space-between">
          <Text dimColor>
            {tiny || (fullscreen && compact)
              ? "PgUp/Dn | Ctrl+C"
              : fullscreen
                ? "PgUp/PgDn scroll. Ctrl+C stops safely."
                : "Ctrl+C stops safely."}
          </Text>
          {!tiny && <Elapsed started={started} animate={fullscreen} />}
        </Box>
      </Box>
    </ThemeProvider>
  )
}
