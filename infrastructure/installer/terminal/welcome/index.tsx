import { Box, Text } from "ink"

import { terminalColors } from "../theme/index.ts"

// GitHub silhouette adapted from Primer Octicons' mark-github (MIT; repository LICENSE).
const github = {
  expanded: [
    "       .+**@@@@@#**+.       ",
    "    .+#@@@@@@@@@@@@@@#+.    ",
    "   *@@@@@@@@@@@@@@@@@@@@*   ",
    " .@@@@#  :+++::+++:  #@@@@. ",
    ".@@@@@#              #@@@@@.",
    "*@@@@@.              .@@@@@*",
    "@@@@@*                *@@@@@",
    "@@@@@#                #@@@@@",
    "*@@@@@*.            .*@@@@@*",
    ".@@@**@@*+:     .:+*@@@@@@@.",
    " .@@@: +@#*.     #@@@@@@@@. ",
    "   *@@+.         :@@@@@@*   ",
    "    .+#@@@+      :@@@@*.    ",
    "       .++.       ++.       ",
  ],
  compact: [
    "   :**@@@@*+:   ",
    " :#@*#@@@@#*@#: ",
    ":@@#        @@@:",
    "@@@:        :@@@",
    "@@@+        +@@@",
    ":@#*#+.  .+#@@@:",
    " :#*::    @@@#: ",
    "   :+*    **:   ",
  ],
}

const wordmark = [
  " ____  _____ ____  _     ___ ____    _",
  "|  _ \\| ____|  _ \\| |   |_ _/ ___|  / \\",
  "| |_) |  _| | |_) | |    | | |     / _ \\",
  "|  _ <| |___|  __/| |___ | | |___ / ___ \\",
  "|_| \\_\\_____|_|   |_____|___\\____/_/   \\_\\",
]

export const welcomeHeights = {
  expanded: github.expanded.length,
  compact: github.compact.length,
}

export function Welcome({ expanded }: { expanded: boolean }) {
  return (
    <Box alignItems="center">
      <Text color={terminalColors.info}>
        {github[expanded ? "expanded" : "compact"].join("\n")}
      </Text>
      <Box flexDirection="column" marginLeft={3}>
        <Text bold color={terminalColors.accent}>
          {expanded ? wordmark.join("\n") : "REPLICA"}
        </Text>
        <Box marginTop={1}>
          <Text color={terminalColors.info}>
            {expanded ? "GitHub + REPLICA" : "GitHub + Replica"}
          </Text>
        </Box>
        <Text dimColor>Build. Ship. Repeat.</Text>
      </Box>
    </Box>
  )
}
