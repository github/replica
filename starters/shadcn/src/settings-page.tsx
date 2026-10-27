import { useState, type FormEvent } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

type Settings = {
  displayName: string
  email: string
  weeklySummary: boolean
}

const storageKey = "replica-shadcn-settings"
const defaults: Settings = {
  displayName: "Alex Morgan",
  email: "alex@example.com",
  weeklySummary: true,
}

function readSettings(): { settings: Settings; error: string } {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return { settings: defaults, error: "" }
    const value: unknown = JSON.parse(stored)
    if (
      typeof value !== "object" || value === null ||
      !("displayName" in value) || typeof value.displayName !== "string" ||
      !("email" in value) || typeof value.email !== "string" ||
      !("weeklySummary" in value) || typeof value.weeklySummary !== "boolean"
    ) {
      throw new Error("Saved settings do not match this app.")
    }
    return { settings: value as Settings, error: "" }
  } catch {
    return {
      settings: defaults,
      error: "Saved settings could not be read. Enter your preferences and save them again in this browser.",
    }
  }
}

export function SettingsPage() {
  const [initial] = useState(readSettings)
  const [settings, setSettings] = useState(initial.settings)
  const [error, setError] = useState(initial.error)
  const [saved, setSaved] = useState(false)

  function updateSettings(update: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...update }))
    setSaved(false)
    setError("")
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    if (!settings.displayName.trim()) {
      setError("Enter a display name before saving.")
      return
    }
    try {
      const values = { ...settings, displayName: settings.displayName.trim() }
      localStorage.setItem(storageKey, JSON.stringify(values))
      setSettings(values)
      setError("")
      setSaved(true)
    } catch {
      setError("Your browser could not save these settings. Allow local storage, then try again.")
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Make this workspace yours</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          These preferences stay in this browser. No account is created and no email is sent.
        </p>
      </div>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Profile and preferences</CardTitle>
          <CardDescription>A working local form you can adapt for your prototype.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveSettings} className="space-y-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input
                  id="display-name"
                  autoComplete="nickname"
                  required
                  value={settings.displayName}
                  onChange={(event) => updateSettings({ displayName: event.target.value })}
                />
                <FieldDescription>The name to use in this example workspace.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email address</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={settings.email}
                  onChange={(event) => updateSettings({ email: event.target.value })}
                />
                <FieldDescription>Use a fictional address. This prototype does not send messages.</FieldDescription>
              </Field>
              <Separator />
              <Field orientation="horizontal">
                <div className="flex-1 space-y-1">
                  <FieldLabel htmlFor="weekly-summary">Weekly summary</FieldLabel>
                  <FieldDescription>Store a sample notification preference without sending email.</FieldDescription>
                </div>
                <Switch
                  id="weekly-summary"
                  checked={settings.weeklySummary}
                  onCheckedChange={(checked) => updateSettings({ weeklySummary: checked })}
                />
              </Field>
            </FieldGroup>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {saved ? (
              <Alert role="status">
                <AlertDescription>Changes saved in this browser.</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit">Save changes</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
