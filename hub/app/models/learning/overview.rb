# Reads what a repository's Learnings page shows from its store: suggestions with the comments
# behind them, accepted learnings, and what an agent gets.
#
# Evidence is joined to this repository's review comments, so a person sees who said what, on
# which prototype, before deciding. Evidence from another Hub or repository is counted, not shown.
class Learning::Overview
  EMPTY = { suggestions: [], learnings: [], identityReviewCount: 0, recall: { text: "", count: 0 } }.freeze
  EVIDENCE_BATCH = 100

  # The viewer is the person the page is for. The store lets only a person preview recall, and
  # records no use for a preview.
  def initialize(store, viewer:)
    @store = store
    @repository = store.repository
    @viewer = viewer
  end

  def load
    return EMPTY if !@store.exist?

    memories, recall = parallel \
      [ "memories" ],
      [ "recall", "--preview", "--by", @viewer ]
    proposals = memories.select do |item|
      item.dig("record", "state") == "proposed" && !item["withheld"] && !problems?(item) && !identity_review_pending?(item)
    end
    references = proposals.flat_map do |item|
      Array(item.dig("record", "evidence")) + Array(item.dig("record", "contradictions"))
    end.select { local_source?(_1["source"] || {}) }
    comments = review_comments(references)
    events = review_events(references)
    recalled_ids = recall.fetch("memories").pluck("id")
    records = memories.index_by { _1.dig("record", "id") }
    {
      suggestions: proposals.map { suggestion(_1, comments, events, records) },
      learnings: memories.filter_map { learning(_1, recalled_ids) },
      identityReviewCount: memories.count do |item|
        %w[proposed accepted].include?(item.dig("record", "state")) && identity_review_pending?(item)
      end,
      recall: { text: recall.fetch("text"), count: recall.fetch("memories").size }
    }
  rescue KeyError, TypeError, NoMethodError
    raise Learning::Error.new("replica-learning returned output Hub could not read.", code: "unreadable_output")
  end

  private

  # Runs the commands side by side and raises the first failure. The threads only wait on child
  # processes, so they stay out of Rails' executor; joining it while this request waits on them can
  # stall a code reload in development.
  def parallel(*commands)
    threads = commands.map { @store.command(*_1) }.map do |command|
      Thread.new do
        Thread.current.report_on_exception = false
        command.call
      end
    end
    threads.map(&:value)
  end

  def suggestion(item, comments, events, records)
    record = item.fetch("record")
    evidence = Array(record["evidence"]).map { evidence(_1, comments, events) }
    contradictions = Array(record["contradictions"]).map { evidence(_1, comments, events) }
    {
      id: record.fetch("id"),
      reviewDigest: record.fetch("reviewDigest"),
      content: record.fetch("content"),
      reviewers: record.dig("support", "distinctReviewers"),
      prototypes: record.dig("support", "distinctPrototypes"),
      threads: record.dig("support", "distinctEpisodes"),
      replaces: Array(record.dig("proposal", "lifecycle", "targets")).map do |id|
        target = records[id]
        { id:, content: target && !target["withheld"] ? target.dig("record", "content") : nil }
      end,
      evidence: evidence.flatten,
      otherEvidence: evidence.count(&:empty?),
      contradictions: contradictions.flatten,
      otherContradictions: contradictions.count(&:empty?)
    }
  end

  def learning(item, recalled_ids)
    record = item.fetch("record")
    return if record["state"] != "accepted"

    status = item.fetch("status")
    {
      id: record.fetch("id"),
      content: item["withheld"] ? nil : record["content"],
      acceptedBy: login(record.dig("accepted", "by", "id")),
      acceptedAt: record.dig("accepted", "at"),
      edited: record.dig("accepted", "edited") == true,
      recalled: recalled_ids.include?(record.fetch("id")),
      budgetExcluded: status["recallEligible"] == true && recalled_ids.exclude?(record.fetch("id")),
      identityNeedsReview: identity_review_pending?(item),
      damaged: Array(status["problems"]).any?
    }
  end

  # Shows only the permitted stored versions named by this reference, never the live comment body.
  def evidence(reference, comments, events)
    return [] if !local_source?(reference.fetch("source"))

    comment = comments[reference.dig("source", "commentId")]
    return [] if comment.nil?

    reference.fetch("eventIds").filter_map do |id|
      event = events[id]
      next if !comment.deleted_at && (event.nil? || event["episodeId"] != reference["episodeId"] ||
        event.dig("payload", "commentId") != comment.id)

      {
        eventId: id,
        commentId: comment.id,
        body: comment.deleted_at ? nil : event.fetch("payload").fetch("body"),
        authorLogin: comment.user.login,
        authorAvatarUrl: comment.user.avatar_url,
        prototypeName: comment.prototype.name.presence || comment.prototype.branch_name,
        prototypePath: Rails.application.routes.url_helpers
          .repository_prototype_path(@repository.route_id, comment.prototype),
        createdAt: comment.deleted_at ? comment.created_at.iso8601 : event.fetch("at")
      }
    end
  end

  # The comments this store's evidence names, when they come from this Hub and this repository.
  def review_comments(references)
    ids = references.filter_map { _1.dig("source", "commentId") }
    ReviewComment.ordinary.where(id: ids.uniq, prototype: @repository.reviewable_prototypes)
      .includes(:user, :prototype).index_by(&:id)
  end

  # Reads only the displayed proposals' exact evidence, in bounded responses, never the whole store.
  def review_events(references)
    ids = references.flat_map { _1.fetch("eventIds") }.uniq
    ids.each_slice(EVIDENCE_BATCH).each_with_object({}) do |batch, events|
      observations = @store.call \
        "observations", "--purpose", "review", "--type", "human_comment",
        *batch.flat_map { [ "--event", _1 ] }
      observations.fetch("events").each { events[_1.fetch("id")] = _1 }
    end
  end

  # Rejects evidence from another Hub or repository even when it repeats a local comment ID.
  def local_source?(source)
    source["kind"] == Learning::Store::SOURCE && source["repositoryId"] == @repository.id &&
      source["hubOrigin"] == Rails.configuration.x.hub_origin.delete_suffix("/")
  end

  def problems?(item)
    Array(item.dig("status", "problems")).any? || Array(item.dig("status", "conflicts")).any?
  end

  # A reviewed replacement resolves the current notice without rewriting the earlier history.
  def identity_review_pending?(item)
    item.dig("status", "identityNeedsReview") == true && !item.dig("status", "superseded")
  end

  # A store identity such as github:octocat, shown as the login it names.
  def login(identity)
    identity.to_s.sub(/\A(?:github|human):/, "").presence
  end
end
