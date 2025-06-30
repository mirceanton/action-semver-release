# Semantic Release Action

Automatically determine the next semantic version and generate release notes based on
[Conventional Commits](https://www.conventionalcommits.org/).

## Features

- 🔍 **Analyzes commits** since the last GitHub release
- 📊 **Determines next version** using semantic versioning rules
- 📝 **Generates release notes** categorized by commit type
- 🎯 **Conventional Commits** support with breaking change detection
- 📋 **Job Summary** with visual version comparison table
- ⚡ **Zero configuration** - works out of the box

## Example Usage

```yaml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0

      - name: Generate Release Metadata
        id: release-metadata
        uses: mirceanton/action-semver-release@v2
        with:
          github-token: ${{ github.token }}
```

## Inputs

| Input             | Description                             | Required | Default               |
| ----------------- | --------------------------------------- | -------- | --------------------- |
| `github-token`    | GitHub token for API access             | Yes      | `${{ github.token }}` |
| `default-version` | Default version when no releases exist  | No       | `0.0.0`               |
| `dry-run`         | Run in dry-run mode (no actual release) | No       | `false`               |
| `draft`           | Mark the release as a draft             | No       | `false`               |
| `prerelease`      | Mark the release as a pre-release       | No       | `false`               |

## Outputs

| Output           | Description                             | Example                                                                                 |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `next-version`   | The next semantic version               | `1.2.0`                                                                                 |
| `should-release` | Whether a new release should be created | `true`                                                                                  |
| `release-notes`  | Generated release notes in markdown     | See [example](https://github.com/mirceanton/action-semver-metadata/releases/tag/v1.0.0) |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
