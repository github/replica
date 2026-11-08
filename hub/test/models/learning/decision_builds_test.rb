require "test_helper"

class Learning::DecisionBuildsTest < ActiveSupport::TestCase
  include LearningTestHelpers

  setup do
    @previous_store = Rails.configuration.x.artifact_store
    @previous_root = Rails.configuration.x.artifact_root
    @root = Rails.root.join("storage/decision-builds-test-#{SecureRandom.hex(5)}")
    Rails.configuration.x.artifact_store = "local"
    Rails.configuration.x.artifact_root = @root.join("artifacts")
    github_app_configurations.create_installed
    @repository = repositories.create
    @mona = users.create(github_id: 1_002, login: "mona")
    @directory = @root.join("training/checkout-builds")
  end

  teardown do
    Rails.configuration.x.artifact_store = @previous_store
    Rails.configuration.x.artifact_root = @previous_root
    FileUtils.rm_rf(@root)
  end

  test "copies each reviewed prototype's published Builds with every rendering of each page captured" do
    comment = learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a label.")
    first = comment.build
    store(first, "screenshots/desktop.png", "start page")
    later = builds.create_successful(prototype: comment.prototype, number: 2, commit_sha: "c" * 40, at: 1.day.from_now)
    %w[desktop narrow].product(%w[.png -dark.png]).each { |size, suffix| store(later, "screenshots/#{size}#{suffix}", "fixed #{size}#{suffix}") }
    store(later, "templates.json", JSON.generate(version: 1, templates: [ template("pay", "/café?step=2") ]))
    store(later, "screenshots/templates/pay/narrow-dark.png", "payment step")
    unreviewed = prototypes.create(repository: @repository, branch_name: "prototype/unreviewed")
    store(builds.create_successful(prototype: unreviewed, number: 1, commit_sha: "d" * 40), "screenshots/desktop.png", "x")

    counts = Learning::DecisionBuilds.new(@repository).write(@directory)

    manifest = JSON.parse(@directory.join("builds.json").read)
    assert_equal({ builds: 2, screenshots: 6 }, counts)
    assert_equal "replica.decision-builds/v1", manifest.fetch("schemaVersion")
    assert_equal [ [ comment.prototype.id, 1 ], [ comment.prototype.id, 2 ] ], manifest.fetch("builds").map { _1.values_at("prototypeId", "number") }
    assert_equal [ later.chronological_at, later.finished_at ].map { _1.utc.iso8601(6) }, manifest.dig("builds", 1).values_at("createdAt", "publishedAt")
    screenshots = manifest.dig("builds", 1, "screenshots")
    assert_equal \
      [ [ "/", "desktop", "light" ], [ "/", "desktop", "dark" ], [ "/", "narrow", "light" ], [ "/", "narrow", "dark" ],
        [ "/caf%C3%A9?step=2", "narrow", "dark" ] ],
      screenshots.map { _1.values_at("route", "size", "theme") }
    assert_equal "payment step", @directory.join(screenshots.last.fetch("path")).read
    assert_equal 0o700, @directory.stat.mode & 0o777
  end

  test "refuses a directory that exists, is served, sits in Hub's storage, or is reached through a link" do
    comment = learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a label.")
    FileUtils.mkdir_p(@directory)
    assert_raises(Errno::EEXIST) { Learning::DecisionBuilds.new(@repository).write(@directory) }

    linked = @root.join("linked")
    FileUtils.ln_s(@root.join("training"), linked)
    [ Rails.public_path.join("decision-builds-#{SecureRandom.hex(4)}"), Rails.configuration.x.learning_root.join("builds"),
      @root.join("artifacts/builds"), linked.join("builds") ].each do |directory|
      assert_raises(PrivateStorageRoot::Invalid) { Learning::DecisionBuilds.new(@repository).write(directory) }
      assert_not directory.exist?
    end

    FileUtils.rm_rf(@directory)
    store(comment.build, "screenshots/desktop.png", "start page")
    failing = Object.new
    def failing.exist?(*) = true
    def failing.read(*, **) = raise(ArtifactStore::Missing, "gone")
    assert_raises(ArtifactStore::Missing) { Learning::DecisionBuilds.new(@repository, artifact_store: failing).write(@directory) }
    assert_not @directory.exist?
  end

  private

  def store(build, name, content)
    ArtifactStore.current.write("#{build.artifact_prefix}/#{name}", source: StringIO.new(content))
  end

  def template(id, path)
    { id:, name: id.capitalize, category: "Checkout", description: "A step of checkout.", path: }
  end
end
