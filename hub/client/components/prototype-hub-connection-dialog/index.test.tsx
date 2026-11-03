import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createRef, useRef, useState, type ComponentProps } from "react"
import { beforeAll, expect, it, vi } from "vitest"

import { HubConnectionDialog } from "."
import type { HubStatus } from "@utils/prototype-canvas/types"

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true
    },
  })
})

it("keeps approval and copy controls in the dialog without URL fields when browser opening fails", async () => {
  const url = "https://hub.example.com/canvas/pair/ABCD"
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Clipboard unavailable"))
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  const onConnect = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog
        status={{
          state: "pairing",
          repository: "github/prototype",
          hubOrigin: "https://hub.example.com",
        }}
        pairing={{ verificationUrl: url, userCode: "ABCD" }}
        connecting={false}
        error="Could not open your browser."
        onConnect={onConnect}
        onSelectHub={vi.fn()}
        onClose={onClose}
        hubButtonRef={createRef()}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("alert")).toHaveTextContent("Could not open your browser")
  expect(screen.getByRole("dialog")).toHaveClass("canvas-dialog")
  expect(screen.getByRole("button", { name: "Close connection dialog" })).toHaveClass(
    "hub-icon-button",
  )
  const approvalLink = screen.getByRole("link", { name: "Connect to the Hub" })
  expect(approvalLink).toHaveAttribute("href", url)
  expect(approvalLink.className).toContain("Button--primary")
  expect(approvalLink.className).toContain("Button--size-medium")
  expect(approvalLink).toHaveFocus()
  const group = screen.getByRole("group", { name: "Browser approval" })
  expect(group).toHaveClass("hub-connection-approval-actions")
  expect(group).toContainElement(approvalLink)
  expect(group).toContainElement(screen.getByRole("button", { name: "Copy Hub approval link" }))
  expect(screen.getByRole("button", { name: "Copy Hub approval link" })).toHaveAttribute(
    "type",
    "button",
  )
  expect(screen.queryByRole("button", { name: "Connect to the Hub" })).not.toBeInTheDocument()
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Edit Hub URL" })).not.toBeInTheDocument()
  expect(screen.getByText(/Make sure your browser shows the same code/)).toHaveTextContent("ABCD")
  fireEvent.click(screen.getByRole("button", { name: "Copy Hub approval link" }))
  await screen.findByRole("button", { name: "Approval link copied" })
  expect(screen.getByText("Approval link copied")).toHaveClass("hub-visually-hidden")
  expect(writeText).toHaveBeenCalledWith(url)
  expect(screen.getByRole("button", { name: "Approval link copied" })).toHaveClass(
    "hub-icon-button",
  )
  expect(onConnect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Approval link copied" }))
  await screen.findByText(/Copy the Connect to the hub link manually/)
  approvalLink.addEventListener("click", (event) => event.preventDefault(), { once: true })
  fireEvent.click(approvalLink)
  expect(onConnect).not.toHaveBeenCalled()
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }))
  expect(onClose).toHaveBeenCalledOnce()
  view.unmount()
})

it("asks for a Hub URL before connecting when no Hub was discovered or selected", async () => {
  const onConnect = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog
        status={{ state: "unconfigured", repository: "github/prototype" }}
        connecting={false}
        error=""
        onConnect={onConnect}
        onSelectHub={vi.fn()}
        onClose={() => {}}
        hubButtonRef={createRef()}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveFocus()
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  expect(onConnect).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
    target: { value: "https://hub.example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  await waitFor(() => expect(onConnect).toHaveBeenCalledWith("https://hub.example.com"))
  view.unmount()
})

it("shows the effective URL as a link and focuses its current value on Edit", () => {
  const props: ComponentProps<typeof HubConnectionDialog> = {
    status: {
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://selected.example.com",
      discovery: { state: "valid", origin: "https://configured.example.com", mismatch: true },
    },
    connecting: false,
    error: "",
    onConnect: vi.fn(),
    onSelectHub: vi.fn(),
    onClose: vi.fn(),
    hubButtonRef: createRef(),
  }
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog {...props} />
    </ThemeProvider>,
  )
  expect(
    screen.getByText(
      "Connecting to the hub lets you share the prototype with others and enables commenting.",
    ),
  ).toBeInTheDocument()
  expect(screen.queryByText(/One approval connects|Your browser will open/)).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "https://selected.example.com" })).toHaveAttribute(
    "href",
    "https://selected.example.com",
  )
  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Edit Hub URL" })).toHaveClass(
    "hub-icon-button--invisible",
  )
  view.rerender(
    <ThemeProvider>
      <HubConnectionDialog
        {...props}
        status={{ ...props.status!, hubOrigin: "https://refreshed.example.com" }}
      />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Edit Hub URL" }))
  const input = screen.getByRole("textbox", { name: "Hub URL" })
  expect(input).toHaveValue("https://refreshed.example.com")
  expect(input).toHaveFocus()
  expect(screen.queryByRole("link")).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: "https://draft.example.com" } })
  view.rerender(
    <ThemeProvider>
      <HubConnectionDialog
        {...props}
        status={{ ...props.status!, hubOrigin: "https://another.example.com" }}
      />
    </ThemeProvider>,
  )
  expect(input).toHaveValue("https://draft.example.com")
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  expect(props.onConnect).not.toHaveBeenCalled()
  expect(props.onSelectHub).not.toHaveBeenCalled()
  view.unmount()
})

