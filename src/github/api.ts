import { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface GitHubPRData {
  number: number;
  title: string;
  body: string | null;
  state: string;
  head: {
    sha: string;
  };
  user: {
    login: string;
  };
  created_at: string;
  updated_at: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: {
    login: string;
  } | null;
}

export interface GitHubFile {
  filename: string;
  status: string; // 'added', 'removed', 'modified', 'renamed'
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubReview {
  id: number;
  user: {
    login: string;
  };
  state: string; // 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'
  body: string | null;
  submitted_at: string;
}

export interface GitHubComment {
  id: number;
  user: {
    login: string;
  };
  body: string;
  created_at: string;
}

export async function getPRData(
  api: AxiosInstance,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubPRData> {
  try {
    const response = await api.get(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch PR data', error);
    throw error;
  }
}

export async function getPRCommits(
  api: AxiosInstance,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubCommit[]> {
  try {
    const commits: GitHubCommit[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && commits.length < 250) {
      // GitHub API max 250 commits per PR
      const response = await api.get(`/repos/${owner}/${repo}/pulls/${prNumber}/commits`, {
        params: { page, per_page: 100 },
      });

      commits.push(...response.data);
      hasMore = response.data.length === 100;
      page++;
    }

    logger.debug('Fetched PR commits', { prNumber, count: commits.length });
    return commits;
  } catch (error) {
    logger.error('Failed to fetch PR commits', error);
    throw error;
  }
}

export async function getPRFiles(
  api: AxiosInstance,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubFile[]> {
  try {
    const files: GitHubFile[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && files.length < 3000) {
      // GitHub API max 3000 files per PR
      const response = await api.get(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
        params: { page, per_page: 100 },
      });

      files.push(...response.data);
      hasMore = response.data.length === 100;
      page++;
    }

    logger.debug('Fetched PR files', { prNumber, count: files.length });
    return files;
  } catch (error) {
    logger.error('Failed to fetch PR files', error);
    throw error;
  }
}

export async function getPRReviews(
  api: AxiosInstance,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubReview[]> {
  try {
    const reviews: GitHubReview[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await api.get(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
        params: { page, per_page: 100 },
      });

      reviews.push(...response.data);
      hasMore = response.data.length === 100;
      page++;
    }

    logger.debug('Fetched PR reviews', { prNumber, count: reviews.length });
    return reviews;
  } catch (error) {
    logger.error('Failed to fetch PR reviews', error);
    throw error;
  }
}

export async function getPRComments(
  api: AxiosInstance,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubComment[]> {
  try {
    const comments: GitHubComment[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await api.get(
        `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
        {
          params: { page, per_page: 100 },
        }
      );

      comments.push(...response.data);
      hasMore = response.data.length === 100;
      page++;
    }

    logger.debug('Fetched PR comments', { prNumber, count: comments.length });
    return comments;
  } catch (error) {
    logger.error('Failed to fetch PR comments', error);
    throw error;
  }
}

export async function createCheckRun(
  api: AxiosInstance,
  owner: string,
  repo: string,
  headSha: string,
  checkRunData: {
    name: string;
    status: string;
    conclusion?: string;
    output?: {
      title: string;
      summary: string;
      text?: string;
    };
    external_id?: string;
  }
): Promise<{ id: number }> {
  try {
    const response = await api.post(`/repos/${owner}/${repo}/check-runs`, {
      head_sha: headSha,
      ...checkRunData,
    });

    logger.debug('Created check run', {
      owner,
      repo,
      checkRunId: response.data.id,
    });

    return { id: response.data.id };
  } catch (error) {
    logger.error('Failed to create check run', error);
    throw error;
  }
}

export async function updateCheckRun(
  api: AxiosInstance,
  owner: string,
  repo: string,
  checkRunId: number,
  checkRunData: {
    status?: string;
    conclusion?: string;
    output?: {
      title: string;
      summary: string;
      text?: string;
    };
  }
): Promise<void> {
  try {
    await api.patch(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, checkRunData);

    logger.debug('Updated check run', {
      owner,
      repo,
      checkRunId,
    });
  } catch (error) {
    logger.error('Failed to update check run', error);
    throw error;
  }
}
