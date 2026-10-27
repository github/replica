import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { records, type WorkspaceRecord } from "./data/records"

function RecordDetails({ record }: { record: WorkspaceRecord }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-left">
          {record.title}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record.title}</DialogTitle>
          <DialogDescription>{record.id} · {record.category}</DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-6">{record.description}</p>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
          <div><dt className="text-muted-foreground">Owner</dt><dd className="mt-1 font-medium">{record.owner}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="mt-1">{record.status}</dd></div>
          <div><dt className="text-muted-foreground">Last updated</dt><dd className="mt-1">{record.updated}</dd></div>
          <div><dt className="text-muted-foreground">Source</dt><dd className="mt-1">Local sample data</dd></div>
        </dl>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Done</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RecordsPage() {
  const [query, setQuery] = useState("")
  const search = query.trim().toLowerCase()
  const visibleRecords = records.filter((record) =>
    [record.id, record.title, record.category, record.owner, record.status]
      .some((value) => value.toLowerCase().includes(search)),
  )

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">A little structure for your next big idea</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Search the sample records, then open one to explore its details.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All records</CardTitle>
          <CardDescription>Fictional projects for trying out the workspace.</CardDescription>
          <div className="mt-3 max-w-sm">
            <Input
              type="search"
              aria-label="Search records"
              placeholder="Search records..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground" role="status">
            {visibleRecords.length} of {records.length} records
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <RecordDetails record={record} />
                    <p className="mt-1 text-xs text-muted-foreground">{record.id}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{record.status}</Badge></TableCell>
                  <TableCell>{record.category}</TableCell>
                  <TableCell>{record.owner}</TableCell>
                  <TableCell className="whitespace-nowrap">{record.updated}</TableCell>
                </TableRow>
              ))}
              {visibleRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center">
                    <p className="font-medium">No records found</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try a different title, owner or status.</p>
                    <Button variant="outline" className="mt-4" onClick={() => setQuery("")}>Clear search</Button>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
