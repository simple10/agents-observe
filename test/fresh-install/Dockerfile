# Fresh install test harness — test container image
# Runs a nested dockerd so the plugin can start its agents-observe server
# container in full isolation from the host.

FROM docker:27-dind

# Runtime dependencies:
# - bash: entrypoint script (Alpine default is ash)
# - curl + jq: verification checks against the server API
# - nodejs + npm: for the Claude Code CLI and the plugin hook scripts
RUN apk add --no-cache bash curl jq nodejs npm

# Install the Claude Code CLI globally. Pinned to whatever's latest at
# image build time — rebuilds pick up new versions.
RUN npm install -g @anthropic-ai/claude-code

# Copy plugin source into a known location. The .dockerignore at the repo
# root excludes node_modules, build artifacts, and VCS state.
COPY . /plugin

# Entrypoint script — orchestrates dockerd, image load, claude run,
# verification, and diagnostic dump.
COPY test/fresh-install/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
