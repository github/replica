import { Button, FormControl, Text, TextInput } from "@primer/react-brand/esm"

import { HubAdministrationPage } from "@features/hub-administration-page"

import type { BuildSettingsPageData } from "./types"
import "./styles.css"

/** Presents the one deployment-wide package limit with its scope and confirmation. */
export function BuildSettingsPage({ data }: { data: BuildSettingsPageData }) {
  return (
    <HubAdministrationPage data={data}>
      {data.accessDenied ? (
        <Text as="p">{data.emptyLabel}</Text>
      ) : (
        <form action={data.submitPath} method="post" className="build-settings-page__form">
          <input type="hidden" name="_method" value="patch" />
          <input type="hidden" name="authenticity_token" value={data.authenticityToken} />

          <FormControl>
            <FormControl.Label>{data.limitLabel}</FormControl.Label>
            <TextInput
              name="maximum_package_mib"
              type="number"
              min={1}
              step={1}
              required
              defaultValue={data.maximumPackageMib}
              aria-describedby="build-package-description"
            />
          </FormControl>
          <Text as="p" id="build-package-description">
            {data.limitDescription}
          </Text>
          <Text as="p">{data.verification}</Text>

          <label className="build-settings-page__confirmation">
            <input type="checkbox" name="confirmed" value="1" required />
            <span>{data.confirmLabel}</span>
          </label>
          <Button type="submit" variant="primary">
            {data.submitLabel}
          </Button>
        </form>
      )}
    </HubAdministrationPage>
  )
}
