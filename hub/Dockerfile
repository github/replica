# syntax=docker/dockerfile:1
# check=error=true

# This Dockerfile is designed for production, not development. Use with Kamal or build'n'run by hand:
# docker build --build-context learning=../packages/learning -t replica_hub .
# docker run -d -p 80:80 -e RAILS_MASTER_KEY=<value from config/master.key> --name replica_hub replica_hub

# For a containerized dev environment, see Dev Containers: https://guides.rubyonrails.org/getting_started_with_devcontainer.html

# Keep RUBY_VERSION, .ruby-version, and the matching image index digest in sync.
ARG RUBY_VERSION=4.0.5
FROM docker.io/library/ruby:$RUBY_VERSION-slim@sha256:42ad5227a4b2758f32563b34b5967e1055e75c80243eef04e6d2572887d1dec4 AS base

ARG BUNDLER_VERSION=4.0.13

# Rails app lives here
WORKDIR /rails

# Install base packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 sqlite3 && \
    gem install bundler --version ${BUNDLER_VERSION} --no-document && \
    ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Set production environment variables and enable jemalloc for reduced memory usage and latency.
ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development:test" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so"

FROM docker.io/library/node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS node

# Throw-away build stage to reduce size of final image
FROM base AS build
WORKDIR /rails/hub

# Install packages needed to build gems
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Install application gems
COPY vendor/* ./vendor/
COPY Gemfile Gemfile.lock ./

RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    # -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
    bundle exec bootsnap precompile -j 1 --gemfile

# Copy application code
COPY . .

# replica-learning asks Copilot to suggest learnings. Hub runs it with Node.js at runtime.
COPY --from=learning package.json package-lock.json /opt/replica/learning/
COPY --from=learning bin /opt/replica/learning/bin/
COPY --from=learning src /opt/replica/learning/src/

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    npm ci && \
    npm ci --prefix /opt/replica/learning --omit=dev --ignore-scripts

# Precompile bootsnap code for faster boot times.
# -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
RUN bundle exec bootsnap precompile -j 1 app/ lib/

# Precompiling assets for production without requiring secret RAILS_MASTER_KEY
RUN SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile && \
    rm -f tmp/local_secret.txt && \
    rm -rf node_modules

# Final stage for app image
FROM base

ARG REPLICA_BUILD_ACTION
ARG REPLICA_IMAGE_REVISION
ARG REPLICA_IMAGE_VERSION

ENV REPLICA_BUILD_ACTION="${REPLICA_BUILD_ACTION}"

LABEL org.opencontainers.image.source="https://github.com/github/replica" \
      org.opencontainers.image.title="Replica Hub" \
      org.opencontainers.image.description="Self-hosted review and collaboration for interactive prototypes" \
      org.opencontainers.image.revision="${REPLICA_IMAGE_REVISION}" \
      org.opencontainers.image.version="${REPLICA_IMAGE_VERSION}"

# Node.js and replica-learning stay owned by root, so the app cannot change the code it runs.
COPY --from=build /opt/replica/learning /opt/replica/learning
ENV REPLICA_LEARNING_CLI="/opt/replica/learning/bin/replica-learning.mjs"

# Run and own only the runtime files as a non-root user for security
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
USER 1000:1000

# Copy built artifacts: gems, application
COPY --chown=rails:rails --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --chown=rails:rails --from=build /rails/hub /rails
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Entrypoint prepares the database.
ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# Start server via Thruster by default, this can be overwritten at runtime
EXPOSE 80
CMD ["./bin/thrust", "./bin/rails", "server"]
