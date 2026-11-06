process.env.FORCE_COLOR = "3"

if (process.argv.length > 2) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Usage: npm run wizard:design\nOpen the printed loopback URL in a browser and choose Generate all screens and PDF.\nOutputs: infrastructure/.design-gallery/<run>/ (offline gallery, PNGs, transcripts, manifest, annotated PDF).\nNo cloud tools, private configuration, browser automation host, or browser installation required.")
  } else {
    console.error("Unknown arguments. Run npm run wizard:design -- --help.")
    process.exitCode = 1
  }
} else {
  try {
    const { run } = await import("./command.ts")
    await run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Wizard design generation failed.")
    process.exitCode = 1
  }
}
