# Fresh install test harness — test container image
# Runs a nested dockerd so the plugin can start its agents-observe server
# container in full isolation from the host.

FROM docker:27-dind

# Runtime dependencies:
# - bash: entrypoint script (Alpine default is ash)
# - curl + jq: verification checks against the server API
# - nodejs + npm: for the Claude Code CLI and the plugin hook scripts
# - shadow: provides useradd/groupadd for creating non-root user
RUN apk add --no-cache bash curl jq nodejs npm shadow

# Install the Claude Code CLI globally. Pinned to whatever's latest at
# image build time — rebuilds pick up new versions.
RUN npm install -g @anthropic-ai/claude-code

# Create a non-root user for running claude (claude CLI refuses
# --permission-mode bypassPermissions as root).
# Add to docker group so the user can talk to the inner dockerd.
RUN groupadd -f docker && \
    useradd -m -s /bin/bash -G docker testuser

# Copy plugin source into a known location. The .dockerignore at the repo
# root excludes node_modules, build artifacts, and VCS state.
COPY . /plugin
RUN chown -R testuser:testuser /plugin

# Entrypoint script — orchestrates dockerd, image load, claude run,
# verification, and diagnostic dump.
COPY test/fresh-install/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
