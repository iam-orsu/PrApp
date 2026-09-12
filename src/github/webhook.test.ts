import { isRelevantEvent, getEventType } from './webhook';

describe('Webhook Event Filtering', () => {
  const mockRepository = { id: 456, name: 'repo', full_name: 'owner/repo', owner: { login: 'owner', type: 'User' } };

  it('should accept pull_request opened events', () => {
    const event = {
      action: 'opened',
      pull_request: { id: 1, number: 1, title: 'Test', head: { sha: 'abc' }, state: 'open' },
      installation: { id: 123 },
      repository: mockRepository,
    };

    expect(isRelevantEvent(event)).toBe(true);
  });

  it('should accept pull_request synchronize events', () => {
    const event = {
      action: 'synchronize',
      pull_request: { id: 1, number: 1, title: 'Test', head: { sha: 'abc' }, state: 'open' },
      installation: { id: 123 },
      repository: mockRepository,
    };

    expect(isRelevantEvent(event)).toBe(true);
  });

  it('should reject pull_request assigned events', () => {
    const event = {
      action: 'assigned',
      pull_request: { id: 1, number: 1, title: 'Test', head: { sha: 'abc' }, state: 'open' },
      installation: { id: 123 },
      repository: mockRepository,
    };

    expect(isRelevantEvent(event)).toBe(false);
  });

  it('should reject events without installation', () => {
    const event = {
      action: 'opened',
      pull_request: { id: 1, number: 1, title: 'Test', head: { sha: 'abc' }, state: 'open' },
      repository: mockRepository,
    };

    expect(isRelevantEvent(event)).toBe(false);
  });

  it('should correctly identify event type', () => {
    const prEvent = {
      pull_request: { id: 1, number: 1, title: 'Test', head: { sha: 'abc' }, state: 'open' },
      repository: mockRepository,
    };

    expect(getEventType(prEvent)).toBe('pull_request');
  });
});
