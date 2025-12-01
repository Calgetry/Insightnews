(function () {
  const labelMap = {
    like: '点赞',
    comment: '评论'
  };

  const defaultFilters = {
    search: '',
    category: '',
    sort: 'heat',
    minViews: 0,
    minLikes: 0,
    minComments: 0,
    newsRange: ''
  };

  const NEWS_RANGE_UI_TO_INTERNAL = {
    small: 'compact',
    medium: 'medium',
    large: 'rich',
    xlarge: 'massive'
  };

  const NEWS_RANGE_INTERNAL_TO_UI = {
    compact: 'small',
    medium: 'medium',
    rich: 'large',
    massive: 'xlarge'
  };

  const normalizeNewsRange = (value) => {
    if (!value) return '';
    return NEWS_RANGE_UI_TO_INTERNAL[value] || value;
  };

  const mapNewsRangeToUi = (value) => {
    if (!value) return '';
    return Object.prototype.hasOwnProperty.call(NEWS_RANGE_INTERNAL_TO_UI, value)
      ? NEWS_RANGE_INTERNAL_TO_UI[value]
      : value;
  };

  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const TopicsManager = {
    state: {
      topics: [],
      filteredTopics: [],
      selectedTopicId: null,
      selectedTopicIds: new Set(),
      filters: { ...defaultFilters },
      // null = follow default behavior; 'admin' = use /admin/topics; 'svc' = use topicService.list
      preferredListSource: null
    },
    topicApi: ((window.AppConfig && window.AppConfig.ENDPOINTS && window.AppConfig.ENDPOINTS.topicService) || {}),
    pendingHeaderNotice: null,
    _headerNoticeTimer: null,

    init() {
      if (!Auth.isLoggedIn()) {
        window.location.href = 'index.html';
        return;
      }

      this.detailRequests = {};
      this.pendingHeaderNotice = null;
      this._headerNoticeTimer = null;

      this.cacheDom();
      this.cacheModalDom();
      this.bindEvents();
      this.bindModalEvents();
      // 先探测后端可用性然后加载数据
      this.probeBackendAndRefresh();
    },

    async probeBackendAndRefresh(){
      const countItems = (payload) => {
        if (Array.isArray(payload)) return payload.length;
        if (Array.isArray(payload?.data)) return payload.data.length;
        if (Array.isArray(payload?.topics)) return payload.topics.length;
        if (Array.isArray(payload?.list)) return payload.list.length;
        if (Array.isArray(payload?.records)) return payload.records.length;
        return 0;
      };

      try {
        const endpoints = (window.AppConfig && window.AppConfig.ENDPOINTS) || {};
        const topicsCfg = endpoints.topics || {};
        const svcCfg = endpoints.topicService || {};
        const adminPath = topicsCfg.list || topicsCfg || '/admin/topics';
        const svcPath = svcCfg.list || svcCfg || '/topic';

        let svcPayload = null;
        let svcCount = 0;
        try {
          svcPayload = await window.api.request(svcPath, { method: 'GET', forceNetwork: true });
          svcCount = countItems(svcPayload);
        } catch (svcErr) {
          svcPayload = null;
        }

        if (svcPayload && svcCount > 0) {
          this.state.preferredListSource = 'svc';
          return;
        }

        let adminPayload = null;
        let adminCount = 0;
        try {
          adminPayload = await window.api.request(adminPath, { method: 'GET', forceNetwork: true });
          adminCount = countItems(adminPayload);
        } catch (adminErr) {
          adminPayload = null;
        }

        if (adminPayload && adminCount > 0) {
          this.state.preferredListSource = 'admin';
          return;
        }

        if (svcPayload) {
          // svc 接口可用但返回空数组，仍然默认使用 svc 防止无限回退
          this.state.preferredListSource = 'svc';
          return;
        }

        if (adminPayload) {
          this.state.preferredListSource = 'admin';
          return;
        }

        this.state.preferredListSource = null;
      } catch (e) {
        this.state.preferredListSource = null;
      } finally {
        // 无论如何都尝试加载数据，若后端不可用或返回空数组，会据实展示
        this.reloadData();
      }
    },

    cacheDom() {
      // 优先使用访话管理页面的元素ID，如果不存在则使用原ID
      this.topicListEl = document.getElementById('topicsList2') || document.getElementById('topicsList');
      this.topicHeaderEl = document.getElementById('topicsTopicHeader') || document.getElementById('topicHeader');
      this.newsContainerEl = document.getElementById('topicsNewsContainer') || document.getElementById('newsContainer');
      this.topicCountEl = document.getElementById('topicsTopicCountOverview') || document.getElementById('topicCountOverview') || document.getElementById('topicCount');
      this.newsCountEl = document.getElementById('topicsNewsCountOverview') || document.getElementById('newsCountOverview') || document.getElementById('newsCount');
      this.totalLikesEl = document.getElementById('topicsTotalLikesOverview') || document.getElementById('totalLikesOverview') || document.getElementById('totalLikes');
      this.filteredCountEl = document.getElementById('topicsFilteredCount') || document.getElementById('filteredCount');
      this.searchInput = document.getElementById('topicsTopicSearch') || document.getElementById('topicSearch');
      this.searchBtn = document.getElementById('topicsSearchBtn') || document.getElementById('searchBtn');
      this.filterToggleBtn = document.getElementById('topicsFilterToggle') || document.getElementById('filterToggle');
      this.filterPanel = document.getElementById('topicsFilterPanel') || document.getElementById('filterPanel');
      this.closeFilterBtn = document.getElementById('topicsCloseFilter') || document.getElementById('closeFilter');
      this.resetBtn = document.getElementById('topicsResetBtn') || document.getElementById('resetBtn');
      this.categorySelect = document.getElementById('topicsTopicCategoryFilter') || document.getElementById('topicCategoryFilter') || document.getElementById('filterTopicType');
      this.sortSelect = document.getElementById('topicsTopicSort') || document.getElementById('topicSort');
      this.minViewsInput = document.getElementById('topicsTopicMinViews') || document.getElementById('topicMinViews') || document.getElementById('filterMinViews');
      this.minLikesInput = document.getElementById('topicsTopicMinLikes') || document.getElementById('topicMinLikes') || document.getElementById('filterMinLikes');
      this.minCommentsInput = document.getElementById('topicsTopicMinComments') || document.getElementById('topicMinComments') || document.getElementById('filterMinComments');
      this.newsRangeSelect = document.getElementById('topicsTopicNewsRange') || document.getElementById('topicNewsRange') || document.getElementById('filterNewsCount');
      this.refreshBtn = document.getElementById('topicsRefreshBtn') || document.getElementById('refreshBtn');
      this.exportBtn = document.getElementById('topicsExportBtn2') || document.getElementById('topicsExportBtn');
      this.exportMenu = document.getElementById('topicsExportMenu2') || document.getElementById('topicsExportMenu');
      this.bulkDeleteBtn = document.getElementById('bulkDeleteTopicsBtn');
    },

    bindEvents() {
      if (this.searchInput) {
        this.searchInput.addEventListener('input', Utils.debounce(() => {
          this.state.filters.search = this.searchInput.value.trim();
          this.applyFilters();
        }, 250));
      }

      if (this.searchBtn) {
        this.searchBtn.addEventListener('click', () => {
          this.state.filters.search = this.searchInput?.value.trim() || '';
          this.applyFilters();
        });
      }

      if (this.categorySelect) {
        this.categorySelect.addEventListener('change', () => {
          this.state.filters.category = this.categorySelect.value;
          this.applyFilters();
        });
      }

      if (this.sortSelect) {
        this.sortSelect.addEventListener('change', () => {
          this.state.filters.sort = this.sortSelect.value;
          this.applyFilters();
        });
      }

      const numericMap = [
        { el: this.minViewsInput, key: 'minViews' },
        { el: this.minLikesInput, key: 'minLikes' },
        { el: this.minCommentsInput, key: 'minComments' }
      ];
      numericMap.forEach(({ el, key }) => {
        if (!el) return;
        el.addEventListener('input', () => {
          this.state.filters[key] = Number(el.value) || 0;
          this.applyFilters();
        });
      });

      if (this.newsRangeSelect) {
        this.newsRangeSelect.addEventListener('change', () => {
          const rawValue = this.newsRangeSelect.value;
          this.state.filters.newsRange = normalizeNewsRange(rawValue);
          this.applyFilters();
        });
      }

      if (this.filterToggleBtn && this.filterPanel) {
        this.filterToggleBtn.addEventListener('click', () => {
          this.filterPanel.classList.toggle('show');
        });
      }

      if (this.closeFilterBtn && this.filterPanel) {
        this.closeFilterBtn.addEventListener('click', () => {
          this.filterPanel.classList.remove('show');
        });
      }

      if (this.resetBtn) {
        this.resetBtn.addEventListener('click', () => this.resetFilters());
      }

      if (this.refreshBtn) {
        this.refreshBtn.addEventListener('click', () => {
          this.reloadData();
        });
      }

      if (this.bulkDeleteBtn) {
        this.bulkDeleteBtn.addEventListener('click', () => this.bulkDeleteSelectedTopics());
        this.updateBulkSelectionUI();
      }

      if (this.exportBtn && this.exportMenu) {
        this.exportBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleExportMenu();
        });

        this.exportMenu.addEventListener('click', (e) => {
          const item = e.target.closest('.dropdown-item');
          if (!item) return;
          e.preventDefault();
          this.handleExport(item.dataset.format);
          this.closeExportMenu();
        });

        this.boundCloseExportMenu = (event) => {
          if (!this.exportMenu.classList.contains('show')) return;
          if (this.exportBtn.contains(event.target) || this.exportMenu.contains(event.target)) return;
          this.closeExportMenu();
        };

        document.addEventListener('click', this.boundCloseExportMenu);
      }

      if (this.topicListEl) {
        this.topicListEl.addEventListener('click', (e) => {
          if (e.target && ((e.target.classList && e.target.classList.contains('topic-checkbox')) || e.target.closest('.topic-select'))) {
            return;
          }
          const card = e.target.closest('.topic-item');
          if (!card) return;
          const topicId = card.dataset.topicId;
          this.selectTopic(topicId);
        });

        this.topicListEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          const card = e.target.closest('.topic-item');
          if (!card) return;
          e.preventDefault();
          this.selectTopic(card.dataset.topicId);
        });

        this.topicListEl.addEventListener('change', (e) => {
          if (!e.target || !e.target.classList || !e.target.classList.contains('topic-checkbox')) return;
          e.stopPropagation();
          const topicId = e.target.dataset.topicId;
          this.toggleTopicSelection(topicId, e.target.checked);
        });
      }

      if (this.newsContainerEl) {
        this.newsContainerEl.addEventListener('click', (e) => {
          const toggle = e.target.closest('.news-toggle');
          if (!toggle) return;
          const card = toggle.closest('.news-card');
          if (!card) return;
          const detail = card.querySelector('.news-detail-body');
          const expanded = !card.classList.contains('expanded');
          card.classList.toggle('expanded', expanded);
          if (detail) detail.hidden = !expanded;
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          toggle.textContent = expanded ? '收起详情' : '查看详情';
        });
      }
    },

    async reloadData() {
      if (this.canUseTopicApi()) {
        try {
          const topicsFromApi = await this.fetchTopicsFromApi();
          // 将后端返回（包括空数组）视为真实响应，避免自动回退到 mock
          this.state.topics = Array.isArray(topicsFromApi) ? topicsFromApi : [];
          this.clearTopicSelections({ silent: true });
          this.afterTopicsLoaded();
          return;
        } catch (error) {
          console.warn('[Topics] 获取真实话题数据失败，使用本地 mock', error);
        }
      }

      this.state.topics = this.generateMockTopics(6);
      this.clearTopicSelections({ silent: true });
      this.afterTopicsLoaded();
    },

    afterTopicsLoaded() {
      this.applyFilters();
      this.updateOverview();
      this.populateCategoryFilterOptions();
      if (this.state.filteredTopics.length) {
        this.selectTopic(this.state.filteredTopics[0].id);
      } else {
        this.clearDetails();
      }
    },

    canUseTopicApi() {
      const flags = (window.AppConfig && window.AppConfig.FEATURE_FLAGS) || {};
      // 如果后端探测结果显示不可用，则不使用 API
      if (this.state.preferredListSource === null) {
        return false;
      }
      return Boolean(window.api && this.topicApi && this.topicApi.list && flags.USE_REAL_BACKEND !== false);
    },

    buildListQuery({ includeEmptyCategory = false } = {}) {
      const params = {};
      const { filters } = this.state;
      if (filters.category) {
        params.category = filters.category;
      } else if (includeEmptyCategory) {
        params.category = '';
      }
      return params;
    },

    getListEndpoint() {
      const keyword = this.state.filters.search?.trim();
      // 优先使用用户选择 / 探测出的 preferredListSource
      if (this.state.preferredListSource === 'svc') {
        if (keyword && this.topicApi.search) {
          return { path: this.topicApi.search, params: { keyword } };
        }
        return { path: this.topicApi.list, params: this.buildListQuery({ includeEmptyCategory: true }) };
      }

      if (this.state.preferredListSource === 'admin') {
        const topicsCfg = (window.AppConfig && window.AppConfig.ENDPOINTS && window.AppConfig.ENDPOINTS.topics) || {};
        const path = topicsCfg.list || topicsCfg || '/admin/topics';
        return { path, params: this.buildListQuery() };
      }

      // 默认行为：如果搜索关键词且 topicApi.search 可用则使用，否则使用 topicApi.list
      if (keyword && this.topicApi.search) {
        return { path: this.topicApi.search, params: { keyword } };
      }
      return { path: this.topicApi.list, params: this.buildListQuery({ includeEmptyCategory: true }) };
    },

    async fetchTopicsFromApi() {
      const endpoint = this.getListEndpoint();
      if (!endpoint.path) return [];
      
      try {
        const raw = await window.api.get(endpoint.path, endpoint.params || {});
        return this.normalizeTopicList(raw);
      } catch (error) {
        console.warn(`[Topics] API请求失败: ${endpoint.path}`, error);
        throw error; // 让上层处理回退逻辑
      }
    },

    normalizeTopicList(rawPayload) {
      let list = [];
      if (Array.isArray(rawPayload)) list = rawPayload;
      else if (Array.isArray(rawPayload?.data)) list = rawPayload.data;
      else if (Array.isArray(rawPayload?.topics)) list = rawPayload.topics;
      else if (Array.isArray(rawPayload?.list)) list = rawPayload.list;
      else if (Array.isArray(rawPayload?.records)) list = rawPayload.records;

      return list.map((item, index) => this.normalizeTopic(item, index)).filter(Boolean);
    },

    normalizeTopic(item = {}, index = 0) {
      const fallbackId = item.id || item.topicId || item.topicID || item._id || `topic-${Date.now()}-${index}`;
      const tags = Array.isArray(item.tags)
        ? item.tags
        : typeof item.tags === 'string'
          ? item.tags.split(',').map(tag => tag.trim()).filter(Boolean)
          : (Array.isArray(item.keywords) ? item.keywords : []);
      const newsList = this.normalizeNewsList(item.news || item.newsList || item.articles || item.latestNews);

      return {
        id: fallbackId,
        title: item.title || item.topicTitle || item.name || item.topicName || `热门话题 #${index + 1}`,
        summary: item.summary || item.description || item.brief || '暂无简介',
        category: item.category || item.type || '未分类',
        tags,
        heat: Number(item.heat || item.hotScore || item.score || item.popularity || 0),
        stats: {
          likes: Number(item.likes || item.likeCount || 0),
          comments: Number(item.comments || item.commentCount || 0)
        },
        createdAt: item.createdAt || item.publishTime || Date.now() - index * 3600 * 1000,
        news: newsList,
        _detailLoaded: Array.isArray(newsList) && newsList.length > 0
      };
    },

    normalizeNewsList(listLike) {
      if (!Array.isArray(listLike)) return [];
      return listLike.map((item, index) => {
        const stats = item.stats || {};
        const likes = Number(item.likes || item.likeCount || stats.likes || 0);
        const comments = Number(item.comments || item.commentCount || stats.comments || 0);
        const views = Number(item.views || item.viewCount || item.reads || stats.views || 0);
        return {
          id: item.id || item.newsId || item.articleId || `${Date.now()}-${index}`,
          title: item.title || item.newsTitle || item.articleTitle || `新闻 ${index + 1}`,
          summary: item.summary || item.description || item.brief || '',
          publishedAt: item.publishedAt || item.publishTime || item.time || Date.now() - index * 3600 * 1000,
          views,
          likes,
          comments,
          stats: {
            likes,
            comments
          }
        };
      });
    },

    async loadTopicDetail(topicId) {
      // 检查后端是否可用，如果不可用则直接返回
      if (!topicId || this.state.preferredListSource === null || !this.canUseTopicApi() || !this.topicApi.detail) {
        console.debug(`[Topics] 跳过加载话题详情，后端不可用或缺少必要参数`, {
          topicId,
          preferredListSource: this.state.preferredListSource,
          canUseTopicApi: this.canUseTopicApi(),
          hasDetailApi: !!this.topicApi.detail
        });
        return;
      }
      if (this.detailRequests[topicId]) return this.detailRequests[topicId];

      const topic = this.state.topics.find(t => String(t.id) === String(topicId));
      if (!topic) return;

      try {
        const request = window.api.get(typeof this.topicApi.detail === 'function'
          ? this.topicApi.detail(topicId)
          : `${this.topicApi.detail}/${topicId}`);
        this.detailRequests[topicId] = request;
        const payload = await request;
        const merged = this.normalizeTopicDetail(payload, topic, topicId);
        Object.assign(topic, merged, { _detailLoaded: true });
        if (String(this.state.selectedTopicId) === String(topicId)) {
          this.renderTopicHeader(topic);
          this.renderNews(topic);
        }
        try {
          if (typeof window.syncVisitTopicsForVisits === 'function') {
            window.syncVisitTopicsForVisits();
          }
        } catch (e) { /* ignore bridge errors */ }
      } catch (error) {
        console.warn(`[Topics] 获取话题 ${topicId} 详情失败`, error);
      } finally {
        delete this.detailRequests[topicId];
      }
    },

    normalizeTopicDetail(payload, topicFallback = {}, topicId) {
      const detail = payload?.data || payload?.topic || payload || {};
      const news = this.normalizeNewsList(detail.news || detail.newsList || detail.articles || detail.latestNews);
      return {
        id: detail.id || detail.topicId || topicFallback.id || topicId,
        title: detail.title || detail.topicTitle || detail.name || topicFallback.title,
        summary: detail.summary || detail.description || topicFallback.summary,
        category: detail.category || detail.type || topicFallback.category,
        tags: Array.isArray(detail.tags) && detail.tags.length ? detail.tags : topicFallback.tags,
        heat: Number(detail.heat || detail.hotScore || detail.score || topicFallback.heat || 0),
        stats: {
          likes: Number(detail.likes || detail.likeCount || topicFallback.stats?.likes || 0),
          comments: Number(detail.comments || detail.commentCount || topicFallback.stats?.comments || 0)
        },
        news: news.length ? news : topicFallback.news
      };
    },

    applyFilters() {
      const { search, category, sort, minViews, minLikes, minComments, newsRange } = this.state.filters;
      let result = [...this.state.topics];

      if (search) {
        const keyword = search.toLowerCase();
        result = result.filter((topic) => {
          return (
            topic.title.toLowerCase().includes(keyword) ||
            topic.tags.some((tag) => tag.toLowerCase().includes(keyword))
          );
        });
      }

      if (category) {
        result = result.filter((topic) => topic.category === category);
      }

      if (minViews) {
        result = result.filter((topic) => this.sumViews(topic) >= minViews);
      }

      if (minLikes) {
        result = result.filter((topic) => this.sumLikes(topic) >= minLikes);
      }

      if (minComments) {
        result = result.filter((topic) => this.sumComments(topic) >= minComments);
      }


      if (newsRange) {
        result = result.filter((topic) => {
          const count = this.getNewsCount(topic);
          if (newsRange === 'compact') return count >= 1 && count <= 3;
          if (newsRange === 'medium') return count >= 4 && count <= 6;
          if (newsRange === 'rich') return count >= 7 && count <= 9;
          if (newsRange === 'massive') return count >= 10;
          return true;
        });
      }

      if (sort === 'heat') {
        result.sort((a, b) => b.heat - a.heat);
      } else if (sort === 'latest') {
        result.sort((a, b) => b.createdAt - a.createdAt);
      }

      this.state.filteredTopics = result;
      this.syncSelectionWithCurrentTopics();
      this.renderTopics();
      this.updateBulkSelectionUI();
      if (this.filteredCountEl) {
        this.filteredCountEl.textContent = `${result.length} 个结果`;
      }

      if (!result.some((topic) => topic.id === this.state.selectedTopicId)) {
        this.state.selectedTopicId = null;
      }

      if (!this.state.selectedTopicId && result.length) {
        this.selectTopic(result[0].id);
      } else if (!result.length) {
        this.clearDetails('未找到满足条件的话题');
      }
    },

    renderTopics() {
      if (!this.topicListEl) return;
      if (!this.state.filteredTopics.length) {
        this.topicListEl.innerHTML = '<div class="topic-empty">暂无话题</div>';
        return;
      }

      this.topicListEl.innerHTML = this.state.filteredTopics
        .map((topic, index) => {
          const topicId = String(topic.id);
          const isActive = String(topic.id) === String(this.state.selectedTopicId);
          const isSelected = this.state.selectedTopicIds.has(topicId);
          const classes = ['topic-item'];
          if (isActive) classes.push('active');
          if (isSelected) classes.push('selected');
          return `
            <div class="${classes.join(' ')}" data-topic-id="${Utils.escapeHtml(topicId)}" role="listitem" tabindex="0">
              <label class="topic-select" aria-label="选择话题">
                <input type="checkbox" class="topic-checkbox" data-topic-id="${Utils.escapeHtml(topicId)}" ${isSelected ? 'checked' : ''} />
                <span class="topic-checkbox-visual"></span>
              </label>
              <div class="topic-rank">${index + 1}</div>
              <div class="topic-content">
                <div class="topic-name">${Utils.escapeHtml(topic.title)}</div>
                <div class="topic-meta">${topic.category} · ${(Array.isArray(topic.news) ? topic.news.length : 0)} 篇 · 热度 ${topic.heat}</div>
                <div class="topic-meta">点赞 ${this.sumLikes(topic)} · 评论 ${this.sumComments(topic)}</div>
              </div>
              <div class="topic-arrow">查看 &gt;</div>
            </div>
          `;
        })
        .join('');
    },

    toggleTopicSelection(topicId, isSelected) {
      if (!topicId) return;
      const normalizedId = String(topicId);
      if (isSelected) {
        this.state.selectedTopicIds.add(normalizedId);
      } else {
        this.state.selectedTopicIds.delete(normalizedId);
      }
      this.updateBulkSelectionUI();
      this.renderTopics();
    },

    clearTopicSelections({ silent = false } = {}) {
      if (!this.state.selectedTopicIds.size) return;
      this.state.selectedTopicIds.clear();
      if (!silent) {
        this.updateBulkSelectionUI();
        this.renderTopics();
      }
    },

    syncSelectionWithCurrentTopics() {
      if (!this.state.selectedTopicIds.size) return;
      const validIds = new Set(
        (this.state.filteredTopics || []).map((topic) => String(topic.id))
      );
      let changed = false;
      this.state.selectedTopicIds.forEach((id) => {
        if (!validIds.has(String(id))) {
          this.state.selectedTopicIds.delete(id);
          changed = true;
        }
      });
      if (changed) {
        this.updateBulkSelectionUI();
      }
    },

    updateBulkSelectionUI() {
      if (!this.bulkDeleteBtn) return;
      if (this.bulkDeleteBtn.classList.contains('loading')) {
        return;
      }
      const count = this.state.selectedTopicIds.size;
      const labelEl = this.bulkDeleteBtn.querySelector('.btn-label');
      const countEl = this.bulkDeleteBtn.querySelector('.count-pill');
      const baseLabel = this.bulkDeleteBtn.dataset.baseLabel || '删除';
      if (labelEl) {
        labelEl.textContent = baseLabel;
      }
      if (countEl) {
        countEl.textContent = count;
        countEl.hidden = count === 0;
      }
      this.bulkDeleteBtn.disabled = count === 0;
    },

    setBulkDeleteLoading(isLoading) {
      if (!this.bulkDeleteBtn) return;
      const labelEl = this.bulkDeleteBtn.querySelector('.btn-label');
      const baseLabel = this.bulkDeleteBtn.dataset.baseLabel || '删除';
      if (isLoading) {
        this.bulkDeleteBtn.classList.add('loading');
        this.bulkDeleteBtn.disabled = true;
        if (labelEl) labelEl.textContent = '删除中...';
        return;
      }
      this.bulkDeleteBtn.classList.remove('loading');
      if (labelEl) labelEl.textContent = baseLabel;
      this.updateBulkSelectionUI();
    },

    async bulkDeleteSelectedTopics() {
      if (!this.state.selectedTopicIds.size) {
        return;
      }
      if (!this.bulkDeleteBtn) {
        window.alert('批量删除按钮未初始化，无法继续。');
        return;
      }
      const ids = Array.from(this.state.selectedTopicIds);
      const confirmed = window.confirm(`确定要删除选中的 ${ids.length} 个话题吗？此操作无法撤销。`);
      if (!confirmed) return;
      if (!window.api || typeof window.api.delete !== 'function') {
        window.alert('接口未初始化，无法删除话题。');
        return;
      }

      this.setBulkDeleteLoading(true);
      const failed = [];
      const payload = { code: 200, msg: '话题删除成功', data: '话题删除成功' };

      for (const id of ids) {
        try {
          const endpoint = this.getDeleteEndpoint(id);
          await window.api.delete(endpoint, { body: payload, forceNetwork: true, timeout: 15000 });
          this.state.selectedTopicIds.delete(String(id));
          this.removeTopicFromState(id);
        } catch (err) {
          console.warn('[Topics] 批量删除失败：', err);
          failed.push(id);
        }
      }

      this.setBulkDeleteLoading(false);
      this.updateBulkSelectionUI();
      this.renderTopics();

      if (failed.length) {
        window.alert(`部分话题删除失败 (${failed.length}/${ids.length})，请稍后重试。`);
      } else {
        window.alert(`成功删除 ${ids.length} 个话题。`);
      }
    },

    selectTopic(topicId) {
      const topic = this.state.filteredTopics.find((t) => String(t.id) === String(topicId));
      if (!topic) {
        this.clearDetails();
        return;
      }
      this.state.selectedTopicId = topic.id;
      this.renderTopics();
      this.renderTopicHeader(topic);
      this.renderNews(topic);
      // 只有在后端可用且话题详情未加载时才尝试加载详情
      if (this.state.preferredListSource !== null && this.canUseTopicApi() && !topic._detailLoaded) {
          this.loadTopicDetail(topic.id);
      }
      // 尝试同步到 VisitManager（桥接）：将话题适配为 VisitManager 期望的结构并调用展示函数
      try {
        if (window.VisitManager && typeof window.VisitManager.showTopicDetail === 'function') {
          const adapted = {
            id: topic.id,
            name: topic.title || topic.name || topic.topicTitle || (`话题 ${topic.id}`),
            news: (Array.isArray(topic.news) ? topic.news : []).map(n => ({
              id: n.id || n.newsId || n.articleId,
              title: n.title || n.newsTitle || n.articleTitle || '',
              views: n.views || 0,
              likes: n.likes || n.stats?.likes || 0,
              comments: n.comments || n.stats?.comments || 0
            }))
          };
          window.VisitManager.showTopicDetail(adapted);
        }
      } catch (err) {
        // 不要抛出错误，桥接为可选增强
        console.debug('[Topics] bridge to VisitManager failed', err);
      }
    },

    renderTopicHeader(topic) {
      if (!this.topicHeaderEl) return;
      const newsList = Array.isArray(topic.news) ? topic.news : [];
      const totalLikes = this.sumLikes(topic);
      const totalComments = this.sumComments(topic);
      const totalNews = this.getNewsCount(topic);
      const createdAtText = Utils.formatTime(topic.createdAt, 'full');

      this.topicHeaderEl.classList.remove('empty-state');
      this.topicHeaderEl.innerHTML = `
        <div class="topic-header-bar">
          <div>
            <h2>${Utils.escapeHtml(topic.title)}</h2>
            <p>${Utils.escapeHtml(topic.summary)}</p>
          </div>
          <div class="topic-action-stack">
            <div class="topic-created-pill" aria-label="创建时间">
              <span>创建时间</span>
              <strong>${createdAtText}</strong>
            </div>
          </div>
        </div>
        <div class="topic-inline-notice" role="status" aria-live="polite"></div>
        <div class="topic-stat-grid">
          ${this.renderTopicStat('关联新闻', totalNews)}
          ${this.renderTopicStat('点赞', totalLikes)}
          ${this.renderTopicStat('评论', totalComments)}
        </div>
      `;
      this.bindTopicHeaderActions(topic);
      this.applyPendingHeaderNotice();
    },

    bindTopicHeaderActions(topic) {
      if (!topic || !this.topicHeaderEl) return;
      const deleteBtn = this.topicHeaderEl.querySelector('.topic-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this.promptDeleteTopic(topic));
      }
    },

    setDeleteButtonLoading(button, isLoading) {
      if (!button) return;
      const label = button.querySelector('.label');
      if (isLoading) {
        button.disabled = true;
        button.classList.add('loading');
        if (label) {
          label.textContent = '删除中...';
        }
      } else {
        button.disabled = false;
        button.classList.remove('loading');
        if (label) {
          const fallback = button.dataset.defaultLabel || '删除话题';
          label.textContent = fallback;
        }
      }
    },

    promptDeleteTopic(topic) {
      if (!topic) return;
      const title = topic.title || topic.name || topic.id;
      const confirmed = window.confirm(`确定要删除话题“${title}”吗？删除后将无法恢复。`);
      if (!confirmed) return;
      this.executeTopicDelete(topic);
    },

    async executeTopicDelete(topic) {
      const topicId = topic && topic.id;
      if (!topicId) {
        this.showTopicInlineNotice('未找到话题标识，无法删除。', 'error');
        return;
      }

      if (!window.api || typeof window.api.delete !== 'function') {
        this.showTopicInlineNotice('接口未初始化，无法删除。', 'error');
        return;
      }

      const deleteBtn = this.topicHeaderEl?.querySelector('.topic-delete-btn') || null;
      this.setDeleteButtonLoading(deleteBtn, true);
      this.showTopicInlineNotice('正在删除话题...', 'info');

      const endpoint = this.getDeleteEndpoint(topicId);
      const payload = { code: 200, msg: '话题删除成功', data: '话题删除成功' };

      try {
        await window.api.delete(endpoint, { body: payload, forceNetwork: true, timeout: 15000 });
        this.setPendingHeaderNotice('话题删除成功', 'success');
        const hasRemaining = this.removeTopicFromState(topicId);
        if (!hasRemaining) {
          this.pendingHeaderNotice = null;
        }
      } catch (error) {
        const message = error && error.message ? error.message : '删除失败';
        this.showTopicInlineNotice(`删除失败：${message}`, 'error');
      } finally {
        this.setDeleteButtonLoading(deleteBtn, false);
      }
    },

    getDeleteEndpoint(topicId) {
      if (this.topicApi) {
        if (typeof this.topicApi.delete === 'function') {
          return this.topicApi.delete(topicId);
        }
        if (typeof this.topicApi.deleteTopic === 'function') {
          return this.topicApi.deleteTopic(topicId);
        }
        if (typeof this.topicApi.delete === 'string') {
          return `${this.topicApi.delete}/${encodeURIComponent(topicId)}`;
        }
        if (typeof this.topicApi.deleteTopic === 'string') {
          return `${this.topicApi.deleteTopic}/${encodeURIComponent(topicId)}`;
        }
      }
      return `/topic/delete/topic/${encodeURIComponent(topicId)}`;
    },

    removeTopicFromState(topicId) {
      const currentList = Array.isArray(this.state.topics) ? this.state.topics : [];
      this.state.topics = currentList.filter((topic) => String(topic.id) !== String(topicId));
      const hasTopics = this.state.topics.length > 0;

      if (hasTopics) {
        this.applyFilters();
      } else {
        this.state.filteredTopics = [];
        if (this.topicListEl) {
          this.topicListEl.innerHTML = '<div class="topic-empty">暂无话题</div>';
        }
        this.clearDetails('话题删除成功，目前暂无话题，请创建或刷新数据。');
      }

      this.updateOverview();
      try {
        if (typeof window.syncVisitTopicsForVisits === 'function') {
          window.syncVisitTopicsForVisits();
        }
      } catch (err) {
        console.debug('syncVisitTopicsForVisits failed', err);
      }
      return hasTopics;
    },

    setPendingHeaderNotice(message, type = 'info') {
      if (!message) {
        this.pendingHeaderNotice = null;
        return;
      }
      this.pendingHeaderNotice = { message, type };
    },

    applyPendingHeaderNotice() {
      if (!this.pendingHeaderNotice) {
        this.showTopicInlineNotice('');
        return;
      }
      this.showTopicInlineNotice(this.pendingHeaderNotice.message, this.pendingHeaderNotice.type);
      this.pendingHeaderNotice = null;
    },

    populateCategoryFilterOptions() {
      const select = document.getElementById('filterTopicType') || this.categorySelect;
      if (!select) return;
      const categories = new Set();
      (this.state.topics || []).forEach((topic) => {
        if (topic && topic.category) categories.add(topic.category);
      });
      const preservedValue = select.value;
      const doc = select.ownerDocument || document;
      select.innerHTML = '';
      const defaultOption = doc.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '全部话题';
      select.appendChild(defaultOption);
      Array.from(categories).sort().forEach((category) => {
        const option = doc.createElement('option');
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
      });
      if (preservedValue && categories.has(preservedValue)) {
        select.value = preservedValue;
      }
    },

    showTopicInlineNotice(message = '', type = 'info') {
      if (!this.topicHeaderEl) return;
      const notice = this.topicHeaderEl.querySelector('.topic-inline-notice');
      if (!notice) return;
      notice.classList.remove('show', 'success', 'error');
      if (!message) {
        notice.textContent = '';
        return;
      }
      notice.textContent = message;
      if (type === 'success') {
        notice.classList.add('success');
      } else if (type === 'error') {
        notice.classList.add('error');
      }
      notice.classList.add('show');
      if (this._headerNoticeTimer) {
        clearTimeout(this._headerNoticeTimer);
      }
      this._headerNoticeTimer = setTimeout(() => {
        notice.classList.remove('show', 'success', 'error');
        notice.textContent = '';
      }, 4000);
    },

    renderTopicStat(label, value) {
      return `
        <div class="topic-stat">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `;
    },

    renderNews(topic) {
      if (!this.newsContainerEl) return;
      const newsList = Array.isArray(topic.news) ? topic.news : [];
      if (!newsList.length) {
        this.newsContainerEl.classList.add('empty-state');
        const message = this.canUseTopicApi() && !topic._detailLoaded
          ? '正在从真实接口加载话题详情...' : '该话题暂时没有新闻内容';
        this.newsContainerEl.innerHTML = `<p>${message}</p>`;
        return;
      }

      this.newsContainerEl.classList.remove('empty-state');
      this.newsContainerEl.innerHTML = newsList
        .map((news) => {
          const stats = news.stats;
          const detailId = `${news.id}-detail`;
          return `
            <article class="news-card" data-news-id="${news.id}">
              <header class="news-card-header">
                <div>
                  <h3>${Utils.escapeHtml(news.title)}</h3>
                  <div class="news-meta">发布于 ${Utils.formatTime(news.publishedAt, 'full')}</div>
                </div>
                <button class="news-toggle" aria-expanded="false" aria-controls="${detailId}" type="button">查看详情</button>
              </header>
              <div class="news-preview">
                <p class="news-summary">${Utils.escapeHtml(news.summary)}</p>
                <div class="news-preview-quick">
                  <span>👍 ${stats.likes}</span>
                  <span>💬 ${stats.comments}</span>
                </div>
              </div>
              <div class="news-detail-body" id="${detailId}" hidden>
                <div class="news-detail-section">
                  <div class="section-title">互动概览</div>
                  <div class="news-stats">
                    ${this.renderStatBlock('点赞', stats.likes)}
                    ${this.renderStatBlock('评论', stats.comments)}
                  </div>
                </div>
                <div class="news-detail-section">
                  <div class="section-title">用户互动时间线</div>
                  ${this.renderEngagement(news.interactions)}
                </div>
              </div>
            </article>
          `;
        })
        .join('');
    },

    renderStatBlock(label, value) {
      return `
        <div class="stat-block">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `;
    },

    renderEngagement(interactions) {
      if (!Array.isArray(interactions) || interactions.length === 0) {
        return '<div class="empty-state">暂无互动记录</div>';
      }

      const items = interactions
        .map((item) => {
          return `
            <li class="engagement-item">
              <span class="event-badge ${item.type}">${labelMap[item.type] || item.type}</span>
              <div>
                <div><strong>${Utils.escapeHtml(item.user)}</strong> · ${Utils.escapeHtml(item.detail)}</div>
                <time>${Utils.formatTime(item.time, 'full')}</time>
              </div>
            </li>
          `;
        })
        .join('');

      return `<ul class="engagement-list">${items}</ul>`;
    },

    clearDetails(message = '请选择左侧话题') {
      if (this.topicHeaderEl) {
        this.topicHeaderEl.classList.add('empty-state');
        this.topicHeaderEl.innerHTML = `<p>${message}</p>`;
      }
      if (this.newsContainerEl) {
        this.newsContainerEl.classList.add('empty-state');
        this.newsContainerEl.innerHTML = '<p>暂无数据</p>';
      }
    }
    ,
    updateOverview() {
      if (!this.topicCountEl || !this.newsCountEl || !this.totalLikesEl) return;
      const topics = this.state.topics;
      const newsViews = topics.reduce((sum, topic) => sum + this.sumViews(topic), 0);
      const newsCount = topics.reduce((sum, topic) => sum + this.getNewsCount(topic), 0);
      const totalLikes = topics.reduce((sum, topic) => sum + this.sumLikes(topic), 0);
      const totalComments = topics.reduce((sum, topic) => sum + this.sumComments(topic), 0);

      this.topicCountEl.textContent = topics.length;
      this.newsCountEl.textContent = newsCount;
      this.totalLikesEl.textContent = totalLikes;
      this.totalLikesEl.setAttribute('title', `累计评论 ${totalComments} · 累计浏览 ${newsViews}`);
    },

    sumViews(topic = {}) {
      const list = Array.isArray(topic.news) ? topic.news : [];
      const total = list.reduce((sum, news) => sum + toNumber(news.views ?? news.stats?.views ?? news.viewCount), 0);
      if (total > 0 || list.length) return total;
      const fallbacks = [topic.stats?.views, topic.views, topic.viewCount, topic.totalViews, topic.metrics?.views];
      for (const value of fallbacks) {
        const parsed = toNumber(value);
        if (parsed > 0) return parsed;
      }
      return 0;
    },

    sumLikes(topic = {}) {
      const list = Array.isArray(topic.news) ? topic.news : [];
      const total = list.reduce((sum, news) => sum + toNumber(news.stats?.likes ?? news.likes), 0);
      if (total > 0 || list.length) return total;
      const fallbacks = [topic.stats?.likes, topic.likes, topic.likeCount, topic.totalLikes];
      for (const value of fallbacks) {
        const parsed = toNumber(value);
        if (parsed > 0) return parsed;
      }
      return 0;
    },

    sumComments(topic = {}) {
      const list = Array.isArray(topic.news) ? topic.news : [];
      const total = list.reduce((sum, news) => sum + toNumber(news.stats?.comments ?? news.comments), 0);
      if (total > 0 || list.length) return total;
      const fallbacks = [topic.stats?.comments, topic.comments, topic.commentCount, topic.totalComments];
      for (const value of fallbacks) {
        const parsed = toNumber(value);
        if (parsed > 0) return parsed;
      }
      return 0;
    },

    sumDislikes(topic = {}) {
      const list = Array.isArray(topic.news) ? topic.news : [];
      const total = list.reduce((sum, news) => sum + toNumber(news.stats?.dislikes ?? news.dislikes), 0);
      if (total > 0 || list.length) return total;
      const fallbacks = [topic.stats?.dislikes, topic.dislikes, topic.dislikeCount];
      for (const value of fallbacks) {
        const parsed = toNumber(value);
        if (parsed > 0) return parsed;
      }
      return 0;
    },

    sumReports(topic = {}) {
      const list = Array.isArray(topic.news) ? topic.news : [];
      const total = list.reduce((sum, news) => sum + toNumber(news.stats?.reports ?? news.reports), 0);
      if (total > 0 || list.length) return total;
      const fallbacks = [topic.stats?.reports, topic.reports, topic.reportCount, topic.totalReports];
      for (const value of fallbacks) {
        const parsed = toNumber(value);
        if (parsed > 0) return parsed;
      }
      return 0;
    },

    getNewsCount(topic = {}) {
      if (Array.isArray(topic.news)) return topic.news.length;
      const candidateKeys = ['newsCount', 'articleCount', 'articlesCount', 'totalNews', 'totalArticles'];
      for (const key of candidateKeys) {
        if (key in (topic || {})) {
          const parsed = toNumber(topic[key]);
          if (parsed > 0) return parsed;
        }
      }
      const statsCount = toNumber(topic.stats?.newsCount || topic.stats?.articles || topic.stats?.articlesCount);
      return statsCount > 0 ? statsCount : 0;
    },

    resetFilters() {
      this.state.filters = { ...defaultFilters };
      if (this.searchInput) this.searchInput.value = '';
      if (this.categorySelect) this.categorySelect.value = '';
      if (this.sortSelect) this.sortSelect.value = 'heat';
      if (this.minLikesInput) this.minLikesInput.value = '';
      if (this.minCommentsInput) this.minCommentsInput.value = '';
      if (this.minViewsInput) this.minViewsInput.value = '';
      if (this.newsRangeSelect) {
        if (this.newsRangeSelect.querySelector('option[value=""]')) {
          this.newsRangeSelect.value = '';
        } else {
          this.newsRangeSelect.selectedIndex = 0;
        }
      }
      if (this.filterPanel) this.filterPanel.classList.remove('show');
      this.applyFilters();
    }

    ,

    applyExternalFilters(partial = {}) {
      if (!partial || typeof partial !== 'object') return;
      const merged = { ...this.state.filters };

      if (Object.prototype.hasOwnProperty.call(partial, 'search')) {
        merged.search = String(partial.search || '').trim();
        if (this.searchInput) this.searchInput.value = merged.search;
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'category')) {
        merged.category = partial.category || '';
        if (this.categorySelect) this.categorySelect.value = merged.category;
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'sort')) {
        merged.sort = partial.sort || 'heat';
        if (this.sortSelect) this.sortSelect.value = merged.sort;
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'minViews')) {
        const value = Number(partial.minViews);
        merged.minViews = Number.isFinite(value) && value > 0 ? value : 0;
        if (this.minViewsInput) this.minViewsInput.value = merged.minViews ? merged.minViews : '';
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'minLikes')) {
        const value = Number(partial.minLikes);
        merged.minLikes = Number.isFinite(value) && value > 0 ? value : 0;
        if (this.minLikesInput) this.minLikesInput.value = merged.minLikes ? merged.minLikes : '';
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'minComments')) {
        const value = Number(partial.minComments);
        merged.minComments = Number.isFinite(value) && value > 0 ? value : 0;
        if (this.minCommentsInput) this.minCommentsInput.value = merged.minComments ? merged.minComments : '';
      }

      if (Object.prototype.hasOwnProperty.call(partial, 'newsRange')) {
        const normalized = normalizeNewsRange(partial.newsRange || '');
        merged.newsRange = normalized;
        if (this.newsRangeSelect) {
          const uiValue = mapNewsRangeToUi(normalized);
          if (uiValue && this.newsRangeSelect.querySelector(`option[value="${uiValue}"]`)) {
            this.newsRangeSelect.value = uiValue;
          } else if (this.newsRangeSelect.querySelector(`option[value="${normalized}"]`)) {
            this.newsRangeSelect.value = normalized;
          } else {
            this.newsRangeSelect.value = '';
          }
        }
      }

      this.state.filters = merged;
      this.applyFilters();
    }
    ,
    toggleExportMenu() {
      if (!this.exportMenu) return;
      const isOpen = this.exportMenu.classList.contains('show');
      if (isOpen) {
        this.closeExportMenu();
      } else {
        this.exportMenu.classList.add('show');
      }
    },

    closeExportMenu() {
      if (!this.exportMenu) return;
      this.exportMenu.classList.remove('show');
    },

    handleExport(format) {
      if (format === 'excel') {
        this.exportReportExcel();
        return;
      }
      if (format === 'csv') {
        this.exportReportCsv();
        return;
      }
      this.exportReport();
    },

    collectActiveFilters() {
      const filters = { ...(this.state.filters || {}) };
      const active = {};
      Object.entries(filters).forEach(([key, value]) => {
        const isNumber = typeof value === 'number';
        if ((isNumber && value > 0) || (!isNumber && value)) {
          active[key] = value;
        }
      });
      return { filters, active };
    },

    formatExportTime(value) {
      if (!value) return '-';
      try {
        return Utils.formatTime(value, 'full');
      } catch (e) {
        const date = value instanceof Date ? value : new Date(value);
        return isNaN(date.getTime()) ? '-' : date.toISOString();
      }
    },

    mapNewsForExport(topic, news) {
      if (!news) return null;
      const likes = Number(news.stats?.likes ?? news.likes ?? 0);
      const comments = Number(news.stats?.comments ?? news.comments ?? 0);
      const views = Number(news.views ?? news.stats?.views ?? 0);
      const interactionsCount = Array.isArray(news.interactions) ? news.interactions.length : Number(news.interactionsCount || news.stats?.interactions || 0) || 0;
      return {
        topicId: topic.id,
        topicTitle: topic.title,
        id: news.id,
        title: news.title,
        summary: news.summary || '',
        likes,
        comments,
        views,
        interactions: interactionsCount,
        publishedAt: news.publishedAt || null
      };
    },

    getExportSnapshot() {
      const list = this.state.filteredTopics.length ? this.state.filteredTopics : this.state.topics;
      const { filters, active } = this.collectActiveFilters();
      const generatedAt = new Date();

      const topics = list.map((topic) => {
        const newsList = Array.isArray(topic.news) ? topic.news : [];
        const likes = this.sumLikes(topic);
        const comments = this.sumComments(topic);
        const newsCount = this.getNewsCount(topic);
        return {
          id: topic.id,
          title: topic.title,
          category: topic.category,
          summary: topic.summary || '',
          tags: Array.isArray(topic.tags) ? topic.tags : [],
          heat: Number(topic.heat) || 0,
          newsCount,
          likes,
          comments,
          createdAt: topic.createdAt || null,
          news: newsList.map((news) => this.mapNewsForExport(topic, news)).filter(Boolean)
        };
      });

      const totals = topics.reduce((acc, topic) => {
        acc.newsCount += topic.newsCount;
        acc.totalLikes += topic.likes;
        acc.totalComments += topic.comments;
        acc.totalHeat += topic.heat;
        return acc;
      }, { newsCount: 0, totalLikes: 0, totalComments: 0, totalHeat: 0 });

      const stats = {
        topicCount: topics.length,
        newsCount: totals.newsCount,
        totalLikes: totals.totalLikes,
        totalComments: totals.totalComments,
        avgHeat: topics.length ? Number((totals.totalHeat / topics.length).toFixed(1)) : 0
      };

      return { generatedAt, filters, activeFilters: active, stats, topics };
    },

    exportReport() {
      const snapshot = this.getExportSnapshot();
      if (!snapshot.topics.length) {
        alert('暂无话题可导出');
        return;
      }

      const payload = {
        generatedAt: snapshot.generatedAt.toISOString(),
        filters: snapshot.filters,
        activeFilters: snapshot.activeFilters,
        stats: snapshot.stats,
        topics: snapshot.topics
      };
      const filename = `topics_report_${snapshot.generatedAt.toISOString().slice(0, 10)}`;
      Utils.downloadData(JSON.stringify(payload, null, 2), `${filename}.json`);
      alert('话题报告已导出（JSON）。');
    },

    exportReportCsv() {
      const snapshot = this.getExportSnapshot();
      if (!snapshot.topics.length) {
        alert('暂无话题可导出');
        return;
      }

      const overviewHeader = [
        '话题ID',
        '话题标题',
        '类别',
        '关联新闻',
        '热度',
        '累计点赞',
        '累计评论',
        '标签',
        '创建时间'
      ];

      const newsHeader = [
        '话题ID',
        '话题标题',
        '新闻ID',
        '新闻标题',
        '摘要',
        '浏览量',
        '点赞',
        '评论',
        '互动记录',
        '发布时间'
      ];

      const rows = [];
      rows.push(['导出时间', this.formatExportTime(snapshot.generatedAt)]);
      rows.push(['话题数量', snapshot.stats.topicCount]);
      rows.push(['新闻数量', snapshot.stats.newsCount]);
      rows.push(['累计点赞', snapshot.stats.totalLikes]);
      rows.push(['累计评论', snapshot.stats.totalComments]);
      if (Object.keys(snapshot.activeFilters).length) {
        rows.push([]);
        rows.push(['筛选条件', '值']);
        Object.entries(snapshot.activeFilters).forEach(([key, value]) => {
          rows.push([key, value]);
        });
      }

      rows.push([]);
      rows.push(['=== 话题概览 ===']);
      rows.push(overviewHeader);
      snapshot.topics.forEach((topic) => {
        rows.push([
          topic.id,
          topic.title,
          topic.category,
          topic.newsCount,
          topic.heat,
          topic.likes,
          topic.comments,
          topic.tags.join(' / '),
          this.formatExportTime(topic.createdAt)
        ]);
      });

      rows.push([]);
      rows.push(['=== 新闻详情 ===']);
      rows.push(newsHeader);
      snapshot.topics.forEach((topic) => {
        topic.news.forEach((news) => {
          rows.push([
            topic.id,
            topic.title,
            news.id,
            news.title,
            news.summary,
            news.views,
            news.likes,
            news.comments,
            news.interactions,
            this.formatExportTime(news.publishedAt)
          ]);
        });
      });

      const csv = rows
        .map((row) => row.map((value) => this.csvEscape(value)).join(','))
        .join('\n');

      const filename = `topics_report_${snapshot.generatedAt.toISOString().slice(0, 10)}.csv`;
      Utils.downloadData(csv, filename, 'text/csv;charset=utf-8');
      alert('话题报告已导出（CSV）。');
    },

    exportReportExcel() {
      if (typeof XLSX === 'undefined') {
        alert('Excel 导出库未加载，请刷新页面后重试。');
        return;
      }

      const snapshot = this.getExportSnapshot();

      if (!snapshot.topics.length) {
        alert('暂无话题可导出');
        return;
      }

      const overviewRows = [[
        '话题ID',
        '话题标题',
        '类别',
        '关联新闻',
        '热度',
        '累计点赞',
        '累计评论',
        '标签',
        '创建时间'
      ]];

      const newsRows = [[
        '话题ID',
        '话题标题',
        '新闻ID',
        '新闻标题',
        '摘要',
        '浏览量',
        '点赞',
        '评论',
        '互动记录',
        '发布时间'
      ]];

      snapshot.topics.forEach((topic) => {
        overviewRows.push([
          topic.id,
          topic.title,
          topic.category,
          topic.newsCount,
          topic.heat,
          topic.likes,
          topic.comments,
          topic.tags.join(', '),
          this.formatExportTime(topic.createdAt)
        ]);

        topic.news.forEach((news) => {
          newsRows.push([
            topic.id,
            topic.title,
            news.id,
            news.title,
            news.summary,
            news.views,
            news.likes,
            news.comments,
            news.interactions,
            this.formatExportTime(news.publishedAt)
          ]);
        });
      });

      const metadataRows = [
        ['导出时间', this.formatExportTime(snapshot.generatedAt)],
        ['话题数量', snapshot.stats.topicCount],
        ['新闻数量', snapshot.stats.newsCount],
        ['累计点赞', snapshot.stats.totalLikes],
        ['累计评论', snapshot.stats.totalComments],
        ['平均热度', snapshot.stats.avgHeat]
      ];
      if (Object.keys(snapshot.activeFilters).length) {
        metadataRows.push([]);
        metadataRows.push(['筛选条件']);
        Object.entries(snapshot.activeFilters).forEach(([key, value]) => {
          metadataRows.push([`${key}`, `${value}`]);
        });
      }

      const wb = XLSX.utils.book_new();

      const metaSheet = XLSX.utils.aoa_to_sheet(metadataRows);
      metaSheet['!cols'] = [
        { wch: 14 },
        { wch: 42 }
      ];

      const overviewSheet = XLSX.utils.aoa_to_sheet(overviewRows);
      overviewSheet['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 10 },
        { wch: 12 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 24 },
        { wch: 22 }
      ];

      const newsSheet = XLSX.utils.aoa_to_sheet(newsRows);
      newsSheet['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 16 },
        { wch: 32 },
        { wch: 36 },
        { wch: 12 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 22 }
      ];

      XLSX.utils.book_append_sheet(wb, metaSheet, '导出摘要');
      XLSX.utils.book_append_sheet(wb, overviewSheet, '话题概览');
      XLSX.utils.book_append_sheet(wb, newsSheet, '新闻详情');

      const filename = `topics_report_${snapshot.generatedAt.toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      alert('话题报告已导出（Excel）。');
    },

    csvEscape(value) {
      if (value === undefined || value === null) return '';
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    },

    generateMockTopics(count = 5) {
      const categories = ['科技', '财经', '社会', '国际', '文娱'];
      const tags = ['AI', '新能源', '资本市场', '城市治理', '隐私保护', '明星动态', '宏观经济', '绿色出行'];
      const users = ['张伟', '王芳', '李雷', '赵敏', '陈曦', '刘畅', '孙瑜', '周楠', '郭婷', '黄凯'];

      const topics = [];
      for (let i = 0; i < count; i++) {
        const category = categories[Math.floor(Math.random() * categories.length)];
        const id = `topic-${Date.now()}-${i}`;
        const newsCount = Math.floor(Math.random() * 3) + 3;
        const topicTags = this.pickRandom(tags, 3);

        const topic = {
          id,
          title: `${category}焦点话题 ${i + 1}`,
          category,
          summary: `${category}领域热点事件的多维追踪与用户反馈。`,
          heat: Math.floor(Math.random() * 800) + 200,
          createdAt: Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000),
          tags: topicTags,
          news: []
        };

        for (let n = 0; n < newsCount; n++) {
          const title = `${category}要闻 ${n + 1}`;
          const interactions = this.generateInteractions(users);
          const likes = interactions.filter((item) => item.type === 'like').length;
          const comments = interactions.filter((item) => item.type === 'comment').length;
          const views = Math.floor(Math.random() * 1000) + 100 + likes + comments;

          topic.news.push({
            id: `${topic.id}-news-${n}`,
            title,
            summary: `${title} 的进展与平台监测到的真实用户反馈。`,
            publishedAt: Date.now() - Math.floor(Math.random() * 48 * 60 * 60 * 1000),
            views,
            likes,
            comments,
            stats: {
              likes,
              comments
            },
            interactions
          });
        }
        const totalLikes = topic.news.reduce((sum, news) => sum + toNumber(news.likes), 0);
        const totalComments = topic.news.reduce((sum, news) => sum + toNumber(news.comments), 0);
        const totalViews = topic.news.reduce((sum, news) => sum + toNumber(news.views), 0);
        topic.stats = {
          likes: totalLikes,
          comments: totalComments,
          views: totalViews,
          newsCount: topic.news.length
        };
        topic.newsCount = topic.news.length;
        topics.push(topic);
      }

      return topics;
    },

    generateInteractions(users) {
      const templates = [
        { type: 'like', detail: '点赞了该新闻' },
        { type: 'comment', detail: '评论：观点很有启发' },
        { type: 'comment', detail: '评论：提出了不同看法' },
        { type: 'like', detail: '点赞支持' }
      ];
      const count = Math.floor(Math.random() * 4) + 4;
      const result = [];

      // 保底互动记录
      result.push({
        user: users[Math.floor(Math.random() * users.length)],
        type: 'like',
        detail: '点赞表示支持',
        time: Date.now() - Math.floor(Math.random() * 12 * 60 * 60 * 1000)
      });
      result.push({
        user: users[Math.floor(Math.random() * users.length)],
        type: 'comment',
        detail: '评论：补充了新的观点',
        time: Date.now() - Math.floor(Math.random() * 12 * 60 * 60 * 1000)
      });
      for (let i = 0; i < count; i++) {
        const tpl = templates[Math.floor(Math.random() * templates.length)];
        const user = users[Math.floor(Math.random() * users.length)];
        result.push({
          user,
          type: tpl.type,
          detail: tpl.detail,
          time: Date.now() - Math.floor(Math.random() * 24 * 60 * 60 * 1000)
        });
      }
      return result.sort((a, b) => b.time - a.time);
    },

    pickRandom(source, max) {
      const shuffled = [...source].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, max);
    }

    // Create / Assign UI helpers
    ,
    cacheModalDom() {
      this.createTopicBtn = document.getElementById('createTopicBtn');
      this.assignArticlesBtn = document.getElementById('assignArticlesBtn');
      this.createTopicModal = document.getElementById('createTopicModal');
      this.createTopicForm = document.getElementById('createTopicForm');
      this.createTopicCancel = document.getElementById('createTopicCancel');
      this.createTopicClose = document.getElementById('createTopicClose');
      this.createTopicSaveBtn = document.getElementById('createTopicSave');
      this.createTopicMessage = document.getElementById('createTopicMessage');

      this.assignArticlesModal = document.getElementById('assignArticlesModal');
      this.assignArticlesForm = document.getElementById('assignArticlesForm');
      this.assignArticlesCancel = document.getElementById('assignArticlesCancel');
      this.assignArticlesClose = document.getElementById('assignArticlesClose');
      this.assignTopicSelect = document.getElementById('assignTopicSelect');
      this.assignArticleIds = document.getElementById('assignArticleIds');
      this.assignArticlesMessage = document.getElementById('assignArticlesMessage');
    },

    bindModalEvents() {
      // cache modal dom if not already
      try { if (!this.createTopicBtn) this.cacheModalDom(); } catch (e) {}

      if (this.createTopicBtn) this.createTopicBtn.addEventListener('click', () => this.showCreateTopicModal());
      if (this.createTopicCancel) this.createTopicCancel.addEventListener('click', () => this.hideCreateTopicModal());
      if (this.createTopicClose) this.createTopicClose.addEventListener('click', () => this.hideCreateTopicModal());
      if (this.createTopicForm) this.createTopicForm.addEventListener('submit', (e) => this.handleCreateTopicSubmit(e));

      if (this.assignArticlesBtn) this.assignArticlesBtn.addEventListener('click', () => this.showAssignArticlesModal());
      if (this.assignArticlesCancel) this.assignArticlesCancel.addEventListener('click', () => this.hideAssignArticlesModal());
      if (this.assignArticlesClose) this.assignArticlesClose.addEventListener('click', () => this.hideAssignArticlesModal());
      if (this.assignArticlesForm) this.assignArticlesForm.addEventListener('submit', (e) => this.handleAssignArticlesSubmit(e));
    },

    showCreateTopicModal() {
      try {
        if (!this.createTopicModal) this.cacheModalDom();
        if (!this.createTopicModal) return;
        this.createTopicModal.style.display = 'flex';
        const input = document.getElementById('newTopicTitle');
        if (input) input.focus();
      } catch (e) { console.debug('showCreateTopicModal error', e); }
    },

    hideCreateTopicModal() {
      try {
        if (!this.createTopicModal) return;
        this.createTopicModal.style.display = 'none';
        if (this.createTopicForm) this.createTopicForm.reset();
        this.setCreateTopicMessage('');
        this.setCreateTopicLoading(false);
      } catch (e) { /* ignore */ }
    },

    setCreateTopicMessage(message, type = 'info') {
      if (!this.createTopicMessage) return;
      const el = this.createTopicMessage;
      if (!message) {
        el.style.display = 'none';
        el.textContent = '';
        el.style.color = '';
        return;
      }
      const colorMap = {
        success: '#0f9d58',
        error: '#c0392b',
        info: '#555'
      };
      el.style.display = 'block';
      el.textContent = message;
      el.style.color = colorMap[type] || colorMap.info;
    },

    setCreateTopicLoading(isLoading) {
      if (!this.createTopicSaveBtn) return;
      this.createTopicSaveBtn.disabled = Boolean(isLoading);
      this.createTopicSaveBtn.textContent = isLoading ? '保存中...' : '保存';
    },

    async handleCreateTopicSubmit(e) {
      e.preventDefault();
      this.setCreateTopicMessage('');
      const title = document.getElementById('newTopicTitle')?.value.trim();
      const category = document.getElementById('newTopicCategory')?.value.trim() || '未分类';
      const description = document.getElementById('newTopicDescription')?.value.trim();
      const content = document.getElementById('newTopicContent')?.value.trim();
      const topicCover = document.getElementById('newTopicCover')?.value.trim();
      const tagsRaw = document.getElementById('newTopicTags')?.value || '';
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

      const missing = [];
      if (!title) missing.push('话题标题');
      if (!description) missing.push('简介');
      if (!content) missing.push('内容');
      if (!topicCover) missing.push('封面');

      if (missing.length) {
        this.setCreateTopicMessage(`请填写：${missing.join('、')}`, 'error');
        return;
      }

      const payload = { title, description, content, category, topicCover };
      if (tags.length) payload.tags = tags;
      const createEndpoint = this.topicApi && this.topicApi.create;
      const apiBase = (window.AppConfig && window.AppConfig.API_BASE_URL) || '未配置';
      const tokenPreview = (() => {
        try {
          const fixed = (window.AppConfig && window.AppConfig.FIXED_TOKEN) || '';
          if (!fixed) return '无';
          if (fixed.length <= 12) return fixed;
          return `${fixed.slice(0, 6)}…${fixed.slice(-4)}`;
        } catch (err) {
          return '读取失败';
        }
      })();
      console.groupCollapsed('%c[Topics][CreateTopic] 提交流程', 'color:#6d28d9;font-weight:bold;');
      console.log('请求端点:', createEndpoint);
      console.log('API_BASE_URL:', apiBase);
      console.log('Token 预览:', tokenPreview);
      console.log('提交 payload:', payload);

      try {
        if (!createEndpoint) {
          throw new Error('未配置真实话题创建接口');
        }
        this.setCreateTopicLoading(true);
        this.setCreateTopicMessage('正在提交，请稍候...', 'info');
        const response = await window.api.post(createEndpoint, payload, { forceNetwork: true, timeout: 15000 });
        console.log('后端响应:', response);
        this.setCreateTopicMessage('创建成功，列表将刷新。', 'success');
        try {
          await this.reloadData();
        } catch (refreshErr) {
          console.warn('[Topics] 创建后刷新话题列表失败', refreshErr);
        }
        setTimeout(() => this.hideCreateTopicModal(), 400);
      } catch (err) {
        const message = err && err.message ? err.message : err;
        console.error('[Topics][CreateTopic] 请求失败', err);
        this.setCreateTopicMessage(`创建失败：${message}`, 'error');
      } finally {
        this.setCreateTopicLoading(false);
        console.groupEnd();
      }
    },

    showAssignArticlesModal() {
      try {
        if (!this.assignArticlesModal) this.cacheModalDom();
        if (!this.assignArticlesModal) return;
        // populate topic select
        if (this.assignTopicSelect) {
          this.assignTopicSelect.innerHTML = '';
          (this.state.topics || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.title} (${Array.isArray(t.news) ? t.news.length : 0})`;
            this.assignTopicSelect.appendChild(opt);
          });
        }
        this.assignArticlesModal.style.display = 'flex';
        if (this.assignArticleIds) this.assignArticleIds.focus();
      } catch (e) { console.debug('showAssignArticlesModal error', e); }
    },

    hideAssignArticlesModal() {
      try {
        if (!this.assignArticlesModal) return;
        this.assignArticlesModal.style.display = 'none';
        if (this.assignArticlesForm) this.assignArticlesForm.reset();
        if (this.assignArticlesMessage) { this.assignArticlesMessage.style.display = 'none'; this.assignArticlesMessage.textContent = ''; this.assignArticlesMessage.style.color = ''; }
      } catch (e) { /* ignore */ }
    },

    async handleAssignArticlesSubmit(e) {
      e.preventDefault();
      const topicId = (this.assignTopicSelect && this.assignTopicSelect.value) || null;
      if (!topicId) {
        if (this.assignArticlesMessage) { this.assignArticlesMessage.style.display = 'block'; this.assignArticlesMessage.textContent = '请选择目标话题'; }
        return;
      }

      const raw = (this.assignArticleIds && this.assignArticleIds.value) || '';
      const ids = raw.split(/[,\n\s]+/).map(s => s.trim()).filter(Boolean);
      if (!ids.length) {
        if (this.assignArticlesMessage) { this.assignArticlesMessage.style.display = 'block'; this.assignArticlesMessage.textContent = '请输入至少一个新闻ID'; }
        return;
      }

      try {
        const normalizeNewsIds = (list) => list.map((val) => {
          const trimmed = val.trim();
          if (/^-?\d+$/.test(trimmed)) {
            if (trimmed.length <= 15) return Number(trimmed);
            return trimmed; // 超过安全整数时保留字符串，避免精度丢失
          }
          return trimmed;
        });

        const addNewsEndpoint = this.topicApi && this.topicApi.addNews
          ? (typeof this.topicApi.addNews === 'function' ? this.topicApi.addNews(topicId) : this.topicApi.addNews)
          : null;

        if (addNewsEndpoint) {
          try {
            const payload = { newsIds: normalizeNewsIds(ids) };
            await window.api.post(addNewsEndpoint, payload, { forceNetwork: true, timeout: 15000 });
            if (this.assignArticlesMessage) {
              this.assignArticlesMessage.style.display = 'block';
              this.assignArticlesMessage.style.color = '#0f9d58';
              this.assignArticlesMessage.textContent = '已同步到真实后端，正在更新本地列表…';
            }
          } catch (apiErr) {
            console.warn('[Topics] add-news 接口调用失败，使用本地回退', apiErr);
            if (this.assignArticlesMessage) {
              this.assignArticlesMessage.style.display = 'block';
              this.assignArticlesMessage.style.color = '#c0392b';
              this.assignArticlesMessage.textContent = `真实接口失败：${apiErr && apiErr.message ? apiErr.message : apiErr}，将仅更新本地数据。`;
            }
          }
        }

        // local update
        const target = (this.state.topics || []).find(t => String(t.id) === String(topicId));
        if (target) {
          target.news = target.news || [];
          ids.forEach(aid => {
            if (!target.news.some(n => String(n.id) === String(aid))) {
              target.news.unshift({ id: aid, title: `导入新闻 ${aid}`, summary: '', publishedAt: Date.now(), views: 0, likes: 0, comments: 0, stats: { likes: 0, comments: 0 } });
            }
          });
        }

        this.applyFilters();
        this.updateOverview();
        this.hideAssignArticlesModal();
      } catch (err) {
        if (this.assignArticlesMessage) { this.assignArticlesMessage.style.display = 'block'; this.assignArticlesMessage.textContent = '加入失败: ' + (err && err.message ? err.message : err); }
      }
    },

  };

  window.TopicsManager = TopicsManager;
})();

