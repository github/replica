require "fileutils"
require "open3"
require "tmpdir"

# Enables filesystem repositories only when a developer explicitly opts in.
class LocalDevelopment
  class Error < StandardError; end
  REPOSITORY_ID_KEY = "replica.localId"
  EXAMPLE_BRANCHES = {
    "prototype/welcome" => "welcome",
    "prototype/field-notes" => "field-notes",
    "prototype/signal-room" => "signal-room"
  }.freeze

  # Never permits local identity or source access in production or test by default.
  def self.enabled?
    Rails.env.development? && ENV["REPLICA_LOCAL_MODE"] == "1"
  end

  # Keeps browser cookies from resolving the same database ID in the other mode.
  def self.session_cookie_key
    return "__Host-replica_hub_session" if Rails.env.production?

    enabled? ? "replica_hub_local_session" : "replica_hub_session"
  end

  # Keeps local repositories inside this checkout's ignored workspace.
  def self.repositories_root
    Pathname(ENV.fetch(
      "REPLICA_LOCAL_PROTOTYPES_ROOT",
      Rails.root.join(".local/prototypes").to_s
    )).expand_path
  end

  # Prepares one reviewable example without replacing repositories a developer already owns.
  def self.seed_example!
    raise Error, "Local mode is disabled" if !enabled?

    root = repositories_root
    raise Error, "Local prototype directory uses a symbolic link: #{root}" if root.ascend.any?(&:symlink?)

    FileUtils.mkdir_p(root)
    warm_build_dependencies!
    return if root.children.any?

    directory = Dir.mktmpdir("replica-example-", root.to_s)
    begin
      checkout = Pathname(directory)
      FileUtils.cp_r(Rails.root.join("../starters/minimal").children, checkout)
      example_git!(checkout, "init", "-b", "main")
      seed_example_templates!(checkout)
      example_git!(checkout, "add", ".")
      commit_example!(checkout, "chore: start local prototype")
      seed_example_branches!(checkout)
      warm_dependencies!(checkout)

      raise Error, "Local prototype directory changed during setup: #{root}" if root.children != [ checkout ]

      File.rename(checkout, root.join("example"))
    ensure
      FileUtils.remove_entry(directory) if File.exist?(directory)
    end
  end

  # Returns the configured repository paths without following directory links.
  def self.repository_paths
    root = repositories_root
    if !root.directory? || root.ascend.any?(&:symlink?)
      raise Error, "Local prototype directory does not exist or uses a symbolic link: #{root}"
    end

    root.children.select do |path|
      repository_available?(path.to_s)
    end.sort
  end

  # Keeps a removed or replaced checkout from granting stale access.
  def self.repository_available?(value, identity: :any)
    path = Pathname(value)
    root = repositories_root
    git_directory = path.join(".git")
    available = path.dirname == root && root.directory? && root.ascend.none?(&:symlink?) &&
      path.directory? && !path.symlink? && !git_directory.symlink? &&
      git_directory.directory?
    available && (identity == :any || (identity.present? && repository_identity(path) == identity))
  end

  # A checkout keeps its private identity in Git config, never in a commit.
  def self.repository_identity(path, create: false)
    output, error, status = Open3.capture3 \
      "git", "-C", path.to_s, "config", "--local", "--get-all", REPOSITORY_ID_KEY
    if status.exitstatus == 1 && output.empty?
      return if !create

      identity = SecureRandom.uuid
      Repository::LocalDiscovery.git!("-C", path.to_s, "config", "--local", REPOSITORY_ID_KEY, identity)
      return identity
    end
    if !status.success? || output.lines.size != 1 ||
        !output.strip.match?(/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/)
      raise Error, "Invalid local repository identity at #{path}: #{error.strip.presence || REPOSITORY_ID_KEY}"
    end

    output.strip
  end

  # Prevents background maintenance from outliving the temporary example.
  def self.example_git!(checkout, *arguments)
    Repository::LocalDiscovery.git!("-c", "maintenance.auto=false", "-C", checkout.to_s, *arguments)
  end
  private_class_method :example_git!

  # Gives the example reproducible commits without requiring a developer's Git identity.
  def self.commit_example!(checkout, message)
    arguments = [ "-c", "user.name=Replica Example",
      "-c", "user.email=local@example.invalid",
      "-c", "commit.gpgsign=false",
      "commit" ]
    example_git!(checkout, *arguments, "-m", message)
  end
  private_class_method :commit_example!

  # Adds authored layouts to the first default-branch seed without changing the starter.
  def self.seed_example_templates!(checkout)
    pages = Rails.root.join("db/seeds/local/example")
    templates = JSON.parse(File.read(pages.join("replica.json"))).fetch("templates")
    router_path = checkout.join("src/app/router.tsx")
    router = File.read(router_path)
    imports = []
    routes = []
    templates.each_with_index do |template, index|
      id = template.fetch("id")
      directory = checkout.join("src/routes/templates", id)
      FileUtils.mkdir_p(directory)
      FileUtils.cp(pages.join("#{id}.tsx"), directory.join("index.tsx"))
      FileUtils.cp(pages.join("#{id}.css"), directory.join("styles.css"))
      imports << "import { HomePage as Template#{index} } from \"@routes/templates/#{id}\""
      routes << "  createRoute({ getParentRoute: () => rootRoute, path: \"/#{id}\", component: Template#{index} }),"
    end
    router.sub!("// --- end scaffold:imports ---", "#{imports.join("\n")}\n// --- end scaffold:imports ---")
    router.sub!("  // --- end scaffold:app-routes ---", "#{routes.join("\n")}\n  // --- end scaffold:app-routes ---")
    File.write(router_path, router)
    FileUtils.mkdir_p(checkout.join(".github"))
    FileUtils.cp(pages.join("replica.json"), checkout.join(".github/replica.json"))
  end
  private_class_method :seed_example_templates!

  # Keeps authored demo pages in Hub, not in the neutral starter.
  def self.seed_example_branches!(checkout)
    pages = Rails.root.join("db/seeds/local/example")
    page_path = "src/routes/home/home-page/index.tsx"
    style_path = "src/routes/home/home-page/styles.css"
    adapter_path = "src/routes/home/home-route-page/index.tsx"
    EXAMPLE_BRANCHES.each do |branch, page|
      example_git!(checkout, "switch", "-c", branch, "main")
      FileUtils.cp(pages.join("#{page}.tsx"), checkout.join(page_path))
      FileUtils.cp(pages.join("#{page}.css"), checkout.join(style_path))
      FileUtils.cp(pages.join("route-page.tsx.template"), checkout.join(adapter_path))
      FileUtils.cp(pages.join(".prototype"), checkout.join(".prototype"))
      example_git!(checkout, "add", ".prototype", page_path, style_path, adapter_path)
      commit_example!(checkout, "feat: add #{page.tr('-', ' ')} demo")
    end
    example_git!(checkout, "switch", "prototype/welcome")
  end
  private_class_method :seed_example_branches!

  # Caches the shared build action even when the example already exists.
  def self.warm_build_dependencies!
    action = Rails.root.join("../actions/build").expand_path
    npm_ci!(action, "--ignore-scripts", "--omit=dev") if !action.join("node_modules/playwright").directory?
  end

  # Prepares only the newly seeded example; existing checkouts stay untouched.
  def self.warm_dependencies!(checkout)
    npm_ci!(checkout)
  end

  def self.npm_ci!(directory, *options)
    output, error, status = Open3.capture3("npm", "ci", *options, chdir: directory.to_s)
    return if status.success?

    raise Error, "Could not prepare local example dependencies: " \
      "#{(error.presence || output).strip.last(700)}"
  end
  private_class_method :npm_ci!
end
