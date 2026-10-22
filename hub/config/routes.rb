Rails.application.routes.draw do
  authenticated_preview = lambda do |request|
    request.get_header(PreviewPathRouting::BUILD_ID).present? &&
      request.get_header(PreviewPathRouting::MODE) == PreviewPathRouting::AUTHENTICATED_MODE
  end
  shared_preview = lambda do |request|
    request.get_header(PreviewPathRouting::BUILD_ID).present? &&
      request.get_header(PreviewPathRouting::MODE) == PreviewPathRouting::SHARE_MODE
  end

  constraints authenticated_preview do
    get "/__replica/preview/authorize", to: "preview_files#authorize"
    get "/__replica/preview/bridge", to: "preview_files#bridge"
    get "/__replica/preview/controls", to: "preview_files#controls"
    get "/__replica/preview/files", to: "preview_files#show"
    get "/__replica/preview/files/*path", to: "preview_files#show", format: false
  end

  constraints shared_preview do
    get "/__replica/share/authorize", to: "shared_preview_files#authorize"
    get "/__replica/share/not_found", to: "shared_preview_files#unavailable"
    get "/__replica/share/controls", to: "shared_preview_files#controls"
    get "/__replica/share/files", to: "shared_preview_files#show"
    get "/__replica/share/files/*path", to: "shared_preview_files#show", format: false
  end

  constraints ->(request) { request.get_header(PreviewPathRouting::BUILD_ID).nil? } do
    root "home#index"

    post "auth/github", to: "github_authentications#create", as: :github_authentication
    post "auth/local", to: "local_authentications#create", as: :local_authentication
    get "auth/github/callback", to: "github_authentications#callback", as: :github_authentication_callback
    resource :session, only: :destroy
    resource :welcome, only: %i[show update], controller: "welcome"
    resources :notifications, only: %i[index show update] do
      get :inbox, on: :collection
    end
    resources :fresh_authorizations, only: %i[show destroy], path: "authorization" do
      post :create, on: :member
    end
    get "operator/enrollment", to: "hub_admin_enrollments#show", as: :hub_admin_enrollment
    post "operator/enrollment", to: "hub_admin_enrollments#create"
    resource :security_audit, only: :show, controller: "security_audits"
    resource :session_revocation, only: %i[show create]
    resources :hub_admins, only: %i[index create edit update], constraints: { id: /\d+/ } do
      get :candidates, on: :collection
    end
    resource :sharing_settings, only: %i[show update], controller: "sharing_settings"
    resource :github_app, only: %i[show destroy]
    get "github_app/reset", to: "github_apps#reset_confirmation", as: :reset_github_app
    get "github_app/credentials", to: "github_app_credentials#edit", as: :edit_github_app_credentials
    patch "github_app/credentials", to: "github_app_credentials#update", as: :github_app_credentials
    get "github_app/webhook_rotation", to: "github_app_webhook_rotations#show",
      as: :github_app_webhook_rotation
    post "github_app/webhook_rotation", to: "github_app_webhook_rotations#create"
    delete "github_app/webhook_rotation", to: "github_app_webhook_rotations#destroy"
    resource :copilot_connection, only: %i[show create destroy], path: "copilot"
    get "canvas/pair/:user_code", to: "canvas_pairings#show", as: :canvas_pairing
    post "canvas/pair/:user_code", to: "canvas_pairings#approve", as: :approve_canvas_pairing
    get "canvas/connections", to: "canvas_pairings#index", as: :canvas_connections
    delete "canvas/connections/:id", to: "canvas_pairings#destroy", as: :canvas_connection
    namespace :canvas_api, path: "api/canvas" do
      post "pairings", to: "pairings#create"
      post "pairings/token", to: "pairings#show", as: :pairing_token
      post "cable_ticket", to: "cable_tickets#create"
      post "connection/renewal", to: "renewals#create", as: :connection_renewal
      delete "connection/renewal", to: "renewals#destroy"
      get "connection", to: "connections#show"
      patch "connection", to: "connections#update"
      delete "connection", to: "connections#destroy"
      resource :prototype, only: %i[show update]
      post "learnings/recall", to: "learning_recalls#create", as: :learnings_recall
      get "repositories/:repository_github_id/review_comments",
        to: "repository_review_comments#index",
        as: :repository_review_comments,
        constraints: { repository_github_id: /\d+/ }
      get "repositories/:repository_github_id/review_comment_summaries",
        to: "review_comment_summaries#index",
        as: :repository_review_comment_summaries,
        constraints: { repository_github_id: /\d+/ }
      scope "repositories/:repository_github_id/prototypes/:prototype_id" do
        resources :improvement_notes, only: %i[index create]
        resources :mention_candidates, only: :index
        get "review_comments/:id/thread", to: "review_comment_threads#show",
          as: :review_comment_thread,
          constraints: { repository_github_id: /\d+/, prototype_id: /\d+/, id: /\d+/ }
        resources :share_links, only: %i[index create destroy],
          constraints: { repository_github_id: /\d+/, prototype_id: /\d+/, id: /\d+/ }
        resources :review_comments, only: %i[index create update destroy] do
          resources :replies, only: :create, controller: "review_comment_replies"
          resources :reactions, only: %i[create destroy], param: :content,
            controller: "review_comment_reactions"
          resource :resolution, only: %i[create destroy],
            controller: "review_comment_resolutions"
          resource :read, only: %i[create destroy], controller: "review_thread_reads"
        end
      end
    end
    resources :repositories, only: %i[index show], param: :github_id, constraints: { github_id: /\d+/ } do
      resource :security_audit, only: :show, controller: "repository_security_audits"
      post :poll, on: :member
      resource :analytics, only: :show, controller: "analytics" do
        resources :destinations, only: %i[create update destroy],
          controller: "analytics_destinations", constraints: { id: /\d+/ }
      end
      resource :learnings, only: :show do
        resources :runs, only: :create, controller: "learning_runs"
        post \
          ":memory_id/decision",
          to: "learning_decisions#create",
          as: :decision,
          constraints: { memory_id: /mem_[0-9a-f]{24}/ }
      end
      get "new", to: "new_prototypes#show", as: :new_prototype
      get "replica", to: "replica_browses#show", as: :replica_browse
      resources :templates, only: %i[index show], constraints: { id: /[a-z0-9]+(?:-[a-z0-9]+)*/ }
      get "templates/:template_id/builds/:build_id/screenshots/:size", to: "template_screenshots#show",
        as: :template_screenshot,
        constraints: { template_id: /[a-z0-9]+(?:-[a-z0-9]+)*/, build_id: /\d+/, size: /desktop|narrow/ }
      get "prototypes/manage", to: "prototype_management#show", as: :prototype_management
      resource :workflow_installation, only: :create,
        controller: "repository_workflow_installations"

      resources :prototypes, only: :show,
        constraints: { repository_github_id: /\d+/, id: /\d+/ } do
        resources :mention_candidates, only: :index
        resource :registration, only: :update, controller: "prototype_registrations"
        resource :branch_banner_dismissal, only: :create
        resources :share_links, only: %i[index create destroy],
          constraints: { repository_github_id: /\d+/, prototype_id: /\d+/, id: /\d+/ }
        resources :review_comments, only: %i[index create update destroy],
          constraints: { repository_github_id: /\d+/, prototype_id: /\d+/, id: /\d+/ } do
          resources :reactions, only: %i[create destroy], param: :content,
            controller: "review_comment_reactions",
            constraints: { content: /(?:\+1|-1|laugh|hooray|confused|heart|rocket|eyes)/ }
          resources :replies, only: :create, controller: "review_comment_replies"
          resource :read, only: %i[create destroy], controller: "review_thread_reads"
          resource :resolution, only: %i[create destroy],
            controller: "review_comment_resolutions"
        end
        resources :builds, only: %i[index show], param: :number,
          constraints: { repository_github_id: /\d+/, prototype_id: /\d+/, number: /\d+/ } do
          resources :screenshots, only: :show, param: :size,
            controller: "build_screenshots", constraints: { size: /desktop|narrow/ }
        end
      end
    end

    get "preview/builds/:build_id/authorize", to: "preview_authorizations#show",
      as: :preview_build_authorization, constraints: { build_id: /\d+/ }
    get "share/:public_id/preview", to: "share_preview_authorizations#show",
      as: :share_preview_authorization,
      constraints: { public_id: /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/ }
    get "share/:public_id", to: "shared_builds#show",
      as: :shared_build,
      constraints: { public_id: /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/ }

    get "up" => "rails/health#show", as: :rails_health_check

    resource :setup, only: %i[show create], controller: "github_app_setup" do
      get :callback
      get :install
    end

    post "github/webhooks", to: "github_webhooks#create", as: :github_webhooks
  end
end
