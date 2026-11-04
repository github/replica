import { MarkGithubIcon, OrganizationIcon } from "@primer/octicons-react"
import { Button, Hero, Text } from "@primer/react-brand"
import { useEffect, useId, useState } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubToast } from "@components/hub-toast"
import { ReplicaLogo } from "@components/replica-logo"
import type { HubResolvedColorMode } from "@hooks/use-hub-theme"

import { AsciiGradient } from "./ascii-gradient"
import type { HomeIndexPageData } from "./types"

import "./styles.css"

const HOME_COLOR_THEMES = {
  dark: {
    backgroundColor: "#000000",
    controlBorderColor: "#5fed83",
    controlColor: "#ffffff",
    palettes: [
      { pixelColor: "#258b48", highlightColor: "#47b966" },
      { pixelColor: "#0d6731", highlightColor: "#8cf2a6" },
      { pixelColor: "#0377ff", highlightColor: "#80ccff" },
      { pixelColor: "#8534f3", highlightColor: "#c898fd" },
      { pixelColor: "#0e4a2e", highlightColor: "#bfffd1" },
    ],
  },
  light: {
    backgroundColor: "#f2f5f3",
    controlBorderColor: "#0d6731",
    controlColor: "#0d3024",
    palettes: [
      { pixelColor: "#08872b", highlightColor: "#5fed83" },
      { pixelColor: "#0d6731", highlightColor: "#8cf2a6" },
      { pixelColor: "#0377ff", highlightColor: "#80ccff" },
      { pixelColor: "#8534f3", highlightColor: "#c898fd" },
      { pixelColor: "#0d3024", highlightColor: "#8cf2a6" },
    ],
  },
} as const

export function HomeIndexPage({
  colorMode,
  data,
  enableAnimation = true,
}: {
  colorMode: HubResolvedColorMode
  data: HomeIndexPageData
  enableAnimation?: boolean
}) {
  const colorTheme = HOME_COLOR_THEMES[colorMode]
  const initialPalette = colorTheme.palettes[0]
  const headingId = useId()
  const signInFormPrefix = useId()
  const [paused, setPaused] = useState(false)
  const [eyebrowAnimated, setEyebrowAnimated] = useState(true)
  const [eyebrowSequence, setEyebrowSequence] = useState(0)
  const eyebrowText = eyebrowSequence % 2 === 0 ? data.badge : data.badgeAlternate
  const previousEyebrowText =
    eyebrowSequence === 0 ? undefined : eyebrowSequence % 2 === 0 ? data.badgeAlternate : data.badge

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let timer: number | undefined

    function updatePlayback() {
      window.clearInterval(timer)
      timer = undefined
      const enabled = enableAnimation && !paused && !reducedMotion.matches && !document.hidden
      setEyebrowAnimated(enabled)
      if (enabled) {
        timer = window.setInterval(() => setEyebrowSequence((sequence) => sequence + 1), 6000)
      }
    }

    updatePlayback()
    reducedMotion.addEventListener("change", updatePlayback)
    document.addEventListener("visibilitychange", updatePlayback)

    return () => {
      window.clearInterval(timer)
      reducedMotion.removeEventListener("change", updatePlayback)
      document.removeEventListener("visibilitychange", updatePlayback)
    }
  }, [enableAnimation, paused])

  return (
    <main className="home">
      <div className="home__content">
        <header className="home__header">
          <ReplicaLogo />
        </header>

        <div className="home__body">
          <div className="home__composition">
            <Hero
              variant="gridline"
              align="start"
              enableAnimation={enableAnimation}
              className="home__hero"
              aria-labelledby={headingId}
            >
              <Hero.Label
                animate={enableAnimation}
                animationDelay={eyebrowSequence === 0 ? 1000 : 0}
                initialText={previousEyebrowText}
                className="home__eyebrow"
              >
                {eyebrowAnimated ? eyebrowText : <span>{eyebrowText}</span>}
              </Hero.Label>

              <Hero.Heading id={headingId} size="2" className="home__heading">
                {data.heading}
              </Hero.Heading>

              <Hero.Description className="home__description">{data.description}</Hero.Description>

              {data.alert ? (
                <div className="home__alert">
                  <HubAlert title={data.alert} variant="warning" layout="compact" />
                </div>
              ) : null}

              {data.notice ? <HubToast title={data.notice} /> : null}

              {data.signInActions.map((action) => (
                <form
                  action={action.path}
                  method="post"
                  id={`${signInFormPrefix}-${action.provider}`}
                  key={action.provider}
                >
                  <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                </form>
              ))}

              <Hero.ButtonGroup className="home__actions">
                {data.signInActions.map((action) => {
                  const SignInIcon =
                    action.provider === "github" ? MarkGithubIcon : OrganizationIcon
                  return (
                    <Button
                      type="submit"
                      variant="primary"
                      leadingVisual={<SignInIcon />}
                      form={`${signInFormPrefix}-${action.provider}`}
                      key={action.provider}
                    >
                      {action.label}
                    </Button>
                  )
                })}
              </Hero.ButtonGroup>
            </Hero>
          </div>
        </div>

        <footer className="home__footer">
          <Text as="p" className="home__footer-note">
            {data.footerNote}
          </Text>
        </footer>
      </div>

      <AsciiGradient
        backgroundColor={colorTheme.backgroundColor}
        className="home__art"
        controlBorderColor={colorTheme.controlBorderColor}
        controlColor={colorTheme.controlColor}
        highlightColor={initialPalette.highlightColor}
        palettes={colorTheme.palettes}
        pauseLabel={data.pauseAnimationLabel}
        pixelColor={initialPalette.pixelColor}
        resumeLabel={data.resumeAnimationLabel}
        onPauseChange={setPaused}
      />
    </main>
  )
}
