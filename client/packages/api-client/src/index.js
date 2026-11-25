const TOKEN_KEY = 'devloop.token';
export const DEFAULT_TOKEN = 'dev-local-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN;
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

async function request(method, path, { body, ifMatch } = {}) {
  const headers = { authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ifMatch) headers['if-match'] = ifMatch;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.headers.get('content-type')?.includes('application/json')) {
    const payload = await res.json();
    if (!res.ok) {
      const err = new Error(payload?.error?.message || `HTTP ${res.status}`);
      err.code = payload?.error?.code;
      err.details = payload?.error?.details;
      throw err;
    }
    return { data: payload.data, etag: res.headers.get('etag') };
  }
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return { data: text, etag: res.headers.get('x-evidence-sha256') };
}

const get = (p) => request('GET', p);
const post = (p, body) => request('POST', p, { body });
const put = (p, body, etag) => request('PUT', p, { body, ifMatch: etag });

export const api = {
  health: () => get('/api/v1/health'),
  projects: () => get('/api/v1/projects'),
  project: (id) => get(`/api/v1/projects/${id}`),
  projectConfig: (id) => get(`/api/v1/projects/${id}/config`),
  panel: (id) => get(`/api/v1/projects/${id}/panel`),
  requirements: (id) => get(`/api/v1/projects/${id}/requirements`),
  requirement: (id) => get(`/api/v1/requirements/${id}`),
  updateRequirement: (id, body, etag) => put(`/api/v1/requirements/${id}`, body, etag),
  dag: (id) => get(`/api/v1/requirements/${id}/dag`),
  task: (id) => get(`/api/v1/tasks/${id}`),
  updateTask: (id, body, etag) => put(`/api/v1/tasks/${id}`, body, etag),
  runs: (taskId) => get(`/api/v1/tasks/${taskId}/runs`),
  startRun: (taskId, body) => post(`/api/v1/tasks/${taskId}/runs`, body || {}),
  run: (id) => get(`/api/v1/runs/${id}`),
  evidence: (runId) => get(`/api/v1/runs/${runId}/evidence`),
  evidenceContent: (evidenceId) => get(`/api/v1/evidence/${evidenceId}/content`),
  agentConfig: (projectId) => get(`/api/v1/agent-config?projectId=${encodeURIComponent(projectId)}`),
  cardSync: (projectId) => get(`/api/v1/projects/${projectId}/card-sync`),
  exportCards: (projectId, body) => post(`/api/v1/projects/${projectId}/card-sync/export`, body || {}),
  importCards: (projectId, body) => post(`/api/v1/projects/${projectId}/card-sync/import`, body || {}),
  events: (projectId, since = 0) => get(`/api/v1/events?projectId=${encodeURIComponent(projectId)}&since=${since}`),
  prds: (projectId) => get(`/api/v1/prds?projectId=${encodeURIComponent(projectId)}`),
  createPrd: (body) => post('/api/v1/prds', body),
  getPrd: (id) => get(`/api/v1/prds/${id}`),
  updatePrd: (id, body, etag) => put(`/api/v1/prds/${id}`, body, etag),
  refinePrd: (id) => post(`/api/v1/prds/${id}/refine`),
  reviewPrd: (id) => post(`/api/v1/prds/${id}/review`),
  listPrdReviews: (id) => get(`/api/v1/prds/${id}/reviews`),
};
