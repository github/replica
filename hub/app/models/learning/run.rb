# == Schema Information
#
# Table name: learning_runs
# Database name: primary
#
#  id                    :integer          not null, primary key
#  comments_considered   :integer          default(0), not null
#  comments_labeled      :integer          default(0), not null
#  comments_remaining    :integer          default(0), not null
#  copilot_requests      :integer          default(0), not null
#  failure_code          :string
#  failure_summary       :string
#  finished_at           :datetime
#  input_tokens          :bigint           default(0), not null
#  models                :string
#  nano_aiu              :bigint           default(0), not null
#  output_tokens         :bigint           default(0), not null
#  scheduled             :boolean          default(FALSE), not null
#  started_at            :datetime
#  state                 :string           default("queued"), not null
#  suggestions           :integer          default(0), not null
#  suggestions_remaining :integer          default(0), not null
#  created_at            :datetime         not null
#  updated_at            :datetime         not null
#  repository_id         :integer          not null
#  requested_by_id       :integer
#
# Indexes
#
#  index_learning_runs_on_active_repository             (repository_id) UNIQUE WHERE state IN ('queued', 'running')
#  index_learning_runs_on_created_at                    (created_at)
#  index_learning_runs_on_repository_id_and_created_at  (repository_id,created_at)
#  index_learning_runs_on_requested_by_id               (requested_by_id)
#
# Foreign Keys
#
#  repository_id    (repository_id => repositories.id) ON DELETE => cascade
#  requested_by_id  (requested_by_id => users.id) ON DELETE => nullify
#
# Check Constraints
#
#  learning_runs_counts  (comments_considered >= 0 AND comments_labeled >= 0 AND comments_remaining >= 0 AND suggestions >= 0 AND suggestions_remaining >= 0 AND copilot_requests >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND nano_aiu >= 0)
#  learning_runs_state   (state IN ('queued', 'running', 'succeeded', 'failed'))
#
# Records one time Hub looked for learnings in a repository, and does that work in the background.
#
# A run imports the repository's review comments, asks Copilot to label each new or edited comment,
# and consolidates the labels into suggestions for repository administrators. Hub queues a run each
# day for every repository whose comments changed or that has comments left to label, and whenever
# a repository administrator asks. Runs happen one at a time: Hub starts the next waiting run when
# one finishes, so a run keeps its place however long the queue is.
class Learning::Run < ApplicationRecord
  self.table_name = "learning_runs"

  STATES = %w[queued running succeeded failed].freeze
  ACTIVE = %w[queued running].freeze
  RETENTION = 90.days
  # Suggestions come from comments made within this window, so old feedback fades out.
  WINDOW = 90.days
  # Each labeling command makes one Copilot request, which the labeler gives two minutes. The rest
  # of the time covers starting and stopping the Copilot runtime around it.
  LABEL_TIMEOUT = 5.minutes
  # How long a run keeps asking Copilot before it leaves the remaining comments for the next run.
  LABEL_BUDGET = 30.minutes
  # The most comments one labeling command considers.
  LABEL_BATCH = 400
  # The most new suggestions one run makes. Themes past it wait for the next run, which Hub
  # schedules even when no comment changed, so a person reviews a few at a time.
  MAX_SUGGESTIONS = 10
  # A run ends within about 40 minutes: an import, labeling within its budget, and consolidation,
  # each with a timeout. One still running after this long was stopped by a restart.
  STALLED = 1.hour
  ACTOR = "system:replica-hub".freeze

  belongs_to :repository
  belongs_to :requested_by, class_name: "User", optional: true

  performs :find_learnings!, queue_as: :default do
    self.enqueue_after_transaction_commit = true
    limits_concurrency **Learning::CONCURRENCY, duration: STALLED
    retry_on Learning::ExecutionLock::Busy, **Learning::ExecutionLock::RETRY do |job, error|
      job.arguments.first.fail_lock_wait!
      raise error
    end
    # A run takes minutes, so a removal of deleted comments that waits for the store goes first.
    queue_with_priority 1
    discard_on ActiveJob::DeserializationError
  end

  validates :state, inclusion: { in: STATES }

  scope :recent, -> { order(created_at: :desc, id: :desc) }
  scope :waiting, -> { where(state: "queued").order(:scheduled, :updated_at, :id) }
  scope :used_since, ->(time) { where(started_at: time..) }

  class << self
    # Queues a run for each repository whose comments changed since its last successful run, or
    # whose last run left comments to label, least recently run first, and starts the first one.
    # Hub schedules runs only while a Hub administrator keeps a usable Copilot connection.
    def schedule_all!
      return if LocalDevelopment.enabled? || !CopilotConnection.current&.usable?

      due = Repository.active.select { Learning.available_for?(_1) && due?(_1) }
      last_started = where(repository: due).group(:repository_id).maximum(:started_at)
      due.sort_by { [ last_started[_1.id].to_f, _1.id ] }.each { start!(repository: _1, scheduled: true) }
      dispatch!
    end

    # Queues the run a repository administrator asked for, ahead of scheduled runs, or returns the
    # one already waiting or running for that repository. A daily run still waiting becomes the
    # request, so it moves ahead too.
    def request!(repository:, user:)
      promote!(start!(repository:, requested_by: user), user).tap { dispatch! }
    end

    # Ends runs that a restart stopped, starts the next waiting run, and removes finished runs older
    # than the retention period.
    def clear_expired!
      fail_stalled!
      dispatch!
      where(finished_at: ...RETENTION.ago).where.not(state: ACTIVE).delete_all
    end

    # Starts the next waiting run unless one is running: runs people asked for first, in the order
    # they asked, then scheduled runs in the order Hub queued them. Hub changes a waiting run only to
    # turn it into a request, so its update time is when it was queued or asked for. Calling this
    # again before that run starts enqueues its job again, which does no harm, because only one job
    # can claim a run.
    def dispatch!
      return if exists?(state: "running")

      waiting.first&.find_learnings_later!
    end

    # The Copilot usage, in nano AI units, that runs reported since the given time.
    def usage_since(time)
      used_since(time).sum(:nano_aiu)
    end

    private

    def start!(**attributes)
      fail_stalled!
      create!(**attributes)
    rescue ActiveRecord::RecordNotUnique
      # Another run for this repository is waiting or running; it finished if none is found now.
      where(repository: attributes.fetch(:repository), state: ACTIVE).first || retry
    end

    # Turns a scheduled run that still waits into the person's request. The update changes the run
    # only while it waits, so a run whose job claimed it meanwhile stays as it is.
    def promote!(run, user)
      promoted = where(id: run.id, state: "queued", scheduled: true)
        .update_all(scheduled: false, requested_by_id: user.id, updated_at: Time.current)
      promoted.zero? ? run : run.reload
    end

    def due?(repository)
      last = where(repository:, state: "succeeded").order(:started_at).last
      comments = ReviewComment.ordinary.where(prototype: repository.reviewable_prototypes)
      return comments.exists? if last.nil?

      last.comments_remaining.positive? || last.suggestions_remaining.positive? ||
        comments.where(updated_at: last.started_at..).exists?
    end

    # Fails runs that a restart stopped, in one update that changes only runs still running, so it
    # never overwrites a run that finished meanwhile. A waiting run is never stale.
    def fail_stalled!
      where(state: "running", started_at: ...STALLED.ago).update_all \
        state: "failed",
        finished_at: Time.current,
        failure_code: "stalled",
        failure_summary: "Hub stopped before this run finished.",
        updated_at: Time.current
    end
  end

  # Imports the repository's comments, which removes the text of comments deleted in Hub, labels new
  # comments with Copilot, and records the suggestions it made.
  def find_learnings!
    return if !self.class.where(id:, state: "queued").exists?

    dispatch = false
    Learning::ExecutionLock.synchronize do
      dispatch = true
      find_learnings_in_store!
    end
  rescue Learning::Error => error
    dispatch = fail_unclaimed!(error)
  ensure
    self.class.dispatch! if dispatch
  end

  def fail!(code, message)
    finish!(**failure_attributes(code, message))
  end

  def active?
    state.in?(ACTIVE)
  end

  # Exhausted lock retries fail only a waiting run, never a duplicate's running or finished work.
  def fail_lock_wait!
    error = Learning::Error.new \
      "Hub could not obtain the learning execution lock after repeated retries. An operator must check for a stuck learning writer.",
      code: "execution_lock_busy"
    self.class.dispatch! if fail_unclaimed!(error)
  end

  private

  # Claims and changes the store only while this process owns the execution lock.
  def find_learnings_in_store!
    # A job already enqueued keeps its place in Solid Queue even when a daily run is promoted.
    # Check the current order for every run, not only those that are still scheduled.
    return if !claim!
    return fail!("unavailable", "Learnings is off for this repository.") if !available?

    store = Learning::Store.new(repository)
    store.prepare!
    captured_at = Time.current
    Learning::Collection.new(store, captured_at:).import!(store.grant_ids!(by: grantor, basis:))
    label(store, since: (captured_at - WINDOW).utc.iso8601(6))
    @connection&.verified!(token: @copilot_token) if copilot_requests.positive?
    consolidation = store.call \
      "consolidate",
      "--from", (captured_at - WINDOW).utc.iso8601(6),
      "--to", captured_at.utc.iso8601(6),
      "--actor", ACTOR,
      "--max", MAX_SUGGESTIONS.to_s
    succeed!(consolidation)
  rescue CopilotConnection::Refused => error
    fail!("copilot_refused", error.message)
  rescue Learning::Error => error
    @connection&.refuse!(token: @copilot_token) if error.code == "unauthorized"
    fail!(error.code, error.message)
  rescue StandardError
    fail!("failed", "Hub could not finish this run.")
    raise
  end

  # A lock-open failure ends only a queued run, never another worker's running or finished run.
  def fail_unclaimed!(error)
    changed = self.class.where(id:, state: "queued").update_all \
      **failure_attributes(error.code, error.message),
      finished_at: Time.current,
      updated_at: Time.current
    reload if changed.positive?
    changed.positive?
  end

  # Keeps failures bounded consistently whether work started or failed before its claim.
  def failure_attributes(code, message)
    { state: "failed", failure_code: code.to_s.first(60), failure_summary: message.to_s.first(1_000) }
  end

  # Rechecks installation state when the job starts, after a queued repository may have been removed.
  def available?
    repository.reload
    return false if repository.installation_state != "active" || !Learning.available_for?(repository)
    return LocalDevelopment.repository_available?(repository.local_path, identity: repository.local_identity) if repository.local?

    GithubAppConfiguration.current&.installation_state == "active"
  end

  # Claims only the next waiting run, atomically with its current order, so an old job cannot jump ahead.
  def claim!
    claimed = self.class.where(id:, state: "queued")
      .where(id: self.class.waiting.limit(1).select(:id))
      .update_all(state: "running", started_at: Time.current, updated_at: Time.current)
    reload if claimed == 1
    claimed == 1
  end

  # The operator's Copilot token while the connection allows Hub to use it, or none in local
  # development, where Copilot uses whoever is signed in. Remembers both, so a refusal applies only
  # to the token Copilot actually refused.
  def copilot_token
    return nil if LocalDevelopment.enabled?

    @connection = CopilotConnection.current
    raise CopilotConnection::Refused, "Copilot is not connected." if @connection.nil?

    @copilot_token = @connection.access_token!
  end

  # Who allowed Hub to use this repository's comments: the person who connected Copilot, or the
  # developer in local development.
  def grantor
    person = LocalDevelopment.enabled? ? requested_by : CopilotConnection.current&.user
    raise CopilotConnection::Refused, "Copilot is not connected." if person.nil?

    Learning.person_for(person)
  end

  def basis
    return "Local development: the developer asked Hub to find learnings." if LocalDevelopment.enabled?

    "A Hub administrator connected Copilot, which turns on Learnings for this Hub's repositories."
  end

  # Asks Copilot about the new or edited comments in the window, one request per command, until none
  # wait or the labeling budget is spent. Hub checks that Learnings and the repository are still
  # available before each request and saves each request's usage after it, so access that ends
  # stops the next request and a request that fails keeps the usage of the ones before it. The store
  # records each successful result so only still-pending comment versions are tried again. Another
  # request starts only if it would end within the budget even at its timeout. A failed command's
  # partial report preserves known usage without claiming that its work succeeded.
  def label(store, since:)
    totals = { considered: 0, labeled: 0, remaining: 0, requests: 0, input_tokens: 0, output_tokens: 0,
      nano_aiu: 0, models: [] }
    deadline = LABEL_BUDGET.from_now
    loop do
      if !available?
        raise Learning::Error.new("Learnings is off for this repository.", code: "unavailable")
      end

      batch = begin
        store.call \
          "label",
          "--since", since,
          "--limit", LABEL_BATCH.to_s,
          "--max-requests", "1",
          copilot_token:,
          timeout: LABEL_TIMEOUT
      rescue Learning::Error => error
        record_labeling!(totals, error.labeling_result) if error.labeling_result
        raise
      end
      record_labeling!(totals, batch)
      break if totals[:remaining].zero? || batch.fetch("considered").zero? || LABEL_TIMEOUT.from_now > deadline
    end
  rescue KeyError, TypeError, NoMethodError
    raise Learning::Error.new("replica-learning returned output Hub could not read.", code: "unreadable_output")
  end

  # Saves what labeling has done so far, after each batch, so a run that fails later still shows
  # the Copilot usage it caused.
  def record_labeling!(totals, batch)
    usage = batch.fetch("usage")
    totals[:considered] += batch.fetch("considered")
    totals[:labeled] += batch.fetch("labeled")
    totals[:remaining] = batch.fetch("remaining")
    totals[:requests] += usage.fetch("requests")
    totals[:input_tokens] += usage.fetch("inputTokens")
    totals[:output_tokens] += usage.fetch("outputTokens")
    totals[:nano_aiu] += usage.fetch("nanoAiu")
    totals[:models] |= Array(batch["models"])
    update! \
      comments_considered: totals[:considered],
      comments_labeled: totals[:labeled],
      comments_remaining: totals[:remaining],
      copilot_requests: totals[:requests],
      input_tokens: totals[:input_tokens],
      output_tokens: totals[:output_tokens],
      nano_aiu: totals[:nano_aiu],
      models: totals[:models].join(", ").first(200).presence
  end

  def succeed!(consolidation)
    if consolidation.fetch("status") != "complete"
      raise Learning::Error.new \
        "The learning store did not collect the whole review window. Run replica-learning verify before trying again.",
        code: "incomplete_collection"
    end

    finish! \
      state: "succeeded",
      suggestions: Array(consolidation["proposals"]).count { changed_since_start?(_1) },
      suggestions_remaining: Integer(consolidation.fetch("overBudget", 0)).clamp(0, nil)
  end

  # Inline adapters must not start the next mutation until the current execution lock is released.
  def finish!(**attributes)
    update!(**attributes, finished_at: Time.current)
    self.class.dispatch! if Learning::ExecutionLock.current.nil?
  end

  # Consolidation returns every suggestion it still makes; only the new or changed ones count.
  # The store records times to the millisecond.
  def changed_since_start?(proposal)
    Time.iso8601(proposal.fetch("updatedAt")) >= started_at.floor(3)
  rescue KeyError, ArgumentError, TypeError
    false
  end
end
