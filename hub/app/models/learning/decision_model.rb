# == Schema Information
#
# Table name: learning_decision_models
# Database name: primary
#
#  id                   :integer          not null, primary key
#  base_model           :string           not null
#  training_environment :string           not null
#  created_at           :datetime         not null
#  updated_at           :datetime         not null
#  chosen_by_id         :integer
#  repository_id        :integer          not null
#
# Indexes
#
#  index_learning_decision_models_on_chosen_by_id   (chosen_by_id)
#  index_learning_decision_models_on_repository_id  (repository_id) UNIQUE
#
# Foreign Keys
#
#  chosen_by_id   (chosen_by_id => users.id) ON DELETE => nullify
#  repository_id  (repository_id => repositories.id) ON DELETE => cascade
#
# Check Constraints
#
#  learning_decision_models_base_model            (length(base_model) BETWEEN 1 AND 200)
#  learning_decision_models_training_environment  (training_environment IN ('container', 'managed'))
#
# Which base model a repository's administrators chose to post-train as its decision model, and
# where its reinforcement learning runs. The decision model checks Build screenshots against the
# repository's accepted learnings. Hub keeps only this choice: replica-learning prepares training
# tasks, and the team runs training in an environment it controls.
class Learning::DecisionModel < ApplicationRecord
  # Where training runs: the team's own container, or a managed service that runs the same one.
  ENVIRONMENTS = %w[container managed].freeze
  DEFAULT_ENVIRONMENT = "container".freeze
  # Each installed command's base models, by its path.
  CATALOGS = Concurrent::Map.new

  self.table_name = "learning_decision_models"

  belongs_to :repository
  belongs_to :chosen_by, class_name: "User", optional: true

  validates :base_model, inclusion: { in: ->(_) { catalog.pluck(:id) } }
  validates :training_environment, inclusion: { in: ENVIRONMENTS }

  # The base models replica-learning suggests, in its order. The list ships with the command, so
  # Hub asks the installed command once rather than keeping a copy that could drift from it.
  def self.catalog
    CATALOGS.compute_if_absent(Learning.cli_path.to_s) do
      Learning::Command.new.call("decision", "models").fetch("models").map do |model|
        license = model.fetch("license")
        {
          id: model.fetch("id"), name: model.fetch("name"), url: model.fetch("url"), maker: model.fetch("maker"),
          parameters: model.fetch("parameters"), readout: model.fetch("readout"), license: license.fetch("name"),
          license_url: license.fetch("url"), commercial_use: license.fetch("commercialUse")
        }.freeze
      end.freeze
    end
  rescue KeyError, TypeError, NoMethodError
    raise Learning::Error.new("replica-learning returned output Hub could not read.", code: "unreadable_output")
  end

  # Records an administrator's choice for the repository, replacing any earlier one.
  def self.choose!(repository:, base_model:, training_environment:, user:)
    attributes = { base_model:, training_environment:, chosen_by: user }
    create_or_find_by!(repository:) { _1.assign_attributes(attributes) }.tap { _1.update!(attributes) }
  end
end
