import path from 'node:path';

function unwrapData(value, label) {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'data')) {
    throw new Error('OpenCode V2 returned an invalid ' + label + ' response: missing data envelope');
  }
  return value.data;
}

function normalizeModel(model) {
  if (model === undefined || model === null) return undefined;
  if (!model || typeof model !== 'object') throw new Error('OpenCode model must be an object');
  const providerID = model.providerID;
  const id = model.id || model.modelID;
  if (typeof providerID !== 'string' || !providerID || typeof id !== 'string' || !id) {
    throw new Error('OpenCode V2 model must contain providerID and id/modelID');
  }
  return { providerID, id };
}

function promptText(input) {
  if (typeof input === 'string' && input.trim()) return input;
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('OpenCode prompt must contain text');
  }
  const text = input
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('OpenCode prompt must contain at least one text part');
  return text;
}

export class OpenCodeClient {
  constructor({
    baseUrl = 'http://127.0.0.1:4096',
    username = 'opencode',
    password = '',
    directory,
    timeoutMs = 30000,
    fetchImpl = globalThis.fetch
  } = {}) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('OpenCode baseUrl must be a clean HTTP or HTTPS URL');
    }
    if (typeof username !== 'string' || !username.trim()) throw new Error('OpenCode username is required');
    if (directory !== undefined && (typeof directory !== 'string' || !path.isAbsolute(directory))) {
      throw new Error('OpenCode directory must be an absolute path');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.directory = directory === undefined ? undefined : path.resolve(directory);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(route, options = {}) {
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) {
      throw new Error('OpenCode route must be an absolute path on the configured server');
    }
    const headers = {
      accept: 'application/json',
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(this.password
        ? { authorization: 'Basic ' + Buffer.from(this.username + ':' + this.password).toString('base64') }
        : {})
    };
    const { signal: externalSignal, timeoutMs = this.timeoutMs, ...requestOptions } = options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    if (externalSignal && externalSignal.aborted) controller.abort();
    else externalSignal && externalSignal.addEventListener('abort', abort, { once: true });

    try {
      const response = await this.fetchImpl(this.baseUrl + route, {
        ...requestOptions,
        signal: controller.signal,
        headers: { ...headers, ...requestOptions.headers }
      });
      const body = await response.text();
      if (!response.ok) {
        const suffix = response.status === 404
          ? ' (the server may not expose the OpenCode V2 API required by this benchmark)'
          : '';
        throw new Error('OpenCode HTTP ' + response.status + suffix + ': ' + body.slice(0, 2000));
      }
      if (response.status === 204 || !body.trim()) return null;
      try {
        return JSON.parse(body);
      } catch (error) {
        throw new Error('OpenCode returned invalid JSON (' + response.status + '): ' + error.message);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error(
          externalSignal && externalSignal.aborted
            ? 'OpenCode request cancelled'
            : 'OpenCode request timed out after ' + timeoutMs + 'ms'
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', abort);
    }
  }

  async health() {
    const info = await this.request('/api/info');
    if (!info || typeof info.version !== 'string' || !info.version.trim()) {
      throw new Error('OpenCode V2 compatibility check failed: /api/info did not return a server version');
    }
    return { ...info, healthy: true };
  }

  async listSessions() {
    return unwrapData(await this.request('/api/session'), 'session list');
  }

  async createSession(title, { signal, agent, model } = {}) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('Session title is required');
    const payload = {
      title: title.trim(),
      ...(this.directory ? { location: { directory: this.directory } } : {}),
      ...(agent ? { agent } : {}),
      ...(model ? { model: normalizeModel(model) } : {})
    };
    return unwrapData(
      await this.request('/api/session', { method: 'POST', body: JSON.stringify(payload), signal }),
      'session create'
    );
  }

  async getSession(sessionId, options = {}) {
    return unwrapData(
      await this.request('/api/session/' + encodeURIComponent(sessionId), options),
      'session get'
    );
  }

  async deleteSession(sessionId, { signal, timeoutMs } = {}) {
    return this.request('/api/session/' + encodeURIComponent(sessionId), {
      method: 'DELETE',
      signal,
      timeoutMs
    });
  }

  async getSessionMessages(sessionId, { signal } = {}) {
    const route = '/api/session/' + encodeURIComponent(sessionId) + '/message?order=desc&limit=200';
    const messages = unwrapData(await this.request(route, { signal }), 'session messages');
    if (!Array.isArray(messages)) throw new Error('OpenCode V2 returned an invalid session messages list');
    return messages;
  }

  async abortSession(sessionId, { signal, timeoutMs } = {}) {
    return this.request('/api/session/' + encodeURIComponent(sessionId) + '/interrupt', {
      method: 'POST',
      signal,
      timeoutMs
    });
  }

  async waitSession(sessionId, { signal, timeoutMs } = {}) {
    return this.request('/api/experimental/session/' + encodeURIComponent(sessionId) + '/wait', {
      method: 'POST',
      signal,
      timeoutMs
    });
  }

  async getSessionDiff(sessionId, { signal, timeoutMs } = {}) {
    const diff = unwrapData(
      await this.request('/api/session/' + encodeURIComponent(sessionId) + '/diff', { signal, timeoutMs }),
      'session diff'
    );
    if (!Array.isArray(diff)) throw new Error('OpenCode V2 returned an invalid session diff');
    return diff;
  }

  async prompt(sessionId, input, { signal, timeoutMs } = {}) {
    const body = { text: promptText(input) };
    return unwrapData(
      await this.request('/api/session/' + encodeURIComponent(sessionId) + '/prompt', {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
        timeoutMs
      }),
      'session prompt'
    );
  }
}
