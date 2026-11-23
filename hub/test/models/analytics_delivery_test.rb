require "test_helper"

class AnalyticsDeliveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @repository = repositories.create
    @prototype = prototypes.create(repository: @repository)
    @user = users.create
  end

  test "rolls back the event and delivery with its product change" do
    destination
    assert_no_difference([ "Analytics::Event.count", "Analytics::Delivery.count" ]) do
      Prototype.transaction do
        register
        raise ActiveRecord::Rollback
      end
    end
    assert_nil @prototype.reload.registered_at
  end

  test "backfills only when requested and only within the repository and retention" do
    old = travel_to(91.days.ago) { register }
    recent = register(prototypes.create(repository: @repository, branch_name: "prototype/recent"))
    other = repositories.create(github_id: 2002, name_with_owner: "github/other")
    prototypes.create(repository: other).register!(name: "Other", author: @user)

    configured = destination
    assert_empty configured.deliveries
    configured.destroy!
    configured = destination(include_retained: true)
    assert_equal [ recent.id ], configured.deliveries.pluck(:event_id)
    assert_not_includes configured.deliveries.pluck(:event_id), old.id
    configured.queue_event!(recent)
    assert_equal 1, configured.deliveries.count
  end

  test "encrypts credentials and requires provider-specific valid inputs" do
    configured = destination
    assert_equal "private-write-key", configured.reload.credentials["write_key"]
    raw = Analytics::Destination.connection.select_value("SELECT credentials FROM analytics_destinations LIMIT 1")
    assert_not_includes raw, "private-write-key"
    assert_not configured.update(region: "https://example.com")
    assert_not configured.update(region: "in")
    assert_not configured.update(region: "us", event_types: [ "offline_created" ])
    assert_not configured.update(event_types: [], credentials: {})
    assert_raises(ActiveRecord::RecordInvalid) { destination }
  end

  test "a stale edit keeps the latest rotated secret when its field is blank" do
    configured = destination
    stale = Analytics::Destination.find(configured.id)
    configured.configure!({ credentials: { "write_key" => "rotated-secret" } })
    stale.configure!({ region: "eu", credentials: { "write_key" => "" } })
    assert_equal "rotated-secret", configured.reload.credentials["write_key"]
    assert_equal "eu", configured.region
  end

  test "database rejects a delivery across repository boundaries" do
    configured = destination
    event = register
    configured.deliveries.delete_all
    other = repositories.create(github_id: 2002, name_with_owner: "github/other")
    assert_raises(ActiveRecord::InvalidForeignKey) do
      Analytics::Delivery.create! \
        event:, destination: configured, repository: other, due_at: Time.current
    end
  end

  test "recovery does not queue the same claimed delivery while its job is waiting" do
    destination
    event = register
    delivery = event.deliveries.sole
    assert_not_nil delivery.reload.enqueue_claim_expires_at
    clear_enqueued_jobs
    assert_enqueued_jobs(0) { 2.times { Analytics::Delivery.recover! } }
    assert_equal "pending", delivery.reload.state
  end

  test "an expired enqueue claim allows recovery when a queued job disappears" do
    destination
    delivery = register.deliveries.sole
    clear_enqueued_jobs
    travel_to delivery.reload.enqueue_claim_expires_at + 1.second do
      assert_enqueued_jobs(1) { Analytics::Delivery.recover! }
      assert_enqueued_jobs(0) { Analytics::Delivery.recover! }
      assert_operator delivery.reload.enqueue_claim_expires_at, :>, Time.current
    end
  end

  test "concurrent recoverers cannot both claim the same due delivery" do
    destination
    delivery = register.deliveries.sole
    delivery.update!(enqueue_claim_expires_at: nil)
    first = Analytics::Delivery.find(delivery.id)
    second = Analytics::Delivery.find(delivery.id)
    clear_enqueued_jobs
    assert_enqueued_jobs(1) { first.enqueue; second.enqueue }
  end

  test "enqueue failures release the claim and preserve the outbox" do
    destination
    event = register
    delivery = event.deliveries.sole
    delivery.update!(enqueue_claim_expires_at: nil)
    delivery.define_singleton_method(:deliver_later!) { raise ActiveJob::EnqueueError, "queue unavailable" }
    delivery.enqueue
    assert_nil delivery.reload.enqueue_claim_expires_at
    assert_equal "pending", delivery.reload.state
    assert_includes Analytics::Delivery.due, delivery
    clear_enqueued_jobs
    assert_enqueued_jobs(1) { Analytics::Delivery.recover! }
  end

  test "a rejected enqueue also releases its claim" do
    destination
    delivery = register.deliveries.sole
    delivery.update!(enqueue_claim_expires_at: nil)
    delivery.define_singleton_method(:deliver_later!) { false }
    delivery.enqueue
    assert_nil delivery.reload.enqueue_claim_expires_at
  end

  test "unexpected queue errors release the claim and remain visible" do
    destination
    delivery = register.deliveries.sole
    delivery.update!(enqueue_claim_expires_at: nil)
    delivery.define_singleton_method(:deliver_later!) { raise "unexpected queue failure" }
    assert_raises(RuntimeError) { delivery.enqueue }
    assert_nil delivery.reload.enqueue_claim_expires_at
  end

  test "sends Segment with a stable UUID outside the transaction and marks acceptance" do
    destination
    event = register
    transaction_depth = Analytics::Delivery.connection.open_transactions
    request = stub_request(:post, "https://api.segment.io/v1/track")
      .with(basic_auth: [ "private-write-key", "" ]) do |request|
        assert_equal transaction_depth, Analytics::Delivery.connection.open_transactions
        payload = JSON.parse(request.body)
        payload["messageId"] == event.uuid && payload["userId"] == event.actor_id &&
          payload["timestamp"] == event.occurred_at.iso8601(6) &&
          payload["properties"] == event.properties.merge("actor_type" => "person")
      end.to_return(status: 200, body: '{"success":true}')
    delivery = event.deliveries.sole
    2.times { delivery.deliver! }
    assert_requested request, times: 1
    assert_equal "succeeded", delivery.reload.state
    assert_nil delivery.enqueue_claim_expires_at
    assert_not_nil delivery.destination.reload.last_delivered_at
  end

  test "queued work stops after disconnect" do
    configured = destination
    event = register
    request = stub_request(:post, "https://api.segment.io/v1/track")
      .to_return(status: 200, body: '{"success":true}')
    assert_performed_jobs(1) { perform_enqueued_jobs }
    register(prototypes.create(repository: @repository, branch_name: "prototype/later"))
    configured.destroy!
    perform_enqueued_jobs
    assert_requested request, times: 1
  end

  test "retries transient errors with the same ID and a bounded attempt count" do
    destination
    event = register
    request = stub_request(:post, "https://api.segment.io/v1/track")
      .with { JSON.parse(_1.body)["messageId"] == event.uuid }
      .to_return(status: 503, body: "secret error body")
    delivery = event.deliveries.sole
    8.times do
      travel_to delivery.reload.due_at + 1.second do
        delivery.deliver!
      end
    end
    assert_requested request, times: 8
    assert_equal "failed", delivery.reload.state
    assert_equal "http_503", delivery.failure_code
    assert_not_includes delivery.to_json, "secret error body"
    assert_empty Analytics::Delivery.due
  end

  test "recovers an abandoned lease without exceeding the attempt limit" do
    destination
    delivery = register.deliveries.sole
    delivery.update!( \
      state: "delivering", lease_token: "abandoned", attempts: 8,
      due_at: 1.second.ago, enqueue_claim_expires_at: nil
    )
    clear_enqueued_jobs
    assert_enqueued_jobs(1) { Analytics::Delivery.recover! }
    delivery.deliver!
    assert_equal "failed", delivery.reload.state
    assert_equal "attempts_exhausted", delivery.failure_code
    assert_nil delivery.enqueue_claim_expires_at
  end

  test "recovery delivers an abandoned worker lease" do
    destination
    delivery = register.deliveries.sole
    delivery.update!( \
      state: "delivering", lease_token: "abandoned", attempts: 1,
      due_at: 1.second.ago, enqueue_claim_expires_at: nil
    )
    clear_enqueued_jobs
    request = stub_request(:post, "https://api.segment.io/v1/track")
      .to_return(status: 200, body: '{"success":true}')
    assert_enqueued_jobs(1) { Analytics::Delivery.recover! }
    perform_enqueued_jobs
    assert_requested request, times: 1
    assert_equal "succeeded", delivery.reload.state
    assert_equal 2, delivery.attempts
    assert_nil delivery.enqueue_claim_expires_at
  end

  test "pausing removal expiration and disconnect prevent further sends" do
    configured = destination
    event = register
    delivery = event.deliveries.sole
    configured.update!(enabled: false)
    clear_enqueued_jobs
    assert_enqueued_jobs(0) { Analytics::Delivery.recover! }
    delivery.deliver!
    assert_equal 0, delivery.reload.attempts
    configured.update!(enabled: true)
    @repository.update!(installation_state: "removed", removed_at: Time.current)
    assert_enqueued_jobs(0) { Analytics::Delivery.recover! }
    delivery.deliver!
    assert_equal 0, delivery.reload.attempts
    @repository.update!(installation_state: "active", removed_at: nil)
    travel 91.days do
      delivery.deliver!
      assert_equal 0, delivery.reload.attempts
      Analytics::Event.clear_expired!
      assert_not Analytics::Delivery.exists?(delivery.id)
    end
    retained = register(prototypes.create(repository: @repository, branch_name: "prototype/new"))
    configured.destroy!
    assert Analytics::Event.exists?(retained.id)
    assert_empty Analytics::Delivery.all
  end

  test "paused destinations keep new events and selection changes cancel pending work" do
    configured = destination
    configured.update!(enabled: false)
    event = register
    assert_empty Analytics::Delivery.due
    configured.update!(enabled: true)
    assert_includes Analytics::Delivery.due, event.deliveries.sole
    configured.configure!({ event_types: [ "build_published" ] })
    assert_equal "canceled", event.deliveries.sole.reload.state
    second = register(prototypes.create(repository: @repository, branch_name: "prototype/new"))
    assert_empty second.deliveries
  end

  private

  def register(prototype = @prototype)
    prototype.register!(name: "Welcome", author: @user)
    Analytics::Event.find_by!(source_key: "prototype/#{prototype.id}/registered")
  end

  def destination(include_retained: false)
    configured = @repository.analytics_destinations.new
    configured.configure!( \
      {
        provider: "segment", region: "us", credentials: { "write_key" => "private-write-key" },
        event_types: Analytics::Event::TYPES
      },
      include_retained:
    )
    configured
  end
end
