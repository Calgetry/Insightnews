(function () {
  const GLOBAL_RUNTIME = window.__APP_CONFIG__ || {};
  const STORAGE_KEYS = {
    apiBase: 'admin_api_base_url',
    fixedToken: 'admin_fixed_token'
  };

  const DEFAULTS = {
    apiBase: '/api',
    fixedToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIyNTExMjcyMDFAcXEuY29tIn0.PIDSqm5FM7Y6llBMPbvYGLSLb2u5oL2mpQtpm-k8vik'
  };

  const readStoredValue = (key) => {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  };

  const runtimeSource = {
    apiBase: 'default',
    fixedToken: 'default'
  };

  let resolvedApiBase = typeof GLOBAL_RUNTIME.apiBaseUrl === 'string' && GLOBAL_RUNTIME.apiBaseUrl.trim()
    ? GLOBAL_RUNTIME.apiBaseUrl.trim()
    : '';

  if (resolvedApiBase) {
    runtimeSource.apiBase = 'global';
  } else {
    const storedBase = readStoredValue(STORAGE_KEYS.apiBase);
    if (storedBase) {
      resolvedApiBase = storedBase;
      runtimeSource.apiBase = 'localStorage';
    }
  }

  const API_BASE_URL = resolvedApiBase || DEFAULTS.apiBase;

  let resolvedFixedToken = typeof GLOBAL_RUNTIME.fixedToken === 'string' && GLOBAL_RUNTIME.fixedToken.trim()
    ? GLOBAL_RUNTIME.fixedToken.trim()
    : '';

  if (resolvedFixedToken) {
    runtimeSource.fixedToken = 'global';
  } else {
    const storedToken = readStoredValue(STORAGE_KEYS.fixedToken);
    if (storedToken) {
      resolvedFixedToken = storedToken;
      runtimeSource.fixedToken = 'localStorage';
    }
  }

  const FIXED_TOKEN = resolvedFixedToken || DEFAULTS.fixedToken;

  const persistValue = (key, value) => {
    try {
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    } catch (err) {}
  };

  const reloadIfNeeded = (reload) => {
    if (reload) {
      window.location.reload();
    }
  };

  window.AppRuntimeConfig = Object.freeze({
    setApiBaseUrl(url, { persist = true, reload = true } = {}) {
      if (typeof url !== 'string' || !url.trim()) {
        throw new Error('API Base URL must be a non-empty string.');
      }
      if (persist) persistValue(STORAGE_KEYS.apiBase, url.trim());
      reloadIfNeeded(reload);
      return url.trim();
    },
    clearApiBaseUrl({ reload = true } = {}) {
      persistValue(STORAGE_KEYS.apiBase, '');
      reloadIfNeeded(reload);
    },
    setFixedToken(token, { persist = true, reload = true } = {}) {
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('Fixed token must be a non-empty string.');
      }
      if (persist) persistValue(STORAGE_KEYS.fixedToken, token.trim());
      reloadIfNeeded(reload);
      return token.trim();
    },
    clearFixedToken({ reload = true } = {}) {
      persistValue(STORAGE_KEYS.fixedToken, '');
      reloadIfNeeded(reload);
    }
  });
  
  // 系统配置
  const SYSTEM_CONFIG = {
    appName: 'InsightNews 管理系统',
    version: '1.0.0',
    company: 'InsightNews Team',
    supportEmail: 'support@insightnews.com'
  };

  // API端点配置
  const ENDPOINTS = {
    users: {
      list: '/admin/users',
      create: '/admin/users',
      detail: (id) => `/admin/users/${encodeURIComponent(id)}`,
      update: (id) => `/admin/users/${encodeURIComponent(id)}`,
      delete: (id) => `/admin/users/${encodeURIComponent(id)}`,
      batchDelete: '/admin/users/batch-delete',
      export: '/admin/users/export'
    },

    // 数据分析
    analytics: {
      overview: '/admin/analytics/overview',
      userStats: '/admin/analytics/user-stats',
      activityLogs: '/admin/analytics/activity-logs',
      trends: '/admin/analytics/trends'
    },

    // 系统管理
    system: {
      config: '/admin/system/config',
      logs: '/admin/system/logs',
      backup: '/admin/system/backup'
    },

    // 真实用户服务接口（True API）
    userService: {
      register: '/user/register',
      login: '/user/login',
      info: '/user/info',
      update: '/user/update',
      logout: '/user/logout',
      feedback: '/user/feedback',
      favorites: '/user/favorite/topics',
      delete: '/user/delete'
    },

    // 公开话题/评论服务
    topicService: {
      list: '/topic',
      create: '/topic/add',
      detail: (topicId) => `/topic/${encodeURIComponent(topicId)}`,
      search: '/topic/search',
      hotSearch: '/topic/hot/search',
      searchHistory: '/topic/search/history',
      clearSearch: '/topic/delete/search',
      comments: (topicId) => `/topic/comment/page/${encodeURIComponent(topicId)}`,
      commentAdd: (topicId) => `/topic/comment/add/${encodeURIComponent(topicId)}`,
      commentReplies: (commentId) => `/topic/comment/replies/${encodeURIComponent(commentId)}`,
      commentToggleLike: (commentId) => `/topic/comment/toggle-like/${encodeURIComponent(commentId)}`,
      commentDelete: (commentId) => `/topic/delete/${encodeURIComponent(commentId)}`,
      favorite: (topicId) => `/topic/favorite/${encodeURIComponent(topicId)}`,
      delete: (topicId) => `/topic/delete/topic/${encodeURIComponent(topicId)}`
    },

    // 话题与举报（本地 mock 或真实后端）
    topics: {
      list: '/admin/topics',
      detail: (id) => `/admin/topics/${encodeURIComponent(id)}`
    },
    reports: {
      list: '/admin/reports',
      detail: (id) => `/admin/reports/${encodeURIComponent(id)}`
    }
  };


  const AUTH_CONFIG = {
    headerPrefix: '', // 默认为空字符串，后端期望直接收到 JWT 字符串
    preferFixedTokenForAdmin: true,
    adminPathKeywords: ['/admin/'],
    extraHeaderNames: ['token']
  };

  // 暴露全局配置
  window.AppConfig = Object.freeze({
    API_BASE_URL,
    FIXED_TOKEN,
    SYSTEM_CONFIG,
    ENDPOINTS,
    AUTH_CONFIG,
    
    // 分页配置
    PAGINATION: {
      defaultPageSize: 10,
      pageSizes: [10, 20, 50, 100]
    },
    
    // 主题配置
    THEME: {
      colors: {
        primary: '#6d5ef2',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6'
      }
    }
    ,
    // 特性开关：用于控制是否启用真实后端或实验性功能
    FEATURE_FLAGS: {
      // 请在部署时根据需要打开或关闭
      ENABLE_GEMINI_3_PRO: true,
      USE_REAL_BACKEND: true,
      ENABLE_BACKEND_PROBE: false
    },
    RUNTIME: {
      sources: runtimeSource,
      storageKeys: { ...STORAGE_KEYS },
    }
  });
})();