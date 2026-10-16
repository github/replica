require "test_helper"

class Learning::RunTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  include LearningTestHelpers

  setup do
    @configuration = github_app_configurations.create_installed
    @admin = users.create(hub_admin: true)
    @connection = connect_copilot(@admin)
    @repository = repositories.create
    @mona = users.create(github_id: 1_002, login: "mona")
    @hubot = users.create(github_id: 1_003, login: "hubot")
    use_test_labeler(@repository)
  end

  test "suggests a learning that two reviewers raised on two prototypes and records Copilot's usage" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "Nice colors.")

    run = Learning::Run.request!(repository: @repository, user: @admin)
    assert_equal "queued", run.state
    run.find_learnings!

    run.reload
    assert_equal "succeeded", run.state, run.failure_summary
    assert_equal \
      [ 3, 2, 1, 1, 150, 5_000_000, "test-model" ],
      [ run.comments_considered, run.comments_labeled, run.suggestions, run.copilot_requests,
        run.input_tokens + run.output_tokens, run.nano_aiu, run.models ]
    suggestion = Learning::Store.new(@repository).call("memories").sole.fetch("record")
    assert_equal %w[proposed visible-form-labels], suggestion.values_at("state", "themeKey")
    assert_operator @connection.reload.verified_at, :>, 1.minute.ago
  end

  test "a later run reads only what changed, so Copilot sees nothing twice" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "Nice colors.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!

    second = Learning::Run.request!(repository: @repository, user: @admin)
    second.find_learnings!

    assert_equal \
      [ "succeeded", 0, 0, 0, 0 ],
      [ second.state, second.comments_considered, second.suggestions, second.copilot_requests, second.nano_aiu ]
    store = Learning::Store.new(@repository)
    assert_equal 1, store.call("grants", "list").size
    assert_equal "github:octocat", store.call("grants", "list").sole.dig("grant", "grantedBy", "id")
    assert_equal 1, store.call("memories").size
  end

  test "improvement notes do not make a repository due for learning" do
    comment = learning_comment(@repository, @mona, "prototype/signup", "The field needs a label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    travel 1.minute
    ReviewComment.create! \
      prototype: comment.prototype,
      user: @mona,
      kind: "improvement_note",
      local_id: SecureRandom.uuid,
      note_revision: 1,
      note_status: "open",
      body: "Polish the field",
      anchor: comment.anchor

    assert_not Learning::Run.send(:due?, @repository)
  end

  test "a relative learning command completes a repository run" do
    ENV["REPLICA_LEARNING_CLI"] = "test/fixtures/files/learning-cli.mjs"
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    assert Learning.available_for?(@repository)

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.reload.state, run.failure_summary
    assert_equal 1, run.suggestions
    assert_equal 1, run.copilot_requests
  end

  test "a busy execution lock retries without claiming or failing a queued run" do
    run = Learning::Run.request!(repository: @repository, user: @admin)
    entered = Queue.new
    release = Queue.new
    worker = Thread.new do
      Learning::ExecutionLock.synchronize do
        entered << true
        release.pop(timeout: 10) || raise("The test did not release its worker.")
      end
    end
    assert entered.pop(timeout: 5)

    earliest = 30.seconds.from_now
    retry_time = ->(time) { (earliest..35.seconds.from_now).cover?(time) }
    assert_enqueued_with(job: Learning::Run::FindLearningsJob, args: [ run ], at: retry_time) do
      Learning::Run::FindLearningsJob.perform_now(run)
    end

    assert_equal "queued", run.reload.state
    assert_nil run.started_at
    assert_nil run.failure_code
  ensure
    release&.push(true)
    assert worker.join(5) if worker
    worker&.value
  end

  test "an obsolete lock-wait failure never changes a running or completed run" do
    run = Learning::Run.request!(repository: @repository, user: @admin)
    stale = Learning::Run.find(run.id)
    run.update!(state: "running", started_at: Time.current)

    stale.fail_lock_wait!

    assert_equal "running", run.reload.state
    assert_nil run.failure_code
    run.update!(state: "succeeded", finished_at: Time.current)
    stale.fail_lock_wait!
    assert_equal "succeeded", run.reload.state
    assert_nil run.failure_code
    assert_no_enqueued_jobs(only: Learning::Run::FindLearningsJob) { stale.find_learnings! }
  end

  test "an unsafe execution root fails an unclaimed run without changing its target" do
    target = Rails.configuration.x.learning_root.join("sentinel")
    target.mkdir(0o750)
    link = Rails.configuration.x.learning_root.join("unsafe")
    File.symlink(target, link)
    Rails.configuration.x.learning_root = link
    run = Learning::Run.request!(repository: @repository, user: @admin)

    run.find_learnings!

    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_nil run.started_at
    assert_empty target.children
    assert_equal 0o750, target.stat.mode & 0o777
  end

  test "pins managed users to their GitHub ID while preserving their display login" do
    @mona.update!(login: "mona_acme")
    comment = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    comment.thread.resolve_by!(@mona)
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    assert_equal 1, run.suggestions
    observations = Learning::Store.new(@repository).call("observations", "--purpose", "review")
    managed = observations.fetch("events").find { _1.dig("actor", "id") == "github-user:github.com/#{@mona.github_id}" }
    assert managed
    assert_equal "mona_acme", managed.dig("actor", "login")
  end

  test "one GitHub account renamed between runs never becomes two reviewers" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    @mona.update!(login: "mona-renamed")
    learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a visible label.")

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    assert_equal 0, run.suggestions
    store = Learning::Store.new(@repository)
    assert_empty store.call("memories")
    events = store.call("observations", "--purpose", "review", "--type", "human_comment").fetch("events")
    assert_equal [ "github-user:github.com/#{@mona.github_id}" ], events.map { _1.dig("actor", "id") }.uniq
  end

  test "a reused login on another GitHub account still counts as a different reviewer" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    @mona.update!(login: "mona-renamed")
    @hubot.update!(login: "mona")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    proposal = Learning::Store.new(@repository).call("memories").sole.fetch("record")
    assert_equal 2, proposal.dig("support", "distinctReviewers")
  end

  test "identity migration blocks a stale login-based proposal when support collapses to one person" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    import_legacy_comments
    @mona.update!(login: "mona-renamed")
    learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a visible label.")
    proposal = import_legacy_comments.fetch("proposals").sole
    assert_equal 2, proposal.dig("support", "distinctReviewers")

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    assert_equal 0, run.suggestions
    store = Learning::Store.new(@repository)
    error = assert_raises(Learning::Error) do
      store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
    end
    assert_equal "identity_revalidation_required", error.code
    overview = Learning::Overview.new(store, viewer: "github:octocat").load
    assert_empty overview[:suggestions]
    assert_equal 1, overview[:identityReviewCount]
  end

  test "identity migration retains the old approval but withholds it until a fresh review" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    import_legacy_comments
    @mona.update!(login: "mona-renamed")
    learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a visible label.")
    proposal = import_legacy_comments.fetch("proposals").sole
    store = Learning::Store.new(@repository)
    approved = store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    item = store.call("memories").sole
    assert_equal approved.fetch("digest"), item.dig("record", "digest")
    assert_equal approved.fetch("accepted"), item.dig("record", "accepted")
    assert_equal true, item.fetch("withheld")
    assert_equal true, item.dig("status", "identityNeedsReview")
    assert_empty Array(item.dig("status", "problems"))
    assert_empty store.call("recall", "--preview", "--by", "github:octocat").fetch("memories")
    again = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)
    assert_equal "succeeded", again.state, again.failure_summary
    assert_equal 0, again.comments_considered
  end

  test "identity migration never restores a redacted legacy version still present in Hub" do
    comment = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    import_legacy_comments
    store = Learning::Store.new(@repository)
    store.call("redact", "--comment", comment.id.to_s, "--by", "github:octocat")
    assert_not_includes store_bytes, "The email field has no label."

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    assert_not_includes store_bytes, "The email field has no label."
  end

  [ false, true ].each do |empty|
    %w[proposed accepted].each do |state|
      test "#{state} legacy guidance is blocked by an #{empty ? "empty" : "incomplete"} filtered first capture" do
        first = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
        import_legacy_comments
        @mona.update!(login: "mona-renamed")
        second = learning_comment(@repository, @mona, "prototype/checkout", "The card number needs a visible label.")
        proposal = import_legacy_comments.fetch("proposals").sole
        store = Learning::Store.new(@repository)
        if state == "accepted"
          store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
        end
        [ first, second ].each { _1.thread.resolve_by!(@mona) }
        learning_comment(@repository, @mona, "prototype/profile", "The phone field needs a visible label.") if !empty
        grants = store.call("grants", "list")
        run = Learning::Run.request!(repository: @repository, user: @admin)

        with_filtered_identity_capture do |captures|
          run.find_learnings!
          log = captures.sole
          assert_equal "stable-user-id", log.fetch(:reviewerIdentity)
          assert_equal "unresolved", log.fetch(:calls).sole.dig(:input, :resolution)
          assert_equal(empty ? 0 : 1, log.fetch(:calls).sole.dig(:result, :threads).size)
        end

        assert_equal %w[failed incomplete_collection], [ run.reload.state, run.failure_code ]
        assert_equal grants, store.call("grants", "list")
        item = store.call("memories").sole
        assert_equal true, item.dig("status", "identityNeedsReview")
        assert_empty store.call("recall", "--preview", "--by", "github:octocat").fetch("memories")
        if state == "proposed"
          error = assert_raises(Learning::Error) do
            store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
          end
          assert_equal "identity_revalidation_required", error.code
        else
          assert_equal "accepted", item.dig("record", "state")
        end
        assert_empty Learning::Overview.new(store, viewer: "github:octocat").load[:suggestions]
      end
    end
  end

  test "a Hub run with no current comments still adopts identity policy and withholds legacy approval" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    proposal = import_legacy_comments.fetch("proposals").sole
    store = Learning::Store.new(@repository)
    approved = store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
    before = store.call("status").fetch("counts").slice("episodes", "events")
    grants = store.call("grants", "list")
    @repository.prototypes.update_all(replica: true)
    imports = []
    capture_import = ->(command) { command.call.tap { imports << _1 } }
    run = Learning::Run.request!(repository: @repository, user: @admin)

    intercepting("import", with: capture_import) { run.find_learnings! }

    assert_equal "succeeded", run.state, run.failure_summary
    assert_equal 0, run.comments_considered
    assert_equal "stable-user-id", imports.sole.dig("collection", "reviewerIdentity")
    assert_equal 0, imports.sole.dig("collection", "counts", "messages")
    assert_equal before, store.call("status").fetch("counts").slice("episodes", "events")
    assert_equal grants, store.call("grants", "list")
    item = store.call("memories").sole
    assert_equal approved.fetch("digest"), item.dig("record", "digest")
    assert_equal true, item.dig("status", "identityNeedsReview")
    assert_empty store.call("recall", "--preview", "--by", "github:octocat").fetch("memories")
  end

  test "labels in batches until no comments wait, also past a batch Copilot left unlabeled" do
    learning_comment(@repository, @hubot, "prototype/checkout", "Nice colors.")
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")

    run = with_constants(LABEL_BATCH: 1) { Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!) }

    assert_equal \
      [ "succeeded", 3, 2, 0, 3 ],
      [ run.state, run.comments_considered, run.comments_labeled, run.comments_remaining, run.copilot_requests ]
  end

  test "leaves the comments it had no time for to the next run, which keeps the repository due" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")

    first = with_constants(LABEL_BATCH: 1, LABEL_BUDGET: 0.seconds) do
      Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)
    end

    assert_equal [ "succeeded", 1, 1 ], [ first.state, first.comments_labeled, first.comments_remaining ]
    assert_difference("Learning::Run.count", 1) { Learning::Run.schedule_all! }
    second = Learning::Run.last.tap(&:find_learnings!)
    assert_equal [ 1, 0 ], [ second.comments_labeled, second.comments_remaining ]
    assert_equal 1, Learning::Store.new(@repository).call("memories").size
  end

  test "leaves the suggestions past its limit to the next run, which keeps the repository due" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    learning_comment(@repository, @mona, "prototype/signup", "The grey hint text has too little contrast.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The contrast on the price is too low.")

    with_constants(MAX_SUGGESTIONS: 1) do
      first = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)
      assert_equal [ "succeeded", 1, 1 ], [ first.state, first.suggestions, first.suggestions_remaining ]

      assert_difference("Learning::Run.count", 1) { Learning::Run.schedule_all! }
      second = Learning::Run.last.tap(&:find_learnings!)
      assert_equal [ "succeeded", 1, 0 ], [ second.state, second.suggestions, second.suggestions_remaining ]
      assert_equal 2, Learning::Store.new(@repository).call("memories").size
      assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }
    end
  end

  test "removes the text of a comment deleted in Hub from the store's files" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    assert_includes store_bytes, "The email field has no label."

    travel 1.minute
    deleted.thread.delete_body!(actor: @mona)
    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", run.state, run.failure_summary
    assert_not_includes store_bytes, "The email field has no label."
    assert_includes store_bytes, "The card number needs a visible label."
  end

  test "removes a deleted comment's text even when no earlier run finished" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    first = Learning::Run.request!(repository: @repository, user: @admin)
    failing_to_label(code: "copilot_unavailable", message: "Copilot did not answer.") { first.find_learnings! }
    assert_equal %w[failed copilot_unavailable], [ first.reload.state, first.failure_code ]
    assert_includes store_bytes, "The email field has no label."

    travel 1.minute
    deleted.thread.delete_body!(actor: @mona)
    second = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal "succeeded", second.state, second.failure_summary
    assert_not_includes store_bytes, "The email field has no label."
  end

  test "a deletion while Learnings is off removes that comment's text, adds nothing else, and creates no store" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    travel 1.minute
    learning_comment(@repository, @hubot, "prototype/checkout", "The postcode needs a label too.")
    without_store = repositories.create(github_id: 2_002, name_with_owner: "github/without-store")
    elsewhere = learning_comment(without_store, @mona, "prototype/signup", "The phone field has no label.")
    @connection.destroy!
    counts = store_counts

    perform_enqueued_jobs do
      deleted.thread.delete_body!(actor: @mona)
      elsewhere.thread.delete_body!(actor: @mona)
    end

    assert_not_includes store_bytes, "The email field has no label."
    assert_includes store_bytes, "The card number needs a visible label."
    assert_not_includes store_bytes, "The postcode needs a label too."
    assert_equal counts, store_counts
    assert_empty Dir[Learning::Store.new(without_store).directory.join("learning.sqlite*")]
    assert_performed_with job: ReviewComment::RemoveFromLearningStoreJob, args: [ deleted, { by: "github:mona" } ]
  end

  test "a deletion removes the text of every version of the comment and of its labels, without a grant" do
    comment = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    travel 1.minute
    comment.thread.edit_body!("The email field still has no visible label.", actor: @mona)
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    assert_includes store_bytes, "Show a visible label above every form field."
    store = Learning::Store.new(@repository)
    grant = store.call("grants", "list").sole.dig("grant", "id")
    store.call("grants", "withdraw", grant, "--purpose", "review", "--purpose", "instruction", "--by", "github:octocat")

    travel 1.minute
    perform_enqueued_jobs { comment.thread.delete_body!(actor: @mona) }

    assert_not_includes store_bytes, "The email field has no label."
    assert_not_includes store_bytes, "The email field still has no visible label."
    assert_not_includes store_bytes, "Show a visible label above every form field."
  end

  test "removing a deleted comment again succeeds and changes nothing" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    travel 1.minute
    perform_enqueued_jobs { deleted.thread.delete_body!(actor: @mona) }
    counts = store_counts

    ReviewComment::RemoveFromLearningStoreJob.perform_now(deleted)

    assert_equal counts, store_counts
    assert_not_includes store_bytes, "The email field has no label."
  end

  test "removing a deleted comment keeps trying through an outage of eight failed attempts" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    attempts = 0
    outage = ->(command) do
      attempts += 1
      raise Learning::Error.new("Node.js or the replica-learning command is not installed here.", code: "unavailable") if attempts <= 8

      command.call
    end

    intercepting("redact", with: outage) { perform_enqueued_jobs { deleted.thread.delete_body!(actor: @mona) } }

    assert_equal 9, attempts
    assert_not_includes store_bytes, "The email field has no label."
  end

  test "removes a deleted comment's text without Copilot after Copilot refused its token" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    @connection.refuse!

    travel 1.minute
    perform_enqueued_jobs { deleted.thread.delete_body!(actor: @mona) }

    assert_not_includes store_bytes, "The email field has no label."
  end

  test "removes a deleted comment's text later when the queue refused the removal, with Copilot disconnected" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    @connection.destroy!
    removal = ReviewComment::RemoveFromLearningStoreJob

    travel 1.minute
    refusing_jobs(removal) { deleted.thread.delete_body!(actor: @mona) }
    assert_includes store_bytes, "The email field has no label."
    assert_no_enqueued_jobs(only: removal) { ReviewComment.recover_learning_removals! }

    travel ReviewComment::LEARNING_REMOVAL_RETRY
    assert_enqueued_jobs(1, only: removal) { ReviewComment.recover_learning_removals! }
    assert_no_enqueued_jobs(only: removal) { ReviewComment.recover_learning_removals! }
    perform_enqueued_jobs

    assert_not_includes store_bytes, "The email field has no label."
    assert_nil deleted.reload.learning_removal_due_at
    %w[development production].each do |environment|
      task = YAML.load_file(Rails.root.join("config/recurring.yml")).fetch(environment).fetch("recover_learning_removals")
      assert_equal "ReviewComment.recover_learning_removals!", task.fetch("command")
    end
  end

  test "finds a store whose configuration chooses the JSON Lines provider and removes deleted text there" do
    deleted = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    use_provider(@repository, "jsonl")
    Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
    store = Learning::Store.new(@repository)
    assert_includes json_lines_bytes, "The email field has no label."
    assert_empty Dir[store.directory.join("learning.sqlite*")]

    overview = Learning::Overview.new(store, viewer: Learning.person_for(@admin)).load
    assert_equal 1, overview[:suggestions].size

    travel 1.minute
    perform_enqueued_jobs { deleted.thread.delete_body!(actor: @mona) }

    assert_not_includes json_lines_bytes, "The email field has no label."
  end

  test "a store with only its configuration reads as empty, and a deletion there adds no data" do
    comment = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    store = Learning::Store.new(@repository)

    overview = Learning::Overview.new(store, viewer: Learning.person_for(@admin)).load
    perform_enqueued_jobs { comment.thread.delete_body!(actor: @mona) }

    assert_equal [ [], [], 0 ], [ overview[:suggestions], overview[:learnings], overview.dig(:recall, :count) ]
    assert_equal %w[config.json labeler.mjs], store.directory.children.map { _1.basename.to_s }.sort
  end

  test "removing a deleted comment waits for a run in progress and goes before runs still waiting" do
    comment = learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    removal = ReviewComment::RemoveFromLearningStoreJob.new(comment)
    run = Learning::Run::FindLearningsJob.new(Learning::Run.request!(repository: @repository, user: @admin))

    assert_equal run.concurrency_key, removal.concurrency_key
    assert_operator removal.priority.to_i, :<, run.priority.to_i
  end

  test "schedules a repository once its comments change, and only while Copilot is usable" do
    repositories.create(github_id: 2_002, name_with_owner: "github/quiet")
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")

    assert_difference("Learning::Run.count", 1) { Learning::Run.schedule_all! }
    run = Learning::Run.last
    assert_equal [ @repository, true ], [ run.repository, run.scheduled ]
    assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }

    run.find_learnings!
    assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }

    travel 1.minute
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    assert_difference("Learning::Run.count", 1) { Learning::Run.schedule_all! }
    Learning::Run.last.find_learnings!

    travel 1.minute
    learning_comment(@repository, @hubot, "prototype/checkout", "The postcode needs a label too.")
    @connection.refuse!
    assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }
  end

  test "asking again while a run waits returns that run" do
    first = Learning::Run.request!(repository: @repository, user: @admin)

    assert_equal first, Learning::Run.request!(repository: @repository, user: @mona)
    assert_equal 1, Learning::Run.count
  end

  test "queues every due repository, least recently run first, and keeps each run waiting until its turn" do
    old = repositories.create(github_id: 2_002, name_with_owner: "github/old")
    never = repositories.create(github_id: 2_003, name_with_owner: "github/never")
    { @repository => 1.day.ago, old => 3.days.ago }.each do |repository, started_at|
      Learning::Run.create!(repository:, scheduled: true, state: "succeeded", started_at:, finished_at: started_at)
    end
    [ old, never ].each { use_test_labeler(_1) }
    [ @repository, old, never ].each { learning_comment(_1, @mona, "prototype/signup", "The email field has no label.") }

    assert_enqueued_jobs(1, only: Learning::Run::FindLearningsJob) { Learning::Run.schedule_all! }
    waiting = Learning::Run.where(state: "queued").order(:id).to_a
    assert_equal [ never, old, @repository ], waiting.map(&:repository)

    travel 2.days
    Learning::Run.clear_expired!
    assert_equal waiting, Learning::Run.where(state: "queued").order(:id).to_a

    3.times do
      travel 1.minute
      perform_enqueued_jobs(only: Learning::Run::FindLearningsJob)
    end
    assert_equal [ "succeeded" ] * 3, waiting.map { _1.reload.state }
    assert_equal waiting.map(&:started_at).sort, waiting.map(&:started_at)
  end

  test "a run someone asks for goes before scheduled runs still waiting" do
    later = repositories.create(github_id: 2_002, name_with_owner: "github/later")
    asked = repositories.create(github_id: 2_003, name_with_owner: "github/asked")
    [ later, asked ].each { use_test_labeler(_1) }
    [ @repository, later ].each { learning_comment(_1, @mona, "prototype/signup", "The email field has no label.") }
    Learning::Run.schedule_all!
    learning_comment(asked, @mona, "prototype/signup", "The email field has no label.")
    requested = Learning::Run.request!(repository: asked, user: @admin)

    perform_enqueued_jobs(only: Learning::Run::FindLearningsJob)

    assert_equal "succeeded", requested.reload.state
    assert_equal "queued", Learning::Run.find_by!(repository: later).state
  end

  test "asking for a run while the daily run waits moves that run ahead of the other daily runs" do
    first = repositories.create(github_id: 2_002, name_with_owner: "github/first")
    second = repositories.create(github_id: 2_003, name_with_owner: "github/second")
    Learning::Run.create! \
      repository: @repository,
      scheduled: true,
      state: "succeeded",
      started_at: 1.day.ago,
      finished_at: 1.day.ago
    [ first, second ].each { use_test_labeler(_1) }
    [ @repository, first, second ].each { learning_comment(_1, @mona, "prototype/signup", "The email field has no label.") }
    Learning::Run.schedule_all!
    waiting = Learning::Run.find_by!(repository: @repository, state: "queued")

    assert_equal waiting, Learning::Run.request!(repository: @repository, user: @mona)
    assert_equal [ false, @mona ], [ waiting.reload.scheduled, waiting.requested_by ]

    perform_enqueued_jobs(only: Learning::Run::FindLearningsJob)
    assert_equal "succeeded", waiting.reload.state
    assert_equal "queued", Learning::Run.find_by!(repository: second).state
  end

  test "asking for a run while the daily run is running leaves that run as it is" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.schedule_all!
    running = Learning::Run.sole
    running.update_columns(state: "running", started_at: Time.current)

    assert_equal running, Learning::Run.request!(repository: @repository, user: @mona)
    assert_equal [ "running", true, nil ], [ running.reload.state, running.scheduled, running.requested_by ]
  end

  test "a daily run whose job was already waiting lets a run someone asks for start first" do
    asked = repositories.create(github_id: 2_002, name_with_owner: "github/asked")
    use_test_labeler(asked)
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.schedule_all!
    daily = Learning::Run.sole
    learning_comment(asked, @mona, "prototype/signup", "The email field has no label.")
    requested = Learning::Run.request!(repository: asked, user: @admin)

    labeling_takes(1.minute) { 5.times { perform_enqueued_jobs(only: Learning::Run::FindLearningsJob) } }

    assert_equal %w[succeeded succeeded], [ requested.reload.state, daily.reload.state ]
    assert_operator requested.started_at, :<, daily.started_at
    assert_no_enqueued_jobs only: Learning::Run::FindLearningsJob
  end

  test "runs people asked for start in the order they asked, also a daily run moved ahead" do
    later = repositories.create(github_id: 2_002, name_with_owner: "github/later")
    first = repositories.create(github_id: 2_003, name_with_owner: "github/first")
    [ @repository, later ].each { learning_comment(_1, @mona, "prototype/signup", "The email field has no label.") }
    Learning::Run.schedule_all!
    running = Learning::Run.find_by!(repository: @repository)
    running.update_columns(state: "running", started_at: Time.current)
    learning_comment(first, @mona, "prototype/signup", "The email field has no label.")
    asked_first = Learning::Run.request!(repository: first, user: @admin)
    travel 1.minute
    Learning::Run.request!(repository: later, user: @mona)
    running.update_columns(state: "succeeded", finished_at: Time.current)

    assert_enqueued_with(job: Learning::Run::FindLearningsJob, args: [ asked_first ]) { Learning::Run.dispatch! }
  end

  test "a daily run already enqueued and then promoted still waits for an earlier request" do
    first = repositories.create(github_id: 2_002, name_with_owner: "github/first")
    use_test_labeler(first)
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    Learning::Run.schedule_all!
    daily = Learning::Run.sole
    learning_comment(first, @mona, "prototype/signup", "The email field has no label.")
    requested = Learning::Run.request!(repository: first, user: @admin)
    travel 1.minute
    Learning::Run.request!(repository: @repository, user: @mona)

    Learning::Run::FindLearningsJob.perform_now(daily)

    assert_equal "queued", daily.reload.state
    assert_nil daily.started_at
    labeling_takes(1.minute) { 5.times { perform_enqueued_jobs(only: Learning::Run::FindLearningsJob) } }
    assert_equal %w[succeeded succeeded], [ requested.reload.state, daily.reload.state ]
    assert_operator requested.started_at, :<, daily.started_at
  end

  test "the stale check leaves a waiting run to the job that claims it" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    travel 2.days
    claiming_during_stale_check(run) { Learning::Run.clear_expired! }
    run.find_learnings!

    assert_equal "succeeded", run.reload.state, run.failure_summary
  end

  test "starts another labeling batch only when it would end within the budget, even at its timeout" do
    3.times { learning_comment(@repository, @mona, "prototype/signup", "Field #{_1} needs a label.") }
    run = Learning::Run.request!(repository: @repository, user: @admin)

    labeling_takes(6.minutes) { with_constants(LABEL_BATCH: 1, LABEL_TIMEOUT: 20.minutes) { run.find_learnings! } }

    assert_equal [ "succeeded", 2, 1 ], [ run.reload.state, run.comments_considered, run.comments_remaining ]
  end

  test "asks Copilot once per labeling command, so access that ends stops the next request" do
    detail = "It is hard to tell what the field is for after typing. " * 40
    10.times { learning_comment(@repository, @mona, "prototype/signup", "Field #{_1} needs a visible label. #{detail}") }
    run = Learning::Run.request!(repository: @repository, user: @admin)
    commands = 0
    remove_after_command = ->(command) do
      result = command.call
      commands += 1
      Repository.where(id: @repository.id).update_all(installation_state: "removed", removed_at: Time.current)
      result
    end

    intercepting("label", with: remove_after_command) { run.find_learnings! }

    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_equal [ 1, 1, 5_000_000 ], [ commands, run.copilot_requests, run.nano_aiu ]
    assert_predicate run.comments_remaining, :positive?
  end

  test "a run that fails in its second labeling batch keeps the usage of the first" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)
    batches = 0
    second_fails = ->(command) do
      batches += 1
      raise Learning::Error.new("Copilot did not answer.", code: "copilot_unavailable") if batches == 2

      command.call
    end

    intercepting("label", with: second_fails) { with_constants(LABEL_BATCH: 1) { run.find_learnings! } }

    assert_equal [ "failed", 1, 5_000_000 ], [ run.reload.state, run.copilot_requests, run.nano_aiu ]
    assert_equal 5_000_000, Learning::Run.usage_since(1.day.ago)
  end

  %w[repository installation].each do |removed|
    test "stops before another labeling batch when the #{removed} becomes unavailable" do
      learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
      learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
      run = Learning::Run.request!(repository: @repository, user: @admin)
      batches = 0
      revoke_after_batch = ->(command) do
        result = command.call
        batches += 1
        if removed == "repository"
          Repository.where(id: @repository.id).update_all(installation_state: "removed", removed_at: Time.current)
        else
          GithubAppConfiguration.where(id: @configuration.id).update_all(installation_state: "suspended")
        end
        result
      end

      intercepting("label", with: revoke_after_batch) { with_constants(LABEL_BATCH: 1) { run.find_learnings! } }

      assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
      assert_equal 1, batches
      assert_equal 1, run.comments_considered
      assert_equal 1, run.copilot_requests
      assert_equal 5_000_000, run.nano_aiu
    end
  end

  test "a run that fails after labeling keeps its usage" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)
    consolidation_fails = ->(_) { raise Learning::Error.new("The store is busy.", code: "learning_failed") }

    intercepting("consolidate", with: consolidation_fails) { run.find_learnings! }

    assert_equal \
      [ "failed", 1, 1, 150, 5_000_000, "test-model" ],
      [ run.reload.state, run.comments_labeled, run.copilot_requests, run.input_tokens + run.output_tokens,
        run.nano_aiu, run.models ]
  end

  test "records verification only for the token the last request actually used" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    original_digest = @connection.token_digest
    run = Learning::Run.request!(repository: @repository, user: @admin)
    replace_after_request = ->(command) do
      result = command.call
      Rails.configuration.x.copilot_token = "renewed-user-token"
      result
    end

    intercepting("label", with: replace_after_request) { run.find_learnings! }

    assert_equal "succeeded", run.reload.state, run.failure_summary
    assert_equal 1, run.copilot_requests
    assert_equal original_digest, @connection.reload.token_digest
  end

  test "consolidation covers the imported snapshot even when labeling takes minutes" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    labeling_takes(10.minutes) { run.find_learnings! }

    assert_equal "succeeded", run.reload.state, run.failure_summary
    assert_equal 1, run.suggestions
    assert_equal 1, run.copilot_requests
  end

  test "an incomplete consolidation fails the run without losing labeling usage" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)
    incomplete = ->(command) { command.call.merge("status" => "incomplete") }

    intercepting("consolidate", with: incomplete) { run.find_learnings! }

    assert_equal %w[failed incomplete_collection], [ run.reload.state, run.failure_code ]
    assert_match "whole review window", run.failure_summary
    assert_equal 5_000_000, run.nano_aiu
  end

  %w[review instruction].each do |purpose|
    test "a run never replaces withdrawn #{purpose} consent, and explicit renewal restores it" do
      learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
      learning_comment(@repository, @hubot, "prototype/checkout", "The card number needs a visible label.")
      Learning::Run.request!(repository: @repository, user: @admin).find_learnings!
      store = Learning::Store.new(@repository)
      suggestion = store.call("memories").sole.fetch("record")
      store.call("accept", suggestion.fetch("id"), "--digest=#{suggestion.fetch("reviewDigest")}", "--by", "github:octocat")
      grant = store.call("grants", "list").sole.dig("grant", "id")
      store.call("grants", "withdraw", grant, "--purpose", purpose, "--by", "github:octocat")

      run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

      assert_equal %w[failed grant_inactive], [ run.reload.state, run.failure_code ]
      assert_equal 1, store.call("grants", "list").size
      recall_count = purpose == "instruction" ? 0 : 1
      assert_equal recall_count, store.call("recall", "--preview", "--by", "github:octocat").fetch("memories").size

      store.call \
        "grants", "add", "--purpose", purpose,
        "--source", Learning::Store::SOURCE, "--basis=The operator explicitly renewed consent.", "--by", "github:octocat"
      renewed = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)
      assert_equal "succeeded", renewed.reload.state, renewed.failure_summary
      assert_equal 1, store.call("recall", "--preview", "--by", "github:octocat").fetch("memories").size
    end
  end

  test "a run never replaces an expired Hub-comment grant" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    store = Learning::Store.new(@repository)
    store.call \
      "grants", "add", "--purpose", "review", "--purpose", "instruction",
      "--source", Learning::Store::SOURCE, "--basis=Consent for one minute.", "--by", "github:octocat",
      "--expires", 1.minute.from_now.utc.iso8601(6)
    travel 2.minutes

    run = Learning::Run.request!(repository: @repository, user: @admin).tap(&:find_learnings!)

    assert_equal %w[failed grant_inactive], [ run.reload.state, run.failure_code ]
    assert_equal 1, store.call("grants", "list").size
  end

  test "Copilot refusing the connection fails the run and stops Hub from asking again" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    failing_to_label { run.find_learnings! }

    assert_equal %w[failed unauthorized], [ run.reload.state, run.failure_code ]
    assert_equal "Copilot refused this token.", run.failure_summary
    assert @connection.reload.refused_at
    assert_not @connection.usable?
    assert SecurityAuditEvent.exists?(action: "copilot_connection.use", outcome: "failed")
  end

  test "a run that a restart stopped is ended so the repository can run again" do
    stopped = Learning::Run.request!(repository: @repository, user: @admin)
    stopped.update_columns(state: "running", started_at: 4.hours.ago)

    replacement = Learning::Run.request!(repository: @repository, user: @admin)

    assert_not_equal stopped, replacement
    assert_equal %w[failed stalled], [ stopped.reload.state, stopped.failure_code ]
    assert_equal "queued", replacement.state
  end

  test "retains recent execution and usage after a run waited longer than retention" do
    recent = Learning::Run.create! \
      repository: @repository, state: "succeeded", created_at: 91.days.ago,
      started_at: 1.day.ago, finished_at: 1.day.ago, nano_aiu: 123
    expired = Learning::Run.create! \
      repository: @repository, state: "succeeded", created_at: 92.days.ago,
      started_at: 91.days.ago, finished_at: 91.days.ago

    Learning::Run.clear_expired!

    assert Learning::Run.exists?(recent.id)
    assert_not Learning::Run.exists?(expired.id)
    assert_equal 123, Learning::Run.usage_since(30.days.ago)
  end

  test "does nothing for a repository whose Learnings turned off before the run started" do
    run = Learning::Run.request!(repository: @repository, user: @admin)
    @connection.destroy!

    run.find_learnings!

    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_not Learning::Store.new(@repository).directory.join("learning.sqlite").exist?
  end

  test "a waiting run reloads its repository and imports nothing after removal" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)
    run.repository
    Repository.where(id: @repository.id).update_all(installation_state: "removed", removed_at: Time.current)

    run.find_learnings!

    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_not Learning::Store.new(@repository).directory.join("learning.sqlite").exist?
  end

  test "a waiting run imports nothing while the App installation is suspended" do
    learning_comment(@repository, @mona, "prototype/signup", "The email field has no label.")
    run = Learning::Run.request!(repository: @repository, user: @admin)
    @configuration.update!(installation_state: "suspended")

    run.find_learnings!

    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_not Learning::Store.new(@repository).directory.join("learning.sqlite").exist?
  end

  test "local development uses a local repository and the developer's own Copilot sign-in" do
    in_local_mode do |root|
      path = root.join("prototypes")
      system("git", "init", "--quiet", path.to_s, exception: true)
      identity = LocalDevelopment.repository_identity(path, create: true)
      local = repositories.create \
        github_id: nil,
        name_with_owner: "local/prototypes",
        local_path: path.to_s,
        local_identity: identity
      developer = users.create(github_id: nil, login: "developer")
      use_test_labeler(local)
      comment = learning_comment(local, developer, "prototype/signup", "The email field has no label.")
      comment.thread.resolve_by!(developer)
      learning_comment(local, developer, "prototype/checkout", "The card number needs a visible label.")
      snapshot = Learning::Collection.new(Learning::Store.new(local)).log
      author = snapshot.fetch(:calls).sole.dig(:result, :threads).first.fetch(:author)
      assert_equal developer.id, author.fetch(:localId)
      assert_not author.key?(:githubId)

      assert Learning.available_for?(local)
      assert_not Learning.available_for?(@repository)
      run = Learning::Run.request!(repository: local, user: developer)
      run.find_learnings!

      assert_equal "succeeded", run.reload.state, run.failure_summary
      assert_equal 1, run.suggestions
      grant = Learning::Store.new(local).call("grants", "list").sole.fetch("grant")
      assert_equal "human:developer", grant.dig("grantedBy", "id")
      events = Learning::Store.new(local).call("observations", "--purpose", "review", "--type", "human_comment").fetch("events")
      expected = "hub-user:#{Rails.configuration.x.hub_origin.delete_suffix("/")}/#{developer.id}"
      assert_equal [ expected ], events.map { _1.dig("actor", "id") }.uniq
      assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }
    end
  end

  private

  # Models a real filtered host capture without pretending it covers resolved threads.
  def with_filtered_identity_capture
    original = Learning::Collection.instance_method(:log)
    captures = []
    Learning::Collection.define_method(:log) do
      original.bind_call(self).tap do |log|
        call = log.fetch(:calls).sole
        call.fetch(:input)[:resolution] = "unresolved"
        call.fetch(:result).fetch(:threads).select! { _1[:resolvedAt].nil? }
        captures << log
      end
    end
    yield captures
  ensure
    Learning::Collection.define_method(:log, original)
  end

  # Recreates pre-upgrade Hub imports without immutable identity fields, through the real command.
  def import_legacy_comments
    import_legacy_learning_comments(@repository, by: "github:octocat")
  end

  # Every file of the repository's store, as one string, to check what text is on disk.
  def store_bytes
    Dir[Learning::Store.new(@repository).directory.join("learning.sqlite*")].sum("") { File.binread(_1) }
  end

  # How many comment threads, comment events, and imports the repository's store holds.
  def store_counts
    Learning::Store.new(@repository).call("status").fetch("counts").slice("episodes", "events", "completeCollections")
  end

  # Every data file of a store that the JSON Lines provider keeps, as one string.
  def json_lines_bytes
    Dir[Learning::Store.new(@repository).directory.join("v1", "*")].sum("") { File.binread(_1) }
  end

  # Switches a store's configuration to another memory provider, the way an operator could.
  def use_provider(repository, provider)
    config = Learning::Store.new(repository).directory.join("config.json")
    File.write(config, JSON.generate(JSON.parse(config.read).merge("memory" => { "provider" => provider })))
  end

  def with_constants(**values)
    previous = values.to_h { |name, _| [ name, Learning::Run.const_get(name) ] }
    values.each { |name, value| replace_constant(name, value) }
    yield
  ensure
    previous.each { |name, value| replace_constant(name, value) }
  end

  def replace_constant(name, value)
    Learning::Run.send(:remove_const, name)
    Learning::Run.const_set(name, value)
  end

  def in_local_mode
    original_enabled = LocalDevelopment.method(:enabled?)
    original_root = LocalDevelopment.method(:repositories_root)
    root = Pathname(Dir.mktmpdir("replica-local-")).realpath
    LocalDevelopment.define_singleton_method(:enabled?) { true }
    LocalDevelopment.define_singleton_method(:repositories_root) { root }
    yield root
  ensure
    LocalDevelopment.define_singleton_method(:enabled?, original_enabled)
    LocalDevelopment.define_singleton_method(:repositories_root, original_root)
    FileUtils.rm_rf(root)
  end

  # Makes labeling fail the way Copilot does, by default by refusing Hub's Copilot token.
  def failing_to_label(code: "unauthorized", message: "Copilot refused this token.", &block)
    intercepting("label", with: ->(_) { raise Learning::Error.new(message, code:) }, &block)
  end

  # Makes each labeling command take the given time, as Hub's clock sees it.
  def labeling_takes(duration, &block)
    intercepting("label", with: ->(command) { command.call.tap { travel duration } }, &block)
  end

  # A queue that refuses every job, the way a failed write to the queue database does.
  class RefusingQueue < ActiveJob::QueueAdapters::AbstractAdapter
    def enqueue(*) = raise(ActiveJob::EnqueueError, "The queue database refused the job.")
    def enqueue_at(*) = raise(ActiveJob::EnqueueError, "The queue database refused the job.")
  end

  # Makes the queue refuse a job class while the block runs.
  def refusing_jobs(job)
    original = job.queue_adapter
    job.queue_adapter = RefusingQueue.new
    yield
  ensure
    job.queue_adapter = original
  end

  # Replaces one kind of replica-learning command with the given lambda, which receives the real
  # command. Other commands run as usual.
  def intercepting(name, with:)
    original = Learning::Store.method(:new)
    Learning::Store.define_singleton_method(:new) do |repository|
      original.call(repository).tap do |store|
        real = store.method(:call)
        store.define_singleton_method(:call) do |*arguments, **options|
          command = -> { real.call(*arguments, **options) }
          arguments.first == name ? with.call(command) : command.call
        end
      end
    end
    yield
  ensure
    Learning::Store.singleton_class.remove_method(:new)
  end

  # Lets the run's job claim and finish the run at the moment Hub's stale check decides to fail it,
  # the way a worker can claim a run between the check's read and its write.
  def claiming_during_stale_check(run)
    original = Learning::Run.instance_method(:fail!)
    Learning::Run.define_method(:fail!) do |code, message|
      run.find_learnings! if id == run.id && code == "stalled"
      original.bind_call(self, code, message)
    end
    yield
  ensure
    Learning::Run.define_method(:fail!, original)
  end
end
