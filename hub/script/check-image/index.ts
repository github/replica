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
    const registry = process.env.NPM_REGISTRY
    if (registry) {
      const url = new URL(registry)
      assert(
        url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
        "NPM_REGISTRY must be an HTTPS URL without credentials, query, or fragment",
      )
    }
    execFileSync(
      "docker",
      [
        "build",
        "-t",
        image,
        ...(registry ? ["--build-arg", `NPM_REGISTRY=${registry}`] : []),
        resolve(import.meta.dirname, "../.."),
      ],
      {
        stdio: "inherit",
      },
    )
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
    const migrationPassword = "replica-migration-image-only"
    const runtimePassword = "replica-runtime-image-only"
    docker(
      "run",
      "--rm",
      "--network",
      network,
      "-e",
      databaseUrl,
      "-e",
      `HUB_MIGRATION_PASSWORD=${migrationPassword}`,
      "-e",
      `HUB_RUNTIME_PASSWORD=${runtimePassword}`,
      image,
      "node",
      "dist/server/scripts/provision-database-access/index.js",
    )
    const migrationUrl = new URL(databaseUrl.slice("DATABASE_URL=".length))
    migrationUrl.username = "replica_migration"
    migrationUrl.password = migrationPassword
    const runtimeUrl = new URL(migrationUrl)
    runtimeUrl.username = "replica_runtime"
    runtimeUrl.password = runtimePassword
    for (let attempt = 0; attempt < 2; attempt++) {
      docker(
        "run",
        "--rm",
        "--network",
        network,
        "-e",
        `DATABASE_URL=${migrationUrl}`,
        "-e",
        "DATABASE_RUNTIME_ROLE=replica_runtime",
        image,
        "node",
        "dist/server/scripts/setup/index.js",
      )
    }
    docker(
      "run",
      "--rm",
      "--network",
      network,
      "-e",
      `DATABASE_URL=${runtimeUrl}`,
      image,
      "node",
      "--input-type=module",
      "-e",
      `import assert from "node:assert/strict";
       import { randomUUID } from "node:crypto";
       import pg from "pg";
       import pino from "pino";
       import { createJobQueue } from "./dist/server/integrations/bullmq/create-job-queue/index.js";
       import { createJobWorker } from "./dist/server/integrations/bullmq/create-job-worker/index.js";
       setTimeout(() => { console.error("Runtime database access probe timed out"); process.exit(1); }, 30_000).unref();
       const databaseUrl = process.env.DATABASE_URL;
       const client = new pg.Client({ connectionString: databaseUrl });
       await client.connect();
       try {
         assert.equal((await client.query("SELECT current_user AS role")).rows[0].role, "replica_runtime");
         const id = randomUUID();
         await client.query("INSERT INTO public.users (id) VALUES ($1)", [id]);
         assert.equal((await client.query("SELECT id FROM public.users WHERE id = $1", [id])).rows[0].id, id);
         assert.equal((await client.query("UPDATE public.users SET updated_at = now() WHERE id = $1", [id])).rowCount, 1);
         assert.equal((await client.query("DELETE FROM public.users WHERE id = $1", [id])).rowCount, 1);
         for (const sql of [
           "CREATE TABLE public.image_permission_probe (id integer)",
           "CREATE TABLE bullmq.image_permission_probe (id integer)",
           "DROP TABLE public.users",
           "TRUNCATE TABLE public.users",
           "CREATE ROLE image_permission_probe",
           "SELECT * FROM public._prisma_migrations",
           "UPDATE public._prisma_migrations SET checksum = checksum",
           "UPDATE bullmq.migration SET version = version",
         ]) {
           await assert.rejects(client.query(sql), { code: "42501" }, sql);
         }
       } finally {
         await client.end();
       }
       for (const name of ["on-demand", "scheduled"]) {
         const options = { name, databaseUrl, logger: pino({ level: "silent" }) };
         const queue = createJobQueue(options);
         const worker = createJobWorker({
           ...options,
           processors: [{ name: "image-check", process: async ({ value }) => value * 2 }],
         });
         let running;
         try {
           await worker.waitUntilReady();
           const jobs = await queue.addBulk([
             { name: "image-check", data: { value: 21 } },
             { name: "image-check", data: { value: 7 } },
           ]);
           running = worker.run();
           void running.catch(() => {});
           const deadline = Date.now() + 10_000;
           while (!(await Promise.all(jobs.map(job => job.getState()))).every(state => state === "completed")) {
             assert(Date.now() < deadline, "Runtime worker did not complete queued jobs");
             await new Promise(resolve => setTimeout(resolve, 50));
           }
           assert.deepEqual(await Promise.all(jobs.map(async job => (await queue.getJob(job.id)).returnvalue)), [42, 14]);
         } finally {
           await Promise.all([worker.close(), queue.close()]);
           await running;
         }
       }`,
    )
    docker(
      "run",
      "-d",
      "--name",
      application,
      "--network",
      network,
      "-e",
      `DATABASE_URL=${runtimeUrl}`,
      image,
    )
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
    console.log("Image database access, setup, jobs, readiness, serving, and shutdown passed.")
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
