require "test_helper"

class NotificationDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  class RecordingProvider
    attr_reader :deliveries
    attr_accessor :failure, :on_delivery

    def initialize
      @deliveries = []
    end

    def key = "test-notifications"
    def label = "Team notifications"
    def eligible?(recipient:) = true

    def deliver!(recipient:, messages:, preferences_url:)
      on_delivery&.call
      raise failure if failure

      deliveries << { recipient:, messages:, preferences_url: }
    end
  end

  teardown do
    NotificationDelivery.provider = nil
  end

  test "without a provider new activity stays in Inbox and enabling a provider never scans history" do
    NotificationDelivery.provider = nil
    build = builds.create_successful(prototype: prototypes.create(author: users.create))
    actor = users.create(github_id: 1002, login: "mona")

    assert_difference "Notification.count", 1 do
      assert_no_difference "NotificationDelivery.count" do
        create_comment(build, actor:)
      end
    end
    provider = RecordingProvider.new
    NotificationDelivery.provider = provider
    NotificationDelivery.recover!
    assert_empty NotificationDelivery.all
    assert_empty provider.deliveries

    create_comment(build, actor:)
    assert_equal 2, Notification.count
    assert_equal [ Notification.last.id ], NotificationDelivery.pluck(:notification_id)
  end

  test "delivery persistence failures roll back the source activity and Inbox notification" do
    configure
    failure = -> { raise ActiveRecord::RecordInvalid, self }
    NotificationDelivery.set_callback(:create, :after, failure)
    begin
      assert_no_difference [ "ReviewComment.count", "Notification.count", "NotificationDelivery.count" ] do
        assert_raises(ActiveRecord::RecordInvalid) { create_comment(@build, actor: @actor) }
      end
    ensure
      NotificationDelivery.skip_callback(:create, :after, failure)
    end
  end

  test "an adapter configuration failure preserves review activity and records only a sanitized failed delivery" do
    configure
    failure = NotificationDelivery::Failure.new(code: "authentication_failed", retryable: false)
    failure.define_singleton_method(:message) { "secret-token https://internal.example.test/hooks/private" }
    @provider.define_singleton_method(:key) { raise failure }

    comment = nil
    assert_difference [ "ReviewComment.count", "Notification.count", "NotificationDelivery.count" ], 1 do
      comment = create_comment(@build, actor: @actor)
    end

    assert_equal "Useful feedback", comment.reload.body
    delivery = NotificationDelivery.sole
    assert_equal comment, delivery.notification.review_comment
    assert_equal "failed", delivery.state
    assert_equal "unavailable", delivery.provider_key
    assert_equal "authentication_failed", delivery.failure_code
    assert_not_includes delivery.to_json, "secret-token"
    assert_not_includes delivery.to_json, "internal.example.test"
    assert_empty @provider.deliveries
  end

  test "changing adapter destinations cancels old pending and retryable activity instead of forwarding its backlog" do
    configure
    2.times { create_comment(@build, actor: @actor) }
    NotificationDelivery.last.update!(state: "retryable")
    old_ids = NotificationDelivery.ids
    @provider.define_singleton_method(:key) { "replacement-notifications" }

    NotificationDelivery.recover!
    assert_equal [ "canceled" ], NotificationDelivery.where(id: old_ids).distinct.pluck(:state)
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.order(:id).last
    travel_to delivery.due_at + 1.second do
      NotificationDelivery.recover!
      perform_enqueued_jobs
    end

    assert_equal [ delivery.notification_id ], @provider.deliveries.sole.fetch(:messages).map { _1.fetch(:id) }
    assert_equal 3, Notification.count
    assert_equal [ "canceled" ], NotificationDelivery.where(id: old_ids).distinct.pluck(:state)
  end

  test "hourly digests bound message size and retain read activity with authenticated Hub links" do
    configure
    travel_to Time.current.beginning_of_hour + 5.minutes
    26.times { create_comment(@build, actor: @actor, body: "Useful feedback " * 30) }
    ids = Notification.ids
    Notification.update_all(read_at: Time.current)
    first_due = NotificationDelivery.minimum(:due_at)
    assert_equal Time.current.beginning_of_hour + 1.hour, first_due
    NotificationDelivery.first.deliver!
    assert_empty @provider.deliveries

    travel_to first_due + 1.second do
      NotificationDelivery.order(:id).each(&:deliver!)
    end
    messages = @provider.deliveries.flat_map { _1.fetch(:messages) }
    assert_equal ids.sort, messages.map { _1.fetch(:id) }.sort
    assert @provider.deliveries.all? { _1.fetch(:messages).length.between?(1, 25) }
    assert_equal 26, NotificationDelivery.where(state: "succeeded").count
    assert_equal 26, Notification.where.not(read_at: nil).count
    messages.each do |message|
      assert_operator message.fetch(:excerpt).length, :<=, 240
      assert_equal Notification.find(message.fetch(:id)).kind, message.fetch(:kind)
      uri = URI(message.fetch(:url))
      assert_equal Rails.configuration.x.hub_origin, "#{uri.scheme}://#{uri.authority}"
      assert_not_includes uri.path, "/shares/"
      assert_equal message.fetch(:id).to_s, Rack::Utils.parse_query(uri.query).fetch("notification")
    end
    assert_equal "#{Rails.configuration.x.hub_origin}/notification_settings",
      @provider.deliveries.first.fetch(:preferences_url)
  end

  test "a disappeared queued job is recovered from the durable outbox without a new source action" do
    configure
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.sole

    travel_to delivery.due_at + 1.second do
      assert_enqueued_jobs(1) { NotificationDelivery.recover! }
      claim_expires_at = delivery.reload.enqueue_claim_expires_at
      assert_operator claim_expires_at, :>, Time.current
      clear_enqueued_jobs
      assert_enqueued_jobs(0) { NotificationDelivery.recover! }
    end
    travel_to delivery.enqueue_claim_expires_at + 1.second do
      stub_github_installation_token
      assert_enqueued_jobs(1) { NotificationDelivery.recover! }
      perform_enqueued_jobs
    end

    assert_equal "succeeded", delivery.reload.state
    assert_equal 1, @provider.deliveries.length
    assert_equal 1, Notification.count
    assert_equal 1, NotificationDelivery.count
  end

  test "a digest cannot include another recipient's activity from the same prototype" do
    configure
    root = create_comment(@build, actor: @recipient)
    root.thread.create_reply!(user: @actor, body: "For the owner")
    root.thread.create_reply!(user: @recipient, body: "For the other reviewer")
    delivery = NotificationDelivery.find_by!(notification: Notification.for_user(@recipient))
    other = NotificationDelivery.where.not(id: delivery.id).sole

    travel_to delivery.due_at + 1.second do
      delivery.deliver!
    end

    assert_equal [ delivery.notification_id ], @provider.deliveries.sole.fetch(:messages).map { _1.fetch(:id) }
    assert_equal "pending", other.reload.state
  end

  test "a live lease prevents a duplicate worker and an expired crash lease can recover" do
    configure
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.sole
    delivery.update!(state: "delivering", lease_token: "crashed-worker", attempts: 1, due_at: 1.second.ago)

    travel 1.hour do
      stub_github_installation_token
      NotificationDelivery.recover!
      duplicate = NotificationDelivery.find(delivery.id)
      @provider.on_delivery = -> { duplicate.deliver! }
      delivery.deliver!
    end

    assert_equal 1, @provider.deliveries.length
    assert_equal "succeeded", delivery.reload.state
    assert_equal 2, delivery.attempts
  end

  test "transient provider failures preserve the same notification for retry without persisting raw errors" do
    configure
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.sole
    failure = NotificationDelivery::Failure.new(code: "service_unavailable", retryable: true)
    failure.define_singleton_method(:message) { "secret-token https://internal.example.test/hooks/private" }
    @provider.failure = failure

    travel_to delivery.due_at + 1.second do
      delivery.deliver!
      assert_equal "retryable", delivery.reload.state
      assert_operator delivery.due_at, :>, Time.current
      assert_not_includes delivery.to_json, "secret-token"
      assert_not_includes delivery.to_json, "internal.example.test"
    end
    @provider.failure = nil
    travel_to delivery.due_at + 1.second do
      NotificationDelivery.recover!
      perform_enqueued_jobs
    end

    assert_equal "succeeded", delivery.reload.state
    assert_equal [ delivery.notification_id ], @provider.deliveries.sole.fetch(:messages).map { _1.fetch(:id) }
  end

  test "delivery resolves the current login by immutable ID instead of disclosing to a recycled login" do
    configure
    create_comment(@build, actor: @actor)
    stub_profile(login: "renamed-octocat")
    stub_github_permissions([ @payload ], { 2001 => "read" }, login: "renamed-octocat")
    WebMock.reset_executed_requests!
    delivery = NotificationDelivery.sole

    travel_to delivery.due_at + 1.second do
      delivery.deliver!
    end

    assert_equal({ github_id: 1001, login: "renamed-octocat" }, @provider.deliveries.sole.fetch(:recipient))
    assert_requested :get, "#{GITHUB_API_URL}/user/1001"
    assert_requested :get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/renamed-octocat/permission"
    assert_not_requested :get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission"
  end

  test "fresh permission loss suppresses delivery even after a cached repository grant" do
    configure
    create_comment(@build, actor: @actor)
    assert @build.prototype.repository.authorization.authorized?(@recipient)
    stub_github_permissions([ @payload ], { 2001 => "none" })
    delivery = NotificationDelivery.sole

    travel_to delivery.due_at + 1.second do
      delivery.deliver!
    end

    assert_empty @provider.deliveries
    assert_equal 1, Notification.count
    assert_not_equal "succeeded", delivery.reload.state
  end

  test "an immutable profile mismatch and transient authorization failure disclose no activity" do
    configure
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.sole
    stub_profile(github_id: 9999)
    travel_to delivery.due_at + 1.second do
      delivery.deliver!
    end
    assert_empty @provider.deliveries

    stub_profile
    create_comment(@build, actor: @actor)
    delivery = NotificationDelivery.order(:id).last
    stub_github_permissions([ @payload ], { 2001 => :failure })
    travel_to delivery.due_at + 1.second do
      delivery.deliver!
    end
    assert_empty @provider.deliveries
    assert_equal "retryable", delivery.reload.state
  end

  test "deleted messages and withdrawn reactions cannot reach a queued digest" do
    configure
    comment = create_comment(@build, actor: @actor)
    own = create_comment(@build, actor: @recipient)
    own.thread.add_reaction!(user: @actor, content: "heart", activity_version: own.activity_version)
    deliveries = NotificationDelivery.all.to_a
    assert_equal 2, deliveries.length
    comment.thread.delete_body!(actor: @actor)
    own.thread.remove_reaction!(user: @actor, content: "heart", activity_version: own.reload.activity_version)

    travel 2.hours do
      NotificationDelivery.recover!
      perform_enqueued_jobs
      deliveries.each { |delivery| delivery.deliver! if NotificationDelivery.exists?(delivery.id) }
    end

    assert_empty @provider.deliveries
  end

  test "personal opt out cancels pending and retryable work but retains Inbox without backfill" do
    configure
    root = create_comment(@build, actor: @actor)
    create_comment(@build, actor: @actor)
    NotificationDelivery.last.update!(state: "retryable")
    ids = NotificationDelivery.ids
    root.thread.create_reply!(user: @recipient, body: "Reply to the other reviewer")
    other = NotificationDelivery.order(:id).last
    preference = NotificationPreference.for_identity(Notification.first.recipient)

    preference.change!(enabled: false)
    assert_equal [ "canceled" ], NotificationDelivery.where(id: ids).distinct.pluck(:state)
    assert_equal "pending", other.reload.state
    create_comment(@build, actor: @actor)
    preference.change!(enabled: true)
    NotificationDelivery.recover!
    assert_equal (ids + [ other.id ]).sort, NotificationDelivery.ids.sort
    create_comment(@build, actor: @actor)
    assert_equal 5, Notification.count
    assert_equal [ other.notification_id, Notification.last.id ].sort,
      NotificationDelivery.where(state: "pending").pluck(:notification_id).sort
  end

  test "prototype mutes cancel only that recipient and prototype and do not replay muted activity" do
    configure
    root = create_comment(@build, actor: @actor)
    identity = Notification.first.recipient
    muted = NotificationDelivery.sole
    muted.update!(state: "retryable")
    root.thread.create_reply!(user: @recipient, body: "The other reviewer still receives activity")
    other_recipient = NotificationDelivery.order(:id).last
    other_build = builds.create_successful \
      prototype: prototypes.create(repository: @build.prototype.repository, author: @recipient, branch_name: "prototype/other")
    create_comment(other_build, actor: @actor)
    other = NotificationDelivery.order(:id).last

    NotificationMute.set!(recipient: identity, prototype: @build.prototype, muted: true)
    assert_equal "canceled", muted.reload.state
    assert_equal "pending", other.reload.state
    assert_equal "pending", other_recipient.reload.state
    create_comment(@build, actor: @actor)
    NotificationMute.set!(recipient: identity, prototype: @build.prototype, muted: false)
    NotificationDelivery.recover!
    assert_equal 3, NotificationDelivery.count
    create_comment(@build, actor: @actor)
    assert_equal 4, NotificationDelivery.count
    assert_equal 5, Notification.count
  end

  private

  def configure
    @provider = RecordingProvider.new
    NotificationDelivery.provider = @provider
    github_app_configurations.create_installed
    @recipient = users.create
    @actor = users.create(github_id: 1002, login: "mona")
    @build = builds.create_successful(prototype: prototypes.create(author: @recipient))
    @payload = repository_payload(2001, "github/prototype")
    stub_github_installation_token
    stub_profile
    stub_github_permissions([ @payload ], { 2001 => "read" })
  end

  def stub_profile(github_id: 1001, login: "octocat")
    stub_request(:get, "#{GITHUB_API_URL}/user/1001")
      .to_return(status: 200, body: JSON.generate(id: github_id, login:, avatar_url: nil),
        headers: { "Content-Type" => "application/json" })
  end

  def create_comment(build, actor:, body: "Useful feedback")
    ReviewComment.create_with_mentions! \
      prototype: build.prototype, build:, user: actor, body:,
      anchor: {
        "schemaVersion" => 1, "kind" => "element",
        "route" => { "pathname" => "/", "search" => "", "hash" => "" },
        "selector" => "#save", "accessibleName" => "Save", "tagName" => "button", "selectedText" => "",
        "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
        "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
        "elementOffset" => { "x" => 0.5, "y" => 0.5 }
      }
  end
end
