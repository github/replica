import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

export async function checkImage() {
  const suffix = randomUUID()
  const network = `replica-image-${suffix}`
  const database = `${network}-database`
  const application = `${network}-app`
  const image = `replica-hub-check:${suffix}`
  function docker(...args: string[]) {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim()
  }
  function probe(path: string, status: number, contentType: string) {
    docker(
      "exec",
      application,
      "node",
      "--input-type=module",
      "-e",
      `const r = await fetch("http://127.0.0.1:3001${path}", {headers: {accept: "text/html"}});
       if (r.status !== ${status} || !r.headers.get("content-type")?.startsWith("${contentType}")) process.exit(1);`,
    )
  }
  let networkCreated = false
  let databaseCreated = false
  let applicationCreated = false
  let imageCreated = false
  try {
    execFileSync("docker", ["build", "-t", image, resolve(import.meta.dirname, "../..")], {
      stdio: "inherit",
    })
    imageCreated = true
    docker("network", "create", network)
    networkCreated = true
    docker(
      "run",
      "-d",
      "--name",
      database,
      "--network",
      network,
      "-e",
      "POSTGRES_USER=replica",
      "-e",
      "POSTGRES_PASSWORD=replica",
      "-e",
      "POSTGRES_DB=replica",
      "postgres:18.6-bookworm",
    )
    databaseCreated = true
    const deadline = Date.now() + 60_000
    while (
      spawnSync("docker", ["exec", database, "pg_isready", "-U", "replica", "-d", "replica"], {
        stdio: "ignore",
      }).status !== 0
    ) {
      assert(Date.now() < deadline, "PostgreSQL did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const databaseUrl = `DATABASE_URL=postgresql://replica:replica@${database}:5432/replica`
    for (let attempt = 0; attempt < 2; attempt++) {
      docker(
        "run",
        "--rm",
        "--network",
        network,
        "-e",
        databaseUrl,
        image,
        "node",
        "dist/server/scripts/setup/index.js",
      )
    }
    docker("run", "-d", "--name", application, "--network", network, "-e", databaseUrl, image)
    applicationCreated = true
    const readyDeadline = Date.now() + 60_000
    while (
      spawnSync(
        "docker",
        [
          "exec",
          application,
          "node",
          "-e",
          'fetch("http://127.0.0.1:3001/api/ready").then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))',
        ],
        { stdio: "ignore" },
      ).status !== 0
    ) {
      assert(Date.now() < readyDeadline, "Hub did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    probe("/api/health", 200, "application/json")
    probe("/", 200, "text/html")
    probe("/projects/example", 200, "text/html")
    probe("/api/missing", 404, "application/json")
    probe("/assets/missing.js", 404, "application/json")
    docker("stop", "--time", "40", application)
    assert.equal(
      docker("inspect", "-f", "{{.State.ExitCode}}", application),
      "0",
      "Hub must exit cleanly after termination",
    )
    console.log("Image setup, readiness, serving, and shutdown passed.")
  } catch (error) {
    if (applicationCreated) spawnSync("docker", ["logs", application], { stdio: "inherit" })
    throw error
  } finally {
    if (applicationCreated) docker("rm", "-f", application)
    if (databaseCreated) docker("rm", "-fv", database)
    if (networkCreated) docker("network", "rm", network)
    if (imageCreated) docker("image", "rm", image)
  }
}

await checkImage()
