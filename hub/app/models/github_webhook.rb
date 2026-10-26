# Authenticates GitHub webhooks and records each supported delivery once.
class GithubWebhook
  MAXIMUM_BODY_SIZE = 25.megabytes
  INSTALLATION_ACTIONS = %w[created deleted new_permissions_accepted suspend unsuspend].freeze
  COMMIT_SHA_FORMAT = /\A[0-9a-f]{40}\z/

  class Rejected < StandardError; end
  class HeadObservationConflict < StandardError; end

  class << self
    # Authenticates one delivery and records the change it reports.
    def process!(configuration:, body:, delivery_id:, event:, signature:, &admission)
      new(configuration:, body:, delivery_id:, event:, signature:).process!(&admission)
    end

    # Remote metadata can request a resend only for events Hub actually processes.
    def supported_event?(event:, action:)
      case event
      when "push" then true
      when "workflow_run" then %w[requested in_progress completed].include?(action)
      when "installation" then INSTALLATION_ACTIONS.include?(action)
      when "installation_repositories" then %w[added removed].include?(action)
      else false
      end
    end
  end

  # Stores the delivery details needed to authenticate and record a webhook.
  def initialize(configuration:, body:, delivery_id:, event:, signature:)
    @configuration = configuration
    @credential_snapshot = configuration.credential_snapshot
    @installation_snapshot = configuration.installation_snapshot
    @body = body
    @delivery_id = delivery_id
    @event = event
    @signature = signature
  end

  # Authenticates one delivery and records the change it reports.
  def process!
    verify_signature!
    payload = JSON.parse(body)
    raise Rejected, "Invalid webhook payload" if !payload.is_a?(Hash)
    return if !supported?(payload)

    installation = payload.fetch("installation")
    if event.in?(%w[push workflow_run])
      verify_installation!(installation)
    else
      verify_app!(installation)
    end
    return if !configuration.accepts_installation?(installation["id"])
    if configuration.pinned_installation? && event.in?(%w[installation installation_repositories])
      account = installation.fetch("account")
      return if account["id"] != installation_snapshot.fetch(:installation_account_github_id) ||
        account["type"] != installation_snapshot.fetch(:installation_account_type)
    end

    delivery = find_delivery!
    if delivery.processed?
      with_delivery_configuration! do
        WebhookRedelivery.complete!(configuration:, guid: delivery_id)
      end
      return delivery.build
    end
    claimed = with_delivery_configuration! { delivery.start_processing! }
    return if !claimed
    if block_given? && !yield(delivery, installation.fetch("id").to_i)
      delivery.allow_retry!
      return
    end

    build = case event
    when "push" then record_push!(payload)
    when "workflow_run" then record_workflow_run!(payload)
    else record_installation!(payload)
    end
    with_delivery_configuration! do
      if delivery.finish_processing!(build:)
        WebhookRedelivery.complete!(configuration:, guid: delivery_id)
      end
    end
    build
  rescue JSON::ParserError, KeyError, TypeError, ArgumentError, Repository::WorkflowRunDiscoveries::InvalidRun
    delivery&.allow_retry!
    raise Rejected, "Invalid webhook payload"
  rescue StandardError
    delivery&.allow_retry!
    raise
  end

  private

  attr_reader :body, :configuration, :credential_snapshot, :installation_snapshot, :delivery_id, :event, :signature

  # Installation notifications can change identity; pushes and workflow runs cannot.
  def with_delivery_configuration!(&block)
    if event.in?(%w[push workflow_run])
      configuration.with_installation!(snapshot: installation_snapshot, &block)
    elsif configuration.pinned_installation?
      identity = installation_snapshot.except(:installation_state, :owner_github_id, :owner_type)
      configuration.with_installation!(snapshot: identity, &block)
    else
      GithubAppConfiguration.with_credentials!(**credential_snapshot, &block)
    end
  end

  # Confirms the delivery body matches a signature made with a saved secret.
  # @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
  def verify_signature!
    raise Rejected, "Webhook body is too large" if body.bytesize > MAXIMUM_BODY_SIZE

    secrets = with_accepted_secrets { |accepted| accepted }
    matched_secret = secrets.find do |secret|
      expected = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", secret, body)}"
      signature.to_s.bytesize == expected.bytesize &&
        ActiveSupport::SecurityUtils.secure_compare(signature.to_s, expected)
    end
    raise Rejected, "Invalid webhook signature" if matched_secret.nil?

    accepted = with_accepted_secrets { |current| current.include?(matched_secret) }
    raise Rejected, "Invalid webhook signature" if !accepted
  end

  # A retired previous secret must fail even when the App revision has not changed.
  def with_accepted_secrets
    GithubAppConfiguration.with_credentials!(**credential_snapshot) do
      live = GithubAppConfiguration.uncached { GithubAppConfiguration.find(configuration.id) }
      yield [ live.webhook_secret, live.previous_webhook_secret ].compact
    end
  end

  # Reports whether Hub records changes from this event and action.
  def supported?(payload)
    self.class.supported_event?(event:, action: payload["action"])
  end

  # Finds one delivery identity and rejects attempts to change its contents.
  def find_delivery!
    valid_id = delivery_id.present? && delivery_id.bytesize <= 255
    raise Rejected, "Invalid webhook delivery ID" if !valid_id

    digest = Digest::SHA256.hexdigest(body)
    delivery = with_delivery_configuration! do
      WebhookDelivery.find_or_create_by!(github_delivery_id: delivery_id) do |record|
        record.event = event
        record.payload_sha256 = digest
      end
    end
    verify_delivery_identity!(delivery, digest)
  rescue ActiveRecord::RecordInvalid => error
    delivery = WebhookDelivery.find_by(github_delivery_id: delivery_id) if
      error.record.errors.added?(:github_delivery_id, :taken)
    raise Rejected, "Invalid webhook delivery" if delivery.nil?

    verify_delivery_identity!(delivery, digest)
  end

  # Concurrent first receipts still compare their authenticated identity.
  def verify_delivery_identity!(delivery, digest)
    raise Rejected, "Webhook delivery ID was reused" if !delivery.matches?(event:, payload_sha256: digest)

    delivery
  end

  # Records an installation change after confirming it belongs to this GitHub App.
  def record_installation!(payload)
    installation = payload.fetch("installation")
    verify_app!(installation)
    action = payload.fetch("action")
    if event == "installation" && action == "deleted"
      configuration.installation.record_status!(installation, action:)
    else
      configuration.synchronize_repositories!
    end
    nil
  end

  # Records an exact branch Build, including default-branch pushes.
  def record_push!(payload)
    installation = payload.fetch("installation")
    verify_installation!(installation)
    return if configuration.installation_state != "active"

    repository = Repository.active.find_by(github_id: payload.fetch("repository").fetch("id").to_i)
    return if repository.nil?

    branch_name = branch_name_from(payload.fetch("ref"))
    return if branch_name.nil? || !repository.build_branch?(branch_name)

    if payload.fetch("deleted") == true
      repository.branch_presence.record_deletion!(branch_name:, configuration:, installation: installation_snapshot)
      return
    end
    return if payload.fetch("deleted") != false

    commit_sha = valid_commit_sha!(payload.fetch("after"))
    return if commit_sha == "0" * 40

    previous_commit_sha = valid_commit_sha!(payload.fetch("before"))
    previous_commit_sha = nil if previous_commit_sha == "0" * 40
    if repository.prototypes.retired.exists?(branch_name:)
      return record_retained_push! \
        repository,
        branch_name,
        commit_sha,
        previous_commit_sha,
        default_branch: payload.fetch("repository").fetch("default_branch")
    end

    recovery = recovered?
    head = Prototype.uncached { repository.prototypes.active.find_by(branch_name:) }
    expected_current_build_id = recovery ? head&.current_build_id : :any
    expected_head_observation_revision = head&.head_observation_revision || 0
    branch_head = !recovery || current_branch_head?(repository, branch_name, commit_sha)
    configuration.with_installation!(snapshot: installation_snapshot) do
      repository.build_discoveries.record! \
        branch_name:,
        commit_sha:,
        previous_commit_sha:,
        branch_head:,
        expected_prototype_id: head&.id,
        prototype_id: recovery ? head&.id : nil,
        expected_current_build_id:,
        expected_head_observation_revision:,
        default_branch: payload.fetch("repository").fetch("default_branch") do |head_recorded|
          if branch_head && !recovery && !head_recorded
            raise HeadObservationConflict, "Branch head changed during push discovery"
          end
        end
    end
  end

  # Historical pushes never pick a replacement identity just because its name matches.
  def record_retained_push!(repository, branch_name, commit_sha, previous_commit_sha, default_branch:)
    observed = repository.branch_presence.observations[branch_name]
    current = repository.branch_presence.refresh! \
      branch_name:,
      observed:,
      configuration:,
      installation: installation_snapshot,
      default_branch: default_branch
    matches = Build.joins(:prototype).where(
      prototypes: { repository_id: repository.id, branch_name: }, commit_sha:
    ).limit(2).to_a
    build = if current&.commit_sha == commit_sha
      current
    else
      matches.sole if matches.one?
    end
    return if build.nil?

    # A matching SHA alone cannot identify which active history sent the push.
    accepted_head_change = observed && observed.branch_deleted_at.nil? &&
      current&.prototype_id == observed.id && current.commit_sha == commit_sha &&
      current.prototype.current_build_id == current.id &&
      current.prototype.head_observation_revision == observed.head_observation_revision + 1 &&
      previous_commit_sha.present? && observed.current_build&.commit_sha == previous_commit_sha
    return build if !accepted_head_change && (matches.many? || build.prototype.branch_deleted_at.nil?)

    configuration.with_installation!(snapshot: installation_snapshot) do
      repository.build_discoveries.record! \
        branch_name:,
        commit_sha:,
        previous_commit_sha:,
        default_branch:,
        prototype_id: build.prototype_id
    end
  end

  # Recovery metadata identifies historical retries without slowing every live push.
  def recovered?
    WebhookRedelivery.uncached do
      WebhookRedelivery.exists? \
        github_app_configuration_id: configuration.id,
        github_delivery_id: delivery_id
    end
  end

  # Keeps a recovered push in history unless GitHub still reports it as current.
  def current_branch_head?(repository, branch_name, commit_sha)
    token = configuration.tokens.installation
    reference = begin
      configuration.github_client.repositories.reference \
        repository,
        branch_name,
        token:
    rescue GithubClient::NotFound
      return false
    end
    valid_commit_sha!(reference.fetch("object").fetch("sha")) == commit_sha
  end

  # Records a fixed Replica workflow run for an enabled repository.
  def record_workflow_run!(payload)
    verify_installation!(payload.fetch("installation"))
    return if configuration.installation_state != "active"

    repository_payload = payload.fetch("repository")
    repository = Repository.active.find_by(github_id: repository_payload.fetch("id").to_i)
    return if repository.nil?

    configuration.with_installation!(snapshot: installation_snapshot) do
      repository.workflow_run_discoveries.record! \
        payload.fetch("workflow_run"),
        action: payload.fetch("action"),
        default_branch: repository_payload.fetch("default_branch")
    end
  end

  # Confirms a push belongs to this Hub's current App installation.
  def verify_installation!(installation)
    configuration.with_installation!(snapshot: installation_snapshot) do
      installation_id = installation_snapshot.fetch(:installation_id)
      matches = installation_id.present? && installation.fetch("id").to_i == installation_id
      raise Rejected, "Webhook is for another GitHub App installation" if !matches
    end
  end

  # Extracts only Git branch refs and leaves tags or malformed refs ineligible.
  def branch_name_from(ref)
    return if !ref.is_a?(String) || !ref.start_with?("refs/heads/")

    ref.delete_prefix("refs/heads/").presence
  end

  # Rejects malformed source identities before they reach persistence.
  def valid_commit_sha!(commit_sha)
    raise Rejected, "Invalid commit SHA" if !COMMIT_SHA_FORMAT.match?(commit_sha)

    commit_sha
  end

  # Confirms the webhook belongs to this Hub's GitHub App.
  def verify_app!(installation)
    raise Rejected, "Webhook is for another GitHub App" if installation.fetch("app_id").to_i != configuration.github_app_id
  end
end