// 注册 mock handler，作为后端不可用时的回退
if (window.api && window.TopicsManager) {
  try {
    // 基本 admin topics mock（不带 base 前缀） — 支持 GET 列表与 POST 创建
    window.api.registerMock('/admin/topics', async (method, path, options) => {
      try {
        const m = (method || 'GET').toString().toUpperCase();
        if (m === 'POST') {
          // options.body 可能是对象或字符串
          let body = options && options.body;
          try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) {}
          const title = (body && (body.title || body.name)) || `新话题 ${Date.now()}`;
          const id = (body && body.id) || `topic-${Date.now()}`;
          const created = TopicsManager.normalizeTopic({ id, title, category: body && body.category, summary: body && body.summary, tags: body && body.tags }, 0);
          try { TopicsManager.state.topics = [created].concat(TopicsManager.state.topics || []); } catch (e) {}
          return created;
        }
      } catch (err) {}
      return TopicsManager.generateMockTopics(6);
    });

    // 若存在 API_BASE_URL，再注册一个带前缀的变体，覆盖不同请求拼接方式
    try {
      const base = (window.AppConfig && window.AppConfig.API_BASE_URL) || '';
      if (base) {
        const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
        const prefixed = normalizedBase + '/admin/topics';
        // 带前缀的变体，同样支持 POST/GET
        window.api.registerMock(prefixed, async (method, path, options) => {
          try {
            const m = (method || 'GET').toString().toUpperCase();
            if (m === 'POST') {
              let body = options && options.body;
              try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) {}
              const title = (body && (body.title || body.name)) || `新话题 ${Date.now()}`;
              const id = (body && body.id) || `topic-${Date.now()}`;
              const created = TopicsManager.normalizeTopic({ id, title, category: body && body.category, summary: body && body.summary, tags: body && body.tags }, 0);
              try { TopicsManager.state.topics = [created].concat(TopicsManager.state.topics || []); } catch (e) {}
              return created;
            }
          } catch (err) {}
          return TopicsManager.generateMockTopics(6);
        });
        // 额外再注册一个正则以匹配任意以 /admin/topics 结尾的 URL（包含完整域名的情况），同样支持 POST
        window.api.registerMock(new RegExp('/admin/topics$'), async (method, path, options) => {
          try {
            const m = (method || 'GET').toString().toUpperCase();
            if (m === 'POST') {
              let body = options && options.body;
              try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) {}
              const title = (body && (body.title || body.name)) || `新话题 ${Date.now()}`;
              const id = (body && body.id) || `topic-${Date.now()}`;
              const created = TopicsManager.normalizeTopic({ id, title, category: body && body.category, summary: body && body.summary, tags: body && body.tags }, 0);
              try { TopicsManager.state.topics = [created].concat(TopicsManager.state.topics || []); } catch (e) {}
              return created;
            }
          } catch (err) {}
          return TopicsManager.generateMockTopics(6);
        });
      }
    } catch (e) { /* ignore */ }
  } catch (e) {}
}

  // 注册 topic 详情的 mock（通配），当页面尝试请求 /topic/:id 或 /admin/topics/:id 等详情时使用本地数据回退
  if (window.api && window.TopicsManager) {
    try {
      const detailRe = new RegExp('/(?:admin/)?(?:topics|topic)(?:/.*)?$');
      window.api.registerMock(detailRe, async (method, path, options) => {
        try {
          const mth = (method || 'GET').toString().toUpperCase();
          // 解析 path 的 segments
          const segments = String(path || '').split('/').filter(Boolean);
          if (!segments.length) return {};

          // find topic id: last segment unless last is 'articles', then pick second last
          let id = null;
          if (segments[segments.length - 1] === 'articles' && segments.length >= 2) {
            id = segments[segments.length - 2];
          } else {
            id = segments[segments.length - 1];
          }

          // 若已有 TopicsManager.state.topics，尝试找到对应话题
          const existing = (TopicsManager.state && Array.isArray(TopicsManager.state.topics)) ? TopicsManager.state.topics : [];
          let found = null;
          if (id && existing.length) {
            found = existing.find(t => String(t.id) === String(id));
          }

          if (mth === 'POST') {
            // 处理 POST /admin/topics/:id/articles
            if (!found) {
              // 如果找不到对应话题，则创建一个基础话题
              const generated = TopicsManager.generateMockTopics(1);
              found = generated && generated.length ? generated[0] : null;
              if (found) {
                try { TopicsManager.state.topics = [found].concat(TopicsManager.state.topics || []); } catch (e) {}
              }
            }

            // 解析 body，支持 { ids: [...] } 或直接数组
            let body = options && options.body;
            try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) {}
            const ids = Array.isArray(body && body.ids) ? body.ids : (Array.isArray(body) ? body : []);
            const added = [];
            if (found && ids.length) {
              found.news = found.news || [];
              ids.forEach(aid => {
                if (!found.news.some(n => String(n.id) === String(aid))) {
                  const newNews = { id: aid, title: `导入新闻 ${aid}`, summary: '', publishedAt: Date.now(), views: 0, likes: 0, comments: 0, stats: { likes: 0, comments: 0 } };
                  found.news.unshift(newNews);
                  added.push(aid);
                }
              });
            }
            return { success: true, added };
          }

          if (!found) {
            // fallback: 生成单个 mock 话题并返回
            const generated = TopicsManager.generateMockTopics(1);
            found = generated && generated.length ? generated[0] : null;
          }

          if (!found) return {};
          // 封装为话题详情结构，兼容 normalizeTopicDetail
          return { topic: found };
        } catch (err) {
          return {};
        }
      });
    } catch (e) { /* ignore */ }
  }