it("saves an edited URL before connecting and retains invalid drafts and save failures", async () => {
  const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal")
  const onConnect = vi.fn().mockResolvedValue(undefined)
  const onSelectHub = vi
    .fn()
    .mockRejectedValueOnce(new Error("Remote Hubs require HTTPS."))
    .mockResolvedValueOnce(undefined)
  function Example() {
    const hubButtonRef = useRef<HTMLButtonElement>(null)
    const [status, setStatus] = useState<HubStatus>({
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://old.example.com",
    })
    return (
      <ThemeProvider>
        <HubConnectionDialog
          status={status}
          connecting={false}
          error=""
          onConnect={onConnect}
          onSelectHub={async (origin) => {
            await onSelectHub(origin)
            setStatus({ ...status, hubOrigin: origin })
          }}
          onClose={vi.fn()}
          hubButtonRef={hubButtonRef}
        />
      </ThemeProvider>
    )
  }
  const view = render(<Example />)
  fireEvent.click(screen.getByRole("button", { name: "Edit Hub URL" }))
  const input = screen.getByRole("textbox", { name: "Hub URL" })
  fireEvent.change(input, { target: { value: "not a URL" } })
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  expect(onSelectHub).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "http://remote.example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Remote Hubs require HTTPS.")
  expect(input).toHaveValue("http://remote.example.com")
  expect(onConnect).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "https://new.example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  await screen.findByRole("link", { name: "https://new.example.com" })
  expect(showModal).toHaveBeenCalledOnce()
  expect(screen.getByRole("button", { name: "Edit Hub URL" })).toHaveFocus()
  expect(onSelectHub).toHaveBeenLastCalledWith("https://new.example.com")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  expect(onConnect).toHaveBeenCalledWith(undefined)
  view.unmount()
})

it("resets only the draft and keeps it editable when reset fails", async () => {
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const onResetHub = vi
    .fn()
    .mockRejectedValueOnce(new Error("No repository Hub URL is available."))
    .mockResolvedValueOnce("https://configured.example.com")
  const props: ComponentProps<typeof HubConnectionDialog> = {
    status: {
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://selected.example.com",
    },
    connecting: false,
    error: "",
    onConnect: vi.fn(),
    onSelectHub,
    onResetHub,
    onClose: vi.fn(),
    hubButtonRef: createRef(),
  }
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog {...props} />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Edit Hub URL" }))
  const input = screen.getByRole("textbox", { name: "Hub URL" })
  fireEvent.change(input, { target: { value: "https://draft.example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "Reset to repository Hub URL" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("No repository Hub URL is available")
  expect(input).toHaveValue("https://draft.example.com")
  fireEvent.click(screen.getByRole("button", { name: "Reset to repository Hub URL" }))
  await waitFor(() => expect(input).toHaveValue("https://configured.example.com"))
  expect(onSelectHub).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeDisabled()
  view.rerender(
    <ThemeProvider>
      <HubConnectionDialog {...props} status={null} />
    </ThemeProvider>,
  )
  expect(input).toHaveValue("https://configured.example.com")
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Save Hub" })).toBeEnabled()
  view.unmount()
})

it("hides URL configuration while opening the browser and restores it after an error", () => {
  const props: ComponentProps<typeof HubConnectionDialog> = {
    status: {
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://hub.example.com",
    },
    connecting: true,
    error: "",
    onConnect: vi.fn(),
    onSelectHub: vi.fn(),
    onClose: vi.fn(),
    hubButtonRef: createRef(),
  }
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog {...props} />
    </ThemeProvider>,
  )
  expect(screen.queryByRole("link")).not.toBeInTheDocument()
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Edit Hub URL" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Opening browser..." })).toBeDisabled()
  view.rerender(
    <ThemeProvider>
      <HubConnectionDialog
        {...props}
        connecting={false}
        error="The approval expired or was declined. Connect again to retry."
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("alert")).toHaveTextContent("The approval expired or was declined")
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Edit Hub URL" })).toBeEnabled()
  view.unmount()
})

it("clears a failed reset before displaying a new connection failure", async () => {
  const onConnect = vi.fn()
  function Example() {
    const [error, setError] = useState("")
    return (
      <ThemeProvider>
        <HubConnectionDialog
          status={{ state: "unconfigured", repository: "github/prototype" }}
          connecting={false}
          error={error}
          onConnect={(origin) => {
            onConnect(origin)
            setError("Could not open your browser.")
            return Promise.resolve()
          }}
          onSelectHub={vi.fn()}
          onResetHub={() => Promise.reject(new Error("No repository Hub URL is available."))}
          onClose={vi.fn()}
          hubButtonRef={createRef()}
        />
      </ThemeProvider>
    )
  }
  const view = render(<Example />)
  fireEvent.click(screen.getByRole("button", { name: "Reset to repository Hub URL" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("No repository Hub URL is available")
  fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
    target: { value: "https://hub.example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open your browser."),
  )
  expect(onConnect).toHaveBeenCalledWith("https://hub.example.com")
  view.unmount()
})

it.each([
  ["https://hub.example.com/path?<img src=x onerror=alert(1)>", "https://hub.example.com"],
  ["http://127.0.0.1:19500/path", "http://127.0.0.1:19500"],
])("derives the clickable origin from the parsed URL %s", (hubOrigin, href) => {
  const view = render(
    <ThemeProvider>
      <HubConnectionDialog
        status={{ state: "disconnected", repository: "github/prototype", hubOrigin }}
        connecting={false}
        error=""
        onConnect={vi.fn()}
        onSelectHub={vi.fn()}
        onClose={vi.fn()}
        hubButtonRef={createRef()}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("link", { name: hubOrigin })).toHaveAttribute("href", href)
  expect(view.container.querySelector("img")).toBeNull()
  view.unmount()
})
