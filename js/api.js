(function () {
  const { API_BASE_URL, ENDPOINTS, FIXED_TOKEN, AUTH_CONFIG } = window.AppConfig || {};
  const AUTH_HEADER_PREFIX = (AUTH_CONFIG && typeof AUTH_CONFIG.headerPrefix === 'string')
    ? AUTH_CONFIG.headerPrefix
    : '';

  class ApiClient {
    constructor() {
      this.baseURL = API_BASE_URL;
      this.timeout = 10000;
      this._backendAvailable = null; // null = unknown, true/false = known
      this._useMock = false; // when true, prefer mock handlers
      this.mockHandlers = []; // { pattern: RegExp, handler: Function }

      // read default preference from config feature flags
      try {
        const flags = (window.AppConfig && window.AppConfig.FEATURE_FLAGS) || {};
        if (flags.USE_REAL_BACKEND === false) this._useMock = true;
        this._featureFlags = flags;
      } catch (e) {}

      // probe backend availability only when explicitly enabled to avoid hitting an invalid root path
      if (this._featureFlags && this._featureFlags.ENABLE_BACKEND_PROBE) {
        this.probeBackend();
      }

    }

    async request(path, options = {}) {
      const url = path && typeof path === 'string' && path.startsWith('http') ? path : `${this.baseURL}${path}`;
      const { forceNetwork, timeout: reqTimeout, headers: extraHeaders, skipAuth, tokenStrategy, ...requestOptions } = options;
      const token = this.resolveAuthToken(path, tokenStrategy);

      const attachAuth = this.shouldAttachAuthHeader(path, skipAuth);

      // 安全地处理令牌，防止特殊字符导致语法错误
      let authHeaderValue = '';
      if (attachAuth && token) {
        const tokenStr = String(token).replace(/[\r\n\t\v\f]/g, '').trim();
        authHeaderValue = `${AUTH_HEADER_PREFIX}${tokenStr}`;
      }
        const defaultHeaders = {
          'Content-Type': 'application/json'
        };
        if (authHeaderValue) {
          defaultHeaders['Authorization'] = authHeaderValue;
          this.applyExtraAuthHeaders(defaultHeaders, authHeaderValue);
        }

      // merge headers but allow caller to override
      const headers = Object.assign({}, defaultHeaders, extraHeaders || {});

      const config = Object.assign({ method: 'GET' }, requestOptions);
      config.headers = headers;

      const tryMock = async (err) => {
        // find registered mock handler by path
        const handler = this.findMockHandler(path);
        if (handler) {
          try {
            const res = await handler(requestOptions.method || 'GET', path, requestOptions);
            return res;
          } catch (e) {
            // mock handler failed, fall through to throw original error
            throw err;
          }
        }
        // 没有找到 mock 处理器，抛出原始错误
        throw err;
      };

      try {
        // if configured to use mock only, skip network unless forceNetwork is enabled
        if (this._useMock && !forceNetwork) {
          return await tryMock(new Error('Using mock mode'));
        }

        const controller = new AbortController();
        const timeoutMs = typeof reqTimeout === 'number' ? reqTimeout : this.timeout;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        config.signal = controller.signal;

        // If body is FormData, let the browser set Content-Type (remove it)
        if (config.body instanceof FormData) {
          try { delete config.headers['Content-Type']; } catch (e) {}
        } else if (config.body && typeof config.body === 'object' && !(config.body instanceof ArrayBuffer)) {
          // only stringify plain objects
          try { config.body = JSON.stringify(config.body); } catch (e) {}
        }

        const response = await fetch(url, config);
        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorText = await response.text();
            if (errorText) {
              try {
                const parsed = JSON.parse(errorText);
                errorMessage = parsed.message || parsed.msg || parsed.error || errorMessage;
              } catch (err) {
                errorMessage = errorText;
              }
            }
          } catch (err) {}
          throw new Error(errorMessage);
        }

        let data = null;
        if (response.status !== 204) {
          const rawText = await response.text();
          if (rawText) {
            try {
              data = JSON.parse(rawText);
            } catch (err) {
              data = rawText;
            }
          }
        }

        // 统一响应格式处理
        if (data && typeof data === 'object') {
          const hasCode = data.code !== undefined;
          const envelopeCode = hasCode ? data.code : data.status;
          const successFlag = data.success;

          if (!this.isSuccessfulCode(envelopeCode)) {
            const message = data.message || data.msg || data.error || `请求失败（${envelopeCode}）`;
            const err = new Error(message);
            err.code = envelopeCode;
            throw err;
          }

          if (successFlag === false) {
            const message = data.message || data.msg || data.error || '请求失败';
            const err = new Error(message);
            err.code = envelopeCode;
            throw err;
          }

          return data.data !== undefined ? data.data : data;
        }

        return data;
      } catch (error) {
        // on network or other errors, attempt to fallback to mock if available
        if (error.name === 'AbortError') {
          // try mock fallback
          return await tryMock(new Error('请求超时'));
        }
        try {
          return await tryMock(error);
        } catch (e) {
          // if no mock or mock failed, propagate original error
          throw error;
        }
      }
    }

    // 注册 mock handler：pattern 可以是字符串前缀或正则；handler(method, path, options) => Promise<any>
    registerMock(pattern, handler) {
      let re;
      if (pattern instanceof RegExp) re = pattern;
      else re = new RegExp('^' + pattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
      this.mockHandlers.push({ pattern: re, handler });
    }

    findMockHandler(path) {
      if (!this.mockHandlers || !this.mockHandlers.length) return null;
      // 尝试多种路径形式进行匹配：原始 path、去除 baseURL 的 path、仅 pathname（当传入完整 URL 时）以及带/不带前导斜杠的变体
      const candidates = new Set();
      try {
        if (typeof path === 'string') {
          candidates.add(path);
          // 去掉 baseURL 前缀（若存在）
          if (this.baseURL && path.startsWith(this.baseURL)) {
            const stripped = path.slice(this.baseURL.length) || '/';
            candidates.add(stripped);
          }
          // 若 path 看起来像绝对 URL，则解析 pathname/search
          if (/^https?:\/\//i.test(path)) {
            try {
              const u = new URL(path);
              candidates.add(u.pathname + u.search);
              candidates.add(u.pathname);
            } catch (e) {}
          }
          // 带/不带前导斜杠的变体
          if (!path.startsWith('/')) candidates.add('/' + path);
          if (path.startsWith('/')) candidates.add(path.replace(/^\//, ''));
        }
      } catch (e) {}

      const arr = Array.from(candidates);
      for (let i = 0; i < this.mockHandlers.length; i++) {
        const m = this.mockHandlers[i];
        for (let j = 0; j < arr.length; j++) {
          try {
            if (m.pattern.test(arr[j])) return m.handler;
          } catch (e) {
            // 忽略单次匹配错误，继续尝试其它变体
          }
        }
      }
      return null;
    }

    async probeBackend() {
      // quick probe to determine backend availability
      if (!this.baseURL) {
        this._backendAvailable = false;
        this._useMock = true;
        return this._backendAvailable;
      }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        // 优先使用公共话题服务端点，若不存在再回退到 /admin/topics
        const endpoints = (window.AppConfig && window.AppConfig.ENDPOINTS) || {};
        let probePath = (endpoints.topicService && endpoints.topicService.list) || (endpoints.topics && endpoints.topics.list) || '/admin/topics';
        if (!probePath.startsWith('/')) probePath = '/' + probePath;
        // 有些 topicService 需要 category 查询参数，哪怕为空也要带上
        const needsCategory = probePath.includes('/topic') && !probePath.includes('?');
        const suffix = needsCategory ? '?category=' : '';
        const base = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL;
        const probeUrl = `${base}${probePath}${suffix}`;
        const res = await fetch(probeUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        this._backendAvailable = res && (res.ok || res.status === 404); // 404 也表示后端是可达的
        if (!this._backendAvailable) this._useMock = true;
      } catch (e) {
        this._backendAvailable = false;
        this._useMock = true;
      }
      return this._backendAvailable;
    }

    // GET请求
    async get(path, params = {}) {
      const queryString = Object.keys(params).length 
        ? `?${new URLSearchParams(params).toString()}`
        : '';
      return this.request(`${path}${queryString}`, { method: 'GET' });
    }

    // POST请求
    async post(path, data = {}, options = {}) {
      return this.request(path, Object.assign({ method: 'POST', body: data }, options));
    }

    // PUT请求
    async put(path, data = {}, options = {}) {
      return this.request(path, Object.assign({ method: 'PUT', body: data }, options));
    }

    // DELETE请求
    async delete(path, options = {}) {
      return this.request(path, Object.assign({ method: 'DELETE' }, options));
    }

    // 上传文件
    async upload(path, file, onProgress = null, options = {}) {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      const timeoutMs = typeof options.timeout === 'number' ? options.timeout : this.timeout;
      
      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (onProgress && e.lengthComputable) {
            onProgress(Math.round((e.loaded * 100) / e.total));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data);
            } catch (error) {
              resolve(xhr.responseText);
            }
          } else {
            reject(new Error(`上传失败: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('上传失败'));
        });

        xhr.ontimeout = () => {
          reject(new Error('请求超时'));
        };

        xhr.timeout = timeoutMs;

        xhr.open('POST', `${this.baseURL}${path}`);
        const tokenHeader = (() => {
          try {
            if (!this.shouldAttachAuthHeader(path, options && options.skipAuth)) return '';
            const t = this.resolveAuthToken(path, options && options.tokenStrategy);
            if (!t) return '';
            const safeToken = String(t).replace(/[\r\n\t\v\f]/g, '').trim();
            return `${AUTH_HEADER_PREFIX}${safeToken}`;
          } catch (e) { return ''; }
        })();
        if (tokenHeader) {
          xhr.setRequestHeader('Authorization', tokenHeader);
            this.applyExtraAuthHeaders(xhr, tokenHeader);
        }
        xhr.send(formData);
      });
    }

    getStoredAuthToken() {
      try {
        if (window.Utils && window.Utils.storage && typeof window.Utils.storage.getItem === 'function') {
          return window.Utils.storage.getItem('admin_token') || '';
        }
        // fallback to direct localStorage (still guarded)
        return localStorage && localStorage.getItem ? localStorage.getItem('admin_token') || '' : '';
      } catch (err) {
        try { window.__storageBlocked = true; } catch (e) {}
        return '';
      }
    }

    resolveAuthToken(path, strategy = null) {
      const stored = this.getStoredAuthToken();
      const wantsStored = strategy === 'stored';
      const wantsFixed = strategy === 'fixed' || (!strategy && this.shouldUseFixedToken(path));

      if (wantsFixed) {
        return FIXED_TOKEN || stored || '';
      }

      if (wantsStored) {
        return stored || '';
      }

      return stored || FIXED_TOKEN || '';
    }

    shouldUseFixedToken(path) {
      try {
        if (!AUTH_CONFIG || !AUTH_CONFIG.preferFixedTokenForAdmin) return false;
        const keywords = Array.isArray(AUTH_CONFIG.adminPathKeywords) && AUTH_CONFIG.adminPathKeywords.length
          ? AUTH_CONFIG.adminPathKeywords
          : ['/admin/'];
        const normalized = typeof path === 'string' ? path.toLowerCase() : '';
        if (!normalized) return false;
        return keywords.some((frag) => frag && normalized.includes(String(frag).toLowerCase()));
      } catch (e) {
        return false;
      }
    }

    isSuccessfulCode(rawCode) {
      if (rawCode === undefined || rawCode === null) return true;
      if (typeof rawCode === 'boolean') return rawCode;
      if (typeof rawCode === 'number') {
        return rawCode === 200 || rawCode === 0;
      }
      if (typeof rawCode === 'string') {
        const trimmed = rawCode.trim();
        if (!trimmed) return true;
        const upper = trimmed.toUpperCase();
        if (upper === 'SUCCESS' || upper === 'OK') return true;
        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric)) {
          return numeric === 200 || numeric === 0;
        }
        return false;
      }
      return false;
    }

    shouldAttachAuthHeader(path, skipAuth) {
      if (skipAuth) return false;
      if (!path) return true;
      const normalized = typeof path === 'string' ? path.toLowerCase() : '';
      const authFree = ['/user/login', '/user/register'];
      return !authFree.some((frag) => normalized.includes(frag));
    }

    applyExtraAuthHeaders(target, value) {
      try {
        const list = AUTH_CONFIG && Array.isArray(AUTH_CONFIG.extraHeaderNames)
          ? AUTH_CONFIG.extraHeaderNames
          : [];
        list.forEach((name) => {
          if (!name || typeof name !== 'string') return;
          if (typeof target.set === 'function') {
            target.set(name, value);
          } else {
            target[name] = value;
          }
        });
      } catch (e) {}
    }
  }

  // 创建全局API客户端实例
  window.api = new ApiClient();
})();