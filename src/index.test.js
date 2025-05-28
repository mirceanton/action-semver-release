const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');
const { run } = require('./index');

// Mock the @actions/core module
jest.mock('@actions/core');

// Mock the @actions/github module
jest.mock('@actions/github', () => {
  const mockOctokit = {
    rest: {
      repos: {
        getLatestRelease: jest.fn(),
        listCommits: jest.fn()
      }
    }
  };

  return {
    getOctokit: jest.fn(() => mockOctokit),
    context: {
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    }
  };
});

describe('Semantic Release Helper Action', () => {
  // Get the mocked modules/functions for easy access in tests
  const mockGetInput = core.getInput;
  const mockSetOutput = core.setOutput;
  const mockSetFailed = core.setFailed;
  const mockInfo = core.info;
  const mockWarn = core.warn;
  const mockDebug = core.debug;

  const mockOctokit = github.getOctokit();
  const mockGetLatestRelease = mockOctokit.rest.repos.getLatestRelease;
  const mockListCommits = mockOctokit.rest.repos.listCommits;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Setup default mock responses
    mockGetInput.mockImplementation((name, options) => {
      if (name === 'github-token') return 'mock-token';
      if (name === 'default-version') return '0.0.0';
      return '';
    });
  });

  test('No previous release should use default version', async () => {
    // Setup mocks
    const notFoundError = new Error('No release found');
    notFoundError.status = 404;
    mockGetLatestRelease.mockRejectedValue(notFoundError);
    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: some bug fix' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '0.0.1');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('No previous releases'));
  });

  test('Patch commits should increment patch version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v1.2.3',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: bug fix 1' }
        },
        {
          sha: 'def456',
          commit: { message: 'fix(core): bug fix 2' }
        },
        {
          sha: 'ghi789',
          commit: { message: 'chore: update docs' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '1.2.4');
  });

  test('Feature commits should increment minor version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v2.0.0',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: bug fix' }
        },
        {
          sha: 'def456',
          commit: { message: 'feat: new feature' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '2.1.0');
  });

  test('Breaking change in body should increment major version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v1.2.3',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: bug fix' }
        },
        {
          sha: 'def456',
          commit: { message: 'feat: new feature\n\nBREAKING CHANGE: This breaks the API' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '2.0.0');
  });

  test('Breaking change with ! syntax should increment major version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v0.9.5',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: bug fix' }
        },
        {
          sha: 'def456',
          commit: { message: 'feat!: breaking feature' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '1.0.0');
  });

  test('Breaking change with scoped ! syntax should increment major version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v3.2.1',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix(api): bug fix' }
        },
        {
          sha: 'def456',
          commit: { message: 'feat(core)!: breaking feature with scope' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '4.0.0');
  });

  test('Priority: breaking > feature > fix', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v1.0.0',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'fix: bug fix' }
        },
        {
          sha: 'def456',
          commit: { message: 'feat: new feature' }
        },
        {
          sha: 'ghi789',
          commit: { message: 'fix!: breaking fix' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output - should be major version bump due to breaking change
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '2.0.0');
  });

  test('No relevant commits should not change version', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v1.2.3',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: { message: 'chore: update dependencies' }
        },
        {
          sha: 'def456',
          commit: { message: 'docs: update readme' }
        }
      ]
    });

    // Run the action
    await run();

    // Verify output - version should not change
    expect(mockSetOutput).toHaveBeenCalledWith('next-version', '1.2.3');
  });

  test('Commit List API error should fail the action', async () => {
    // Setup mocks
    mockGetLatestRelease.mockResolvedValue({
      data: {
        tag_name: 'v1.0.0',
        created_at: '2023-01-01T00:00:00Z'
      }
    });

    mockListCommits.mockRejectedValue(new Error('API error'));

    // Run the action
    await run();

    // Verify error handling
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('API error'));
  });
  test('Release List API error should fail the action', async () => {
    // Setup mocks
    mockGetLatestRelease.mockRejectedValue(new Error('API error'));
    mockListCommits.mockRejectedValue(new Error('API error'));

    // Run the action
    await run();

    // Verify error handling
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('API error'));
  });
});
