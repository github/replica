# Lets Hub's learning tests run the real replica-learning command without Copilot.
#
# Each test gets its own learning root, and use_test_labeler puts a labeler in a repository's
# store that answers without a network, the way an operator could configure one.
module LearningTestHelpers
  extend ActiveSupport::Concern

  LABELER = Rails.root.join("test/fixtures/files/learning-labeler.mjs")
  ANCHOR = {
    "schemaVersion" => 1,
    "kind" => "element",
    "route" => { "pathname" => "/", "search" => "", "hash" => "" },
    "selector" => "#email",
    "accessibleName" => "Email",
    "tagName" => "input",
    "selectedText" => "",
    "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
    "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
    "elementOffset" => { "x" => 0.5, "y" => 0.5 }
  }.freeze

  included do
    setup do
      @previous_learning_root = Rails.configuration.x.learning_root
      @previous_copilot_token = Rails.configuration.x.copilot_token
      @previous_copilot_billing = Rails.configuration.x.copilot_billing
      @previous_learning_cli = ENV["REPLICA_LEARNING_CLI"]
      @previous_learning_environment = Learning::Command.instance_method(:environment)
      @learning_test_root = Dir.mktmpdir("replica-learning-")
      Rails.configuration.x.learning_root = Pathname(@learning_test_root)
      ENV["REPLICA_LEARNING_CLI"] = Rails.root.join("test/fixtures/files/learning-cli.mjs").to_s
      original = @previous_learning_environment
      Learning::Command.define_method(:environment) do |token, temporary|
        original.bind_call(self, token, temporary).merge("REPLICA_LEARNING_TEST_CLOCK" => Time.current.iso8601(6))
      end
      Learning::Command.send(:private, :environment)
    end

    teardown do
      begin
        FileUtils.rm_rf(@learning_test_root) if @learning_test_root
      ensure
        Rails.configuration.x.learning_root = @previous_learning_root if @learning_test_root
        Rails.configuration.x.copilot_token = @previous_copilot_token if defined?(@previous_copilot_token)
        Rails.configuration.x.copilot_billing = @previous_copilot_billing if defined?(@previous_copilot_billing)
        ENV["REPLICA_LEARNING_CLI"] = @previous_learning_cli if defined?(@previous_learning_cli)
        if @previous_learning_environment
          Learning::Command.define_method(:environment, @previous_learning_environment)
          Learning::Command.send(:private, :environment)
        end
      end
    end
  end

  private

  # Connects Copilot as a Hub administrator does, with the token the operator gave Hub.
  def connect_copilot(user, token: "copilot-user-token", verified_at: 1.day.ago)
    Rails.configuration.x.copilot_token = token
    CopilotConnection.create!(user:, token_digest: CopilotConnection.digest(token), verified_at:)
  end

  # Connects Copilot for the current installation of Hub's GitHub App, replacing any connection, as a
  # Hub administrator does with organization billing, which confirms that Copilot bills the
  # organization. That App needs an active organization installation.
  def connect_copilot_for_organization(user, verified_at: 1.day.ago)
    Rails.configuration.x.copilot_billing = "organization"
    CopilotConnection.where(singleton_key: 1).delete_all
    CopilotConnection.create! \
      user:,
      token_digest: CopilotConnection.digest(CopilotConnection.credential),
      verified_at:
  end

  def use_test_labeler(repository)
    directory = Learning::Store.new(repository).directory
    FileUtils.mkdir_p(directory, mode: 0o700)
    FileUtils.cp(LABELER, directory.join("labeler.mjs"))
    options = { signals: Learning::Store::SIGNALS }
    options[:minReviewers] = 1 if repository.local?
    config = {
      schemaVersion: "replica.learning-config/v1",
      labeling: { labeler: { module: "./labeler.mjs" } },
      consolidation: { options: }
    }
    File.write directory.join("config.json"), JSON.generate(config), perm: 0o600
  end

  # Exercises the contract's optional counts through a real configured consolidator.
  def use_test_consolidator_without_support(repository)
    use_test_consolidator(repository, "learning-consolidator-without-support.mjs")
  end

  # Proposes an actual replacement of two accepted learnings.
  def use_test_merge_consolidator(repository)
    use_test_consolidator(repository, "learning-merge-consolidator.mjs")
  end

  # Installs only the named fixture into this test's own store.
  def use_test_consolidator(repository, filename)
    directory = Learning::Store.new(repository).directory
    FileUtils.cp \
      Rails.root.join("test/fixtures/files", filename),
      directory.join(filename)
    config = JSON.parse(directory.join("config.json").read)
    config.fetch("consolidation")["consolidator"] = { "module" => "./#{filename}" }
    directory.join("config.json").write(JSON.generate(config))
  end

  # Recreates pre-upgrade Hub imports through the real command, without claiming stable identity.
  def import_legacy_learning_comments(repository, by:)
    store = Learning::Store.new(repository)
    collection = Learning::Collection.new(store)
    log = collection.log
    log.delete(:reviewerIdentity)
    result = log.fetch(:calls).sole.fetch(:result)
    result.fetch(:threads).each do |thread|
      [ thread, *thread.fetch(:replies) ].each { _1.fetch(:author).except!(:githubId, :localId) }
      thread[:resolvedBy]&.except!(:githubId, :localId)
    end
    collection.define_singleton_method(:log) { log }
    collection.import!(store.grant_ids!(by:, basis: "Legacy review fixture consent."))
    store.call("label")
    captured = Time.iso8601(result.fetch(:capturedAt))
    store.call \
      "consolidate", "--from", (captured - Learning::Run::WINDOW).utc.iso8601(6),
      "--to", captured.utc.iso8601(6), "--actor", Learning::Run::ACTOR
  end

  # A review comment on the prototype for branch, on a successful Build of its own.
  def learning_comment(repository, user, branch, body)
    prototype = repository.prototypes.find_by(branch_name: branch) ||
      prototypes.create(repository:, branch_name: branch)
    number = prototype.builds.count + 1
    commit_sha = SecureRandom.hex(20)
    build = if repository.local?
      now = Time.current
      builds.create(prototype:, number:, commit_sha:).tap do |created|
        created.update! \
          state: "successful",
          started_at: now,
          finished_at: now,
          local_package_completed_at: now,
          artifact_prefix: "builds/#{created.id}",
          artifact_bytes: 100
      end
    else
      builds.create_successful(prototype:, number:, commit_sha:)
    end
    ReviewComment.create!(prototype:, build:, user:, body:, anchor: ANCHOR)
  end
end
