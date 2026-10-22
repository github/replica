require "test_helper"
require "timeout"

class Repository::PrototypeCandidatesTest < ActiveSupport::TestCase
  test "overlaps branch comparisons within four calls and deduplicates heads before caching on the request thread" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    github_app_configurations.create_installed
    user = users.create
    repository = repositories.create
    heads = { "main" => "a" * 40 }
    6.times do |index|
      name = "prototype/branch-#{index}"
      heads[name] = format("%040x", index + 1)
      prototypes.create(repository:, branch_name: name)
    end
    heads["prototype/shared-head"] = heads.fetch("prototype/branch-0")
    prototypes.create(repository:, branch_name: "prototype/shared-head")
    prototypes.create(repository:, branch_name: "prototype/deleted")
    stub_github_installation_token
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(heads.map { |name, sha| { name:, commit: { sha: } } }),
        headers: { "Content-Type" => "application/json" }
    started = Queue.new
    release = Queue.new
    mutex = Mutex.new
    active = 0
    maximum = 0
    stub_request(:get, %r{/repos/#{repository.github_path}/compare/})
      .to_return do
        mutex.synchronize do
          active += 1
          maximum = [ maximum, active ].max
        end
        started << true
        release.pop
        {
          status: 200,
          body: JSON.generate(total_commits: 1, commits: [ { author: { id: user.github_id } } ]),
          headers: { "Content-Type" => "application/json" }
        }
      ensure
        mutex.synchronize { active -= 1 }
      end
    coordinator = Thread.new do
      Timeout.timeout(5) do
        4.times { started.pop }
        4.times { release << true }
        2.times { started.pop }
        2.times { release << true }
      end
    ensure
      6.times { release << true }
    end
    request_thread = Thread.current
    configuration_reads = []
    cache_writers = []
    sql = ->(*arguments) do
      payload = arguments.last
      configuration_reads << Thread.current if payload[:sql].include?('FROM "github_app_configurations"')
    end
    cache = ->(*) { cache_writers << Thread.current }
    result = nil

    ActiveSupport::Notifications.subscribed(sql, "sql.active_record") do
      ActiveSupport::Notifications.subscribed(cache, "cache_write.active_support") do
        result = repository.prototype_candidates.available_page(user, permission: "write")
      end
    end
    coordinator.value

    assert_equal heads.keys.grep(/^prototype/).sort, result.first.map(&:branch_name).sort
    assert_equal 1, result.last
    assert_equal 4, maximum
    assert_equal [ request_thread ], configuration_reads
    assert_equal [ request_thread ] * 6, cache_writers
    assert_requested :get, %r{/compare/}, times: 6
    assert_requested :post, "#{GITHUB_API_URL}/app/installations/456/access_tokens", times: 1
    WebMock.reset_executed_requests!

    assert_equal result, repository.prototype_candidates.available_page(user, permission: "write")
    assert_not_requested :get, %r{/compare/}
  ensure
    6.times { release << true } if release
    coordinator&.join
    Rails.cache = original_cache
  end

  test "retains a successful in-flight comparison after another head fails and retries incomplete history" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    github_app_configurations.create_installed
    user = users.create
    repository = repositories.create
    base = "a" * 40
    failed_head = "b" * 40
    successful_head = "c" * 40
    heads = { "main" => base, "prototype/failed" => failed_head, "prototype/successful" => successful_head }
    heads.keys.grep(/^prototype/).each { |name| prototypes.create(repository:, branch_name: name) }
    stub_github_installation_token
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(heads.map { |name, sha| { name:, commit: { sha: } } }),
        headers: { "Content-Type" => "application/json" }
    response = {
      status: 200,
      body: JSON.generate(total_commits: 1, commits: [ { author: { id: user.github_id } } ]),
      headers: { "Content-Type" => "application/json" }
    }
    comparison_url = "#{GITHUB_API_URL}/repos/#{repository.github_path}/compare/#{base}..."
    incomplete_request = stub_request(:get, "#{comparison_url}#{failed_head}")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(total_commits: 101, commits: Array.new(100) { { author: { id: user.github_id } } }),
        headers: { "Content-Type" => "application/json" }
    successful_started = Queue.new
    failure_raised = Queue.new
    failure = GithubClient::Error.new("Comparison temporarily unavailable")
    stub_request(:get, "#{comparison_url}#{failed_head}")
      .with(query: { "per_page" => "100", "page" => "2" })
      .to_return do
        Timeout.timeout(5) { successful_started.pop }
        raise failure
      end
    successful_request = stub_request(:get, "#{comparison_url}#{successful_head}")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return do
        successful_started << true
        Timeout.timeout(5) { failure_raised.pop }
        response
      end
    # Observe the error itself so the successful HTTP response cannot finish before it is raised.
    trace = TracePoint.new(:raise) do |event|
      failure_raised << true if event.raised_exception.equal?(failure)
    end
    request_thread = Thread.current
    cache_writers = []
    cache = ->(*) { cache_writers << Thread.current }

    trace.enable(target_thread: nil) do
      ActiveSupport::Notifications.subscribed(cache, "cache_write.active_support") do
        error = assert_raises(GithubClient::Error) do
          repository.prototype_candidates.available_page(user, permission: "write")
        end
        assert_same failure, error
      end
    end
    successful_request.to_return(response)
    remaining_request = stub_request(:get, "#{comparison_url}#{failed_head}")
      .with(query: { "per_page" => "100", "page" => "2" })
      .to_return(response.merge(body: JSON.generate(total_commits: 101, commits: [ { author: { id: user.github_id } } ])))
    WebMock.reset_executed_requests!

    branches, page_count = repository.prototype_candidates.available_page(user, permission: "write")

    assert_equal heads.keys.grep(/^prototype/).sort, branches.map(&:branch_name).sort
    assert_equal 1, page_count
    assert_requested incomplete_request, times: 1
    assert_requested remaining_request, times: 1
    assert_not_requested successful_request
    assert_equal [ request_thread ], cache_writers
  ensure
    trace&.disable
    successful_started << true if successful_started
    failure_raised << true if failure_raised
    Rails.cache = original_cache
  end

  test "skips queued comparisons after running calls fail and retries every uncached head" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    github_app_configurations.create_installed
    user = users.create
    repository = repositories.create
    base = "a" * 40
    heads = { "main" => base }
    6.times do |index|
      name = "prototype/branch-#{index}"
      heads[name] = format("%040x", index + 1)
      prototypes.create(repository:, branch_name: name)
    end
    stub_github_installation_token
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(heads.map { |name, sha| { name:, commit: { sha: } } }),
        headers: { "Content-Type" => "application/json" }
    response = {
      status: 200,
      body: JSON.generate(total_commits: 1, commits: [ { author: { id: user.github_id } } ]),
      headers: { "Content-Type" => "application/json" }
    }
    started = Queue.new
    release = Queue.new
    comparisons = heads.values.drop(1).map.with_index do |head, index|
      request = stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/compare/#{base}...#{head}")
        .with(query: { "per_page" => "100", "page" => "1" })
      if index < 4
        request.to_return do
          started << true
          Timeout.timeout(5) { release.pop }
          { status: 503, body: "{}" }
        end
      else
        request.to_return(response)
      end
      request
    end
    coordinator = Thread.new do
      Timeout.timeout(5) do
        4.times { started.pop }
        4.times { release << true }
      end
    ensure
      4.times { release << true }
    end

    error = assert_raises(GithubClient::Error) do
      repository.prototype_candidates.available_page(user, permission: "write")
    end
    coordinator.value

    assert_equal 503, error.status
    comparisons.drop(4).each { |request| assert_not_requested request }
    comparisons.each { |request| request.to_return(response) }
    WebMock.reset_executed_requests!

    branches, page_count = repository.prototype_candidates.available_page(user, permission: "write")

    assert_equal heads.keys.grep(/^prototype/).sort, branches.map(&:branch_name).sort
    assert_equal 1, page_count
    comparisons.each { |request| assert_requested request, times: 1 }
  ensure
    4.times { release << true } if release
    coordinator&.join
    Rails.cache = original_cache
  end
end
