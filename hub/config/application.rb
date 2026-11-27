require_relative "boot"

require "rails"
require "set"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
# require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
require "action_cable/engine"
require "rails/test_unit/railtie"
require_relative "../lib/azure_front_door_verification"
require_relative "../lib/build_action_releases"
require_relative "../lib/preview_path_routing"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module ReplicaHub
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets hub_tracing tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Don't generate system test files.
    config.generators.system_tests = nil
    config.app_generators { _1.test_framework _1.test_framework, fixture: false }
    config.middleware.insert_before 0, AzureFrontDoorVerification
    config.middleware.insert_after AzureFrontDoorVerification, PreviewPathRouting

    config.x.hub_origin = ENV.fetch("REPLICA_HUB_ORIGIN", "http://replica.localhost:19500")
    config.x.preview_origin_template = ENV.fetch(
      "REPLICA_PREVIEW_ORIGIN_TEMPLATE",
      "http://b{build_id}.preview.replica.localhost:19500"
    )
    config.x.share_preview_origin_template = ENV.fetch(
      "REPLICA_SHARE_PREVIEW_ORIGIN_TEMPLATE",
      "http://s{build_id}.preview.replica.localhost:19500"
    )
    config.x.github_api_url = ENV.fetch("REPLICA_GITHUB_API_URL", "https://api.github.com")
    config.x.github_url = ENV.fetch("REPLICA_GITHUB_URL", "https://github.com")
    config.x.welcome_video_url = ENV.fetch(
      "REPLICA_WELCOME_VIDEO_URL",
      "https://www.youtube.com/watch?v=J2Z28CwIfsA"
    ).presence
    config.x.welcome_video_poster_url = ENV["REPLICA_WELCOME_VIDEO_POSTER_URL"].presence
    config.x.github_api_version = ENV.fetch("REPLICA_GITHUB_API_VERSION", "2026-03-10")
    action_releases = BuildActionReleases.parse(
      Rails.root.join("config/build_action_releases").readlines(chomp: true)
    )
    config.x.build_action = ENV["REPLICA_BUILD_ACTION"].presence || action_releases.first
    config.x.build_action_revisions = \
      action_releases.drop(1).to_set if config.x.build_action == action_releases.first
    config.x.artifact_store = ENV.fetch("REPLICA_ARTIFACT_STORE", "local")
    default_artifact_root = ENV["REPLICA_LOCAL_MODE"] == "1" && Rails.env.development? ?
      Rails.root.join("storage/local_artifacts") : Rails.root.join("storage/artifacts")
    config.x.artifact_root = Pathname(ENV.fetch("REPLICA_ARTIFACT_ROOT", default_artifact_root))
      .expand_path(Rails.root)
    default_learning_root = ENV["REPLICA_LOCAL_MODE"] == "1" && Rails.env.development? ?
      Rails.root.join("storage/local_learning") : Rails.root.join("storage/learning")
    config.x.learning_root = Pathname(ENV.fetch("REPLICA_LEARNING_ROOT", default_learning_root))
      .expand_path(Rails.root)
    config.x.azure_storage_account = ENV["REPLICA_AZURE_STORAGE_ACCOUNT"]
    config.x.azure_storage_container = ENV["REPLICA_AZURE_STORAGE_CONTAINER"]
    config.x.azure_managed_identity_client_id = ENV["REPLICA_AZURE_MANAGED_IDENTITY_CLIENT_ID"]
    # Who Copilot bills for Learnings: token_owner, the owner of REPLICA_COPILOT_TOKEN, or
    # organization, the organization that installed Hub's GitHub App. See docs/copilot.md.
    config.x.copilot_billing = ENV["REPLICA_COPILOT_BILLING"].presence || "token_owner"
    # A fine-grained personal access token whose only permission is Copilot requests. Hub passes it
    # only to replica-learning and never stores it. Organization billing ignores it.
    config.x.copilot_token = ENV["REPLICA_COPILOT_TOKEN"].presence
  end

  require_relative "../lib/hub_tracing"
  HubTracing.start!
end
