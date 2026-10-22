require "test_helper"
require "timeout"

# Uses committed, isolated databases and the real Solid Queue adapter and learning CLI.
class LearningExecutionTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  include LearningTestHelpers

  self.use_transactional_tests = false

  def before_setup
    @original_handler = ActiveRecord::Base.connection_handler
    @original_default_handler = ActiveRecord::Base.default_connection_handler
    @original_queue_connection_name = SolidQueue::Record.connection_specification_name
    @handler = ActiveRecord::ConnectionAdapters::ConnectionHandler.new
    ActiveRecord::Base.default_connection_handler = @handler
    ActiveRecord::Base.connection_handler = @handler
    @directory = Dir.mktmpdir("replica-learning-queue-")
    ActiveRecord::Migration.suppress_messages do
      ActiveRecord::Base.establish_connection(database_configuration("queue"))
      load Rails.root.join("db/queue_schema.rb")
      SolidQueue::Record.establish_connection(database_configuration("queue"))
      ActiveRecord::Base.establish_connection(database_configuration("primary"))
      load Rails.root.join("db/schema.rb")
    end
    super
  end

  def after_teardown
    super
  ensure
    begin
      @handler&.clear_all_connections!(:all)
    ensure
      ActiveRecord::Base.default_connection_handler = @original_default_handler
      ActiveRecord::Base.connection_handler = @original_handler
      SolidQueue::Record.connection_specification_name = @original_queue_connection_name
      FileUtils.remove_entry(@directory) if @directory
    end
  end

  def queue_adapter_for_test
    ActiveJob::QueueAdapters::SolidQueueAdapter.new
  end

  setup do
    github_app_configurations.create_installed
    @admin = users.create(hub_admin: true)
    connect_copilot(@admin)
    @repository = repositories.create
    @author = users.create(github_id: 1_002, login: "mona")
    @comment = learning_comment(@repository, @author, "prototype/signup", "Private deleted label marker-one.")
    use_test_labeler(@repository)
    @store = Learning::Store.new(@repository)
    @process = SolidQueue::Process.register \
      kind: "Worker", name: "learning-test-#{SecureRandom.hex(8)}", pid: Process.pid, hostname: "test"
  end

  test "a run that waited ready keeps a redaction out after its queue semaphore expires" do
    learning_comment(@repository, users.create(github_id: 1_003), "prototype/checkout", "Retained label marker-two.")
    directory = @store.directory
    FileUtils.cp \
      Rails.root.join("test/fixtures/files/learning-blocked-labeler.mjs"),
      directory.join("blocked-labeler.mjs")
    config = JSON.parse(directory.join("config.json").read)
    config.fetch("labeling").fetch("labeler")["module"] = "./blocked-labeler.mjs"
    directory.join("config.json").write(JSON.generate(config))
    run = Learning::Run.request!(repository: @repository, user: @admin)
    semaphore_expiry = SolidQueue::Semaphore.sole.expires_at
    travel 45.minutes
    execution = claim(Learning::Run::FindLearningsJob.name)
    assert_equal semaphore_expiry, SolidQueue::Semaphore.sole.expires_at
    worker = Thread.new { Rails.application.executor.wrap { execution.perform } }
    Timeout.timeout(10) { sleep 0.01 until directory.join("label-started").file? }
    assert_equal "running", run.reload.state

    @comment.thread.delete_body!(actor: @author)
    removal = SolidQueue::BlockedExecution.sole.job
    travel 20.minutes
    assert_operator semaphore_expiry, :<, Time.current
    assert_equal 1, SolidQueue::Semaphore.expired.delete_all
    assert_equal 1, SolidQueue::BlockedExecution.unblock(100)
    assert_equal removal.id, claim(ReviewComment::RemoveFromLearningStoreJob.name).tap(&:perform).job_id

    retry_job = SolidQueue::ScheduledExecution.sole.job
    assert_equal ReviewComment::RemoveFromLearningStoreJob.name, retry_job.class_name
    assert_equal 1, retry_job.arguments.fetch("executions")
    assert_empty SolidQueue::FailedExecution.all
    assert_includes store_bytes, "Private deleted label marker-one."
    directory.join("label-release").write("Release the owned test labeler.")
    assert worker.join(20), "The learning run did not finish."
    worker.value
    assert_equal "succeeded", run.reload.state, run.failure_summary

    travel 35.seconds
    assert_equal 1, SolidQueue::ScheduledExecution.dispatch_next_batch(100)
    claim(ReviewComment::RemoveFromLearningStoreJob.name).perform

    assert_not_includes store_bytes, "Private deleted label marker-one."
    assert_includes store_bytes, "Retained label marker-two."
    assert_empty SolidQueue::FailedExecution.all
  ensure
    directory&.join("label-release")&.write("Release the owned test labeler.")
    if worker && !worker.join(20)
      Process.kill("KILL", directory.join("label-started").read.to_i)
      assert worker.join(5), "The test's learning worker did not stop."
    end
    worker&.value
  end

  test "a paused redaction keeps an expired queue lease from admitting a new run" do
    @store.prepare!
    grants = @store.grant_ids!(by: "github:octocat", basis: "Queue regression fixture.")
    Learning::Collection.new(@store).import!(grants)
    entered = Queue.new
    release = Queue.new
    original = Learning::Store.instance_method(:remove_comment!)
    Learning::Store.define_method(:remove_comment!) do |comment_id, by:|
      entered << true
      release.pop(timeout: 15) || raise("The test did not release its redaction.")
      original.bind_call(self, comment_id, by:)
    end
    @comment.thread.delete_body!(actor: @author)
    execution = claim(ReviewComment::RemoveFromLearningStoreJob.name)
    worker = Thread.new { Rails.application.executor.wrap { execution.perform } }
    assert entered.pop(timeout: 5)
    before = store_bytes
    travel 16.minutes
    assert_equal 1, SolidQueue::Semaphore.expired.delete_all
    run = Learning::Run.request!(repository: @repository, user: @admin)

    claim(Learning::Run::FindLearningsJob.name).perform

    assert_equal "queued", run.reload.state
    assert_nil run.started_at
    assert_nil run.failure_code
    assert_equal before, store_bytes
    assert_equal Learning::Run::FindLearningsJob.name, SolidQueue::ScheduledExecution.sole.job.class_name
    release << true
    assert worker.join(15)
    worker.value
    assert_not_includes store_bytes, "Private deleted label marker-one."
    travel 35.seconds
    assert_equal 1, SolidQueue::ScheduledExecution.dispatch_next_batch(100)
    claim(Learning::Run::FindLearningsJob.name).perform
    assert_equal "succeeded", run.reload.state, run.failure_summary
    assert_not_includes store_bytes, "Private deleted label marker-one."
    assert_empty SolidQueue::FailedExecution.all
  ensure
    release&.push(true)
    assert worker.join(20) if worker
    worker&.value
    Learning::Store.define_method(:remove_comment!, original) if original
  end

  test "exhausted lock retries fail a waiting run visibly without touching the locked store" do
    run = Learning::Run.request!(repository: @repository, user: @admin)
    before = store_bytes
    lock = File.open(Rails.configuration.x.learning_root, File::RDONLY)
    assert lock.flock(File::LOCK_EX | File::LOCK_NB)
    attempts = Learning::ExecutionLock::RETRY.fetch(:attempts)
    assert_equal 121, attempts

    (attempts - 1).times do
      claim(Learning::Run::FindLearningsJob.name).perform
      assert_equal "queued", run.reload.state
      assert_nil run.started_at
      travel_to SolidQueue::ScheduledExecution.sole.scheduled_at + 1.second
      assert_equal 1, SolidQueue::ScheduledExecution.dispatch_next_batch(100)
    end
    assert_raises(Learning::ExecutionLock::Busy) { claim(Learning::Run::FindLearningsJob.name).perform }

    assert_equal %w[failed execution_lock_busy], [ run.reload.state, run.failure_code ]
    assert_nil run.started_at
    assert run.finished_at
    assert_includes run.failure_summary, "operator"
    assert_equal Learning::Run::FindLearningsJob.name, SolidQueue::FailedExecution.sole.job.class_name
    assert_empty SolidQueue::ScheduledExecution.all
    assert_equal before, store_bytes
    lock.close
    Learning::Run.clear_expired!
    assert_empty SolidQueue::ReadyExecution.all
    Learning::Run.request!(repository: @repository, user: @admin).tap do |replacement|
      claim(Learning::Run::FindLearningsJob.name).perform
      assert_equal "succeeded", replacement.reload.state, replacement.failure_summary
    end
  ensure
    lock&.close if !lock&.closed?
  end

  test "exhausted removal lock retries stay visible and recover after the durable due time" do
    grants = @store.grant_ids!(by: "github:octocat", basis: "Lock recovery regression.")
    Learning::Collection.new(@store).import!(grants)
    @comment.thread.delete_body!(actor: @author)
    lock = File.open(Rails.configuration.x.learning_root, File::RDONLY)
    assert lock.flock(File::LOCK_EX | File::LOCK_NB)
    attempts = Learning::ExecutionLock::RETRY.fetch(:attempts)
    assert_equal 121, attempts
    CopilotConnection.current.destroy!

    (attempts - 1).times do
      claim(ReviewComment::RemoveFromLearningStoreJob.name).perform
      assert @comment.reload.learning_removal_due_at
      travel_to SolidQueue::ScheduledExecution.sole.scheduled_at + 1.second
      assert_equal 1, SolidQueue::ScheduledExecution.dispatch_next_batch(100)
    end
    assert_raises(Learning::ExecutionLock::Busy) { claim(ReviewComment::RemoveFromLearningStoreJob.name).perform }

    assert_equal ReviewComment::RemoveFromLearningStoreJob.name, SolidQueue::FailedExecution.sole.job.class_name
    assert_empty SolidQueue::ScheduledExecution.all
    assert_includes store_bytes, "Private deleted label marker-one."
    assert @comment.reload.learning_removal_due_at.future?
    lock.close
    ReviewComment.recover_learning_removals!
    assert_empty SolidQueue::ReadyExecution.all
    travel ReviewComment::LEARNING_REMOVAL_RETRY + 1.second
    ReviewComment.recover_learning_removals!
    assert_equal 1, SolidQueue::ReadyExecution.count
    ReviewComment.recover_learning_removals!
    assert_equal 1, SolidQueue::ReadyExecution.count
    claim(ReviewComment::RemoveFromLearningStoreJob.name).perform
    assert_nil @comment.reload.learning_removal_due_at
    assert_not_includes store_bytes, "Private deleted label marker-one."
  ensure
    lock&.close if !lock&.closed?
  end

  %w[repository installation].each do |removed|
    test "stops before a second real request after #{removed} access ends during the first" do
      directory = use_multirequest_labeler("pause-first")
      run = Learning::Run.request!(repository: @repository, user: @admin)
      execution = claim(Learning::Run::FindLearningsJob.name)
      worker = Thread.new { Rails.application.executor.wrap { execution.perform } }
      Timeout.timeout(10) { sleep 0.01 until directory.join("label-started").file? }
      if removed == "repository"
        @repository.update!(installation_state: "removed", removed_at: Time.current)
      else
        GithubAppConfiguration.current.update!(installation_state: "suspended")
      end
      directory.join("label-release").write("Release the owned test labeler.")
      assert worker.join(20), "The learning run did not finish."
      worker.value
      requests = label_requests(directory)

      assert_equal 1, requests.size, "Review text was sent again after access ended."
      assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
      assert_equal requests.first.fetch("comments").size, run.comments_considered
      assert_operator run.comments_remaining, :>, 0
      assert_equal 1, run.copilot_requests
      assert_equal 5_000_000, run.nano_aiu
      assert_empty SolidQueue::FailedExecution.all
    ensure
      directory&.join("label-release")&.write("Release the owned test labeler.")
      if worker && !worker.join(20)
        Process.kill("KILL", directory.join("label-started").read.to_i)
        assert worker.join(5), "The test's learning worker did not stop."
      end
      worker&.value
    end
  end

  test "a failure in the second real request keeps the first request's completed usage" do
    directory = use_multirequest_labeler("fail-second")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    claim(Learning::Run::FindLearningsJob.name).perform

    requests = label_requests(directory)
    assert_equal "failed", run.reload.state
    assert_match(/second model request failed/i, run.failure_summary)
    assert_equal 2, requests.size
    assert_equal 1, run.copilot_requests
    assert_equal 5_000_000, run.nano_aiu
    assert_equal 150, run.input_tokens + run.output_tokens
    assert_equal requests.sum { _1.fetch("comments").size }, run.comments_considered
    assert_equal requests.first.fetch("comments").size, run.comments_labeled
    assert_equal requests.last.fetch("comments").size, run.comments_remaining
    assert_equal 2, requests.pluck("pid").uniq.size, "The command made more than one model request."
    assert_empty SolidQueue::FailedExecution.all
  end

  test "a real labeler cleanup failure retains its completed usage and does not claim success" do
    directory = use_multirequest_labeler("fail-close")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    claim(Learning::Run::FindLearningsJob.name).perform

    requests = label_requests(directory)
    assert_equal %w[failed unavailable], [ run.reload.state, run.failure_code ]
    assert_equal 1, run.failure_summary.scan("The model runtime could not close.").size
    assert_equal 1, requests.size
    assert_equal 1, run.copilot_requests
    assert_equal 5_000_000, run.nano_aiu
    assert_equal requests.first.fetch("comments").size, run.comments_considered
    assert_equal run.comments_considered, run.comments_labeled
    assert_operator run.comments_remaining, :>, 0
    assert_empty SolidQueue::FailedExecution.all
  end

  test "a refused request with malformed usage still disables Copilot and retains earlier charges" do
    directory = use_multirequest_labeler("unauthorized-usage")
    run = Learning::Run.request!(repository: @repository, user: @admin)

    claim(Learning::Run::FindLearningsJob.name).perform

    assert_equal %w[failed unauthorized], [ run.reload.state, run.failure_code ]
    assert_match(/usage.*unknown/i, run.failure_summary)
    assert_includes run.failure_summary, "Synthetic token refused."
    assert_equal 2, label_requests(directory).size
    assert_equal 1, run.copilot_requests
    assert_equal 5_000_000, run.nano_aiu
    assert CopilotConnection.current.refused?
    assert_not CopilotConnection.current.usable?
    assert_no_difference("Learning::Run.count") { Learning::Run.schedule_all! }
    assert_empty SolidQueue::FailedExecution.all
  end

  private

  def use_multirequest_labeler(mode)
    # All targets fit the production comment limit but exceed one real 16,000-character group.
    assert_operator Learning::Run::LABEL_BATCH, :>=, 11
    10.times do |index|
      learning_comment(@repository, @author, "prototype/large-#{index}", "A visible label is needed. #{"x" * 2_000}")
    end
    directory = @store.directory
    FileUtils.cp \
      Rails.root.join("test/fixtures/files/learning-multirequest-labeler.mjs"),
      directory.join("multirequest-labeler.mjs")
    config = JSON.parse(directory.join("config.json").read)
    config.fetch("labeling").fetch("labeler")["module"] = "./multirequest-labeler.mjs"
    directory.join("config.json").write(JSON.generate(config))
    directory.join("label-mode").write(mode)
    directory
  end

  def label_requests(directory)
    directory.join("label-requests.jsonl").read.lines.map { JSON.parse(_1) }
  end

  def database_configuration(name)
    ActiveRecord::DatabaseConfigurations::HashConfig.new \
      "test", name, { adapter: "sqlite3", database: File.join(@directory, "#{name}.sqlite3"), timeout: 5000 }
  end

  def claim(class_name)
    execution = SolidQueue::ReadyExecution.claim([ "default" ], 1, @process.id).sole
    assert_equal class_name, execution.job.class_name
    execution
  end

  def store_bytes
    @store.directory.glob("**/*").select(&:file?).map { _1.binread.force_encoding(Encoding::UTF_8).scrub }.join
  end
end
