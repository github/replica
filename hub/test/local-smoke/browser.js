// Object preserves the function value without a leading semicolon that breaks CLI loading.
Object(async (page) => {
  const root = new URL(page.url())
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(root.hostname) ||
    !["http:", "https:"].includes(root.protocol) ||
    root.pathname !== "/" ||
    root.search ||
    root.hash
  ) {
    throw new Error("Open Hub at its loopback origin root before running the smoke test.")
  }
  const browser = page.context().browser()
  if (!browser) throw new Error("The smoke test needs a browser that can create isolated contexts.")

  // Keep the CLI's automatic snapshot on the landing page, away from share URLs.
  const adminContext = await browser.newContext()
  let signedOutContext
  let shareFailure
  try {
    const admin = await adminContext.newPage()
    admin.setDefaultTimeout(10_000)
    await admin.goto(root.href, { waitUntil: "domcontentloaded" })
    await admin.getByRole("button", { name: "Sign in as local developer", exact: true }).click()
    await admin
      .getByRole("button", { name: "Choose repository. local/validation selected", exact: true })
      .waitFor()

    const prototypes = admin.getByRole("region", { name: "Prototypes", exact: true })
    const welcome = prototypes.getByRole("link", { name: "Welcome", exact: true })
    const noBuild = prototypes.getByRole("link", { name: "No Build", exact: true })
    await welcome.waitFor()
    const screenshot = prototypes.getByRole("img", { name: "Welcome, Build 1", exact: true })
    await screenshot.scrollIntoViewIfNeeded()
    const screenshotLoaded = await screenshot.evaluate(async (image) => {
      await image.decode()
      return image.naturalWidth === 1 && image.naturalHeight === 1
    })
    if (!screenshotLoaded) {
      throw new Error("The gallery did not display the saved Welcome screenshot.")
    }
    const galleryNames = await prototypes.getByRole("link").allTextContents()

    await admin.getByRole("link", { name: "Edit prototype listings", exact: true }).click()
    const draftBranch = "prototype/listing-draft"
    const addBranch = admin
      .getByRole("region", { name: "Available branches", exact: true })
      .getByRole("button", { name: `Add to Hub: ${draftBranch}`, exact: true })
    await addBranch.click()
    const registration = admin.getByRole("dialog", { name: "Add branch to Hub", exact: true })
    const name = registration.getByRole("textbox", { name: "Name", exact: true })
    const draftNames = [draftBranch, (await name.inputValue()).trim()]
    if (galleryNames.some((listedName) => draftNames.includes(listedName.trim()))) {
      throw new Error("The unregistered branch appeared in the prototype gallery.")
    }

    const registeredName = "Local listing smoke"
    await name.fill(registeredName)
    await registration.getByRole("button", { name: "Add to Hub", exact: true }).click()
    await admin
      .getByRole("region", { name: "Prototypes in Hub", exact: true })
      .getByRole("listitem")
      .filter({
        has: admin.getByRole("button", { name: `Edit details: ${draftBranch}`, exact: true }),
        hasText: registeredName,
      })
      .waitFor()
    await addBranch.waitFor({ state: "hidden" })
    await admin.getByRole("link", { name: "Back to prototypes", exact: true }).click()
    await welcome.waitFor()
    await admin.reload({ waitUntil: "domcontentloaded" })
    await prototypes.getByRole("link", { name: registeredName, exact: true }).waitFor()

    const galleryUrl = admin.url()
    await admin.getByRole("link", { name: "Security audit", exact: true }).click()
    await admin.getByRole("heading", { name: "Security audit", exact: true }).waitFor()
    await admin.getByRole("row").filter({ hasText: "prototype.registered" }).waitFor()
    await admin.goto(galleryUrl, { waitUntil: "domcontentloaded" })

    const navigation = admin.getByRole("navigation", { name: "Repository navigation", exact: true })
    const welcomeLink = navigation.getByRole("link", { name: "Welcome", exact: true })
    await welcomeLink.click()
    const hideWelcome = admin.getByRole("button", { name: "Hide welcome", exact: false })
    await hideWelcome.waitFor()
    const welcomePageUrl = admin.url()
    await hideWelcome.click()
    await welcomeLink.waitFor({ state: "hidden" })
    await admin.goto(welcomePageUrl, { waitUntil: "domcontentloaded" })
    await admin
      .getByRole("heading", { name: "Getting started with Replica", exact: true })
      .waitFor()
    if (await welcomeLink.count()) throw new Error("Welcome was not hidden after reload.")

    await navigation.getByRole("link", { name: "Create", exact: true }).click()
    const templates = admin.getByRole("region", { name: "Templates", exact: true })
    await templates.getByRole("link", { name: "Open template: Field notes", exact: true }).click()
    await admin
      .locator("iframe")
      .contentFrame()
      .getByRole("heading", { name: "Field notes template", exact: true })
      .waitFor()
    await adminContext.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: root.origin,
    })
    await admin.getByRole("button", { name: "Branch from here", exact: true }).click()
    const brief = "Add a trail map to the field notes."
    await admin
      .getByPlaceholder("What changes would you like to make?", { exact: true })
      .fill(brief)
    await admin
      .getByRole("button", { name: "Copy prompt", exact: true })
      .and(admin.locator("button:enabled"))
      .click()
    await admin.waitForFunction(async (submittedBrief) => {
      const prompt = await navigator.clipboard.readText()
      return prompt.includes(submittedBrief) && prompt.includes("/field-notes")
    }, brief)
    await admin.goto(galleryUrl, { waitUntil: "domcontentloaded" })

    await admin.getByRole("link", { name: "Canvas connections", exact: true }).click()
    await admin.getByRole("heading", { name: "Canvas connections", exact: true }).waitFor()
    await admin.getByText(/^No active connections\./).waitFor()
    await admin.goto(galleryUrl, { waitUntil: "domcontentloaded" })

    await admin.getByRole("radio", { name: "List view", exact: true }).press("Space")
    function row(name) {
      return prototypes
        .getByRole("row")
        .filter({ has: admin.getByRole("link", { name, exact: true }) })
    }
    await row("Welcome").getByText("passing", { exact: true }).waitFor()
    await row("No Build").getByText("No Build yet", { exact: true }).waitFor()

    async function dismissIntroduction(name) {
      const dismiss = admin
        .getByRole("dialog", { name, exact: true })
        .getByRole("button", { name: "View prototype", exact: true })
      if (await dismiss.isVisible()) await dismiss.click()
    }

    await noBuild.click()
    await admin.getByRole("heading", { name: "No preview available", exact: true }).waitFor()
    await dismissIntroduction("No Build")
    await admin.locator("iframe").waitFor({ state: "detached" })
    await admin
      .getByRole("link", { name: "Close and return to the prototype gallery", exact: true })
      .click()

    await welcome.click()
    const privatePreview = admin.getByTitle("Welcome, Build 1 preview", { exact: true })
    await privatePreview.waitFor()
    await dismissIntroduction("Welcome")
    await privatePreview
      .contentFrame()
      .getByRole("heading", { name: "Welcome prototype", exact: true })
      .waitFor()
    const welcomeUrl = admin.url()

    await admin.goto(new URL("/settings/sharing", root).href, { waitUntil: "domcontentloaded" })
    await admin.getByRole("heading", { name: "Public sharing is disabled", exact: true }).waitFor()
    await admin
      .getByRole("checkbox", {
        name: "I understand and confirm this deployment-wide change.",
        exact: true,
      })
      .check()
    await admin.getByRole("button", { name: "Enable public sharing", exact: true }).click()
    const enabled = admin.getByRole("heading", { name: "Public sharing is enabled", exact: true })
    await enabled.waitFor()
    await admin.reload({ waitUntil: "domcontentloaded" })
    await enabled.waitFor()

    await admin.goto(welcomeUrl, { waitUntil: "domcontentloaded" })
    await admin.getByRole("button", { name: "More actions", exact: true }).click()
    await admin
      .getByRole("menuitem", { name: "Share links", exact: true })
      .getByRole("link", { name: "Share links", exact: true })
      .click()
    await admin.getByRole("heading", { name: "Build 1", exact: true }).waitFor()
    const label = "Local smoke preview"
    await admin.getByRole("textbox", { name: "Label", exact: true }).fill(label)

    shareFailure = "The share form did not create an openable Build 1 link."
    await admin.getByRole("button", { name: "Create share link", exact: true }).click()
    const activeLink = admin.getByRole("listitem").filter({
      has: admin.getByRole("heading", { name: label, exact: true }),
    })
    const open = activeLink.getByRole("link", { name: "Open", exact: true })
    await open.waitFor()
    shareFailure = "The created link did not point to a public page on this Hub."
    const shareUrl = new URL((await open.getAttribute("href")) ?? "", root)
    if (shareUrl.origin !== root.origin || !/^\/shared\/[^/]+$/.test(shareUrl.pathname)) {
      throw new Error(shareFailure)
    }

    shareFailure = "The signed-out page did not show the saved Welcome Build 1 preview."
    signedOutContext = await browser.newContext()
    const shared = await signedOutContext.newPage()
    shared.setDefaultTimeout(10_000)
    await shared.goto(shareUrl.href, { waitUntil: "domcontentloaded" })
    await shared
      .getByTitle("Welcome · Build 1", { exact: true })
      .contentFrame()
      .getByRole("heading", { name: "Welcome prototype", exact: true })
      .waitFor()

    shareFailure = "The public preview showed private Hub navigation or account controls."
    await shared
      .getByRole("navigation", {
        name: /^(Repository navigation|Hub navigation|Security and settings)$/,
      })
      .waitFor({ state: "hidden" })
    await shared.getByRole("button", { name: /^Account menu/ }).waitFor({ state: "hidden" })

    shareFailure = "The admin did not revoke the created share link."
    admin.once("dialog", (dialog) => dialog.accept())
    await activeLink.getByRole("button", { name: "Delete link", exact: true }).click()
    await admin
      .getByRole("region", { name: "Inactive share links", exact: true })
      .getByRole("listitem")
      .filter({ has: admin.getByRole("link", { name: label, exact: true }) })
      .getByText(/\bRevoked$/)
      .waitFor()

    shareFailure = "Reloading the signed-out page did not block the revoked share link."
    await shared.reload({ waitUntil: "domcontentloaded" })
    await shared.getByRole("heading", { name: "This link was revoked", exact: true }).waitFor()
    await shared.locator("iframe").waitFor({ state: "detached" })
  } catch (error) {
    // Playwright errors can include the token in navigation and locator logs.
    if (shareFailure) throw new Error(shareFailure)
    throw error
  } finally {
    await Promise.all([signedOutContext?.close(), adminContext.close()])
  }
  return "local smoke passed"
})
