process.stdout.write(
  JSON.stringify({
    considered: 3,
    labeled: 2,
    remaining: 1,
    usage: { requests: 2, nanoAiu: 1250000 },
  }),
)
process.stderr.write("error (unauthorized): Copilot refused the credential.\n")
process.exitCode = 1
