import { useEffect, useState } from "react"

import dashboardData from "@/app/dashboard/data.json"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

import { RecordsPage } from "./records-page"
import { SettingsPage } from "./settings-page"

const navigation = [
  { path: "/", title: "Dashboard" },
  { path: "/records", title: "Records" },
  { path: "/settings", title: "Settings" },
] as const

function currentPath() {
  const fragment = window.location.hash.slice(1)
  return fragment.startsWith("/") ? fragment.split(/[?#]/)[0] : "/"
}

function WorkspaceNavigation({ path }: { path: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      {navigation.map((item) => (
        <SidebarMenuItem key={item.path}>
          <SidebarMenuButton asChild isActive={path === item.path}>
            <a
              href={`#${item.path}`}
              aria-current={path === item.path ? "page" : undefined}
              onClick={() => setOpenMobile(false)}
            >
              <span>{item.title}</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

function DashboardPage() {
  return (
    <div className="@container/main flex flex-col gap-6 py-6">
      <SectionCards />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive />
      </div>
      <DataTable data={dashboardData} />
    </div>
  )
}

export default function App() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onHashChange = () => setPath(currentPath())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const page = navigation.find((item) => item.path === path)

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader>
          <a href="#/" className="flex items-center gap-2 rounded-md p-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              A
            </span>
            <span>Acme workspace</span>
          </a>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <nav aria-label="Main navigation">
              <WorkspaceNavigation path={path} />
            </nav>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-4">
          <p className="text-sm font-medium">Your next idea starts here</p>
          <p className="text-xs text-muted-foreground">Sample data · No account required</p>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-base font-semibold">{page?.title ?? "Page not found"}</h1>
          <Badge variant="outline" className="ml-auto">Local prototype</Badge>
        </header>
        <div className="flex min-w-0 flex-1 flex-col">
          {path === "/" ? <DashboardPage /> : null}
          {path === "/records" ? <RecordsPage /> : null}
          {path === "/settings" ? <SettingsPage /> : null}
          {!page ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <h2 className="text-xl font-semibold">This page is not in the prototype</h2>
              <p className="text-sm text-muted-foreground">Use the workspace navigation to explore an example.</p>
              <Button asChild><a href="#/">Back to dashboard</a></Button>
            </div>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
