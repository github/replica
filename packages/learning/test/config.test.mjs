import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { placeIn, scopeFromName, scopeFromRemote, withoutCredentials } from "../src/config.mjs"

describe("placeIn", () => {
  const root = path.resolve("/work/checkout")

  it("counts the checkout itself and names that start with two dots as inside", () => {
    assert.deepEqual(placeIn(root, root), { inside: true, underReplica: false, relative: "." })
    const dotted = placeIn(root, path.join(root, "..private", "learning"))
    assert.equal(dotted.inside, true)
    assert.equal(dotted.underReplica, false)
  })

  it("puts only .replica and what it holds under .replica", () => {
    assert.equal(placeIn(root, path.join(root, ".replica")).underReplica, true)
    assert.equal(placeIn(root, path.join(root, ".replica", "learning")).underReplica, true)
    assert.equal(placeIn(root, path.join(root, ".replica-old")).underReplica, false)
    assert.equal(placeIn(root, path.join(root, "public", ".replica")).underReplica, false)
  })

  it("treats parents and siblings as outside", () => {
    assert.equal(placeIn(root, path.dirname(root)).inside, false)
    assert.equal(placeIn(root, path.resolve(root, "..", "checkout-data")).inside, false)
  })
})

describe("scopeFromRemote", () => {
  it("reads the host and owner/name from HTTPS, SSH, and scp-style remotes", () => {
    for (const remote of [
      "https://github.com/Acme/checkout-prototypes.git",
      "https://ana:token@github.com/acme/checkout-prototypes",
      "https://ana:p@ss@github.com/acme/checkout-prototypes.git",
      "ssh://git@github.com:22/acme/checkout-prototypes.git",
      "git@github.com:acme/checkout-prototypes.git",
    ])
      assert.deepEqual(
        scopeFromRemote(remote),
        { host: "github.com", repository: "acme/checkout-prototypes" },
        remote,
      )
  })

  it("keeps the same owner/name on another host apart", () => {
    assert.deepEqual(scopeFromRemote("https://GHE.example.com/acme/checkout-prototypes.git"), {
      host: "ghe.example.com",
      repository: "acme/checkout-prototypes",
    })
  })

  it("refuses remotes without a usable host or owner/name", () => {
    for (const remote of [
      "/srv/git/acme/checkout-prototypes.git",
      "file:///srv/git/acme/checkout-prototypes.git",
      "https://[::1]/acme/checkout-prototypes.git",
      "https://github.com/acme",
    ])
      assert.equal(scopeFromRemote(remote), null, remote)
  })
})

describe("withoutCredentials", () => {
  it("drops a user name and password from a remote URL and leaves scp-style users alone", () => {
    assert.equal(
      withoutCredentials("https://ana:p@ss@github.com/acme/checkout-prototypes.git"),
      "https://github.com/acme/checkout-prototypes.git",
    )
    assert.equal(
      withoutCredentials("git@github.com:acme/checkout-prototypes.git"),
      "git@github.com:acme/checkout-prototypes.git",
    )
  })
})

describe("scopeFromName", () => {
  it("accepts a GitHub repository ID and rejects invalid numeric IDs", () => {
    assert.deepEqual(scopeFromName("github.com/repositories/123456"), {
      host: "github.com",
      repository: "repositories/123456",
    })
    for (const id of ["0", "-1", "1.5"])
      assert.equal(scopeFromName(`github.com/repositories/${id}`), null, id)
  })

  it("refuses a name or anything that is not a GitHub repository ID", () => {
    for (const name of [
      "github.com/acme/checkout-prototypes",
      "replica.localhost:19500/repositories/123456",
      "acme/checkout-prototypes",
      "github.com/acme",
      "github.com/acme/checkout-prototypes/extra",
      "github.com/acme/checkout prototypes",
      "",
      undefined,
    ])
      assert.equal(scopeFromName(name), null, String(name))
  })
})
