# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_19_140000) do
  create_table "analytics_deliveries", force: :cascade do |t|
    t.integer "attempts", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "delivered_at"
    t.bigint "destination_id", null: false
    t.integer "destination_revision", default: 1, null: false
    t.datetime "due_at", null: false
    t.datetime "enqueue_claim_expires_at"
    t.bigint "event_id", null: false
    t.string "failure_code"
    t.string "lease_token"
    t.integer "repository_id", null: false
    t.string "state", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["event_id", "destination_id"], name: "index_analytics_deliveries_on_event_id_and_destination_id", unique: true
    t.index ["repository_id"], name: "index_analytics_deliveries_on_repository_id"
    t.index ["state", "due_at"], name: "index_analytics_deliveries_on_state_and_due_at"
    t.check_constraint "attempts >= 0", name: "analytics_delivery_attempts"
    t.check_constraint "destination_revision > 0", name: "analytics_delivery_destination_revision"
    t.check_constraint "state IN ('pending', 'delivering', 'retryable', 'succeeded', 'failed', 'canceled')", name: "analytics_delivery_state"
  end

  create_table "analytics_destinations", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "credentials", null: false
    t.text "custom_config"
    t.boolean "enabled", default: true, null: false
    t.json "event_types", null: false
    t.datetime "last_delivered_at"
    t.string "name"
    t.string "provider", null: false
    t.string "region", null: false
    t.integer "repository_id", null: false
    t.integer "revision", default: 1, null: false
    t.datetime "updated_at", null: false
    t.index "repository_id, lower(name)", name: "index_analytics_destinations_on_custom_name", unique: true, where: "provider = 'custom'"
    t.index ["id", "repository_id"], name: "index_analytics_destinations_on_id_and_repository_id", unique: true
    t.index ["repository_id", "provider"], name: "index_analytics_destinations_on_builtin_provider", unique: true, where: "provider != 'custom'"
    t.index ["repository_id"], name: "index_analytics_destinations_on_repository_id"
    t.check_constraint "(provider = 'segment' AND region IN ('us', 'eu')) OR (provider = 'mixpanel' AND region IN ('us', 'eu', 'in')) OR (provider = 'custom' AND region = 'custom')", name: "analytics_destination_region"
    t.check_constraint "provider IN ('segment', 'mixpanel', 'custom')", name: "analytics_destination_provider"
    t.check_constraint "revision > 0", name: "analytics_destination_revision"
  end

  create_table "analytics_events", force: :cascade do |t|
    t.string "actor_id"
    t.string "name", null: false
    t.datetime "occurred_at", null: false
    t.json "properties", null: false
    t.integer "repository_id", null: false
    t.string "source_key", null: false
    t.string "uuid", null: false
    t.index ["id", "repository_id"], name: "index_analytics_events_on_id_and_repository_id", unique: true
    t.index ["occurred_at"], name: "index_analytics_events_on_occurred_at"
    t.index ["repository_id"], name: "index_analytics_events_on_repository_id"
    t.index ["source_key"], name: "index_analytics_events_on_source_key", unique: true
    t.index ["uuid"], name: "index_analytics_events_on_uuid", unique: true
    t.check_constraint "json_valid(properties) AND json_type(properties) = 'object'", name: "analytics_events_properties"
    t.check_constraint "name IN ('prototype_registered', 'prototype_first_published', 'build_published', 'review_comment_created', 'review_reply_added', 'review_thread_resolved', 'review_thread_reopened')", name: "analytics_events_name"
  end

  create_table "branch_banner_dismissals", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "prototype_id", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["prototype_id"], name: "index_branch_banner_dismissals_on_prototype_id"
    t.index ["user_id", "prototype_id"], name: "index_branch_banner_dismissals_on_user_id_and_prototype_id", unique: true
    t.index ["user_id"], name: "index_branch_banner_dismissals_on_user_id"
  end

  create_table "builds", force: :cascade do |t|
    t.bigint "artifact_bytes"
    t.string "artifact_prefix"
    t.string "commit_author_avatar_url", limit: 2048
    t.datetime "commit_author_checked_at"
    t.bigint "commit_author_github_id"
    t.string "commit_author_login"
    t.string "commit_author_name"
    t.datetime "commit_author_requested_at"
    t.string "commit_sha", null: false
    t.datetime "created_at", null: false
    t.string "failure_summary"
    t.datetime "finished_at"
    t.bigint "github_artifact_id"
    t.integer "github_workflow_run_attempt"
    t.bigint "github_workflow_run_id"
    t.datetime "local_package_completed_at"
    t.integer "number", null: false
    t.string "previous_commit_sha"
    t.integer "prototype_id", null: false
    t.datetime "start_page_checked_at"
    t.datetime "started_at"
    t.string "state", default: "queued", null: false
    t.datetime "updated_at", null: false
    t.datetime "workflow_completed_at"
    t.datetime "workflow_created_at"
    t.string "workflow_url", limit: 2048
    t.index "prototype_id, COALESCE(workflow_created_at, created_at) DESC, number DESC", name: "index_builds_on_prototype_and_chronology"
    t.index ["artifact_prefix"], name: "index_builds_on_artifact_prefix", unique: true, where: "artifact_prefix IS NOT NULL"
    t.index ["github_artifact_id"], name: "index_builds_on_github_artifact_id", unique: true, where: "github_artifact_id IS NOT NULL"
    t.index ["github_workflow_run_id", "github_workflow_run_attempt"], name: "index_builds_on_github_workflow_run", unique: true, where: "github_workflow_run_id IS NOT NULL"
    t.index ["id", "prototype_id"], name: "index_builds_on_id_and_prototype_id", unique: true
    t.index ["prototype_id", "commit_sha"], name: "index_builds_on_prototype_id_and_commit_sha", unique: true
    t.index ["prototype_id", "number"], name: "index_builds_on_prototype_id_and_number", unique: true
    t.index ["prototype_id"], name: "index_builds_on_prototype_id"
    t.check_constraint "(state = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR (state = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR (state = 'superseded' AND started_at IS NULL AND finished_at IS NOT NULL) OR (state IN ('failed', 'successful') AND started_at IS NOT NULL AND finished_at IS NOT NULL)", name: "builds_state_timestamps"
    t.check_constraint "(state = 'successful' AND artifact_prefix IS NOT NULL AND artifact_bytes IS NOT NULL AND failure_summary IS NULL AND ((workflow_completed_at IS NOT NULL AND github_artifact_id IS NOT NULL AND local_package_completed_at IS NULL) OR (workflow_completed_at IS NULL AND github_artifact_id IS NULL AND local_package_completed_at IS NOT NULL))) OR (state <> 'successful' AND artifact_prefix IS NULL AND artifact_bytes IS NULL AND local_package_completed_at IS NULL)", name: "builds_publication"
    t.check_constraint "CASE WHEN commit_author_name IS NULL THEN commit_author_github_id IS NULL AND commit_author_login IS NULL AND commit_author_avatar_url IS NULL WHEN commit_author_github_id IS NULL THEN commit_author_login IS NULL AND commit_author_avatar_url IS NULL ELSE commit_author_github_id > 0 AND commit_author_login IS NOT NULL AND length(trim(commit_author_login)) BETWEEN 1 AND 255 AND (commit_author_avatar_url IS NULL OR length(CAST(commit_author_avatar_url AS BLOB)) BETWEEN 1 AND 2048) END", name: "builds_commit_author_identity"
    t.check_constraint "CASE WHEN github_workflow_run_id IS NULL THEN github_workflow_run_attempt IS NULL AND workflow_url IS NULL ELSE github_workflow_run_id > 0 AND github_workflow_run_attempt > 0 AND COALESCE(length(trim(workflow_url)) BETWEEN 1 AND 2048, 0) END", name: "builds_workflow_identity"
    t.check_constraint "artifact_bytes IS NULL OR artifact_bytes > 0", name: "builds_artifact_bytes"
    t.check_constraint "artifact_prefix IS NULL OR artifact_prefix = 'builds/' || id", name: "builds_artifact_prefix"
    t.check_constraint "commit_author_name IS NULL OR length(trim(commit_author_name)) BETWEEN 1 AND 255", name: "builds_commit_author_name"
    t.check_constraint "failure_summary IS NULL OR (state = 'failed' AND length(CAST(failure_summary AS BLOB)) BETWEEN 1 AND 1000)", name: "builds_failure_summary"
    t.check_constraint "github_artifact_id IS NULL OR (github_artifact_id > 0 AND workflow_completed_at IS NOT NULL)", name: "builds_github_artifact"
    t.check_constraint "length(commit_sha) = 40 AND commit_sha NOT GLOB '*[^0-9a-f]*'", name: "builds_commit_sha"
    t.check_constraint "number > 0", name: "builds_positive_number"
    t.check_constraint "previous_commit_sha IS NULL OR (length(previous_commit_sha) = 40 AND previous_commit_sha NOT GLOB '*[^0-9a-f]*')", name: "builds_previous_commit_sha"
    t.check_constraint "previous_commit_sha IS NULL OR previous_commit_sha <> commit_sha", name: "builds_distinct_commit_shas"
    t.check_constraint "state IN ('queued', 'running', 'failed', 'superseded', 'successful')", name: "builds_state"
    t.check_constraint "workflow_completed_at IS NULL OR (github_workflow_run_id IS NOT NULL AND state IN ('running', 'failed', 'successful'))", name: "builds_workflow_completion"
    t.check_constraint "workflow_created_at IS NULL OR github_workflow_run_id IS NOT NULL", name: "builds_workflow_creation"
  end

  create_table "canvas_grants", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.datetime "inactive_at"
    t.datetime "last_active_at"
    t.string "refresh_token_digest"
    t.integer "repository_id", null: false
    t.datetime "revoked_at"
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.datetime "fresh_authorized_at"
    t.datetime "learnings_consented_at"
    t.index ["expires_at"], name: "index_canvas_grants_on_expires_at"
    t.index ["inactive_at"], name: "index_canvas_grants_on_inactive_at"
    t.index ["refresh_token_digest"], name: "index_canvas_grants_on_refresh_token_digest", unique: true
    t.index ["repository_id"], name: "index_canvas_grants_on_repository_id"
    t.index ["revoked_at"], name: "index_canvas_grants_on_revoked_at", where: "revoked_at IS NOT NULL"
    t.index ["token_digest"], name: "index_canvas_grants_on_token_digest", unique: true
    t.index ["user_id"], name: "index_canvas_grants_on_user_id"
    t.check_constraint "(refresh_token_digest IS NULL AND last_active_at IS NULL AND inactive_at IS NULL) OR (refresh_token_digest IS NOT NULL AND last_active_at IS NOT NULL AND inactive_at IS NOT NULL AND inactive_at > last_active_at)", name: "canvas_grants_renewable"
    t.check_constraint "expires_at > created_at", name: "canvas_grants_expiry"
  end

  create_table "canvas_pairings", force: :cascade do |t|
    t.datetime "approved_at"
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.string "device_code_digest", null: false
    t.datetime "expires_at", null: false
    t.string "refresh_token_digest"
    t.integer "repository_id", null: false
    t.datetime "updated_at", null: false
    t.string "user_code", null: false
    t.integer "user_id"
    t.datetime "learnings_consented_at"
    t.index ["consumed_at"], name: "index_canvas_pairings_on_consumed_at", where: "consumed_at IS NOT NULL"
    t.index ["device_code_digest"], name: "index_canvas_pairings_on_device_code_digest", unique: true
    t.index ["expires_at"], name: "index_canvas_pairings_on_expires_at"
    t.index ["repository_id"], name: "index_canvas_pairings_on_repository_id"
    t.index ["user_code"], name: "index_canvas_pairings_on_user_code", unique: true
    t.index ["user_id"], name: "index_canvas_pairings_on_user_id"
    t.check_constraint "(approved_at IS NULL AND user_id IS NULL) OR (approved_at IS NOT NULL AND user_id IS NOT NULL)", name: "canvas_pairings_approval"
    t.check_constraint "consumed_at IS NULL OR approved_at IS NOT NULL", name: "canvas_pairings_consumption"
    t.check_constraint "learnings_consented_at IS NULL OR approved_at IS NOT NULL", name: "canvas_pairings_learnings_consent"
  end

  create_table "comment_mentions", force: :cascade do |t|
    t.integer "review_comment_id", null: false
    t.integer "github_identity_id", null: false
    t.string "login", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["github_identity_id"], name: "index_comment_mentions_on_github_identity_id"
    t.index ["review_comment_id", "github_identity_id"], name: "idx_on_review_comment_id_github_identity_id_54cb03314e", unique: true
    t.index ["review_comment_id"], name: "index_comment_mentions_on_review_comment_id"
    t.check_constraint "length(trim(login)) > 0", name: "comment_mentions_login"
  end

  create_table "copilot_connection_states", force: :cascade do |t|
    t.integer "singleton_key", default: 1, null: false
    t.bigint "generation", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["singleton_key"], name: "index_copilot_connection_states_on_singleton_key", unique: true
    t.check_constraint "generation >= 0", name: "copilot_connection_states_generation"
    t.check_constraint "singleton_key = 1", name: "copilot_connection_states_singleton"
  end

  create_table "copilot_connections", force: :cascade do |t|
    t.integer "singleton_key", default: 1, null: false
    t.integer "user_id", null: false
    t.string "token_digest", null: false
    t.datetime "verified_at", null: false
    t.datetime "refused_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["singleton_key"], name: "index_copilot_connections_on_singleton_key", unique: true
    t.index ["user_id"], name: "index_copilot_connections_on_user_id"
    t.check_constraint "length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*'", name: "copilot_connections_token_digest"
    t.check_constraint "singleton_key = 1", name: "copilot_connections_singleton"
  end

  create_table "fresh_authorizations", force: :cascade do |t|
    t.string "public_id", null: false
    t.integer "user_id", null: false
    t.integer "repository_id"
    t.bigint "github_id", null: false
    t.string "credential_type", null: false
    t.bigint "credential_id", null: false
    t.string "purpose", null: false
    t.string "return_to", null: false
    t.string "oauth_state_digest"
    t.datetime "expires_at", null: false
    t.datetime "consumed_at"
    t.datetime "verified_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["credential_type", "credential_id"], name: "idx_on_credential_type_credential_id_835b090260"
    t.index ["expires_at"], name: "index_fresh_authorizations_on_expires_at"
    t.index ["public_id"], name: "index_fresh_authorizations_on_public_id", unique: true
    t.index ["repository_id"], name: "index_fresh_authorizations_on_repository_id"
    t.index ["user_id"], name: "index_fresh_authorizations_on_user_id"
    t.check_constraint "credential_type IN ('Session', 'CanvasGrant') AND credential_id > 0 AND github_id > 0", name: "fresh_authorizations_identity"
    t.check_constraint "purpose IN ('never_expiring_share', 'analytics_destination', 'hub_admin_management', 'sharing_settings', 'session_revocation', 'github_app_reset', 'github_app_credentials', 'github_app_webhook', 'github_app_finish_webhook', 'copilot_connection', 'copilot_disconnection')", name: "fresh_authorizations_purpose"
    t.check_constraint "verified_at IS NULL OR consumed_at IS NOT NULL", name: "fresh_authorizations_verification"
  end

  create_table "github_app_configurations", force: :cascade do |t|
    t.string "app_slug", null: false
    t.string "client_id", null: false
    t.text "client_secret", null: false
    t.datetime "created_at", null: false
    t.bigint "github_app_id", null: false
    t.datetime "installation_checked_at"
    t.bigint "installation_id"
    t.string "installation_state", default: "not_installed", null: false
    t.datetime "installed_at"
    t.bigint "owner_github_id", null: false
    t.string "owner_login", null: false
    t.string "owner_type", null: false
    t.text "previous_webhook_secret"
    t.text "private_key", null: false
    t.integer "singleton_key", default: 1, null: false
    t.datetime "suspended_at"
    t.datetime "updated_at", null: false
    t.text "webhook_secret", null: false
    t.datetime "webhook_secret_rotated_at"
    t.integer "lock_version", default: 0, null: false
    t.bigint "credential_revision", default: 1, null: false
    t.string "webhook_rotation_state", default: "idle", null: false
    t.string "webhook_request_token"
    t.datetime "webhook_request_expires_at"
    t.index ["singleton_key"], name: "index_github_app_configurations_on_singleton_key", unique: true
    t.check_constraint "(installation_state = 'not_installed' AND installation_id IS NULL) OR (installation_state <> 'not_installed' AND installation_id IS NOT NULL)", name: "github_app_configurations_installation_identity"
    t.check_constraint "(webhook_request_token IS NULL AND webhook_request_expires_at IS NULL) OR (webhook_rotation_state = 'pending' AND webhook_request_token IS NOT NULL AND webhook_request_expires_at IS NOT NULL)", name: "github_app_configurations_webhook_request"
    t.check_constraint "(webhook_rotation_state = 'idle' AND previous_webhook_secret IS NULL) OR (webhook_rotation_state IN ('pending', 'confirmed') AND previous_webhook_secret IS NOT NULL)", name: "github_app_configurations_webhook_rotation"
    t.check_constraint "credential_revision > 0 AND lock_version >= 0", name: "github_app_configurations_revision"
    t.check_constraint "github_app_id > 0", name: "github_app_configurations_positive_app_id"
    t.check_constraint "installation_id IS NULL OR installation_id > 0", name: "github_app_configurations_positive_installation_id"
    t.check_constraint "installation_state IN ('not_installed', 'active', 'suspended', 'removed')", name: "github_app_configurations_installation_state"
    t.check_constraint "owner_github_id > 0", name: "github_app_configurations_positive_owner_id"
    t.check_constraint "owner_type IN ('Organization', 'User')", name: "github_app_configurations_owner_type"
    t.check_constraint "singleton_key = 1", name: "github_app_configurations_singleton"
  end

  create_table "github_identities", force: :cascade do |t|
    t.bigint "github_id", null: false
    t.string "login", null: false
    t.string "avatar_url"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["github_id"], name: "index_github_identities_on_github_id", unique: true
    t.check_constraint "github_id > 0", name: "github_identities_positive_id"
    t.check_constraint "length(trim(login)) > 0", name: "github_identities_login"
  end

  create_table "hub_admin_enrollments", force: :cascade do |t|
    t.string "proof_digest", null: false
    t.string "oauth_state_digest"
    t.datetime "expires_at", null: false
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_hub_admin_enrollments_on_expires_at"
    t.index ["proof_digest"], name: "index_hub_admin_enrollments_on_proof_digest", unique: true
  end

  create_table "improvement_comment_replies", force: :cascade do |t|
    t.integer "response_id", null: false
    t.integer "request_id", null: false
    t.integer "prototype_id", null: false
    t.integer "user_id", null: false
    t.string "thread_key", null: false
    t.integer "position", null: false
    t.index ["prototype_id", "user_id", "thread_key"], name: "improvement_comment_replies_thread"
    t.index ["prototype_id"], name: "index_improvement_comment_replies_on_prototype_id"
    t.index ["request_id"], name: "index_improvement_comment_replies_on_request_id"
    t.index ["response_id", "position"], name: "index_improvement_comment_replies_on_response_id_and_position", unique: true
    t.index ["response_id", "request_id"], name: "idx_on_response_id_request_id_1aa61357ff", unique: true
    t.index ["user_id"], name: "index_improvement_comment_replies_on_user_id"
    t.check_constraint "response_id <> request_id AND position >= 0", name: "improvement_comment_replies_shape"
  end

  create_table "improvement_comments", force: :cascade do |t|
    t.integer "prototype_id", null: false
    t.integer "user_id", null: false
    t.integer "build_id"
    t.integer "root_id"
    t.string "local_id", null: false
    t.string "thread_key", null: false
    t.integer "position", default: 0, null: false
    t.string "role", default: "author", null: false
    t.string "status", default: "open", null: false
    t.text "body"
    t.json "author_snapshot"
    t.json "anchor"
    t.integer "note_revision"
    t.string "note_status"
    t.datetime "deleted_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["build_id"], name: "index_improvement_comments_on_build_id"
    t.index ["id", "prototype_id", "user_id", "local_id"], name: "improvement_comments_root_identity", unique: true
    t.index ["id", "prototype_id", "user_id", "thread_key"], name: "improvement_comments_thread_identity", unique: true
    t.index ["prototype_id", "created_at", "id"], name: "idx_on_prototype_id_created_at_id_3f3dd1473e"
    t.index ["prototype_id", "user_id", "local_id"], name: "idx_on_prototype_id_user_id_local_id_bce29f2a3a", unique: true
    t.index ["prototype_id"], name: "index_improvement_comments_on_prototype_id"
    t.index ["root_id", "position"], name: "index_improvement_comments_on_root_id_and_position", unique: true
    t.index ["user_id"], name: "index_improvement_comments_on_user_id"
    t.check_constraint "(role = 'author' AND status IN ('open', 'sent', 'ready', 'blocked')) OR (role = 'copilot' AND status IN ('ready', 'blocked') AND author_snapshot IS NULL)", name: "improvement_comments_role_status"
    t.check_constraint "(root_id IS NULL AND position = 0 AND role = 'author' AND thread_key = local_id AND build_id IS NOT NULL AND anchor IS NOT NULL AND note_revision > 0 AND note_revision IS NOT NULL AND note_status IN ('open', 'sent', 'ready', 'resolved', 'blocked') AND note_status IS NOT NULL) OR (root_id IS NOT NULL AND root_id <> id AND position > 0 AND build_id IS NULL AND anchor IS NULL AND note_revision IS NULL AND note_status IS NULL)", name: "improvement_comments_shape"
    t.check_constraint "CASE WHEN deleted_at IS NULL THEN body IS NOT NULL AND length(trim(body)) > 0 AND length(CAST(body AS BLOB)) <= 10000 ELSE body IS NULL AND author_snapshot IS NULL END", name: "improvement_comments_body"
    t.check_constraint "anchor IS NULL OR (json_valid(anchor) AND json_type(anchor) = 'object' AND length(CAST(anchor AS BLOB)) <= 16384)", name: "improvement_comments_anchor"
    t.check_constraint "author_snapshot IS NULL OR (json_valid(author_snapshot) AND json_type(author_snapshot) = 'object')", name: "improvement_comments_author"
    t.check_constraint "length(local_id) = 36 AND length(thread_key) = 36", name: "improvement_comments_local_id"
  end

  create_table "learning_runs", force: :cascade do |t|
    t.integer "repository_id", null: false
    t.integer "requested_by_id"
    t.boolean "scheduled", default: false, null: false
    t.string "state", default: "queued", null: false
    t.datetime "started_at"
    t.datetime "finished_at"
    t.integer "comments_considered", default: 0, null: false
    t.integer "comments_labeled", default: 0, null: false
    t.integer "comments_remaining", default: 0, null: false
    t.integer "suggestions", default: 0, null: false
    t.integer "suggestions_remaining", default: 0, null: false
    t.integer "copilot_requests", default: 0, null: false
    t.bigint "input_tokens", default: 0, null: false
    t.bigint "output_tokens", default: 0, null: false
    t.bigint "nano_aiu", default: 0, null: false
    t.string "models"
    t.string "failure_code"
    t.string "failure_summary"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_learning_runs_on_created_at"
    t.index ["repository_id", "created_at"], name: "index_learning_runs_on_repository_id_and_created_at"
    t.index ["repository_id"], name: "index_learning_runs_on_active_repository", unique: true, where: "state IN ('queued', 'running')"
    t.index ["requested_by_id"], name: "index_learning_runs_on_requested_by_id"
    t.check_constraint "comments_considered >= 0 AND comments_labeled >= 0 AND comments_remaining >= 0 AND suggestions >= 0 AND suggestions_remaining >= 0 AND copilot_requests >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND nano_aiu >= 0", name: "learning_runs_counts"
    t.check_constraint "state IN ('queued', 'running', 'succeeded', 'failed')", name: "learning_runs_state"
  end

  create_table "notification_resources", force: :cascade do |t|
    t.integer "notification_id", null: false
    t.string "resource_type", null: false
    t.integer "resource_id", null: false
    t.string "role", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["notification_id", "resource_type", "resource_id", "role"], name: "index_notification_resources_on_identity", unique: true
    t.index ["notification_id"], name: "index_notification_resources_on_notification_id"
    t.index ["resource_type", "resource_id"], name: "index_notification_resources_on_resource"
    t.check_constraint "role IN ('primary', 'context')", name: "notification_resources_role"
  end

  create_table "notifications", force: :cascade do |t|
    t.integer "recipient_id", null: false
    t.integer "actor_id", null: false
    t.integer "comment_mention_id"
    t.string "kind", null: false
    t.datetime "read_at"
    t.integer "lock_version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "source_key", null: false
    t.index ["actor_id"], name: "index_notifications_on_actor_id"
    t.index ["comment_mention_id"], name: "index_notifications_on_comment_mention_id", unique: true
    t.index ["recipient_id", "created_at", "id"], name: "index_notifications_on_recipient_id_and_created_at_and_id"
    t.index ["recipient_id", "source_key"], name: "index_notifications_on_recipient_id_and_source_key", unique: true
    t.index ["recipient_id"], name: "index_notifications_on_recipient_id"
    t.check_constraint "(kind = 'comment_mention' AND comment_mention_id IS NOT NULL) OR (kind <> 'comment_mention' AND comment_mention_id IS NULL)", name: "notifications_mention_source"
    t.check_constraint "kind IN ('comment_created', 'comment_mention', 'comment_reply', 'comment_reaction', 'thread_resolved', 'thread_reopened')", name: "notifications_kind"
    t.check_constraint "lock_version >= 0", name: "notifications_version"
  end

  create_table "preview_grants", force: :cascade do |t|
    t.integer "build_id", null: false
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "return_path", limit: 2048, null: false
    t.integer "session_id", null: false
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.index ["build_id"], name: "index_preview_grants_on_build_id"
    t.index ["session_id"], name: "index_preview_grants_on_session_id"
    t.index ["token_digest"], name: "index_preview_grants_on_token_digest", unique: true
    t.check_constraint "length(CAST(return_path AS BLOB)) BETWEEN 1 AND 2048 AND substr(return_path, 1, 1) = '/'", name: "preview_grants_return_path"
    t.check_constraint "length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*'", name: "preview_grants_token_digest"
  end

  create_table "prototype_introductions", force: :cascade do |t|
    t.integer "user_id", null: false
    t.integer "prototype_id", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["prototype_id"], name: "index_prototype_introductions_on_prototype_id"
    t.index ["user_id", "prototype_id"], name: "index_prototype_introductions_on_user_id_and_prototype_id", unique: true
    t.index ["user_id"], name: "index_prototype_introductions_on_user_id"
  end

  create_table "prototypes", force: :cascade do |t|
    t.integer "author_id"
    t.string "branch_name", null: false
    t.datetime "created_at", null: false
    t.integer "current_build_id"
    t.string "description", limit: 500
    t.datetime "first_published_at"
    t.datetime "local_head_observed_at"
    t.string "name"
    t.datetime "registered_at"
    t.boolean "replica", default: false, null: false
    t.integer "repository_id", null: false
    t.string "start_page", limit: 2048
    t.string "start_page_import_error"
    t.datetime "start_page_set_at"
    t.datetime "updated_at", null: false
    t.bigint "head_observation_revision", default: 0, null: false
    t.datetime "branch_deleted_at"
    t.string "retired_head_sha"
    t.index ["author_id"], name: "index_prototypes_on_author_id"
    t.index ["current_build_id"], name: "index_prototypes_on_current_build_id"
    t.index ["repository_id", "branch_name", "branch_deleted_at"], name: "idx_on_repository_id_branch_name_branch_deleted_at_37960952d6"
    t.index ["repository_id", "branch_name"], name: "index_prototypes_on_active_branch", unique: true, where: "branch_deleted_at IS NULL"
    t.index ["repository_id"], name: "index_prototypes_on_repository_id"
    t.check_constraint "description IS NULL OR length(trim(description)) BETWEEN 1 AND 500", name: "prototypes_description"
    t.check_constraint "length(trim(branch_name)) BETWEEN 1 AND 255", name: "prototypes_branch_name"
    t.check_constraint "name IS NULL OR length(trim(name)) BETWEEN 1 AND 255", name: "prototypes_name"
    t.check_constraint "registered_at IS NULL OR name IS NOT NULL", name: "prototypes_registration"
    t.check_constraint "replica = 0 OR registered_at IS NULL", name: "prototypes_replica_unregistered"
    t.check_constraint "retired_head_sha IS NULL OR (branch_deleted_at IS NOT NULL AND length(retired_head_sha) = 40 AND retired_head_sha NOT GLOB '*[^0-9a-f]*')", name: "prototypes_retired_head"
    t.check_constraint "start_page IS NULL OR (length(CAST(start_page AS BLOB)) BETWEEN 1 AND 2048 AND substr(start_page, 1, 1) = '/' AND substr(start_page, 1, 2) != '//')", name: "prototypes_start_page"
  end

  create_table "repositories", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "default_branch", null: false
    t.bigint "github_id"
    t.string "installation_state", default: "active", null: false
    t.string "local_identity"
    t.string "local_path"
    t.string "name_with_owner", null: false
    t.datetime "removed_at"
    t.datetime "synchronized_at", null: false
    t.datetime "updated_at", null: false
    t.index ["github_id"], name: "index_repositories_on_github_id", unique: true
    t.index ["local_path", "local_identity"], name: "index_repositories_on_local_path_and_identity", unique: true
    t.index ["local_path"], name: "index_active_repositories_on_local_path", unique: true, where: "installation_state = 'active'"
    t.check_constraint "(github_id IS NOT NULL AND github_id > 0 AND local_path IS NULL) OR (github_id IS NULL AND local_path IS NOT NULL AND length(trim(local_path)) > 0)", name: "repositories_source_identity"
    t.check_constraint "(installation_state = 'active' AND removed_at IS NULL) OR (installation_state = 'removed' AND removed_at IS NOT NULL)", name: "repositories_removal_state"
    t.check_constraint "installation_state IN ('active', 'removed')", name: "repositories_installation_state"
    t.check_constraint "length(trim(default_branch)) > 0", name: "repositories_default_branch_present"
    t.check_constraint "length(trim(name_with_owner)) > 0", name: "repositories_name_present"
    t.check_constraint "local_identity IS NULL OR local_path IS NOT NULL", name: "repositories_local_identity"
  end

  create_table "review_comment_reactions", force: :cascade do |t|
    t.string "content", null: false
    t.datetime "created_at", null: false
    t.integer "review_comment_id", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["review_comment_id", "user_id", "content"], name: "index_review_comment_reactions_on_identity", unique: true
    t.index ["review_comment_id"], name: "index_review_comment_reactions_on_review_comment_id"
    t.index ["user_id"], name: "index_review_comment_reactions_on_user_id"
    t.check_constraint "content IN ('+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes')", name: "review_comment_reactions_content"
  end

  create_table "review_comments", force: :cascade do |t|
    t.integer "activity_version"
    t.json "anchor"
    t.text "body"
    t.integer "build_id"
    t.datetime "created_at", null: false
    t.datetime "deleted_at"
    t.datetime "edited_at"
    t.integer "prototype_id", null: false
    t.datetime "resolved_at"
    t.integer "resolved_by_id"
    t.integer "root_id"
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.datetime "learning_removal_due_at"
    t.index ["build_id"], name: "index_review_comments_on_build_id"
    t.index ["id", "prototype_id"], name: "index_review_comments_on_id_and_prototype", unique: true
    t.index ["learning_removal_due_at"], name: "index_review_comments_on_learning_removal_due_at", where: "learning_removal_due_at IS NOT NULL"
    t.index ["prototype_id", "created_at", "id"], name: "index_review_comments_on_prototype_and_created_at", order: { created_at: :desc, id: :desc }
    t.index ["resolved_by_id"], name: "index_review_comments_on_resolved_by_id"
    t.index ["root_id"], name: "index_review_comments_on_root_id"
    t.index ["user_id"], name: "index_review_comments_on_user_id"
    t.check_constraint "(resolved_at IS NULL AND resolved_by_id IS NULL) OR (root_id IS NULL AND resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL)", name: "review_comments_resolution"
    t.check_constraint "(root_id IS NULL AND activity_version IS NOT NULL AND activity_version > 0) OR (root_id IS NOT NULL AND activity_version IS NULL)", name: "review_comments_activity_version"
    t.check_constraint "(root_id IS NULL AND build_id IS NOT NULL AND anchor IS NOT NULL) OR (root_id IS NOT NULL AND build_id IS NULL AND anchor IS NULL)", name: "review_comments_thread_shape"
    t.check_constraint "CASE WHEN deleted_at IS NULL THEN body IS NOT NULL AND length(trim(body)) > 0 AND length(CAST(body AS BLOB)) <= 10000 ELSE body IS NULL END", name: "review_comments_body"
    t.check_constraint "anchor IS NULL OR json_type(anchor) = 'object'", name: "review_comments_anchor_object"
    t.check_constraint "anchor IS NULL OR json_valid(anchor)", name: "review_comments_anchor_json"
    t.check_constraint "anchor IS NULL OR length(CAST(anchor AS BLOB)) BETWEEN 2 AND 16384", name: "review_comments_anchor_size"
    t.check_constraint "deleted_at IS NULL OR deleted_at >= created_at", name: "review_comments_deletion_time"
    t.check_constraint "edited_at IS NULL OR (deleted_at IS NULL AND edited_at >= created_at)", name: "review_comments_edit_state"
    t.check_constraint "root_id IS NULL OR root_id <> id", name: "review_comments_root_not_self"
  end

  create_table "review_thread_reads", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "last_seen_activity_version", null: false
    t.datetime "read_at", null: false
    t.integer "root_id", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["root_id", "user_id"], name: "index_review_thread_reads_on_root_and_user", unique: true
    t.index ["root_id"], name: "index_review_thread_reads_on_root_id"
    t.index ["user_id"], name: "index_review_thread_reads_on_user_id"
    t.check_constraint "last_seen_activity_version > 0", name: "review_thread_reads_positive_version"
  end

  create_table "security_audit_events", force: :cascade do |t|
    t.string "action", null: false
    t.string "outcome", null: false
    t.datetime "occurred_at", null: false
    t.integer "repository_id"
    t.boolean "repository_scoped", default: false, null: false
    t.integer "user_id"
    t.string "ip_address"
    t.json "context", default: {}, null: false
    t.index ["occurred_at"], name: "index_security_audit_events_on_occurred_at"
    t.index ["repository_id", "occurred_at", "id"], name: "idx_on_repository_id_occurred_at_id_f6955b3393"
    t.index ["repository_id"], name: "index_security_audit_events_on_repository_id"
    t.index ["user_id"], name: "index_security_audit_events_on_user_id"
    t.check_constraint "json_valid(context) AND json_type(context) = 'object'", name: "security_audit_events_context"
    t.check_constraint "outcome IN ('succeeded', 'denied', 'failed')", name: "security_audit_events_outcome"
    t.check_constraint "repository_scoped = 1 OR repository_id IS NULL", name: "security_audit_events_repository_scope"
  end

  create_table "session_revocations", force: :cascade do |t|
    t.integer "singleton_key", default: 1, null: false
    t.bigint "generation", default: 0, null: false
    t.datetime "ended_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["singleton_key"], name: "index_session_revocations_on_singleton_key", unique: true
    t.check_constraint "generation >= 0", name: "session_revocations_generation"
    t.check_constraint "singleton_key = 1", name: "session_revocations_singleton"
  end

  create_table "sessions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "ip_address"
    t.datetime "updated_at", null: false
    t.string "user_agent"
    t.integer "user_id", null: false
    t.datetime "fresh_authorized_at"
    t.index ["user_id"], name: "index_sessions_on_user_id"
  end

  create_table "share_link_creator_revocations", force: :cascade do |t|
    t.integer "repository_id", null: false
    t.integer "user_id", null: false
    t.integer "revision", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["repository_id", "user_id"], name: "idx_on_repository_id_user_id_5f43486b67", unique: true
    t.index ["repository_id"], name: "index_share_link_creator_revocations_on_repository_id"
    t.index ["user_id"], name: "index_share_link_creator_revocations_on_user_id"
    t.check_constraint "revision >= 0", name: "share_link_creator_revocations_revision"
  end

  create_table "share_links", force: :cascade do |t|
    t.integer "build_id", null: false
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "expires_at"
    t.string "label", limit: 100, null: false
    t.integer "prototype_id", null: false
    t.string "public_id", limit: 36, null: false
    t.datetime "updated_at", null: false
    t.datetime "revoked_at"
    t.index ["build_id"], name: "index_share_links_on_build_id"
    t.index ["created_by_id"], name: "index_share_links_on_created_by_id"
    t.index ["prototype_id", "expires_at", "id"], name: "index_share_links_on_prototype_and_expiration"
    t.index ["public_id"], name: "index_share_links_on_public_id", unique: true
    t.check_constraint "expires_at IS NULL OR expires_at > created_at", name: "share_links_expiration"
    t.check_constraint "length(public_id) = 36 AND substr(public_id, 9, 1) = '-' AND substr(public_id, 14, 1) = '-' AND substr(public_id, 19, 1) = '-' AND substr(public_id, 24, 1) = '-' AND length(replace(public_id, '-', '')) = 32 AND replace(public_id, '-', '') NOT GLOB '*[^0-9a-f]*'", name: "share_links_public_id"
    t.check_constraint "length(trim(label)) > 0 AND length(CAST(label AS BLOB)) <= 100", name: "share_links_label"
  end

  create_table "share_preview_grants", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "return_path", limit: 2048, default: "/", null: false
    t.integer "share_link_id", null: false
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.index ["share_link_id"], name: "index_share_preview_grants_on_share_link_id"
    t.index ["token_digest"], name: "index_share_preview_grants_on_token_digest", unique: true
    t.check_constraint "length(CAST(return_path AS BLOB)) BETWEEN 1 AND 2048 AND substr(return_path, 1, 1) = '/'", name: "share_preview_grants_return_path"
    t.check_constraint "length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*'", name: "share_preview_grants_token_digest"
  end

  create_table "sharing_settings", force: :cascade do |t|
    t.boolean "public_sharing_enabled", default: false, null: false
    t.integer "revision", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.check_constraint "id = 1", name: "sharing_settings_singleton"
    t.check_constraint "revision >= 0", name: "sharing_settings_revision"
  end

  create_table "users", force: :cascade do |t|
    t.string "avatar_url"
    t.datetime "created_at", null: false
    t.bigint "github_id"
    t.datetime "last_authenticated_at", null: false
    t.string "login", null: false
    t.string "name"
    t.datetime "updated_at", null: false
    t.boolean "hub_admin", default: false, null: false
    t.boolean "welcome_hidden", default: false, null: false
    t.boolean "welcome_sign_in_pending", default: true, null: false
    t.index "(github_id IS NULL)", name: "index_users_on_one_local_identity", unique: true, where: "github_id IS NULL"
    t.index ["github_id"], name: "index_users_on_github_id", unique: true
    t.check_constraint "github_id IS NULL OR github_id > 0", name: "users_positive_github_id"
    t.check_constraint "length(trim(login)) > 0", name: "users_login_present"
  end

  create_table "webhook_deliveries", force: :cascade do |t|
    t.integer "build_id"
    t.datetime "created_at", null: false
    t.string "event", null: false
    t.string "github_delivery_id", null: false
    t.string "payload_sha256", null: false
    t.datetime "processed_at"
    t.datetime "processing_started_at"
    t.datetime "updated_at", null: false
    t.string "processing_token"
    t.index ["build_id"], name: "index_webhook_deliveries_on_build_id"
    t.index ["created_at"], name: "index_webhook_deliveries_on_created_at"
    t.index ["github_delivery_id"], name: "index_webhook_deliveries_on_github_delivery_id", unique: true
    t.check_constraint "length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'", name: "webhook_deliveries_payload_sha256"
    t.check_constraint "length(trim(event)) BETWEEN 1 AND 100", name: "webhook_deliveries_event"
    t.check_constraint "length(trim(github_delivery_id)) BETWEEN 1 AND 255", name: "webhook_deliveries_github_id"
    t.check_constraint "processed_at IS NULL OR processing_started_at IS NULL", name: "webhook_deliveries_processing_state"
  end

  create_table "webhook_recovery_checkpoints", force: :cascade do |t|
    t.bigint "github_app_configuration_id", null: false
    t.bigint "github_app_id", null: false
    t.string "cursor", limit: 2048
    t.integer "pages", default: 0, null: false
    t.datetime "scan_started_at"
    t.datetime "last_completed_at"
    t.datetime "gap_started_at"
    t.datetime "gap_ended_at"
    t.datetime "due_at", null: false
    t.datetime "enqueue_claim_expires_at"
    t.string "lease_token"
    t.integer "failures", default: 0, null: false
    t.string "failure_code"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "credential_revision", default: 1, null: false
    t.datetime "last_completed_scan_started_at"
    t.bigint "last_completed_credential_revision"
    t.index ["github_app_configuration_id"], name: "idx_on_github_app_configuration_id_aabbf4a511", unique: true
    t.index ["updated_at"], name: "index_webhook_recovery_checkpoints_on_updated_at"
    t.check_constraint "credential_revision > 0", name: "webhook_recovery_revision"
    t.check_constraint "github_app_configuration_id > 0 AND github_app_id > 0", name: "webhook_recovery_app"
    t.check_constraint "pages >= 0 AND failures >= 0", name: "webhook_recovery_counters"
  end

  create_table "webhook_redeliveries", force: :cascade do |t|
    t.bigint "github_app_configuration_id", null: false
    t.bigint "github_app_id", null: false
    t.string "github_delivery_id", null: false
    t.bigint "github_attempt_id"
    t.bigint "installation_id"
    t.string "event", null: false
    t.string "state", default: "pending", null: false
    t.integer "attempts", default: 0, null: false
    t.datetime "first_delivered_at", null: false
    t.datetime "due_at", null: false
    t.datetime "expires_at", null: false
    t.string "failure_code"
    t.string "lease_token"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "credential_revision", default: 1, null: false
    t.index ["github_app_configuration_id", "github_delivery_id"], name: "index_webhook_redeliveries_on_app_and_guid", unique: true
    t.index ["github_delivery_id"], name: "index_webhook_redeliveries_on_github_delivery_id"
    t.index ["state", "due_at"], name: "index_webhook_redeliveries_on_state_and_due_at"
    t.index ["state", "updated_at"], name: "index_webhook_redeliveries_on_state_and_updated_at"
    t.check_constraint "attempts BETWEEN 0 AND 12", name: "webhook_redelivery_attempts"
    t.check_constraint "credential_revision > 0", name: "webhook_redelivery_revision"
    t.check_constraint "event IN ('push', 'workflow_run', 'installation', 'installation_repositories')", name: "webhook_redelivery_event"
    t.check_constraint "expires_at > first_delivered_at", name: "webhook_redelivery_window"
    t.check_constraint "github_app_configuration_id > 0 AND github_app_id > 0", name: "webhook_redelivery_app"
    t.check_constraint "github_attempt_id IS NULL OR github_attempt_id > 0", name: "webhook_redelivery_attempt_id"
    t.check_constraint "installation_id IS NULL OR installation_id > 0", name: "webhook_redelivery_installation"
    t.check_constraint "length(trim(github_delivery_id)) BETWEEN 1 AND 255", name: "webhook_redelivery_guid"
    t.check_constraint "state IN ('pending', 'requesting', 'waiting', 'succeeded', 'failed')", name: "webhook_redelivery_state"
  end

  add_foreign_key "analytics_deliveries", "analytics_destinations", column: ["destination_id", "repository_id"], primary_key: ["id", "repository_id"], on_delete: :cascade
  add_foreign_key "analytics_deliveries", "analytics_events", column: ["event_id", "repository_id"], primary_key: ["id", "repository_id"], on_delete: :cascade
  add_foreign_key "analytics_deliveries", "repositories"
  add_foreign_key "analytics_destinations", "repositories"
  add_foreign_key "analytics_events", "repositories"
  add_foreign_key "branch_banner_dismissals", "prototypes", on_delete: :cascade
  add_foreign_key "branch_banner_dismissals", "users", on_delete: :cascade
  add_foreign_key "builds", "prototypes"
  add_foreign_key "canvas_grants", "repositories", on_delete: :cascade
  add_foreign_key "canvas_grants", "users", on_delete: :cascade
  add_foreign_key "canvas_pairings", "repositories", on_delete: :cascade
  add_foreign_key "canvas_pairings", "users", on_delete: :cascade
  add_foreign_key "comment_mentions", "github_identities", on_delete: :restrict
  add_foreign_key "comment_mentions", "review_comments", on_delete: :cascade
  add_foreign_key "copilot_connections", "users", on_delete: :cascade
  add_foreign_key "fresh_authorizations", "repositories", on_delete: :nullify
  add_foreign_key "fresh_authorizations", "users", on_delete: :cascade
  add_foreign_key "improvement_comment_replies", "improvement_comments", column: ["request_id", "prototype_id", "user_id", "thread_key"], primary_key: ["id", "prototype_id", "user_id", "thread_key"], on_delete: :restrict
  add_foreign_key "improvement_comment_replies", "improvement_comments", column: ["response_id", "prototype_id", "user_id", "thread_key"], primary_key: ["id", "prototype_id", "user_id", "thread_key"], on_delete: :restrict
  add_foreign_key "improvement_comments", "builds", column: ["build_id", "prototype_id"], primary_key: ["id", "prototype_id"], on_delete: :restrict
  add_foreign_key "improvement_comments", "improvement_comments", column: ["root_id", "prototype_id", "user_id", "thread_key"], primary_key: ["id", "prototype_id", "user_id", "local_id"], on_delete: :restrict
  add_foreign_key "improvement_comments", "prototypes", on_delete: :restrict
  add_foreign_key "improvement_comments", "users", on_delete: :restrict
  add_foreign_key "learning_runs", "repositories", on_delete: :cascade
  add_foreign_key "learning_runs", "users", column: "requested_by_id", on_delete: :nullify
  add_foreign_key "notification_resources", "notifications", on_delete: :cascade
  add_foreign_key "notifications", "comment_mentions", on_delete: :cascade
  add_foreign_key "notifications", "github_identities", column: "recipient_id", on_delete: :restrict
  add_foreign_key "notifications", "users", column: "actor_id", on_delete: :restrict
  add_foreign_key "preview_grants", "builds", on_delete: :cascade
  add_foreign_key "preview_grants", "sessions", on_delete: :cascade
  add_foreign_key "prototype_introductions", "prototypes", on_delete: :cascade
  add_foreign_key "prototype_introductions", "users", on_delete: :cascade
  add_foreign_key "prototypes", "builds", column: ["current_build_id", "id"], primary_key: ["id", "prototype_id"], on_delete: :restrict
  add_foreign_key "prototypes", "repositories"
  add_foreign_key "prototypes", "users", column: "author_id"
  add_foreign_key "review_comment_reactions", "review_comments", on_delete: :cascade
  add_foreign_key "review_comment_reactions", "users", on_delete: :restrict
  add_foreign_key "review_comments", "builds", column: ["build_id", "prototype_id"], primary_key: ["id", "prototype_id"], on_delete: :restrict
  add_foreign_key "review_comments", "prototypes", on_delete: :restrict
  add_foreign_key "review_comments", "review_comments", column: ["root_id", "prototype_id"], primary_key: ["id", "prototype_id"], on_delete: :restrict
  add_foreign_key "review_comments", "users", column: "resolved_by_id", on_delete: :restrict
  add_foreign_key "review_comments", "users", on_delete: :restrict
  add_foreign_key "review_thread_reads", "review_comments", column: "root_id", on_delete: :cascade
  add_foreign_key "review_thread_reads", "users", on_delete: :restrict
  add_foreign_key "security_audit_events", "repositories", on_delete: :nullify
  add_foreign_key "security_audit_events", "users", on_delete: :nullify
  add_foreign_key "sessions", "users", on_delete: :cascade
  add_foreign_key "share_link_creator_revocations", "repositories"
  add_foreign_key "share_link_creator_revocations", "users"
  add_foreign_key "share_links", "builds", column: ["build_id", "prototype_id"], primary_key: ["id", "prototype_id"], on_delete: :restrict
  add_foreign_key "share_links", "prototypes", on_delete: :restrict
  add_foreign_key "share_links", "users", column: "created_by_id", on_delete: :restrict
  add_foreign_key "share_preview_grants", "share_links", on_delete: :cascade
  add_foreign_key "webhook_deliveries", "builds", on_delete: :nullify
end
