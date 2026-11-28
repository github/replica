# == Schema Information
#
# Table name: analytics_events
# Database name: primary
#
#  id            :integer          not null, primary key
#  actor_kind    :string           default("system"), not null
#  name          :string           not null
#  occurred_at   :datetime         not null
#  properties    :json             not null
#  source_key    :string           not null
#  uuid          :string           not null
#  actor_id      :string
#  repository_id :integer          not null
#
# Indexes
#
#  index_analytics_events_on_id_and_repository_id  (id,repository_id) UNIQUE
#  index_analytics_events_on_occurred_at           (occurred_at)
#  index_analytics_events_on_repository_id         (repository_id)
#  index_analytics_events_on_source_key            (source_key) UNIQUE
#  index_analytics_events_on_uuid                  (uuid) UNIQUE
#
# Foreign Keys
#
#  repository_id  (repository_id => repositories.id)
#
# Check Constraints
#
#  analytics_events_actor_kind  ((actor_kind = 'system' AND actor_id IS NULL) OR (actor_kind IN ('person', 'workload') AND actor_id IS NOT NULL))
#  analytics_events_name        (name IN ('prototype_registered', 'prototype_first_published', 'build_published', 'review_comment_created', 'review_reply_added', 'review_thread_resolved', 'review_thread_reopened'))
#  analytics_events_properties  (json_valid(properties) AND json_type(properties) = 'object')
#
# Retains immutable Hub-observed facts, independent of external destinations.
class Analytics::Event < ApplicationRecord
  TYPES = %w[
    prototype_registered prototype_first_published build_published
    review_comment_created review_reply_added review_thread_resolved review_thread_reopened
  ].freeze
  PROPERTY_KEYS = %w[repository_id prototype_id build_id thread_id comment_id].freeze

  belongs_to :repository
  has_many :deliveries, dependent: :delete_all

  validates :uuid, format: { with: /\A[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/ },
    uniqueness: true
  validates :source_key, presence: true
  validates :occurred_at, presence: true
  validates :name, inclusion: { in: TYPES }
  validate :minimal_properties
  after_create :create_deliveries

  scope :retained, -> { where(occurred_at: 90.days.ago..) }

  # Records a fact once, in the same transaction as its source state change.
  def self.record!(repository:, name:, source_key:, properties:, actor_id: nil, actor_kind: nil, occurred_at: Time.current)
    repository.with_lock do
      repository.analytics_events.create_or_find_by!(source_key:) do |event|
        event.name = name
        event.actor_id = actor_id
        event.actor_kind = actor_kind || (actor_id ? "person" : "system")
        event.occurred_at = occurred_at
        event.uuid = SecureRandom.uuid
        event.properties = properties.merge(repository_id: repository.id)
      end
    end
  end

  # Deletes expired facts and delivery history through cascading foreign keys.
  def self.clear_expired!
    where(occurred_at: ...90.days.ago).in_batches.delete_all
  end

  # Facts cannot be edited after they have been observed.
  def readonly?
    persisted?
  end

  private

  # Excludes source content, names, and arbitrary values from the event contract.
  def minimal_properties
    valid = properties.is_a?(Hash) &&
      (properties.keys - PROPERTY_KEYS).empty? &&
      properties.values.all? { _1.is_a?(Integer) && _1.positive? } &&
      properties["repository_id"] == repository_id
    errors.add(:properties, "must contain only scoped identifiers") if !valid
  end

  # Saves the primary-database outbox even when the queue is unavailable.
  def create_deliveries
    repository.analytics_destinations.find_each do |destination|
      destination.queue_event!(self)
    end
  end
end
