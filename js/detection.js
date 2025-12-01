const DEFAULT_DETECTION_ENDPOINTS = {
  uploadText: '/detection/upload/text',
  uploadImage: '/detection/upload/file',
  uploadMultimodal: '/detection/upload/multimodal',
  history: '/detection/history',
  report: (newsId = '') => `/detection/report/${encodeURIComponent(newsId)}`,
  downloadReport: (newsId = '', params) => {
    const safeId = encodeURIComponent(newsId);
    const basePath = `/detection/report/download/${safeId}`;
    if (!params) return basePath;
    if (typeof params === 'string') {
      const trimmed = params.trim();
      if (!trimmed) return basePath;
      return trimmed.startsWith('?') ? `${basePath}${trimmed}` : `${basePath}?${trimmed}`;
    }
    try {
      const queryString = new URLSearchParams(params).toString();
      return queryString ? `${basePath}?${queryString}` : basePath;
    } catch (err) {
      return basePath;
    }
  }
};

const Detection = {
  currentPage: 1,
  pageSize: 10,
  serverPageSize: 50,
  serverPageCursor: 1,
  serverHasMore: true,
  detectionHistoryAll: [],
  detectionHistory: [],
  historyRaw: [],
  totalRecords: 0,
  currentReportId: null,
  latestReportPayload: null,
  latestReportHtml: '',
  selectedRecordIds: new Set(),
  reportCache: new Map(),
  endpoints: Object.assign(
    {},
    DEFAULT_DETECTION_ENDPOINTS,
    (window.AppConfig && window.AppConfig.ENDPOINTS && window.AppConfig.ENDPOINTS.detectionService) || {}
  ),

  matchRecordId(value, targetId) {
    if (!value || !targetId) return false;
    return String(value) === String(targetId);
  },

  getHistoryEntryById(targetId) {
    if (!targetId || !Array.isArray(this.detectionHistoryAll)) return null;
    return this.detectionHistoryAll.find(item => this.matchRecordId(item.id || item.newsId, targetId)) || null;
  },

  buildFallbackReportFromHistory(targetId) {
    const entry = this.getHistoryEntryById(targetId);
    if (!entry) return null;
    const raw = entry.raw || {};
    const timestamp = entry.timestamp || raw.creationTime || raw.createTime || raw.publishDate || raw.timestamp;
    const firstEvidence = Array.isArray(raw.evidenceChain) && raw.evidenceChain.length ? raw.evidenceChain[0] : null;
    return Object.assign({}, raw, {
      id: entry.id,
      title: entry.title,
      credibility: entry.credibility,
      type: entry.type,
      content: entry.content || raw.content || '',
      createTime: timestamp,
      publishDate: raw.publishDate || timestamp,
      score: raw.score !== undefined ? raw.score : this.normalizeScoreValue(firstEvidence && firstEvidence.score) || entry.credibility,
      evidenceChain: Array.isArray(raw.evidenceChain) ? raw.evidenceChain : [],
      quote: raw.quote || (firstEvidence && firstEvidence.quote) || '',
      reason: raw.reason || raw.analysisResult || (firstEvidence && firstEvidence.reason) || '',
      collect: raw.collect,
      likeCount: raw.likeCount,
      favoriteCount: raw.favoriteCount,
      isDislike: raw.isDislike
    });
  },

  normalizeScoreValue(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return undefined;
  },

  canServeReportFromCache(report) {
    if (!report) return false;
    const mustHaveStrings = ['title'];
    for (const key of mustHaveStrings) {
      if (!report[key] || typeof report[key] !== 'string') {
        return false;
      }
    }
    if (!report.publishDate && !report.createTime) return false;
    if (!Array.isArray(report.evidenceChain) || !report.evidenceChain.length) return false;
    return true;
  },

  getDetectionRequestOptions(extra = {}) {
    const authContext = this.resolveAuthContext();
    const baseOptions = { forceNetwork: true };
    if (authContext.strategy) {
      baseOptions.tokenStrategy = authContext.strategy;
    }
    return Object.assign(baseOptions, extra);
  },

  getDetectionAuthToken() {
    return this.resolveAuthContext().token;
  },

  resolveAuthContext() {
    const storedToken = this.getStoredTokenSafely();
    if (storedToken) {
      return { token: storedToken, strategy: 'stored' };
    }
    const fixedToken = this.getFixedTokenSafely();
    if (fixedToken) {
      return { token: fixedToken, strategy: 'fixed' };
    }
    return { token: '', strategy: null };
  },

  getStoredTokenSafely() {
    try {
      if (api && typeof api.getStoredAuthToken === 'function') {
        const token = api.getStoredAuthToken();
        if (token) return token;
      }
    } catch (err) {}
    try {
      if (window.localStorage && typeof window.localStorage.getItem === 'function') {
        return window.localStorage.getItem('admin_token') || '';
      }
    } catch (err) {}
    return '';
  },

  getFixedTokenSafely() {
    return (window.AppConfig && window.AppConfig.FIXED_TOKEN) || '';
  },

  getApiBase() {
    const base = (window.AppConfig && window.AppConfig.API_BASE_URL) || '';
    return typeof base === 'string' ? base : '';
  },

  resolveEndpoint(name, ...args) {
    const endpoint = this.endpoints && this.endpoints[name];
    if (typeof endpoint === 'function') {
      try {
        return endpoint(...args);
      } catch (error) {
        console.error(`解析检测端点失败: ${name}`, error);
        return DEFAULT_DETECTION_ENDPOINTS[name] || '';
      }
    }
    return endpoint || DEFAULT_DETECTION_ENDPOINTS[name] || '';
  },

  normalizeRecordId(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  },

  escapeHtml(value) {
    if (window.Utils && typeof window.Utils.escapeHtml === 'function') {
      return window.Utils.escapeHtml(value);
    }
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  },

  toggleRecordSelection(recordId, checked) {
    const id = this.normalizeRecordId(recordId);
    if (!id) return;
    if (checked) {
      this.selectedRecordIds.add(id);
    } else {
      this.selectedRecordIds.delete(id);
    }
    this.updateSelectionIndicators();
  },

  handleSelectAllToggle(event) {
    const checked = Boolean(event.target && event.target.checked);
    const checkboxes = document.querySelectorAll('.record-checkbox');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = checked;
      const id = this.normalizeRecordId(checkbox.value);
      if (!id) return;
      if (checked) {
        this.selectedRecordIds.add(id);
      } else {
        this.selectedRecordIds.delete(id);
      }
    });
    this.updateSelectionIndicators();
  },

  clearSelection(options = {}) {
    if (options && typeof options.preventDefault === 'function') {
      options.preventDefault();
      options = {};
    }
    const silent = Boolean(options.silent);
    this.selectedRecordIds.clear();
    if (!silent) {
      document.querySelectorAll('.record-checkbox').forEach((checkbox) => {
        checkbox.checked = false;
      });
      const selectAll = document.getElementById('selectAllDetection');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      this.updateSelectionIndicators();
    } else {
      this.updateSelectionIndicators();
    }
  },

  getSelectedRecords() {
    const ids = Array.from(this.selectedRecordIds);
    return ids
      .map((id) => this.getHistoryEntryById(id))
      .filter(Boolean);
  },

  updateSelectionIndicators() {
    const count = this.selectedRecordIds.size;
    const infoEl = document.getElementById('detectionSelectedInfo');
    if (infoEl) {
      infoEl.innerHTML = count
        ? `已选 <strong>${count}</strong> 条 <span class="selected-dot" aria-hidden="true"></span>`
        : '未选择任何记录';
    }
    const toggleButtonState = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = count === 0;
      }
    };
    toggleButtonState('bulkPreviewBtn');
    toggleButtonState('bulkExportBtn');
    const clearBtn = document.getElementById('clearSelectionBtn');
    if (clearBtn) {
      clearBtn.disabled = count === 0;
    }
    const checkboxes = Array.from(document.querySelectorAll('.record-checkbox'));
    const selectAll = document.getElementById('selectAllDetection');
    if (selectAll) {
      const selectedInView = checkboxes.filter((checkbox) => this.selectedRecordIds.has(this.normalizeRecordId(checkbox.value)));
      if (!checkboxes.length) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      } else if (selectedInView.length === checkboxes.length) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
      } else if (selectedInView.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      } else {
        selectAll.checked = false;
        selectAll.indeterminate = true;
      }
    }
  },

  normalizeHistoryResponse(payload) {
    if (!payload) {
      return { items: [], total: 0 };
    }
    if (Array.isArray(payload)) {
      return { items: payload, total: payload.length };
    }
    const dataLayer = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
    const candidateLists = [
      payload.items,
      dataLayer.items,
      dataLayer.records,
      dataLayer.list,
      dataLayer.rows,
      dataLayer.history,
      dataLayer.datas
    ];
    const items = candidateLists.find(Array.isArray) || [];
    let total = 0;
    if (typeof payload.total === 'number') {
      total = payload.total;
    } else if (typeof payload.count === 'number') {
      total = payload.count;
    } else if (dataLayer && typeof dataLayer.total === 'number') {
      total = dataLayer.total;
    } else if (dataLayer && typeof dataLayer.count === 'number') {
      total = dataLayer.count;
    } else {
      total = items.length;
    }
    return { items, total };
  },

  normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const record = Object.assign({}, raw);
    const baseId = raw.id || raw.newsId || raw.reportId || raw.historyId;
    record.id = baseId ? String(baseId) : `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!record.newsId) {
      record.newsId = record.id;
    }
    record.raw = raw;
    record.timestamp = raw.timestamp || raw.createTime || raw.creationTime || raw.publishDate || raw.publish_date;
    const typeLabel = raw.type || raw.category || raw.mediaType || 'text';
    record.type = typeof typeLabel === 'string' ? typeLabel.toLowerCase() : 'text';
    record.content = record.content || raw.detail || raw.body || raw.message || '';
    const credibilitySource = raw.credibility ?? raw.score ?? raw.trustScore ?? raw.rating;
    const credibility = this.normalizeScoreValue(credibilitySource);
    if (credibility !== undefined) {
      record.credibility = credibility;
    }
    if (record.score === undefined || record.score === null) {
      record.score = this.normalizeScoreValue(raw.score) ?? record.credibility;
    }
    if (!record.reason) {
      record.reason = raw.reason || raw.analysisResult || raw.remark || '';
    }
    record.verificationResult = raw.verificationResult || raw.verificationStatus || raw.status || '';
    record.evidenceChain = Array.isArray(raw.evidenceChain)
      ? raw.evidenceChain
      : Array.isArray(raw.evidences)
        ? raw.evidences
        : [];
    return record;
  },

  init() {
    this.bindEvents();
    this.loadDetectionHistory();
  },
  
  bindEvents() {
    // 刷新按钮
    document.getElementById('refreshBtn').addEventListener('click', this.loadDetectionHistory.bind(this));
    
    // 搜索输入
    document.getElementById('searchInput').addEventListener('input', this.handleSearch.bind(this));
    
    // 加载更多按钮
    document.getElementById('loadMoreBtn').addEventListener('click', this.loadMoreHistory.bind(this));

    const bulkPreviewBtn = document.getElementById('bulkPreviewBtn');
    if (bulkPreviewBtn) {
      bulkPreviewBtn.addEventListener('click', this.handleBulkPreview.bind(this));
    }

    const bulkExportBtn = document.getElementById('bulkExportBtn');
    if (bulkExportBtn) {
      bulkExportBtn.addEventListener('click', this.handleBulkExport.bind(this));
    }

    const selectAllCheckbox = document.getElementById('selectAllDetection');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (event) => this.handleSelectAllToggle(event));
    }

    const clearBtn = document.getElementById('clearSelectionBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', this.clearSelection.bind(this));
    }

    const bulkModalClosers = document.querySelectorAll('[data-close="bulkDetectionModal"]');
    bulkModalClosers.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        this.closeBulkPreviewModal();
      });
    });
    
    // 模态框事件
    document.getElementById('closeModalBtn').addEventListener('click', this.closeModal.bind(this));
    document.getElementById('closeModalActionBtn').addEventListener('click', this.closeModal.bind(this));
    document.getElementById('downloadReportBtn').addEventListener('click', this.downloadReport.bind(this));
    document.getElementById('downloadWordBtn').addEventListener('click', this.downloadWordReport.bind(this));
    
    // 页码跳转
    document.getElementById('pageGoBtn').addEventListener('click', this.handlePageGo.bind(this));
    document.getElementById('pageInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handlePageGo();
    });
  },
  
  async showDetectionResult(newsId) {
    try {
      const targetId = newsId || this.currentReportId;
      if (!targetId) {
        throw new Error('缺少报告ID');
      }
      this.currentReportId = targetId;
      const fallback = this.buildFallbackReportFromHistory(targetId);
      const preferHistoryFirst = this.canServeReportFromCache(fallback);
      const { report: reportPayload, badge } = await this.resolveReportData(targetId, {
        preferHistoryFirst,
        fallback
      });

      if (reportPayload) {
        this.displayReport(reportPayload, { badge });
        this.openModal();
      } else {
        alert('获取检测报告失败');
      }
    } catch (error) {
      console.error('获取检测报告失败:', error);
      alert('获取检测报告失败: ' + (error.message || '未知错误'));
    }
  },

  async resolveReportData(targetId, { preferHistoryFirst = false, fallback = null } = {}) {
    const normalizedId = this.normalizeRecordId(targetId);
    if (!normalizedId) {
      throw new Error('缺少报告ID');
    }

    if (this.reportCache.has(normalizedId)) {
      return { report: this.reportCache.get(normalizedId), badge: '' };
    }

    const historyFallback = fallback || this.buildFallbackReportFromHistory(normalizedId);
    if (preferHistoryFirst && this.canServeReportFromCache(historyFallback)) {
      this.reportCache.set(normalizedId, historyFallback);
      return { report: historyFallback, badge: '本地缓存' };
    }

    try {
      const serverReport = await this.fetchReportFromServer(normalizedId);
      if (serverReport && typeof serverReport === 'object' && Object.keys(serverReport).length) {
        this.reportCache.set(normalizedId, serverReport);
        return { report: serverReport, badge: '' };
      }
      if (this.canServeReportFromCache(historyFallback)) {
        this.reportCache.set(normalizedId, historyFallback);
        return { report: historyFallback, badge: '本地缓存' };
      }
      return { report: null, badge: '' };
    } catch (error) {
      if (this.canServeReportFromCache(historyFallback)) {
        this.reportCache.set(normalizedId, historyFallback);
        return { report: historyFallback, badge: '本地缓存' };
      }
      throw error;
    }
  },

  async fetchReportFromServer(targetId) {
    const response = await api.get(
      this.resolveEndpoint('report', targetId),
      {},
      this.getDetectionRequestOptions()
    );
    let payload = response;
    if (payload && typeof payload === 'object' && payload.data && !Array.isArray(payload)) {
      payload = payload.data;
    }
    if (Array.isArray(payload)) {
      payload = payload[0];
    }
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        payload = { raw: payload };
      }
    }
    return payload;
  },
  
  async loadDetectionHistory(options = {}) {
    try {
      let page = 1;
      let append = false;
      let preservePage = false;
      let skipRender = false;
      if (typeof options === 'number') {
        page = options;
      } else if (options && typeof options === 'object') {
        page = typeof options.page === 'number' ? options.page : 1;
        append = Boolean(options.append);
        preservePage = Boolean(options.preservePage);
        skipRender = Boolean(options.skipRender);
      }

      const historyPath = this.resolveEndpoint('history');
      if (!historyPath) {
        throw new Error('未配置检测历史接口路径');
      }

      const queryParams = { page, pageSize: this.serverPageSize };

      const responseData = await api.get(
        historyPath,
        queryParams,
        this.getDetectionRequestOptions()
      );
      const { items, total } = this.normalizeHistoryResponse(responseData);
      const normalized = items
        .map(item => this.normalizeRecord(item))
        .filter(Boolean);

      if (append && this.detectionHistoryAll.length) {
        const existingIds = new Set(this.detectionHistoryAll.map(record => record.id));
        normalized.forEach(record => {
          if (!existingIds.has(record.id)) {
            this.detectionHistoryAll.push(record);
            existingIds.add(record.id);
          }
        });
        this.historyRaw = this.historyRaw.concat(items);
      } else {
        this.historyRaw = items;
        this.detectionHistoryAll = normalized;
        this.currentPage = 1;
        this.reportCache.clear();
        this.clearSelection({ silent: true });
      }

      this.serverPageCursor = page;
      const normalizedTotal = typeof total === 'number' ? total : this.detectionHistoryAll.length;
      this.totalRecords = normalizedTotal;
      this.serverHasMore = this.detectionHistoryAll.length < normalizedTotal;


      const targetPage = preservePage ? this.currentPage : 1;
      if (!skipRender) {
        this.updateDisplayedHistory(targetPage);
      }
      return { items: normalized, total: normalizedTotal };
    } catch (error) {
      console.error('加载检测历史失败:', error);
      // 检查错误类型并进行相应处理
      if (error.message.includes('401') || error.message.toLowerCase().includes('unauthorized') || error.message.includes('token') || error.message.includes('认证')) {
        // 认证错误 - 令牌可能已过期
        console.log('检测到认证错误，可能需要重新登录');
        alert('登录已过期，请重新登录后再试。');
        window.location.href = 'index.html';
      } else if (error.message.includes('系统繁忙') || error.message.includes('稍后重试')) {
        // 针对这种情况，尝试使用一个已知的、有效的令牌进行测试（如果有的话）
        // 或者提供更友好的提示
        console.log('检测到后端服务繁忙提示，可能需要检查认证令牌是否有效');
        // 不在界面上直接显示技术错误，而是提供重试选项
        this.showErrorMessage('检测服务暂时不可用，点击重试按钮可重新加载数据。如问题持续，请联系管理员。');
      } else if (error.message.includes('网络错误') || error.message.includes('Failed to fetch')) {
        this.showErrorMessage('无法连接到服务器，请检查网络连接或稍后再试。');
      } else {
        this.showErrorMessage('加载检测历史失败: ' + (error.message || '未知错误'));
      }
      // 确保即使出错也清空历史记录
      this.detectionHistoryAll = [];
      this.detectionHistory = [];
      this.totalRecords = 0;
      this.serverHasMore = false;
      this.serverPageCursor = 1;
      this.reportCache.clear();
      this.renderHistoryTable();
      this.updatePagination(0);
      this.clearSelection({ silent: true });
      return null;
    }
  },

  updateDisplayedHistory(page = 1) {
    const totalPages = this.getTotalPages();
    const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
    const start = (safePage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.detectionHistory = this.detectionHistoryAll.slice(start, end);
    this.currentPage = safePage;
    this.renderHistoryTable();
    this.updatePagination(this.totalRecords);
  },

  getTotalPages() {
    if (!this.totalRecords) return 0;
    return Math.ceil(this.totalRecords / this.pageSize);
  },

  showErrorMessage(message) {
    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center error-message">
            <div class="alert alert-warning" style="margin: 10px 0; padding: 10px; border-radius: 4px; background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404;">
              <strong>⚠️</strong> ${message}
              <div style="margin-top: 8px;">
                <button class="btn btn-sm btn-outline-primary" onclick="Detection.loadDetectionHistory()">重试</button>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
  },
  
  renderHistoryTable() {
    this.renderHistoryRows(this.detectionHistory, '暂无检测记录');
  },

  renderHistoryRows(list, emptyText) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!list || list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center">${emptyText}</td>
        </tr>
      `;
      return;
    }

    list.forEach(item => {
      const row = document.createElement('tr');
      const recordId = this.normalizeRecordId(item.id || item.newsId);
      const checkboxChecked = this.selectedRecordIds.has(recordId);

      let credibilityClass = '';
      let credibilityText = '未知';
      let credibilityValue = 0;

      if (item.credibility !== undefined && item.credibility !== null) {
        credibilityValue = item.credibility;
        if (credibilityValue >= 80) {
          credibilityClass = 'success';
          credibilityText = `可信 (${credibilityValue}%)`;
        } else if (credibilityValue >= 60) {
          credibilityClass = 'warning';
          credibilityText = `一般 (${credibilityValue}%)`;
        } else {
          credibilityClass = 'danger';
          credibilityText = `可疑 (${credibilityValue}%)`;
        }
      } else if (item.verificationResult) {
        if (item.verificationResult === 'verified') {
          credibilityClass = 'success';
          credibilityText = '已验证';
        } else if (item.verificationResult === 'unverified') {
          credibilityClass = 'warning';
          credibilityText = '未验证';
        } else if (item.verificationResult === 'fake') {
          credibilityClass = 'danger';
          credibilityText = '虚假';
        }
      }

      const displayTitle = item.title || (item.content && item.content.substring ? item.content.substring(0, 50) : '') || '未标题新闻';
      row.innerHTML = `
        <td>
          <input type="checkbox" class="record-checkbox" value="${this.escapeHtml(recordId)}" ${checkboxChecked ? 'checked' : ''} />
        </td>
        <td title="${displayTitle}">
          ${displayTitle}
        </td>
        <td>${this.getDetectionTypeText(item.type || 'text')}</td>
        <td>
          <span class="status-pill ${credibilityClass}">${credibilityText}</span>
        </td>
        <td>${this.formatDate(item.timestamp)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-sm btn-ghost view-report-btn" data-id="${item.id || item.newsId}">
              <svg class="icon"><use href="#eye"></use></svg>
              <span class="btn-text">查看</span>
            </button>
            <button class="btn btn-sm btn-ghost export-word-btn" data-id="${item.id || item.newsId}">
              <svg class="icon"><use href="#download"></use></svg>
              <span class="btn-text">导出 Word</span>
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });

    tbody.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const newsId = e.currentTarget.dataset.id;
        this.showDetectionResult(newsId);
      });
    });

    tbody.querySelectorAll('.export-word-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const newsId = e.currentTarget.dataset.id;
        this.exportWordForRecord(newsId);
      });
    });

    tbody.querySelectorAll('.record-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const target = event.currentTarget;
        this.toggleRecordSelection(target.value, target.checked);
      });
    });

    this.updateSelectionIndicators();
  },
  
  getDetectionTypeText(type) {
    switch (type) {
      case 'text': return '文本检测';
      case 'image': return '图片检测';
      case 'multimodal': return '图文检测';
      default: return '未知类型';
    }
  },
  
  formatDate(dateValue) {
    if (!dateValue) return '未知时间';
    let date = null;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'number') {
      date = new Date(dateValue);
    } else if (typeof dateValue === 'string') {
      let normalized = dateValue.trim();
      if (/^\d+$/.test(normalized)) {
        date = new Date(Number(normalized));
      } else {
        if (normalized.includes(' ') && !normalized.includes('T')) {
          normalized = normalized.replace(' ', 'T');
        }
        date = new Date(normalized);
        if (Number.isNaN(date.getTime())) {
          // Safari 兼容：将 - 替换为 /
          date = new Date(normalized.replace(/-/g, '/'));
        }
      }
    }
    if (!date || Number.isNaN(date.getTime())) {
      return typeof dateValue === 'string' ? dateValue : '未知时间';
    }
    return date.toLocaleString('zh-CN');
  },
  
  handleSearch(e) {
    const keyword = e.target.value.toLowerCase();
    if (!keyword) {
      this.updateDisplayedHistory(this.currentPage || 1);
      return;
    }
    
    const filtered = this.detectionHistoryAll.filter(item => 
      (item.title && item.title.toLowerCase().includes(keyword)) ||
      (item.content && item.content.toLowerCase().includes(keyword))
    );
    
    this.renderFilteredHistory(filtered);
  },
  
  renderFilteredHistory(filtered) {
    this.renderHistoryRows(filtered, '未找到匹配的记录');
  },

  handleBulkPreview() {
    const records = this.getSelectedRecords();
    if (!records.length) {
      alert('请先选择需要查看的记录');
      return;
    }
    this.showBulkPreviewModal(records);
  },

  showBulkPreviewModal(records) {
    const modal = document.getElementById('bulkDetectionModal');
    const list = document.getElementById('bulkDetectionList');
    if (!modal || !list) return;
    list.innerHTML = records.map((record, index) => this.buildBulkPreviewItem(record, index)).join('');
    if (!records.length) {
      list.innerHTML = '<li class="bulk-item">暂无数据</li>';
    }
    this.openBulkPreviewModal();
  },

  buildBulkPreviewItem(record, index = 0) {
    const title = record.title || record.raw?.title || record.content || `记录 ${index + 1}`;
    const avatarLetter = (title && title.trim().charAt(0)) ? title.trim().charAt(0).toUpperCase() : '讯';
    const typeLabel = this.getDetectionTypeText(record.type || 'text');
    const credibilityLabel = (record.credibility !== undefined && record.credibility !== null)
      ? `${record.credibility}%`
      : '未知';
    const summary = record.content ? record.content.replace(/\s+/g, ' ').slice(0, 80) : '暂无内容';
    const timestamp = this.formatDate(record.timestamp);
    return `
      <li class="bulk-item">
        <div class="bulk-avatar">${this.escapeHtml(avatarLetter)}</div>
        <div class="bulk-meta">
          <div class="name">${this.escapeHtml(title)}</div>
          <div class="sub">${this.escapeHtml(typeLabel)} · 可信度 ${this.escapeHtml(credibilityLabel)}</div>
          <div class="sub">时间：${this.escapeHtml(timestamp)}</div>
          <div class="sub">摘要：${this.escapeHtml(summary)}</div>
        </div>
      </li>
    `;
  },

  openBulkPreviewModal() {
    const modal = document.getElementById('bulkDetectionModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  },

  closeBulkPreviewModal() {
    const modal = document.getElementById('bulkDetectionModal');
    if (modal) {
      modal.style.display = 'none';
    }
  },

  handleBulkExport() {
    const records = this.getSelectedRecords();
    if (!records.length) {
      alert('请先选择需要导出的记录');
      return;
    }
    if (typeof XLSX === 'undefined') {
      alert('Excel 导出库未加载，请刷新页面后重试。');
      return;
    }
    this.exportRecordsToExcel(records);
  },

  exportRecordsToExcel(records) {
    const headers = ['新闻标题', '检测类型', '可信度(%)', '检测时间', '检测ID', '判定状态', '内容摘要'];
    const rows = records.map((record) => {
      const summary = (record.content || record.raw?.content || '').replace(/\s+/g, ' ').slice(0, 140);
      const credibility = (record.credibility !== undefined && record.credibility !== null) ? record.credibility : '';
      return [
        record.title || record.raw?.title || '未标题新闻',
        this.getDetectionTypeText(record.type || 'text'),
        credibility,
        this.formatDate(record.timestamp),
        record.id || record.newsId,
        record.verificationResult || record.raw?.verificationResult || '未知',
        summary
      ];
    });
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = [
      { wch: 30 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 20 },
      { wch: 12 },
      { wch: 60 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '检测记录');
    const filename = `detection_records_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
  },
  
  async loadMoreHistory() {
    if (!this.totalRecords) return;
    await this.goToPage(this.currentPage + 1);
  },

  async goToPage(targetPage) {
    if (!targetPage || targetPage < 1) return;
    const totalPages = Math.max(1, this.getTotalPages() || 1);
    const desiredPage = Math.min(targetPage, totalPages);
    const requiredEndIndex = desiredPage * this.pageSize;

    if (this.detectionHistoryAll.length < requiredEndIndex && this.serverHasMore) {
      let guard = 0;
      while (this.detectionHistoryAll.length < requiredEndIndex && this.serverHasMore && guard < 20) {
        guard += 1;
        const nextServerPage = this.serverPageCursor + 1;
        const result = await this.loadDetectionHistory({
          page: nextServerPage,
          append: true,
          preservePage: true,
          skipRender: true
        });
        if (!result) {
          break;
        }
      }
    }

    this.updateDisplayedHistory(desiredPage);
  },
  
  updatePagination(total) {
    this.totalRecords = typeof total === 'number' ? total : this.totalRecords;
    const container = document.getElementById('paginationContainer');
    const info = document.getElementById('paginationInfo');
    const pagination = document.getElementById('pagination');
    
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = !total || this.currentPage * this.pageSize >= total;
    }

    if (!total || total <= this.pageSize) {
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'flex';
    const totalPages = Math.max(1, this.getTotalPages() || 1);
    const startItem = (this.currentPage - 1) * this.pageSize + 1;
    const endItem = Math.min(this.currentPage * this.pageSize, total);
    
    info.textContent = `显示第 ${startItem} - ${endItem} 条，共 ${total} 条`;
    
    pagination.innerHTML = '';
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹';
    prevBtn.disabled = this.currentPage <= 1;
    prevBtn.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.goToPage(this.currentPage - 1);
      }
    });
    pagination.appendChild(prevBtn);
    
    // 页码按钮
    const startPage = Math.max(1, this.currentPage - 2);
    const endPage = Math.min(totalPages, this.currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `page-btn ${i === this.currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => {
        this.goToPage(i);
      });
      pagination.appendChild(pageBtn);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '›';
    nextBtn.disabled = this.currentPage >= totalPages;
    nextBtn.addEventListener('click', () => {
      if (this.currentPage < totalPages) {
        this.goToPage(this.currentPage + 1);
      }
    });
    pagination.appendChild(nextBtn);
  },
  
  async handlePageGo() {
    const pageInput = document.getElementById('pageInput');
    const page = parseInt(pageInput.value);
    const totalPages = Math.max(1, this.getTotalPages() || 1);
    
    if (page && page >= 1 && page <= totalPages) {
      await this.goToPage(page);
      pageInput.value = '';
    } else {
      alert(`请输入 1 到 ${totalPages} 之间的页码`);
    }
  },
  
  displayReport(report, { badge = '' } = {}) {
    const container = document.getElementById('reportContent');
    if (!container) return;
    
    if (!report) {
      container.innerHTML = '<p>无法获取报告内容</p>';
      return;
    }

    const html = this.getReportDetailMarkup(report, { badge });
    container.innerHTML = html;
    this.latestReportPayload = report;
    this.latestReportHtml = html;
    this.attachCollapseHandlers(container);
  },

  getReportDetailMarkup(report, { badge = '' } = {}) {
    if (!report) {
      return '<p>无法获取报告内容</p>';
    }

    const renderEvidenceChain = () => {
      if (!Array.isArray(report.evidenceChain) || !report.evidenceChain.length) return '';
      return `
        <div class="news-detail-section">
          <ol class="evidence-chain">
            ${report.evidenceChain.map((item, index) => `
              <li>
                <strong>步骤 ${index + 1}：</strong>
                <div>${item.title || item.step || '未命名步骤'}</div>
                ${item.description ? `<p>${item.description}</p>` : ''}
                ${item.result ? `<small>结果：${item.result}</small>` : ''}
                ${item.quote ? `<p>引用：${item.quote}</p>` : ''}
                ${item.reason ? `<p>理由：${item.reason}</p>` : ''}
                ${item.score !== undefined ? `<small>得分：${item.score}</small>` : ''}
              </li>
            `).join('')}
          </ol>
        </div>
      `;
    };

    const renderKeyFact = (label, value) => {
      if (value === undefined || value === null || value === '') return '';
      return `
        <div>
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `;
    };

    const renderBooleanStatus = (flag) => {
      if (flag === undefined || flag === null) return '未知';
      return flag ? '是' : '否';
    };

    const collapseSeed = report.id || report.newsId || `temp-${Date.now()}`;
    const buildCollapsibleSection = (key, title, body, expanded = false) => {
      if (!body) return '';
      const collapseId = `collapse-${key}-${collapseSeed}`;
      return `
        <section class="collapsible-block" data-section="${key}">
          <div class="collapsible-header">
            <h4>${title}</h4>
            <button type="button" class="collapse-toggle" data-target="${collapseId}" aria-expanded="${expanded}">
              ${expanded ? '收起详情' : '展开详情'}
            </button>
          </div>
          <div class="collapse-content ${expanded ? '' : 'collapsed'}" id="${collapseId}" data-collapsed="${expanded ? 'false' : 'true'}">
            ${body}
          </div>
        </section>
      `;
    };

    return `
      <div class="report-detail report-scroll">
        <header>
          <div>
            <h3>${report.title || '新闻检测报告'}</h3>
            <p>检测ID: ${report.newsId || report.id || 'N/A'}</p>
          </div>
          <div class="detail-actions">
            <div class="status-pill ${report.verificationResult === 'verified' ? 'success' : report.verificationResult === 'fake' ? 'danger' : 'warning'}">
              ${report.verificationResult === 'verified' ? '已验证' : report.verificationResult === 'fake' ? '虚假' : '待验证'}
            </div>
            ${badge ? `<span class="status-pill warning">${badge}</span>` : ''}
          </div>
        </header>
        <div class="detail-meta-grid">
          ${renderKeyFact('检测时间', this.formatDate(report.createTime || report.timestamp || new Date()))}
          ${renderKeyFact('发布时间', this.formatDate(report.publishDate))}
          ${renderKeyFact('检测类型', this.getDetectionTypeText(report.type || 'text'))}
          ${renderKeyFact('可信度', report.credibility !== undefined ? `${report.credibility}%` : 'N/A')}
          ${renderKeyFact('综合评分', report.score !== undefined ? report.score : 'N/A')}
          ${renderKeyFact('收藏', renderBooleanStatus(report.collect))}
          ${renderKeyFact('点赞数', report.likeCount || 0)}
          ${renderKeyFact('收藏数', report.favoriteCount || 0)}
          ${renderKeyFact('是否点踩', renderBooleanStatus(report.isDislike))}
        </div>
        ${buildCollapsibleSection('content', '新闻内容', report.content ? `
          <div class="news-detail-section">
            <div class="news-message">
              <p>${report.content}</p>
            </div>
          </div>` : '', true)}

        ${buildCollapsibleSection('analysis', '分析结果', report.analysisResult ? `
          <div class="news-detail-section">
            <div class="news-message">
              <p>${report.analysisResult}</p>
            </div>
          </div>` : '')}

        ${buildCollapsibleSection('reason', '判定理由', report.reason ? `
          <div class="news-detail-section">
            <div class="news-message">
              <p>${report.reason}</p>
            </div>
          </div>` : '')}

        ${buildCollapsibleSection('quote', '引用信息', report.quote ? `
          <div class="news-detail-section">
            <div class="news-message">
              <p>${report.quote}</p>
            </div>
          </div>` : '')}

        ${buildCollapsibleSection('sources', '参考来源', report.sources && report.sources.length ? `
          <div class="news-detail-section">
            <ul>
              ${report.sources.map(source => `<li>${source}</li>`).join('')}
            </ul>
          </div>` : '')}

        ${buildCollapsibleSection('evidence', '证据链', renderEvidenceChain())}

        <div class="news-stats">
          <div class="stat-block">
            <span>相似新闻数</span>
            <strong>${report.similarNewsCount || 0}</strong>
          </div>
          <div class="stat-block">
            <span>引用验证</span>
            <strong>${report.quoteVerification || 'N/A'}</strong>
          </div>
          <div class="stat-block">
            <span>图像验证</span>
            <strong>${report.imageVerification || 'N/A'}</strong>
          </div>
        </div>
      </div>
    `;
  },

  attachCollapseHandlers(root) {
    if (!root) return;
    const buttons = root.querySelectorAll('.collapse-toggle');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const target = root.querySelector(`#${targetId}`);
        if (!target) return;
        const isCollapsed = target.classList.toggle('collapsed');
        target.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');
        btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        btn.textContent = isCollapsed ? '展开详情' : '收起详情';
      });
    });
  },
  
  openModal() {
    document.getElementById('detectionModal').style.display = 'flex';
  },
  
  closeModal() {
    document.getElementById('detectionModal').style.display = 'none';
  },
  
  async downloadReport(newsId, query) {
    try {
      if (newsId && typeof newsId.preventDefault === 'function') {
        newsId.preventDefault();
        newsId = undefined;
      }

      const targetId = newsId || this.currentReportId;
      if (!targetId) {
        throw new Error('缺少报告ID');
      }

      const rawToken = this.getDetectionAuthToken();
      const token = rawToken ? rawToken.replace(/^[Bb]earer\s+/, '').trim() : '';
      if (!token) {
        alert('请先登录后再下载报告。');
        return;
      }

      const downloadPath = this.resolveEndpoint('downloadReport', targetId, query);
      if (!downloadPath) {
        throw new Error('未配置下载接口');
      }

      const downloadUrl = this.buildUrl(downloadPath);
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'token': token
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `下载失败 (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      let filename = `detection-report-${targetId}`;
      const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      if (match) {
        const encodedName = match[1] || match[2];
        try {
          filename = decodeURIComponent(encodedName);
        } catch (err) {
          filename = encodedName;
        }
      } else {
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('pdf')) {
          filename += '.pdf';
        } else if (contentType.includes('json')) {
          filename += '.json';
        } else {
          filename += '.dat';
        }
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('下载报告失败:', error);
      alert('下载报告失败: ' + (error.message || '未知错误'));
    }
  },

  downloadWordReport() {
    const report = this.latestReportPayload;
    if (!report) {
      alert('请先打开报告再导出 Word。');
      return;
    }
    this.exportReportAsWord(report);
  },

  async exportWordForRecord(newsId) {
    try {
      const targetId = newsId || this.currentReportId;
      if (!targetId) {
        throw new Error('缺少报告ID');
      }
      const { report } = await this.resolveReportData(targetId, { preferHistoryFirst: false });
      if (!report) {
        throw new Error('无法获取报告数据');
      }
      this.exportReportAsWord(report, { fileSuffix: this.normalizeRecordId(targetId) });
    } catch (error) {
      console.error('导出 Word 报告失败:', error);
      alert('导出 Word 失败: ' + (error.message || '未知错误'));
    }
  },

  exportReportAsWord(report, { fileSuffix = '' } = {}) {
    const docHtml = this.buildWordDocument(report);
    const title = report.title || '新闻检测报告';
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    const suffix = fileSuffix ? `_${fileSuffix}` : '';
    const filename = `${safeTitle}${suffix}.doc`;
    const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  buildWordDocument(report) {
    const safe = (value) => this.escapeHtml(value || '');
    const formatBlock = (text) => safe(text).replace(/\n/g, '<br />');
    const evidenceChain = Array.isArray(report.evidenceChain) ? report.evidenceChain : [];
    const evidenceHtml = evidenceChain.length
      ? evidenceChain.map((item, index) => `
        <li>
          <strong>步骤 ${index + 1}：</strong> ${safe(item.title || item.step || '未命名步骤')}<br/>
          ${item.description ? `<em>描述：</em>${formatBlock(item.description)}<br/>` : ''}
          ${item.result ? `<em>结果：</em>${formatBlock(item.result)}<br/>` : ''}
          ${item.reason ? `<em>理由：</em>${formatBlock(item.reason)}<br/>` : ''}
          ${item.quote ? `<em>引用：</em>${formatBlock(item.quote)}<br/>` : ''}
          ${item.score !== undefined ? `<em>得分：</em>${safe(item.score)}` : ''}
        </li>
      `).join('')
      : '<li>暂无证据链记录</li>';

    const sourcesHtml = Array.isArray(report.sources) && report.sources.length
      ? report.sources.map((source, index) => `<li><strong>来源 ${index + 1}：</strong>${safe(source)}</li>`).join('')
      : '<li>暂无参考来源</li>';

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${safe(report.title || '新闻检测报告')}</title>
    <style>
      body { font-family: "Microsoft Yahei", Arial, sans-serif; line-height: 1.6; color: #111; padding: 24px; }
      h1, h2, h3 { color: #222; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      th { background: #f3f4f6; }
      section { margin-bottom: 20px; }
      ul { padding-left: 20px; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>${safe(report.title || '新闻检测报告')}</h1>
    <p>检测ID：${safe(report.newsId || report.id || 'N/A')}</p>
    <section>
      <h2>基本信息</h2>
      <table>
        <tr><th>检测类型</th><td>${safe(this.getDetectionTypeText(report.type || 'text'))}</td></tr>
        <tr><th>检测时间</th><td>${safe(this.formatDate(report.createTime || report.timestamp || new Date()))}</td></tr>
        <tr><th>发布时间</th><td>${safe(this.formatDate(report.publishDate))}</td></tr>
        <tr><th>可信度</th><td>${report.credibility !== undefined ? safe(`${report.credibility}%`) : '未知'}</td></tr>
        <tr><th>综合评分</th><td>${report.score !== undefined ? safe(report.score) : '未知'}</td></tr>
        <tr><th>判定状态</th><td>${safe(report.verificationResult || '未提供')}</td></tr>
      </table>
    </section>
    <section>
      <h2>新闻内容</h2>
      <p>${report.content ? formatBlock(report.content) : '暂无正文内容'}</p>
    </section>
    <section>
      <h2>分析结果</h2>
      <p>${report.analysisResult ? formatBlock(report.analysisResult) : '暂无分析结果'}</p>
    </section>
    <section>
      <h2>判定理由</h2>
      <p>${report.reason ? formatBlock(report.reason) : '暂无判定理由'}</p>
    </section>
    <section>
      <h2>引用与来源</h2>
      <p>${report.quote ? formatBlock(report.quote) : '暂无引用信息'}</p>
      <ul>${sourcesHtml}</ul>
    </section>
    <section>
      <h2>证据链</h2>
      <ul>${evidenceHtml}</ul>
    </section>
    <section>
      <h2>统计信息</h2>
      <table>
        <tr><th>相似新闻数</th><td>${safe(report.similarNewsCount || 0)}</td></tr>
        <tr><th>引用验证</th><td>${safe(report.quoteVerification || '无数据')}</td></tr>
        <tr><th>图像验证</th><td>${safe(report.imageVerification || '无数据')}</td></tr>
        <tr><th>收藏</th><td>${report.collect ? '是' : '否'}</td></tr>
        <tr><th>点赞数</th><td>${safe(report.likeCount || 0)}</td></tr>
        <tr><th>收藏数</th><td>${safe(report.favoriteCount || 0)}</td></tr>
        <tr><th>是否点踩</th><td>${report.isDislike ? '是' : '否'}</td></tr>
      </table>
    </section>
  </body>
</html>`;
  }
};