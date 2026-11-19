import { spawn } from "node:child_process"
import { once } from "node:events"
import { access, mkdir } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../../server/generated/prisma/client.ts"
import { seedLocalWorkspace } from "../seed-local-workspace/index.ts"

const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))

async function findLoopbackPort() {
  const socket = createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  await promisify(socket.close.bind(socket))()
  if (!address || typeof address === "string") throw new Error("Could not allocate a Hub port.")
  return address.port
}

export async function withLocalSmokeHub(
  {
    root,
    databaseUrl,
    manualStop,
  }: { root: string; databaseUrl: string; manualStop?: AbortSignal },
  useHub: (hubUrl: string) => Promise<void>,
) {
  const clientDirectory = join(hubRoot, "dist/client")
  const entrypoint = join(hubRoot, "dist/server/index.js")
  await Promise.all([access(join(clientDirectory, "index.html")), access(entrypoint)]).catch(
    (error: unknown) => {
      throw new Error("Run npm run build:runtime before starting the smoke Hub.", { cause: error })
    },
  )

  const artifactDirectory = join(root, "artifacts")
  const prototypeRoot = join(root, "prototypes")
  const repositoryPath = join(prototypeRoot, "validation")
  await mkdir(artifactDirectory)
  await mkdir(repositoryPath, { recursive: true })
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  try {
    await seedLocalWorkspace(prisma, repositoryPath, artifactDirectory)
  } finally {
    await prisma.$disconnect()
  }

  const port = await findLoopbackPort()
  const hubUrl = `http://localhost:${port}`
  const server = spawn(process.execPath, [entrypoint], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      CLIENT_DIRECTORY: clientDirectory,
      HUB_LOCAL_SIGN_IN: "true",
      HUB_APPLICATION_ORIGIN: hubUrl,
      HUB_PREVIEW_ORIGIN: `http://preview.localhost:${port}`,
      ARTIFACT_STORAGE_PROVIDER: "filesystem",
      ARTIFACT_STORAGE_DIRECTORY: artifactDirectory,
      REPLICA_LEARNING_ROOT: join(root, "learning"),
      ...(manualStop
        ? {
            HUB_LOCAL_MODE: "true",
            LOCAL_PROTOTYPE_ROOT: prototypeRoot,
            LOCAL_REPLICA_BUILD_ACTION_ROOT: join(hubRoot, "../actions/build"),
          }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let startupOutput = ""
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => {
      startupOutput = (startupOutput + chunk).slice(-6000)
    })
  }
  const closed = once(server, "close")
  const stopped = new AbortController()
  const startup = AbortSignal.any([
    stopped.signal,
    AbortSignal.timeout(manualStop ? 90_000 : 15_000),
    ...(manualStop ? [manualStop] : []),
  ])
  async function waitForReady() {
    while (!startup.aborted) {
      if (startupOutput.includes("Hub API listening")) {
        const response = await fetch(`${hubUrl}/api/ready`, {
          signal: AbortSignal.any([startup, AbortSignal.timeout(1000)]),
        }).catch(() => undefined)
        if (response?.ok) return true
      }
      await delay(100)
    }
    if (manualStop?.aborted) return false
    throw new Error(`Local Hub did not become ready.\n${startupOutput}`)
  }
  try {
    await Promise.race([
      closed.then(([code, signal]) => {
        if (manualStop?.aborted) return
        throw new Error(`Local Hub exited (${code ?? signal}).\n${startupOutput}`)
      }),
      (async () => {
        if ((await waitForReady()) && !manualStop?.aborted) await useHub(hubUrl)
      })(),
    ])
  } finally {
    stopped.abort()
    server.kill("SIGTERM")
    await closed
  }
}
