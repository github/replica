# Run using bin/ci

CI.run do
  step "Setup", "bin/setup --skip-server"

  step "Style: Ruby", "bin/rubocop"
  step "Style: TypeScript", "npm run lint"
  step "Types: TypeScript", "npm run typecheck"
  step "Security: Gem audit", "bin/bundler-audit"
  step "Security: Dependency age", "bin/check-dependency-age"
  step "Build: Test browser", "env RAILS_ENV=test bundle exec vite build"
  step "Tests: Rails", "bin/rails test"
  step "Tests: TypeScript", "npm test"
  step "Tests: Task client", "npm run task-client:test"
  step "Tests: Build controls", "npm run controls:test"
  step "Build: Controls bridge", "npm run controls:assets:check"
  step "Tests: Prototype extension", "npm run extension:test"
  step "Tests: Seeds", "env RAILS_ENV=test bin/rails db:seed:replant"
  step "Tests: Development queue", "bin/check-development-queue"
  step "Architecture: Zeitwerk", "bin/rails zeitwerk:check"
  step "Annotations", "bin/check-annotations"
  step "Build: Storybook", "npm run storybook:build"
  step "Build: Prototype extension assets", "npm run extension:assets:check"
  step "Build: Browser", "npm run build"
end
