(function () {
  const AUTH_KEY = 'admin_auth';
  const TOKEN_KEY = 'admin_token';
  const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24小时
  const FEATURE_FLAGS = (window.AppConfig && window.AppConfig.FEATURE_FLAGS) || {};
  const TRUE_API_ENDPOINTS = (window.AppConfig && window.AppConfig.ENDPOINTS && window.AppConfig.ENDPOINTS.userService) || {};
  const DEFAULT_PERMISSIONS = ['users:read', 'users:write', 'users:delete', 'analytics:read', 'system:config'];
  const SOURCE_TRUE_API = 'true-api';
  const SOURCE_MOCK = 'mock';

  // 管理员账号配置（本地兜底）
  const ADMIN_ACCOUNTS = {
    'admin': {
      password: '123456',
      name: '系统管理员',
      role: 'super_admin',
      permissions: DEFAULT_PERMISSIONS
    }
  };

  const canUseTrueApi = () => FEATURE_FLAGS.USE_REAL_BACKEND !== false && !!(window.api && TRUE_API_ENDPOINTS && TRUE_API_ENDPOINTS.login);

  const ensureEndpoint = (key) => {
    const value = TRUE_API_ENDPOINTS[key];
    if (!value) {
      throw new Error(`尚未配置 ${key} 接口`);
    }
    return value;
  };

  const TrueUserAPI = {
    canUse: () => canUseTrueApi(),
    async register(payload) {
      ensureEndpoint('register');
      return window.api.post(TRUE_API_ENDPOINTS.register, payload, { skipAuth: true, forceNetwork: true });
    },
    async login(payload) {
      ensureEndpoint('login');
      return window.api.request(TRUE_API_ENDPOINTS.login, {
        method: 'POST',
        body: payload,
        forceNetwork: true,
        skipAuth: true
      });
    },
    async info() {
      if (!TRUE_API_ENDPOINTS.info) return null;
      return window.api.get(TRUE_API_ENDPOINTS.info);
    },
    async update(payload) {
      if (!TRUE_API_ENDPOINTS.update) return null;
      return window.api.put(TRUE_API_ENDPOINTS.update, payload);
    },
    async logout() {
      if (!TRUE_API_ENDPOINTS.logout) return null;
      return window.api.post(TRUE_API_ENDPOINTS.logout);
    },
    async feedback(message) {
      if (!TRUE_API_ENDPOINTS.feedback) return null;
      const suffix = message ? `?feedback=${encodeURIComponent(message)}` : '';
      return window.api.post(`${TRUE_API_ENDPOINTS.feedback}${suffix}`);
    },
    async favorites() {
      if (!TRUE_API_ENDPOINTS.favorites) return null;
      return window.api.get(TRUE_API_ENDPOINTS.favorites);
    },
    async deleteAccount() {
      if (!TRUE_API_ENDPOINTS.delete) return null;
      return window.api.delete(TRUE_API_ENDPOINTS.delete);
    }
  };

  // 暴露真实接口调用器，方便其他模块直接复用
  window.TrueUserAPI = TrueUserAPI;

  class AuthManager {
    constructor() {
      this.currentUser = null;
      this.restoreSession();
    }

    canUseTrueApi() {
      return canUseTrueApi();
    }

    shouldUseMock(username) {
      return !!ADMIN_ACCOUNTS[username];
    }

    async login(username, password) {
      const account = (username || '').trim();
      const secret = (password || '').trim();

      if (this.shouldUseMock(account)) {
        return this.loginViaMock(account, secret);
      }

      if (!this.canUseTrueApi()) {
        throw new Error('真实接口暂不可用，请使用管理员账号登录');
      }

      await this.loginViaTrueApi(account, secret);
      return true;
    }

    async loginViaTrueApi(email, code) {
      if (!email) throw new Error('请输入用户邮箱');
      if (!code) throw new Error('请输入验证码');

      const response = await TrueUserAPI.login({ email, code });
      const token = this.extractToken(response);
      if (!token) {
        throw new Error('登录成功但未获取到令牌');
      }

      this.persistToken(token);
      const profile = await this.fetchProfileSafely();
      const authData = this.buildAuthPayload({
        token,
        email,
        profile,
        source: SOURCE_TRUE_API
      });
      this.persistSession(authData);
    }

    async loginViaMock(username, password) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const user = ADMIN_ACCOUNTS[username];
      if (user && user.password === password) {
        const token = this.generateToken(username);
        const authData = {
          source: SOURCE_MOCK,
          username,
          name: user.name,
          role: user.role,
          permissions: user.permissions,
          loginTime: new Date().toISOString(),
          token,
          profile: {
            email: `${username}@local.test`
          }
        };
        this.persistSession(authData);
        return true;
      }
      return false;
    }

    extractToken(payload) {
      if (!payload) return null;
      if (typeof payload === 'string') return payload.trim();
      if (payload.token) return payload.token;
      if (payload.data) {
        if (typeof payload.data === 'string') return payload.data;
        if (payload.data.token) return payload.data.token;
      }
      if (payload.Authorization) return payload.Authorization;
      return null;
    }

    buildAuthPayload({ token, email, profile, source = SOURCE_TRUE_API }) {
      const displayName = (profile && (profile.name || profile.nickname || profile.username)) || email;
      const role = (profile && profile.role) || 'admin';
      const permissions = Array.isArray(profile && profile.permissions) && profile.permissions.length
        ? profile.permissions
        : DEFAULT_PERMISSIONS;

      return {
        source,
        username: email,
        email,
        name: displayName,
        role,
        permissions,
        loginTime: new Date().toISOString(),
        token,
        profile: profile || null
      };
    }

    persistSession(authData) {
      this.currentUser = authData;
      localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
      if (authData.token) {
        localStorage.setItem(TOKEN_KEY, authData.token);
      }
    }

    persistToken(token) {
      localStorage.setItem(TOKEN_KEY, token);
    }

    async fetchProfileSafely() {
      try {
        return await TrueUserAPI.info();
      } catch (error) {
        console.warn('获取用户信息失败:', error);
        return null;
      }
    }

    async refreshProfile() {
      const profile = await this.fetchProfileSafely();
      if (profile) {
        this.updateUserInfo({
          profile,
          name: profile.name || profile.nickname || this.currentUser?.name || '用户'
        });
      }
    }

    // 生成模拟token
    generateToken(username) {
      const timestamp = Date.now();
      return btoa(`${username}|${timestamp}|${Math.random().toString(36).substr(2)}`).substr(0, 32);
    }

    // 退出登录
    logout() {
      if (this.currentUser && this.currentUser.source === SOURCE_TRUE_API && this.canUseTrueApi()) {
        TrueUserAPI.logout().catch(err => console.warn('真实接口登出失败:', err));
      }
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(TOKEN_KEY);
      this.currentUser = null;
    }

    // 恢复会话
    restoreSession() {
      try {
        const authData = localStorage.getItem(AUTH_KEY);
        if (authData) {
          const parsed = JSON.parse(authData);

          if (this.isSessionExpired(parsed.loginTime)) {
            this.logout();
            return false;
          }

          this.currentUser = parsed;
          if (parsed.token) {
            localStorage.setItem(TOKEN_KEY, parsed.token);
          }

          if (parsed.source === SOURCE_TRUE_API && this.canUseTrueApi()) {
            this.refreshProfile().catch(() => {});
          }

          return true;
        }
      } catch (error) {
        console.error('恢复会话失败:', error);
        this.logout();
      }
      return false;
    }

    isSessionExpired(loginTime) {
      if (!loginTime) return true;
      const loginDate = new Date(loginTime);
      const now = new Date();
      return now - loginDate > SESSION_TIMEOUT;
    }

    // 检查登录状态
    isLoggedIn() {
      return this.currentUser !== null && this.restoreSession();
    }

    // 获取当前用户
    getCurrentUser() {
      return this.currentUser;
    }

    // 检查权限
    hasPermission(permission) {
      if (!this.currentUser) return false;
      return this.currentUser.permissions.includes(permission) ||
             this.currentUser.permissions.includes('*');
    }

    // 获取认证头
    getAuthHeader() {
      if (this.currentUser && this.currentUser.token) {
        return { 'Authorization': `Bearer ${this.currentUser.token}` };
      }
      return {};
    }

    // 更新用户信息并持久化
    updateUserInfo(updates = {}) {
      if (!this.currentUser) return;
      const { profile: profileUpdates, ...rest } = updates;
      this.currentUser = { ...this.currentUser, ...rest };
      if (profileUpdates) {
        const baseProfile = this.currentUser.profile || {};
        this.currentUser.profile = { ...baseProfile, ...profileUpdates };
      }
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.currentUser));
    }

    // 保存远端资料（可供设置页面使用）
    async saveProfile(updates) {
      if (this.currentUser && this.currentUser.source === SOURCE_TRUE_API && this.canUseTrueApi() && TRUE_API_ENDPOINTS.update) {
        await TrueUserAPI.update(updates);
        await this.refreshProfile();
      } else {
        this.updateUserInfo(updates);
      }
    }
  }

  // 创建全局认证管理器实例
  window.Auth = new AuthManager();
})();