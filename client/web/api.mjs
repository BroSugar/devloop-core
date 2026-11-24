// 服务端 API 的薄客户端。所有业务状态都来自这里，客户端不做推导。

export function createApiClient({ baseUrl = '', token }) {
  async function request(method, path, { body, ifMatch } = {}) {
    const headers = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (ifMatch) headers['if-match'] = ifMatch;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.headers.get('content-type')?.includes('application/json')) {
      const payload = await res.json();
      if (!res.ok) {
        const err = new Error(payload?.error?.message || `HTTP ${res.status}`);
        err.code = payload?.error?.code;
        err.details = payload?.error?.details;
        err.status = res.status;
        throw err;
      }
      return { data: payload.data, etag: res.headers.get('etag'), meta: payload.meta };
    }
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return { data: text, etag: res.headers.get('x-evidence-sha256') };
  }

  const get = (p) => request('GET', p);
  const post = (p, body) => request('POST', p, { body });
  const put = (p, body, ifMatch) => request('PUT', p, { body, ifMatch });

  return {
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
    events: (projectId, since = 0) => get(`/api/v1/events?projectId=${encodeURIComponent(projectId)}&since=${since}`),
  };
}
