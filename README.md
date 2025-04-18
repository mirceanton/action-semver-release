# Semantic Release Action

A lightweight GitHub Action that creates new releases based on semantic versioning principles. This action uses [SVU](https://github.com/caarlos0/svu) to determine the next version number based on your git history and [conventional commits](#conventional-commits).

## Features

- Automatically determines the next version based on commit history
- Creates GitHub releases with minimal configuration
- Supports different versioning strategies (major, minor, patch, or automatic)
- Generates (basic) release notes from commit history

## Requirements

- Your repository must be checked out with `fetch-depth: 0` for SVU to analyze commit history
- The workflow must have `contents: write` permission
- For private repositories, ensure the token has appropriate permissions
- You should be following [conventional commits](#conventional-commits) rules when writing commit messages

## Example Usage

```yaml
---
name: Release

on:
  # Manually trigger a new release from the Actions tab
  workflow_dispatch:
    inputs:
      version_increment:
        description: 'Version increment type'
        required: false
        default: 'auto'
        type: choice
        options: [ "auto", "major", "minor", "patch", "prerelease" ]
      dry_run:
        description: 'Dry run mode (no actual release)'
        required: false
        default: false
        type: boolean

  # Dry run on any PR to the main branch to make sure the workflow would run
  # successfully before merging
  pull_request:
    branches: ["main"]

  # Automatically create releases on every push to the main branch
  push:
    branches: ["main"]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout code
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0  # !important for SVU to determine the next version number

      - name: Create semantic release
        uses: mirceanton/action-semver-release@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          version-increment: 'auto' # ?can be omittied, 'auto' is default
          dry-run: ${{ inputs.dry-run || github.event_name == 'pull_request' }}

```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `dry-run` | Perform a dry run without creating an actual release | No | `false` |
| `github-token` | GitHub token with repository access | Yes | N/A |
| `version-increment` | Version increment strategy (major, minor, patch, prerelease or auto) | No | `auto` |

## Outputs

| Output | Description |
|--------|-------------|
| `old_version` | The old version, **before** the release |
| `next_version` | The next version determined for the release |
| `commit_count` | Number of commits included in this release |
| `breaking_count` | Number of breaking change commits |
| `feature_count` | Number of feature commits |
| `fix_count` | Number of fix commits |
| `release_url` | URL of the created GitHub release (empty in dry-run mode) |

## How It Works

1. The action installs SVU to analyze your commit history
2. Based on the versioning strategy specified, it determines the next appropriate version number
3. It generates release notes from the git commit history since the previous tag
4. If not in dry-run mode, it creates a GitHub release with the determined version and release notes

## Conventional Commits

For best results, use [Conventional Commits](https://www.conventionalcommits.org/) in your repository. This allows SVU to automatically determine the appropriate version bump based on your commit messages.

One more suggestion in this regard is to use a tool that helps ensure commits are titled properly, such as:

- [commitlint](https://commitlint.js.org/) in CI to validate PR titles that are then squashed into the main branch
- [commitizen](https://commitizen-tools.github.io/commitizen/) locally to enforce commit message structure

An example of such a `commitlint` workflow can be found [here](./.github/workflows/lint.yaml)

Examples of proper commit messages:

- `feat: add new login page` -> Will trigger a minor version bump
- `fix: resolve authentication issue` -> Will trigger a patch version bump
- `feat!: completely redesign API` -> Will trigger a major version bump
- `feat: new API (BREAKING CHANGE)` -> Will trigger a major version bump

## License

[MIT](./LICENSE)
