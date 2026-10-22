section :github do
  github_app_configurations.defaults \
    github_app_id: 123,
    app_slug: "replica-hub-test",
    client_id: "Iv1.test",
    client_secret: "client-secret",
    webhook_secret: "webhook-secret",
    private_key: OpenSSL::PKey::RSA.generate(2048).to_pem,
    owner_github_id: 321,
    owner_login: "github",
    owner_type: "Organization"

  def github_app_configurations.bootstrap_secret = "manual-test-secret"

  # Returns the generated key so token tests can verify signed App JWTs.
  def github_app_configurations.test_private_key = attributes_for.fetch(:private_key)

  # Mirrors the credentials GitHub returns after creating an App from a manifest.
  def github_app_configurations.manifest_credentials
    attributes = attributes_for
    {
      "id" => attributes.fetch(:github_app_id),
      "slug" => attributes.fetch(:app_slug),
      "client_id" => attributes.fetch(:client_id),
      "client_secret" => attributes.fetch(:client_secret),
      "webhook_secret" => attributes.fetch(:webhook_secret),
      "pem" => attributes.fetch(:private_key),
      "owner" => {
        "id" => attributes.fetch(:owner_github_id),
        "login" => attributes.fetch(:owner_login),
        "type" => attributes.fetch(:owner_type)
      }
    }
  end

  # Creates the installed configuration used after GitHub App setup completes.
  def github_app_configurations.create_installed(label = nil, **overrides)
    attributes = {
      singleton_key: 1,
      installation_id: 456,
      installation_account_github_id: overrides.fetch(:owner_github_id, attributes_for.fetch(:owner_github_id)),
      installation_state: "active",
      installed_at: Time.current
    }.merge(overrides)

    create label, unique_by: :singleton_key, **attributes
  end

  users.defaults \
    github_id: 1_001,
    login: "octocat",
    name: "The Octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
    last_authenticated_at: -> { Time.current }

  repositories.defaults \
    github_id: 2_001,
    name_with_owner: "github/prototype",
    default_branch: "main",
    installation_state: "active",
    synchronized_at: -> { Time.current }

  webhook_deliveries.defaults \
    github_delivery_id: -> { SecureRandom.uuid },
    event: "push",
    payload_sha256: "b" * 64
end

section :reviews do
  prototypes.defaults \
    repository: -> { repositories.create },
    branch_name: "prototype/welcome"

  builds.defaults \
    prototype: -> { prototypes.create },
    number: 1,
    commit_sha: "a" * 40,
    state: "queued"

  # Creates the complete published Build state used by previews and reviews.
  def builds.create_successful(label = nil, at: Time.current, artifact_bytes: 100, **attributes)
    build = create label, **attributes
    workflow_run_id = build.id + 10_000

    build.update! \
      state: "successful",
      started_at: at,
      finished_at: at,
      workflow_completed_at: at,
      github_workflow_run_id: workflow_run_id,
      github_workflow_run_attempt: 1,
      workflow_url: \
        "https://github.com/#{build.prototype.repository.name_with_owner}/actions/runs/#{workflow_run_id}",
      github_artifact_id: build.id + 20_000,
      artifact_prefix: "builds/#{build.id}",
      artifact_bytes: artifact_bytes
    build
  end

  sessions.defaults \
    user: -> { users.create },
    ip_address: "127.0.0.1",
    user_agent: "Replica Hub test"

  preview_grants.defaults \
    build: -> { builds.create },
    session: -> { sessions.create },
    token_digest: Digest::SHA256.hexdigest("preview-grant"),
    return_path: "/",
    expires_at: -> { 2.minutes.from_now }
end
