# Records which base model a repository's administrators chose to post-train as its decision model,
# and where its reinforcement learning runs. Training itself happens outside Hub.
class CreateLearningDecisionModels < ActiveRecord::Migration[8.1]
  def change
    create_table :learning_decision_models do |t|
      t.references :repository, null: false, foreign_key: { on_delete: :cascade }, index: { unique: true }
      t.references :chosen_by, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :base_model, null: false
      t.string :training_environment, null: false
      t.timestamps
    end
    add_check_constraint \
      :learning_decision_models,
      "training_environment IN ('container', 'managed')",
      name: "learning_decision_models_training_environment"
    add_check_constraint \
      :learning_decision_models,
      "length(base_model) BETWEEN 1 AND 200",
      name: "learning_decision_models_base_model"
  end
end
