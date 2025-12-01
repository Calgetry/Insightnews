(function () {
  const { ENDPOINTS, PAGINATION } = window.AppConfig || {};

  class UsersManager {
    constructor() {
      const defaultPageSize = (PAGINATION && PAGINATION.defaultPageSize) || 20;
      this.state = {
        page: 1,
        pageSize: defaultPageSize,
        total: 0,
        searchKeyword: '',
        filters: {
          registerRange: 'all',
          startDate: '',
          endDate: '',
          sort: 'newest',
          activeRange: 'all',
          region: ''
        },
        selectedUsers: new Set(),
        users: [],
        loading: false
      };

      this.allUsers = [];
      this._filterUpdateTimer = null;

      try {
        const params = new URLSearchParams(window.location.search);
        const pageParam = parseInt(params.get('page'), 10);
        const pageSizeParam = parseInt(params.get('pageSize'), 10);
        if (!Number.isNaN(pageSizeParam) && [10, 20, 50, 100].includes(pageSizeParam)) {
          this.state.pageSize = pageSizeParam;
        } else {
          const savedSize = parseInt(localStorage.getItem('users_pageSize'), 10);
          if ([10, 20, 50, 100].includes(savedSize)) {
            this.state.pageSize = savedSize;
          }
        }

        if (!Number.isNaN(pageParam) && pageParam > 0) {
          this.state.page = pageParam;
        } else {
          const savedPage = parseInt(localStorage.getItem('users_page'), 10);
          if (!Number.isNaN(savedPage) && savedPage > 0) {
            this.state.page = savedPage;
          }
        }

        const q = params.get('q');
        if (q) this.state.searchKeyword = q;

        let startDate = params.get('startDate') || '';
        let endDate = params.get('endDate') || '';
        const sort = params.get('sort') || this.state.filters.sort;
        let registerRange = params.get('registerRange') || this.state.filters.registerRange;
        let activeRange = params.get('activeRange') || this.state.filters.activeRange;
        const region = params.get('region') || '';

        const validRanges = ['all', '7d', '30d', '90d', 'custom'];
        if (!validRanges.includes(registerRange)) registerRange = 'all';
        if ((startDate || endDate) && registerRange !== 'custom') {
          registerRange = 'custom';
        }
        if (registerRange !== 'custom') {
          const preset = this.computePresetRange(registerRange);
          if (preset) {
            startDate = preset.startDate;
            endDate = preset.endDate;
          }
        }

        const validActive = ['all', '7', '30', '90'];
        if (!validActive.includes(activeRange)) activeRange = 'all';

        this.state.filters = {
          registerRange,
          startDate,
          endDate,
          sort,
          activeRange,
          region: region.trim()
        };

        try {
          const si = document.getElementById('searchInput');
          if (si && this.state.searchKeyword) si.value = this.state.searchKeyword;
          const fsd = document.getElementById('filterStartDate');
          if (fsd) fsd.value = startDate;
          const fed = document.getElementById('filterEndDate');
          if (fed) fed.value = endDate;
          const fsort = document.getElementById('filterSort');
          if (fsort) fsort.value = sort;
          const fact = document.getElementById('filterActiveRange');
          if (fact) fact.value = activeRange;
          const freg = document.getElementById('filterRegion');
          if (freg) freg.value = region.trim();
        } catch (err) {
          // ignore DOM sync errors
        }
      } catch (e) {
        // ignore (older browsers)
      }

      window.UsersManager = this;
      this._exportPortal = {
        open: false,
        originalParent: null,
        nextSibling: null,
        onDocClick: null,
        onKey: null,
        onResize: null
      };

      this.userEndpoints = (ENDPOINTS && ENDPOINTS.users) || {};
      this._serverPaginationHints = null;
    }

    init() {
      if (!Auth.isLoggedIn()) {
        window.location.href = 'index.html';
        return;
      }

      this.bindEvents();
      this.syncFilterControls();
      this.loadUsers();
    }

    bindEvents() {
      // 搜索功能
      const searchBtn = document.getElementById('searchBtn');
      const searchInput = document.getElementById('searchInput');
      
      if (searchBtn) {
        searchBtn.addEventListener('click', () => this.handleSearch());
      }
      
      if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.handleSearch();
        });
      }

      // 筛选功能
      const filterToggle = document.getElementById('filterToggle');
      const closeFilter = document.getElementById('closeFilter');
      const resetBtn = document.getElementById('resetBtn');
      
      if (filterToggle) {
        filterToggle.addEventListener('click', () => this.toggleFilterPanel());
      }
      
      if (closeFilter) {
        closeFilter.addEventListener('click', () => this.toggleFilterPanel());
      }
      
      if (resetBtn) {
        resetBtn.addEventListener('click', () => this.resetFilters());
      }

      // 筛选条件变化时自动应用
      const filterSort = document.getElementById('filterSort');
      if (filterSort) {
        filterSort.addEventListener('change', () => this.handleFilterChange());
      }

      const filterActiveRange = document.getElementById('filterActiveRange');
      if (filterActiveRange) {
        filterActiveRange.addEventListener('change', () => this.handleFilterChange());
      }

      const dateGroup = document.getElementById('filterDateGroup');
      if (dateGroup) {
        dateGroup.addEventListener('click', (e) => {
          const btn = e.target.closest('.filter-pill');
          if (!btn || !btn.dataset.range) return;
          const range = btn.dataset.range;
          if (this.state.filters.registerRange === range) return;
          this.updateRegisterRange(range);
        });
      }

      const customStart = document.getElementById('filterStartDate');
      if (customStart) {
        customStart.addEventListener('change', () => this.onCustomDateChange());
      }
      const customEnd = document.getElementById('filterEndDate');
      if (customEnd) {
        customEnd.addEventListener('change', () => this.onCustomDateChange());
      }

      const filterRegion = document.getElementById('filterRegion');
      if (filterRegion) {
        filterRegion.addEventListener('input', (event) => {
          this.state.filters.region = event.target.value.trim();
          this.scheduleFilterChange();
        });
      }

      // 用户操作
      const addUserBtn = document.getElementById('addUserBtn');
      const exportBtn = document.getElementById('exportBtn');
      const exportMenu = document.getElementById('exportMenu');
      
      if (addUserBtn) {
        addUserBtn.addEventListener('click', () => this.showUserModal());
      }
      
      if (exportBtn && exportMenu) {
        // 使用 portal 技术把下拉菜单移动到 document.body，使用 fixed 定位并计算位置，避免被父容器 clipping
        exportBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._exportPortal.open) {
            this._closeExportMenu(exportMenu);
          } else {
            this._openExportMenu(exportBtn, exportMenu);
          }
        });

        // 点击导出选项（使用事件委托，菜单可能被 portal 到 body）
        exportMenu.addEventListener('click', (e) => {
          const item = e.target.closest('.dropdown-item');
          if (item) {
            e.preventDefault();
            const format = item.getAttribute('data-format');
            this.exportUsers(format);
            this._closeExportMenu(exportMenu);
          }
        });
      }

      // 模态框
      const closeModal = document.getElementById('closeModal');
      const cancelModal = document.getElementById('cancelModal');
      const userForm = document.getElementById('userForm');
      
      if (closeModal) {
        closeModal.addEventListener('click', () => this.hideUserModal());
      }
      
      if (cancelModal) {
        cancelModal.addEventListener('click', () => this.hideUserModal());
      }
      
      if (userForm) {
        userForm.addEventListener('submit', (e) => this.handleUserSave(e));
      }

      // 全选功能
      const selectAll = document.getElementById('selectAll');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
      }

      // 分页事件委托（绑定在 paginationContainer，包含跳转输入）
      const paginationContainer = document.getElementById('paginationContainer');
      if (paginationContainer) {
        paginationContainer.addEventListener('click', (e) => {
          // 点击页码或 首页/上一页/下一页/末页 按钮（带 data-page）
          const btn = e.target.closest('.page-btn');
          if (btn && btn.dataset.page) {
            const page = parseInt(btn.dataset.page, 10);
            if (!isNaN(page)) {
              this.state.page = page;
              try { localStorage.setItem('users_page', String(page)); } catch (err) {}
              this.updateUrlState();
              this.renderPagination();
              this.renderUsers();
              this.updatePageInfo();
            }
            return;
          }

          // 点击跳转按钮（位于 paginationJump）
          const goBtn = e.target.closest('.page-go');
          if (goBtn) {
            this.handleJumpFromInput(paginationContainer);
          }
        });
        // 回车支持：监听 keydown，回车时触发跳转（针对输入框）
        paginationContainer.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('page-input')) {
            e.preventDefault();
            this.handleJumpFromInput(paginationContainer);
          }
        });
      }

      // 表格内事件委托（操作按钮、复选框）
      const tbody = document.getElementById('usersTbody');
      if (tbody) {
        // 按钮点击（查看/编辑/删除）
        tbody.addEventListener('click', (e) => {
          const targetBtn = e.target.closest('button');
          if (!targetBtn) return;
          const userId = targetBtn.dataset.userId;
          if (!userId) return;

          if (targetBtn.classList.contains('view-user')) {
            this.viewUser(userId);
          } else if (targetBtn.classList.contains('edit-user')) {
            this.editUser(userId);
          } else if (targetBtn.classList.contains('delete-user')) {
            this.deleteUser(userId);
          }
        });

        // 复选框变化
        tbody.addEventListener('change', (e) => {
          if (!e.target.matches('.user-checkbox')) return;
          const userId = e.target.value;
          if (e.target.checked) {
            this.state.selectedUsers.add(userId);
          } else {
            this.state.selectedUsers.delete(userId);
          }
          this.updateSelectionState();
        });
      }

      // 每页条数下拉
      const pageSizeSelect = document.getElementById('pageSizeSelect');
      if (pageSizeSelect) {
        pageSizeSelect.value = String(this.state.pageSize);
        pageSizeSelect.addEventListener('change', (e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v > 0) {
            this.state.pageSize = v;
            try { localStorage.setItem('users_pageSize', String(v)); } catch (err) {}
            // update hint
            const hint = document.getElementById('currentPageSize');
            if (hint) hint.textContent = String(v);
            // persist pageSize and reset to page 1
            try { localStorage.setItem('users_page', '1'); } catch (err) {}
            this.state.page = 1; // 跳回第一页
              // 将当前页/页大小写入 URL，便于回链
              this.updateUrlState();
            this.renderPagination();
            this.renderUsers();
            this.updatePageInfo();
          }
        });
      }

      // 工具栏事件委托（处理清除跨页选择与批量操作）
      const toolbarEl = document.querySelector('.toolbar');
      if (toolbarEl) {
        toolbarEl.addEventListener('click', (e) => {
          // 清除选择
          const clearBtn = e.target.closest('#clearSelectionBtn');
          if (clearBtn) {
            this.state.selectedUsers.clear();
            this.renderUsers();
            this.updateSelectionState();
            return;
          }

          // 批量查看
          const bulkView = e.target.closest('#bulkViewBtn');
          if (bulkView) {
            this.bulkViewSelected();
            return;
          }

          // 批量删除
          const bulkDelete = e.target.closest('#bulkDeleteBtn');
          if (bulkDelete) {
            this.bulkDeleteSelected();
            return;
          }
        });
      }

      // 表头内的批量操作容器（因为我们把按钮移动到了表头），需要单独绑定委托
      const headerActions = document.querySelector('.header-bulk-actions');
      if (headerActions) {
        headerActions.addEventListener('click', (e) => {
          const clearBtn = e.target.closest('#clearSelectionBtn');
          if (clearBtn) {
            this.state.selectedUsers.clear();
            this.renderUsers();
            this.updateSelectionState();
            return;
          }

          const bulkView = e.target.closest('#bulkViewBtn');
          if (bulkView) {
            this.bulkViewSelected();
            return;
          }

          const bulkDelete = e.target.closest('#bulkDeleteBtn');
          if (bulkDelete) {
            this.bulkDeleteSelected();
            return;
          }
        });
      }
    }

    handleJumpFromInput(container) {
      const input = container.querySelector('.page-input');
      if (!input) return;
      let page = parseInt(input.value, 10);
      const totalPages = Math.max(1, Math.ceil(this.state.total / this.state.pageSize));
      if (isNaN(page)) return;
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;
      this.state.page = page;
      // persist page to localStorage and URL
      try { localStorage.setItem('users_page', String(page)); } catch (err) {}
      this.updateUrlState();
      this.renderPagination();
      this.renderUsers();
      this.updatePageInfo();
    }

    updateUrlState() {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('page', String(this.state.page));
        url.searchParams.set('pageSize', String(this.state.pageSize));
        // 同步搜索与筛选到 URL（省略空值）
        if (this.state.searchKeyword) {
          url.searchParams.set('q', this.state.searchKeyword);
        } else {
          url.searchParams.delete('q');
        }

        const f = this.state.filters || {};
        if (f.startDate) url.searchParams.set('startDate', f.startDate); else url.searchParams.delete('startDate');
        if (f.endDate) url.searchParams.set('endDate', f.endDate); else url.searchParams.delete('endDate');
        if (f.sort) url.searchParams.set('sort', f.sort); else url.searchParams.delete('sort');
        if (f.registerRange && f.registerRange !== 'all') url.searchParams.set('registerRange', f.registerRange); else url.searchParams.delete('registerRange');
        if (f.activeRange && f.activeRange !== 'all') url.searchParams.set('activeRange', f.activeRange); else url.searchParams.delete('activeRange');
        if (f.region) url.searchParams.set('region', f.region); else url.searchParams.delete('region');

        window.history.replaceState({}, '', url.toString());
      } catch (e) {
        // ignore in older browsers
      }
    }

    composeListUrl(basePath, params = {}) {
      if (!params || !Object.keys(params).length) return basePath;
      try {
        const origin = window.location && window.location.origin ? window.location.origin : 'http://localhost';
        const url = new URL(basePath, origin);
        Object.entries(params).forEach(([key, value]) => {
          if (value === undefined || value === null || value === '') return;
          url.searchParams.set(key, value);
        });
        const relative = url.pathname + (url.search ? url.search : '');
        return relative || basePath;
      } catch (err) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value === undefined || value === null || value === '') return;
          qs.set(key, value);
        });
        const queryString = qs.toString();
        if (!queryString) return basePath;
        return basePath.includes('?') ? `${basePath}&${queryString}` : `${basePath}?${queryString}`;
      }
    }

    normalizeKeyName(rawKey) {
      if (!rawKey || typeof rawKey !== 'string') return '';
      return rawKey.replace(/[^a-z0-9]/gi, '').toLowerCase();
    }

    extractPaginationMeta(payload, hints = {}) {
      const meta = {
        total: hints.total ?? null,
        totalPages: hints.totalPages ?? null,
        pageSize: hints.pageSize ?? null,
        currentPage: hints.currentPage ?? 1,
        pageKey: hints.pageKey ?? null,
        sizeKey: hints.sizeKey ?? null
      };

      const enqueueTargets = [];
      const pushTarget = (obj) => {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) enqueueTargets.push(obj);
      };

      pushTarget(payload);
      try { pushTarget(payload?.data); } catch (err) {}
      try { pushTarget(payload?.meta); } catch (err) {}
      try { pushTarget(payload?.pagination); } catch (err) {}
      try { pushTarget(payload?.page); } catch (err) {}
      try { pushTarget(payload?.pageInfo); } catch (err) {}

      const checkedKeys = new Set();
      const ensureNumber = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };

      enqueueTargets.forEach((target) => {
        Object.keys(target || {}).forEach((key) => {
          if (!key || checkedKeys.has(`${target}-${key}`)) return;
          checkedKeys.add(`${target}-${key}`);

          const normalized = this.normalizeKeyName(key);
          const value = target[key];

          if (meta.total === null && ['total', 'totalcount', 'count', 'totalrecords', 'totalelements', 'recordcount'].includes(normalized)) {
            const num = ensureNumber(value);
            if (num !== null) meta.total = num;
          }

          if (meta.totalPages === null && ['pages', 'totalpages', 'pagecount', 'totalpage', 'pagescount'].includes(normalized)) {
            const num = ensureNumber(value);
            if (num !== null) meta.totalPages = Math.max(1, num);
          }

          if (meta.pageSize === null && ['pagesize', 'size', 'limit', 'rows', 'perpage', 'pagecapacity'].includes(normalized)) {
            const num = ensureNumber(value);
            if (num !== null) {
              meta.pageSize = Math.max(1, num);
              if (!meta.sizeKey) meta.sizeKey = key;
            }
          }

          if (['page', 'pagenum', 'pageno', 'current', 'currentpage', 'pageindex', 'index'].includes(normalized)) {
            const num = ensureNumber(value);
            if (num !== null) {
              meta.currentPage = Math.max(1, num);
              if (!meta.pageKey) meta.pageKey = key;
            }
          }
        });
      });

      if (meta.total && !meta.totalPages && meta.pageSize) {
        meta.totalPages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
      }

      return meta;
    }

    async fetchUsersPage(listPath, pageKey, sizeKey, { page = 1, pageSize = null } = {}) {
      const params = {};
      if (pageKey) params[pageKey] = page;
      if (sizeKey && pageSize) params[sizeKey] = pageSize;
      const url = this.composeListUrl(listPath, params);
      const payload = await window.api.request(url, { method: 'GET', forceNetwork: true });
      const list = this.normalizeUsersResponse(payload);
      const meta = this.extractPaginationMeta(payload, { pageKey, sizeKey, currentPage: page, pageSize });
      return { list, meta };
    }

    mergeUsersIntoMap(targetMap, list) {
      if (!(targetMap instanceof Map)) return;
      (list || []).forEach((user) => {
        if (!user || user.id === undefined || user.id === null) return;
        const key = String(user.id);
        if (!targetMap.has(key)) {
          targetMap.set(key, user);
        } else {
          targetMap.set(key, Object.assign({}, targetMap.get(key), user));
        }
      });
    }

    getDefaultPageParamCandidates(type) {
      if (type === 'page') return ['pageNum', 'page', 'pageNo', 'current', 'currentPage', 'pageIndex'];
      if (type === 'size') return ['pageSize', 'size', 'limit', 'perPage'];
      return [];
    }

    async fetchRemainingPages(listPath, baseMeta, userMap, expectedTotal) {
      if (!listPath) return;
      const pageSize = baseMeta.pageSize || expectedTotal || this.state.pageSize;
      const totalPages = baseMeta.totalPages || (baseMeta.total && pageSize ? Math.ceil(baseMeta.total / pageSize) : 1);
      if (!pageSize || totalPages <= 1) return;

      const pageKeys = baseMeta.pageKey ? [baseMeta.pageKey] : this.getDefaultPageParamCandidates('page');
      const sizeKeys = baseMeta.sizeKey ? [baseMeta.sizeKey] : this.getDefaultPageParamCandidates('size');

      for (let sizeIndex = 0; sizeIndex < sizeKeys.length; sizeIndex++) {
        const sizeKey = sizeKeys[sizeIndex];
        let success = false;
        for (let pageIndex = 0; pageIndex < pageKeys.length; pageIndex++) {
          const pageKey = pageKeys[pageIndex];
          const currentPage = Number.isFinite(baseMeta.currentPage) ? Number(baseMeta.currentPage) : 1;
          let startPage = currentPage + 1;
          if (startPage < 1) startPage = 1;
          let page = startPage;
          try {
            while (page <= totalPages) {
              const { list } = await this.fetchUsersPage(listPath, pageKey, sizeKey, { page, pageSize });
              if (!Array.isArray(list) || !list.length) break;
              const beforeSize = userMap.size;
              this.mergeUsersIntoMap(userMap, list);
              if (userMap.size >= expectedTotal) {
                success = true;
                break;
              }
              if (userMap.size === beforeSize) {
                // 同一页无新增，可能后端不识别该分页键，提前中止
                break;
              }
              page += 1;
            }
          } catch (err) {
            console.debug('UsersManager: 请求后续分页失败', pageKey, sizeKey, err);
          }
          if (success || userMap.size >= expectedTotal) {
            baseMeta.pageKey = pageKey;
            baseMeta.sizeKey = sizeKey;
            baseMeta.pageSize = pageSize;
            break;
          }
        }
        if (success || userMap.size >= expectedTotal) break;
      }
    }

    async loadUsersWithPagination(listPath) {
      if (!listPath || !window.api) {
        return { users: [], meta: {}, expectedTotal: 0 };
      }

      const hints = this._serverPaginationHints || {};
      let initialPageSize = hints.pageSize;
      if (!initialPageSize) {
        initialPageSize = Math.max(this.state.pageSize || 10, 10);
      }

      let firstPage;
      try {
        firstPage = await this.fetchUsersPage(listPath, hints.pageKey, hints.sizeKey, {
          page: 1,
          pageSize: initialPageSize
        });
      } catch (error) {
        // 如果携带旧的分页参数失败，再尝试不带任何参数
        console.debug('UsersManager: 初次携带分页参数失败，尝试默认请求', error);
        firstPage = await this.fetchUsersPage(listPath, null, null, { page: 1 });
      }

      const userMap = new Map();
      this.mergeUsersIntoMap(userMap, firstPage.list);
      const meta = firstPage.meta || {};
      if (!meta.pageSize && Array.isArray(firstPage.list)) {
        const inferredSize = firstPage.list.length;
        if (inferredSize) meta.pageSize = inferredSize;
      }
      if (meta.total && meta.pageSize && !meta.totalPages) {
        meta.totalPages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
      }
      let expectedTotal = meta.total || userMap.size;
      if (!expectedTotal && Array.isArray(firstPage.list)) expectedTotal = firstPage.list.length;

      if (expectedTotal && userMap.size < expectedTotal) {
        await this.fetchRemainingPages(listPath, meta, userMap, expectedTotal);
      }

      const users = Array.from(userMap.values());
      if (expectedTotal && users.length > expectedTotal) {
        users.length = expectedTotal;
      }

      return { users, meta, expectedTotal };
    }

    // --- 导出菜单 portal helpers ---
    _openExportMenu(button, menu) {
      try {
        // 保存原位信息以便关闭时还原
        this._exportPortal.originalParent = menu.parentNode;
        this._exportPortal.nextSibling = menu.nextSibling;

        // 移动到 body
        document.body.appendChild(menu);
        menu.style.position = 'fixed';
        menu.style.minWidth = menu.style.minWidth || '200px';
        menu.style.zIndex = 4000;
        menu.classList.add('show');
        this._exportPortal.open = true;

        // 初次定位
        this._positionExportMenu(button, menu);

        // 绑定全局事件：点击外部、ESC、resize/scroll
        this._exportPortal.onDocClick = (ev) => {
          if (!menu.contains(ev.target) && ev.target !== button && !button.contains(ev.target)) {
            this._closeExportMenu(menu);
          }
        };
        this._exportPortal.onKey = (ev) => {
          if (ev.key === 'Escape') this._closeExportMenu(menu);
        };
        this._exportPortal.onResize = () => this._positionExportMenu(button, menu);

        document.addEventListener('click', this._exportPortal.onDocClick);
        document.addEventListener('keydown', this._exportPortal.onKey);
        window.addEventListener('resize', this._exportPortal.onResize);
        window.addEventListener('scroll', this._exportPortal.onResize, true);
      } catch (err) {
        console.error('openExportMenu error', err);
      }
    }

    _closeExportMenu(menu) {
      try {
        menu.classList.remove('show');
        // 还原位置
        if (this._exportPortal.originalParent) {
          if (this._exportPortal.nextSibling && this._exportPortal.nextSibling.parentNode === this._exportPortal.originalParent) {
            this._exportPortal.originalParent.insertBefore(menu, this._exportPortal.nextSibling);
          } else {
            this._exportPortal.originalParent.appendChild(menu);
          }
        }
        // 清理样式
        menu.style.position = '';
        menu.style.left = '';
        menu.style.top = '';
        menu.style.zIndex = '';

        // 移除事件
        if (this._exportPortal.onDocClick) document.removeEventListener('click', this._exportPortal.onDocClick);
        if (this._exportPortal.onKey) document.removeEventListener('keydown', this._exportPortal.onKey);
        if (this._exportPortal.onResize) window.removeEventListener('resize', this._exportPortal.onResize);
        window.removeEventListener('scroll', this._exportPortal.onResize, true);

        this._exportPortal.open = false;
        this._exportPortal.originalParent = null;
        this._exportPortal.nextSibling = null;
        this._exportPortal.onDocClick = null;
        this._exportPortal.onKey = null;
        this._exportPortal.onResize = null;
      } catch (err) {
        console.error('closeExportMenu error', err);
      }
    }

    _positionExportMenu(button, menu) {
      if (!button || !menu) return;
      const rect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 8; // 小间距

      // 默认放在按钮的下方右对齐
      let left = rect.left + rect.width - menuRect.width;
      if (left < 8) left = 8; // 最小留白

      let top = rect.bottom + gap;

      // 如果下方空间不足，改为上方显示
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      if (top + menuRect.height + 8 > viewportH) {
        // 放到按钮上方
        top = rect.top - menuRect.height - gap;
        if (top < 8) top = 8; // 顶部留白
      }

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.right = 'auto';
    }

    async loadUsers(forceReload = false) {
      this.setLoading(true);
      try {
        await this.fetchAllUsers(forceReload);

        let filteredUsers = this.applyFilters(this.allUsers);
        filteredUsers = this.applySorting(filteredUsers);
        const totalPages = Math.max(1, Math.ceil(filteredUsers.length / this.state.pageSize));
        if (this.state.page > totalPages) this.state.page = totalPages;
        try { localStorage.setItem('users_page', String(this.state.page)); } catch (err) {}
        this.updateUrlState();
        this.state.users = filteredUsers;
        this.state.total = filteredUsers.length;
        this.renderUsers();
        this.renderPagination();
        this.updatePageInfo();
        this.updateStats();
      } catch (error) {
        console.error('加载用户数据失败:', error);
        this.showError('加载用户数据失败: ' + error.message);
      } finally {
        this.setLoading(false);
      }
    }

    async fetchAllUsers(forceReload = false) {
      if (!forceReload && this.allUsers && this.allUsers.length) {
        return this.allUsers;
      }

      const endpoints = this.userEndpoints || {};
      const canUseListApi = window.api && endpoints.list;
      const infoEndpoint = window.AppConfig?.ENDPOINTS?.userService?.info;
      let lastError = null;

      if (canUseListApi) {
        try {
          const { users, meta, expectedTotal } = await this.loadUsersWithPagination(endpoints.list);
          if (Array.isArray(users) && users.length) {
            this.allUsers = users;
            this._serverPaginationHints = Object.assign({}, meta, { expectedTotal });
            return this.allUsers;
          }
        } catch (error) {
          lastError = error;
          if (!this.isBackendBusyError(error)) {
            console.warn('UsersManager: 拉取 /admin/users 失败，准备回退', error);
          }
        }
      }

      if (window.api && infoEndpoint) {
        try {
          const detailResponse = await window.api.request(infoEndpoint, { method: 'GET', forceNetwork: true });
          const normalizedList = this.normalizeUsersResponse(detailResponse);
          if (Array.isArray(normalizedList) && normalizedList.length) {
            this.allUsers = normalizedList;
            return this.allUsers;
          }
          const singleUser = this.normalizeSingleUser(detailResponse);
          if (singleUser) {
            this.allUsers = [singleUser];
            return this.allUsers;
          }
        } catch (error) {
          if (!lastError) lastError = error;
        }
      }

      this.allUsers = this.generateMockUsers(85);
      return this.allUsers;
    }

    normalizeUsersResponse(payload) {
      const source = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.users)
          ? payload.users
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.data?.users)
              ? payload.data.users
              : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.data?.items)
                  ? payload.data.items
              : [];

      return source
        .map((item) => this.normalizeSingleUser(item))
        .filter(Boolean);
    }

    normalizeSingleUser(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const id = raw.id ?? raw.userId ?? raw.uid ?? raw.accountId;
      if (id === undefined || id === null) return null;

      const fallbackNameFromEmail = (raw.email || raw.mail || raw.account || '').split('@')[0] || `用户${id}`;
      const name = (raw.name || raw.nickname || raw.username || raw.realName || fallbackNameFromEmail || `用户${id}`).trim();
      const email = raw.email || raw.mail || raw.account || `${id}@example.com`;
      const phoneSource = raw.phone || raw.mobile || raw.telephone || raw.tel || raw.contact || '';
      const phone = typeof phoneSource === 'number'
        ? String(phoneSource)
        : String(phoneSource || '').trim();
      const registerTime = this.ensureTimestamp(raw.registerTime || raw.createdAt || raw.createTime);
      const lastActive = this.ensureTimestamp(raw.lastActive || raw.lastLogin || raw.updatedAt || registerTime);
      const profile = raw.profile || raw.bio || raw.remark || raw.description || '';
      const region = raw.region || raw.city || raw.country || raw.province || '';
      const avatar = raw.avatar || raw.headimg || raw.photo || '';

      return {
        id,
        name,
        email,
        phone,
        registerTime,
        lastActive,
        profile,
        bio: profile,
        region,
        avatar
      };
    }

    ensureTimestamp(value) {
      if (!value) return Date.now();
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value.replace(/\.\d{3}Z$/, 'Z'));
        if (!Number.isNaN(parsed)) return parsed;
      }
      if (value instanceof Date) return value.getTime();
      return Date.now();
    }

    generateMockUsers(count) {
      const users = [];
      const surnames = ['张', '李', '王', '赵', '钱', '孙', '周', '吴', '郑', '王'];
      const givenNames = ['三', '四', '五', '六', '七', '八', '九', '十', '明', '华', '强', '伟', '芳', '娜', '静', '磊'];
      const domains = ['gmail.com', 'qq.com', '163.com', '126.com', 'hotmail.com', 'outlook.com'];
      const regions = ['上海', '北京', '广州', '深圳', '杭州', '南京', '成都', '厦门', '苏州', '武汉'];
      
      for (let i = 1; i <= count; i++) {
        const surname = surnames[Math.floor(Math.random() * surnames.length)];
        const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
        const name = surname + givenName;
        const domain = domains[Math.floor(Math.random() * domains.length)];
        
        // 确保类型分布合理
        const type = 'normal';
        // 生成合理的注册时间（过去365天内）
        const registerTime = Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000);
        
        // 最后活跃时间在注册时间之后，且在最近30天内
        const lastActive = registerTime + Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);
        
        const email = `user${i}@${domain}`;
        users.push({
          id: email,
          name: name,
          email,
          phone: `138${String(10000000 + i).padStart(8, '0')}`.slice(0, 11),
          type: type,
          registerTime: registerTime,
          lastActive: Math.min(lastActive, Date.now()), // 确保不超过当前时间
          bio: '这是一个用户简介示例，用户在这里可以描述自己的兴趣爱好和个人信息。',
          profile: '这是一个用户简介示例，用户在这里可以描述自己的兴趣爱好和个人信息。',
          region: regions[Math.floor(Math.random() * regions.length)],
          // 使用 base64 编码的简单头像，避免跨域问题
          avatar: this.createAvatarDataUrl(surname.charAt(0), i % 2 === 0 ? '#6d5ef2' : '#10b981')
        });
      }
      
      return users;
    }

    isBackendBusyError(error) {
      if (!error) return false;
      try {
        const message = (error.message || String(error) || '').toLowerCase();
        return message.includes('系统繁忙') || message.includes('稍后重试') || message.includes('server busy');
      } catch (e) {
        return false;
      }
    }

    // 创建头像数据URL的辅助方法，避免跨域问题
    createAvatarDataUrl(letter, color) {
      // 使用 encodeURIComponent 处理中文字符，然后进行 base64 编码
      const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="${color}" rx="40"/><text x="40" y="50" text-anchor="middle" fill="white" font-size="24" font-family="Arial, sans-serif">${encodeURIComponent(letter)}</text></svg>`;
      // 先将字符串转换为UTF-8字节数组，然后转换为base64
      const utf8Bytes = new TextEncoder().encode(svgString);
      const base64 = btoa(String.fromCharCode(...utf8Bytes));
      return `data:image/svg+xml;base64,${base64}`;
    }

    formatDateForInput(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    computePresetRange(range) {
      if (range === 'all') {
        return { startDate: '', endDate: '' };
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = this.formatDateForInput(today);
      let offset = 0;
      switch (range) {
        case '7d':
          offset = 6;
          break;
        case '30d':
          offset = 29;
          break;
        case '90d':
          offset = 89;
          break;
        default:
          return { startDate: '', endDate: '' };
      }
      const start = new Date(today);
      start.setDate(start.getDate() - offset);
      return {
        startDate: this.formatDateForInput(start),
        endDate
      };
    }

    updateRegisterRange(range, options = {}) {
      const { emitChange = true, preserveDates = false } = options;
      const buttons = document.querySelectorAll('#filterDateGroup .filter-pill');
      buttons.forEach((btn) => {
        const isActive = btn.dataset.range === range;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const customWrap = document.getElementById('filterCustomRange');
      const startInput = document.getElementById('filterStartDate');
      const endInput = document.getElementById('filterEndDate');

      if (range === 'custom') {
        if (customWrap) customWrap.classList.remove('hidden');
        if (!preserveDates) {
          if (startInput) startInput.value = this.state.filters.startDate || '';
          if (endInput) endInput.value = this.state.filters.endDate || '';
        }
      } else {
        if (customWrap) customWrap.classList.add('hidden');
        const preset = this.computePresetRange(range);
        if (preset) {
          this.state.filters.startDate = preset.startDate;
          this.state.filters.endDate = preset.endDate;
          if (startInput) startInput.value = preset.startDate;
          if (endInput) endInput.value = preset.endDate;
        }
      }

      this.state.filters.registerRange = range;

      if (emitChange) {
        this.handleFilterChange({
          registerRange: range,
          startDate: this.state.filters.startDate,
          endDate: this.state.filters.endDate
        });
      }
    }

    onCustomDateChange() {
      const startInput = document.getElementById('filterStartDate');
      const endInput = document.getElementById('filterEndDate');
      const startDate = startInput ? startInput.value : '';
      const endDate = endInput ? endInput.value : '';
      this.state.filters.startDate = startDate;
      this.state.filters.endDate = endDate;
      if (this.state.filters.registerRange !== 'custom') {
        this.updateRegisterRange('custom', { emitChange: false, preserveDates: true });
      }
      this.handleFilterChange({
        registerRange: 'custom',
        startDate,
        endDate
      });
    }

    readFiltersFromControls() {
      const registerButton = document.querySelector('#filterDateGroup .filter-pill.active');
      const registerRange = registerButton ? registerButton.dataset.range : (this.state.filters.registerRange || 'all');
      const startDate = document.getElementById('filterStartDate')?.value || '';
      const endDate = document.getElementById('filterEndDate')?.value || '';
      const sort = document.getElementById('filterSort')?.value || 'newest';
      const activeRange = document.getElementById('filterActiveRange')?.value || 'all';
      const region = document.getElementById('filterRegion')?.value.trim() || '';
      return {
        registerRange,
        startDate,
        endDate,
        sort,
        activeRange,
        region
      };
    }

    syncFilterControls() {
      const { filters } = this.state;
      this.updateRegisterRange(filters.registerRange || 'all', { emitChange: false, preserveDates: true });

      if (filters.registerRange === 'custom') {
        const startInput = document.getElementById('filterStartDate');
        const endInput = document.getElementById('filterEndDate');
        if (startInput) startInput.value = filters.startDate || '';
        if (endInput) endInput.value = filters.endDate || '';
        const customWrap = document.getElementById('filterCustomRange');
        if (customWrap) customWrap.classList.remove('hidden');
      }

      const sortSelect = document.getElementById('filterSort');
      if (sortSelect) sortSelect.value = filters.sort || 'newest';

      const activeSelect = document.getElementById('filterActiveRange');
      if (activeSelect) activeSelect.value = filters.activeRange || 'all';

      const regionInput = document.getElementById('filterRegion');
      if (regionInput) regionInput.value = filters.region || '';

    }

    scheduleFilterChange(delay = 260) {
      if (this._filterUpdateTimer) {
        clearTimeout(this._filterUpdateTimer);
      }
      this._filterUpdateTimer = setTimeout(() => {
        this._filterUpdateTimer = null;
        this.handleFilterChange();
      }, delay);
    }

    applyFilters(users) {
      let filtered = [...users];
      const { searchKeyword, filters } = this.state;

      // 关键词搜索
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        filtered = filtered.filter(user => 
          user.name.toLowerCase().includes(keyword) ||
          user.email.toLowerCase().includes(keyword) ||
          String(user.id).includes(keyword)
        );
      }

      // 注册日期筛选（开始日期）
      if (filters.startDate) {
        const startDate = new Date(filters.startDate);
        startDate.setHours(0, 0, 0, 0);
        filtered = filtered.filter(user => new Date(user.registerTime) >= startDate);
      }
      
      // 注册日期筛选（结束日期）
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(user => new Date(user.registerTime) <= endDate);
      }

      if (filters.activeRange && filters.activeRange !== 'all') {
        const days = parseInt(filters.activeRange, 10);
        if (!Number.isNaN(days) && days > 0) {
          const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
          filtered = filtered.filter(user => {
            const last = new Date(user.lastActive || user.registerTime || 0);
            return last.getTime() >= threshold;
          });
        }
      }

      if (filters.region) {
        const regionKeyword = filters.region.toLowerCase();
        filtered = filtered.filter(user => (user.region || '').toLowerCase().includes(regionKeyword));
      }

      return filtered;
    }

    applySorting(users) {
      const { sort } = this.state.filters;
      
      return [...users].sort((a, b) => {
        switch (sort) {
          case 'newest':
            return b.registerTime - a.registerTime;
          case 'oldest':
            return a.registerTime - b.registerTime;
          case 'active':
            return b.lastActive - a.lastActive;
          case 'name':
            return a.name.localeCompare(b.name, 'zh-CN');
          default:
            return 0;
        }
      });
    }

    renderUsers() {
      const tbody = document.getElementById('usersTbody');
      if (!tbody) {
        console.error('找不到用户表格tbody元素');
        return;
      }

      const startIndex = (this.state.page - 1) * this.state.pageSize;
      const pageUsers = this.state.users.slice(startIndex, startIndex + this.state.pageSize);

      if (pageUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">暂无用户数据</td></tr>';
        return;
      }

      tbody.innerHTML = pageUsers.map(user => {
        const displayName = (user.name && user.name.trim()) || (user.email ? user.email.split('@')[0] : `用户${user.id}`);
        const safeName = Utils.escapeHtml(displayName);
        const email = Utils.escapeHtml(user.email || '-');
        const phone = Utils.escapeHtml((user.phone && user.phone.trim()) ? user.phone : '未填写');
        const region = Utils.escapeHtml(user.region || '未填写');
        const remark = Utils.escapeHtml(user.profile || user.bio || '——');
        const avatarUrl = user.avatar ? Utils.escapeHtml(user.avatar) : '';
        const avatarStyle = avatarUrl ? `style="background-image:url('${avatarUrl}');background-size:cover;background-position:center;color:transparent;"` : '';
        const avatarLetterRaw = (displayName && displayName.charAt(0)) ? displayName.charAt(0).toUpperCase() : '?';
        const avatarLetter = Utils.escapeHtml(avatarLetterRaw);
        const registerText = user.registerTime ? Utils.formatTime(user.registerTime, 'date') : '未记录';
        const registerTooltip = user.registerTime ? Utils.escapeHtml(Utils.formatTime(user.registerTime, 'full')) : '未记录';
        const lastActiveText = user.lastActive ? Utils.formatRelativeTime(user.lastActive) : '未记录';
        const lastActiveTooltip = user.lastActive ? Utils.escapeHtml(Utils.formatTime(user.lastActive, 'full')) : '未记录';
        
        return `
        <tr data-user-id="${user.id}">
          <td><input type="checkbox" class="user-checkbox" value="${user.id}" aria-label="选择 用户 ${safeName}"></td>
          <td>
            <div class="user-info">
              <div class="user-avatar" ${avatarStyle}>${avatarUrl ? '' : avatarLetter}</div>
              <div class="user-details">
                <div class="user-name" title="${safeName}">${safeName}</div>
              </div>
            </div>
          </td>
          <td>${email}</td>
          <td>${phone}</td>
          <td>${region}</td>
          <td class="user-register-time" title="${registerTooltip}">${registerText}</td>
          <td class="user-last-active" title="${lastActiveTooltip}">${lastActiveText}</td>
          <td class="user-remark" title="${remark}">${remark}</td>
          <td>
            <div class="action-buttons">
              <button class="btn btn-sm view-user" data-user-id="${user.id}" title="查看详情">
                <svg class="icon"><use href="#eye"></use></svg>
                <span class="btn-text">查看</span>
              </button>
              <button class="btn btn-sm edit-user" data-user-id="${user.id}" title="编辑">
                <svg class="icon"><use href="#edit"></use></svg>
                <span class="btn-text">编辑</span>
              </button>
              <button class="btn btn-sm btn-danger delete-user" data-user-id="${user.id}" title="删除">
                <svg class="icon"><use href="#trash"></use></svg>
                <span class="btn-text">删除</span>
              </button>
            </div>
          </td>
        </tr>
      `}).join('');

      // 确保当前页的复选框反映 state.selectedUsers
      const checkboxes = tbody.querySelectorAll('.user-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = this.state.selectedUsers.has(cb.value);
      });

      // 更新全选/不确定状态
      this.updateSelectionState();
      // 更新已选信息显示
      this.updateSelectedInfo();
    }

    renderPagination() {
      const pagination = document.getElementById('pagination');
      if (!pagination) return;

      const totalPagesRaw = Math.ceil(this.state.total / this.state.pageSize);
      const totalPages = Math.max(1, totalPagesRaw);

      const currentPage = this.state.page;
      const maxButtons = 5; // 页码窗口大小
      let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage + 1 < maxButtons) {
        startPage = Math.max(1, endPage - maxButtons + 1);
      }

      let html = '';
      // 首页 / 上一页
      if (currentPage > 1) {
        html += `<button class="page-btn" data-page="1" aria-label="首页" title="首页">首页</button>`;
        html += `<button class="page-btn" data-page="${currentPage - 1}" aria-label="上一页" title="上一页">上一页</button>`;
      } else {
        // 也在仅一页时展示禁用的首页/上一页，保证分页条不“消失”
        html += `<button class="page-btn" aria-disabled="true" disabled title="首页">首页</button>`;
        html += `<button class="page-btn" aria-disabled="true" disabled title="上一页">上一页</button>`;
      }

      // 如果起始页不是1，显示1并省略
      if (startPage > 1) {
        html += `<button class="page-btn" data-page="1" aria-label="第 1 页" title="第 1 页">1</button>`;
        if (startPage > 2) html += `<span class="ellipsis" aria-hidden="true">…</span>`;
      }

      for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        html += `<button class="page-btn ${isActive ? 'active' : ''}" data-page="${i}" aria-label="第 ${i} 页" title="第 ${i} 页" ${isActive ? 'aria-current="page"' : ''}>${i}</button>`;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="ellipsis" aria-hidden="true">…</span>`;
        html += `<button class="page-btn" data-page="${totalPages}" aria-label="第 ${totalPages} 页" title="第 ${totalPages} 页">${totalPages}</button>`;
      }

      // 下一页 / 末页
      if (currentPage < totalPages) {
        html += `<button class="page-btn" data-page="${currentPage + 1}" aria-label="下一页" title="下一页">下一页</button>`;
        html += `<button class="page-btn" data-page="${totalPages}" aria-label="末页" title="末页">末页</button>`;
      } else {
        html += `<button class="page-btn" aria-disabled="true" disabled title="下一页">下一页</button>`;
        html += `<button class="page-btn" aria-disabled="true" disabled title="末页">末页</button>`;
      }

      pagination.innerHTML = html;
      // 渲染跳转输入在独立容器（显示在记录信息后面）
      const jump = document.getElementById('paginationJump');
      if (jump) {
        jump.innerHTML = `跳至 <input id="pageJumpInput" type="number" min="1" max="${totalPages}" class="page-input" value="${currentPage}" aria-label="跳转页码输入" style="width:84px;margin:0 6px;padding:4px;border-radius:6px;border:1px solid var(--border)"> <button class="page-go btn" aria-label="跳转到指定页" title="跳转">跳转</button>`;
      }
    }

    updatePageInfo() {
      const total = this.state.total;
      const start = total === 0 ? 0 : (this.state.page - 1) * this.state.pageSize + 1;
      const end = total === 0 ? 0 : Math.min(this.state.page * this.state.pageSize, total);
      
      const pageStart = document.getElementById('pageStart');
      const pageEnd = document.getElementById('pageEnd');
      const totalRecords = document.getElementById('totalRecords');
      
      if (pageStart) pageStart.textContent = start;
      if (pageEnd) pageEnd.textContent = end;
      if (totalRecords) totalRecords.textContent = total;
    }

    updateStats() {
      const usersWithPhone = this.state.users.filter(user => (user.phone || '').trim().length > 0).length;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newUsersToday = this.state.users.filter(user => 
        new Date(user.registerTime) >= today
      ).length;
      
      const totalUsersCount = document.getElementById('totalUsersCount');
      const newUsersTodayEl = document.getElementById('newUsersToday');
      
      if (totalUsersCount) totalUsersCount.textContent = this.state.total;
      if (newUsersTodayEl) newUsersTodayEl.textContent = newUsersToday;
    }

    handleSearch() {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        this.state.searchKeyword = searchInput.value.trim();
        this.state.page = 1;
        try { localStorage.setItem('users_page', '1'); } catch (err) {}
        this.updateUrlState();
        this.loadUsers();
      }
    }

    handleFilterChange(partialFilters = null) {
      if (this._filterUpdateTimer) {
        clearTimeout(this._filterUpdateTimer);
        this._filterUpdateTimer = null;
      }
      if (partialFilters) {
        this.state.filters = Object.assign({}, this.state.filters, partialFilters);
      } else {
        const snapshot = this.readFiltersFromControls();
        this.state.filters = Object.assign({}, this.state.filters, snapshot);
      }
      this.state.page = 1;
      try { localStorage.setItem('users_page', '1'); } catch (err) {}
      this.updateUrlState();
      this.loadUsers();
    }

    resetFilters() {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      
      const filterStartDate = document.getElementById('filterStartDate');
      if (filterStartDate) filterStartDate.value = '';
      
      const filterEndDate = document.getElementById('filterEndDate');
      if (filterEndDate) filterEndDate.value = '';

      const filterSort = document.getElementById('filterSort');
      if (filterSort) filterSort.value = 'newest';

      const filterActiveRange = document.getElementById('filterActiveRange');
      if (filterActiveRange) filterActiveRange.value = 'all';

      const filterRegion = document.getElementById('filterRegion');
      if (filterRegion) filterRegion.value = '';
      
      this.state.searchKeyword = '';
      this.state.filters = {
        registerRange: 'all',
        startDate: '',
        endDate: '',
        sort: 'newest',
        activeRange: 'all',
        region: ''
      };
      this.syncFilterControls();
      this.state.page = 1;
      try { localStorage.setItem('users_page', '1'); } catch (err) {}
      this.updateUrlState();
      this.loadUsers();
    }

    toggleFilterPanel() {
      const panel = document.getElementById('filterPanel');
      if (panel) {
        panel.classList.toggle('show');
      }
    }

    showUserModal(user = null) {
      const modal = document.getElementById('userModal');
      const title = document.getElementById('modalTitle');
      
      if (!modal || !title) {
        console.error('找不到模态框元素');
        return;
      }
      
      // 确保表单视图已恢复
      this.restoreFormView();
      
      const form = document.getElementById('userForm');
      if (!form) {
        console.error('找不到表单元素');
        return;
      }
      
      const registerInput = document.getElementById('userRegisterTime');
      const phoneInput = document.getElementById('userPhone');
      const modalMessage = document.getElementById('modalMessage');
      if (modalMessage) {
        modalMessage.textContent = '';
        modalMessage.style.display = 'none';
      }

      if (user) {
        title.textContent = '编辑用户';
        document.getElementById('userId').value = user.id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userEmail').value = user.email;
        if (phoneInput) phoneInput.value = user.phone || '';
        const regionInput = document.getElementById('userRegion');
        if (regionInput) regionInput.value = user.region || '';
        const bioInput = document.getElementById('userBio');
        if (bioInput) bioInput.value = user.profile || user.bio || '';
        if (registerInput) {
          const registerValue = Utils.formatDatetimeLocal(user.registerTime || Date.now());
          registerInput.value = registerValue;
        }
      } else {
        title.textContent = '创建用户';
        if (form && typeof form.reset === 'function') {
          form.reset();
        }
        document.getElementById('userId').value = '';
        document.getElementById('userName').value = '';
        document.getElementById('userEmail').value = '';
        if (phoneInput) phoneInput.value = '';
        const regionInput = document.getElementById('userRegion');
        if (regionInput) regionInput.value = '';
        const bioInput = document.getElementById('userBio');
        if (bioInput) bioInput.value = '';
        if (registerInput) {
          registerInput.value = Utils.formatDatetimeLocal(Date.now());
        }
      }
      
      modal.style.display = 'flex';
      
      // 延迟聚焦，确保模态框已显示
      setTimeout(() => {
        const userNameInput = document.getElementById('userName');
        if (userNameInput) userNameInput.focus();
      }, 100);
    }

    hideUserModal() {
      const modal = document.getElementById('userModal');
      const messageEl = document.getElementById('modalMessage');
      
      if (modal) modal.style.display = 'none';
      // 移除 bulk-modal 样式（如果存在），以恢复默认宽度
      try {
        const dialog = modal && modal.querySelector('.modal-dialog');
        if (dialog) dialog.classList.remove('bulk-modal');
      } catch (err) {}
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.style.display = 'none';
      }
      
      // 恢复表单视图（如果被详情视图替换了）
      this.restoreFormView();
    }
    
    restoreFormView() {
      const modalBody = document.querySelector('#userModal .modal-body');
      if (!modalBody) return;
      
      // 检查是否是详情视图
      if (modalBody.querySelector('.user-detail-view')) {
        // 恢复表单
        modalBody.innerHTML = `
          <form id="userForm" class="form">
            <input type="hidden" id="userId">
            <div class="form-grid">
              <div class="form-item">
                <label for="userName">姓名 <span style="color: var(--danger)">*</span></label>
                <input type="text" id="userName" required placeholder="请输入用户姓名">
              </div>
              <div class="form-item">
                <label for="userEmail">邮箱 <span style="color: var(--danger)">*</span>（作为账号ID）</label>
                <input type="email" id="userEmail" required placeholder="请输入邮箱地址">
              </div>
              <div class="form-item">
                <label for="userPhone">手机号 <span style="color: var(--danger)">*</span></label>
                <input type="tel" id="userPhone" required placeholder="请输入手机号">
              </div>
              <div class="form-item">
                <label for="userRegion">地区</label>
                <input type="text" id="userRegion" placeholder="请输入地区">
              </div>
              <div class="form-item">
                <label for="userRegisterTime">注册时间</label>
                <input type="datetime-local" id="userRegisterTime">
              </div>
            </div>
            <div class="form-item full-width">
              <label for="userBio">个人简介</label>
              <textarea id="userBio" rows="3" placeholder="请输入用户简介..."></textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" id="cancelModal">取消</button>
              <button type="submit" class="btn btn-primary" id="saveUserBtn">保存</button>
            </div>
          </form>
          <div id="modalMessage" class="message"></div>
        `;

        const form = document.getElementById('userForm');
        const cancelModal = document.getElementById('cancelModal');

        if (form) {
          form.addEventListener('submit', (e) => this.handleUserSave(e));
        }
        
        if (cancelModal) {
          cancelModal.addEventListener('click', () => this.hideUserModal());
        }

        const registerInput = document.getElementById('userRegisterTime');
        if (registerInput) {
          registerInput.value = Utils.formatDatetimeLocal(Date.now());
        }
      }
    }

    async handleUserSave(e) {
      e.preventDefault();
      
      const saveBtn = document.getElementById('saveUserBtn');
      if (!saveBtn) return;
      
      const registerInputValue = document.getElementById('userRegisterTime')?.value || '';
      let registerTime = Date.now();
      if (registerInputValue) {
        const parsed = new Date(registerInputValue);
        if (!Number.isNaN(parsed.getTime())) {
          registerTime = parsed.getTime();
        }
      }

      const formValues = {
        name: document.getElementById('userName')?.value.trim() || '',
        email: document.getElementById('userEmail')?.value.trim() || '',
        phone: document.getElementById('userPhone')?.value.trim() || '',
        region: document.getElementById('userRegion')?.value.trim() || '',
        profile: document.getElementById('userBio')?.value.trim() || ''
      };
      
      const userPayload = {
        name: formValues.name,
        email: formValues.email,
        phone: formValues.phone,
        region: formValues.region,
        profile: formValues.profile,
        bio: formValues.profile,
        type: 'normal',
        registerTime
      };
      const payload = userPayload;
      
      // 验证必填字段
      const userId = document.getElementById('userId')?.value;
      const isEdit = Boolean(userId);

      if (!userPayload.name && !isEdit) {
        this.showModalMessage('请输入用户姓名', 'error');
        return;
      }

      if (!userPayload.email && !isEdit) {
        this.showModalMessage('请输入用户邮箱', 'error');
        return;
      }

      if (userPayload.email && !Utils.validateEmail(userPayload.email)) {
        this.showModalMessage('请输入有效的邮箱地址', 'error');
        return;
      }

      if (!userPayload.phone) {
        this.showModalMessage('请输入手机号', 'error');
        return;
      }

      const dtoPayload = isEdit
        ? this.buildUserUpdatePayload(formValues)
        : this.buildUserCreatePayload(formValues);

      if (isEdit && (!dtoPayload || !Object.keys(dtoPayload).length)) {
        this.showModalMessage('请修改至少一个字段后再保存', 'error');
        return;
      }

      saveBtn.disabled = true;
      this.showModalMessage('保存中...', 'info');
      
      try {
        const endpoints = this.userEndpoints || {};
        const canUseApi = window.api && (isEdit ? typeof endpoints.update === 'function' : !!endpoints.create);

        const sendPayload = dtoPayload;

        if (canUseApi) {
          const path = isEdit
            ? (typeof endpoints.update === 'function' ? endpoints.update(userId) : endpoints.update)
            : (typeof endpoints.create === 'function' ? endpoints.create() : endpoints.create);
          const method = isEdit ? 'put' : 'post';
          const requestOptions = { tokenStrategy: 'fixed', forceNetwork: true };
          let apiResult = null;
          try {
            apiResult = await window.api[method](path, sendPayload, requestOptions);
          } catch (apiErr) {
            console.warn('API 保存失败，尝试本地回退更新', apiErr);
            apiResult = null;
          }

          const registerTimeToPersist = payload.registerTime || Date.now();
          if (isEdit) {
            const targetIndex = this.allUsers.findIndex((u) => String(u.id) === String(userId));
            if (targetIndex > -1) {
              if (apiResult && typeof apiResult === 'object') {
                // 后端可能返回：
                // - 单个用户对象
                // - 用户数组（全量或部分）
                // - 包含 users/data/items 的包装对象
                // 兼容多种格式：优先尝试提取单个已更新用户，否则如果获得数组则用数组替换或合并
                let updatedUser = null;
                if (Array.isArray(apiResult)) {
                  // 尝试在数组中找到对应 id
                  const normalizedList = this.normalizeUsersResponse(apiResult) || [];
                  updatedUser = normalizedList.find(u => String(u.id) === String(userId));
                  if (!updatedUser && normalizedList.length) {
                    // 如果返回的是全量列表，替换本地列表
                    this.allUsers = normalizedList;
                    // 重新计算后续渲染将在 loadUsers 中进行
                  }
                } else {
                  // 可能是一个对象：先尝试 normalizeSingleUser
                  updatedUser = this.normalizeSingleUser(apiResult) || null;
                  if (!updatedUser) {
                    // 也可能是包装对象包含数组
                    const possibleList = this.normalizeUsersResponse(apiResult) || [];
                    if (possibleList.length === 1) updatedUser = possibleList[0];
                    else if (possibleList.length > 1) {
                      this.allUsers = possibleList;
                    }
                  }
                }

                if (updatedUser) {
                  this.allUsers[targetIndex] = {
                    ...this.allUsers[targetIndex],
                    ...updatedUser,
                    registerTime: updatedUser.registerTime || registerTimeToPersist,
                    lastActive: Math.max(registerTimeToPersist, Date.now())
                  };
                } else {
                  // 回退到乐观更新
                  this.allUsers[targetIndex] = {
                    ...this.allUsers[targetIndex],
                    ...payload,
                    registerTime: registerTimeToPersist,
                    lastActive: Math.max(registerTimeToPersist, Date.now())
                  };
                }
              } else {
                // 无网络 / API 返回为空，使用乐观更新
                this.allUsers[targetIndex] = {
                  ...this.allUsers[targetIndex],
                  ...payload,
                  registerTime: registerTimeToPersist,
                  lastActive: Math.max(registerTimeToPersist, Date.now())
                };
              }
            }
          } else {
            const newId = (apiResult && (apiResult.id || apiResult.userId)) || Date.now();
            if (apiResult && typeof apiResult === 'object') {
              // 处理后端可能返回的多种格式：单个对象 / 数组 / 包装对象
              if (Array.isArray(apiResult)) {
                const normalizedList = this.normalizeUsersResponse(apiResult) || [];
                // 如果服务器返回列表，采用返回的首项或替换全量
                if (normalizedList.length === 1) {
                  this.allUsers.unshift({
                    id: newId,
                    ...normalizedList[0],
                    registerTime: normalizedList[0].registerTime || registerTimeToPersist,
                    lastActive: Math.max(registerTimeToPersist, Date.now())
                  });
                } else if (normalizedList.length > 1) {
                  this.allUsers = normalizedList.concat(this.allUsers.filter(u => !normalizedList.find(n => String(n.id) === String(u.id))));
                } else {
                  this.allUsers.unshift({
                    id: newId,
                    ...payload,
                    registerTime: registerTimeToPersist,
                    lastActive: Math.max(registerTimeToPersist, Date.now())
                  });
                }
              } else {
                // 可能是单个对象或包装对象
                const normalized = this.normalizeSingleUser(apiResult) || {};
                if (Object.keys(normalized).length) {
                  this.allUsers.unshift({
                    ...normalized,
                    registerTime: normalized.registerTime || registerTimeToPersist,
                    lastActive: Math.max(registerTimeToPersist, Date.now())
                  });
                } else {
                  const possibleList = this.normalizeUsersResponse(apiResult) || [];
                  if (possibleList.length) {
                    this.allUsers = possibleList.concat(this.allUsers.filter(u => !possibleList.find(n => String(n.id) === String(u.id))));
                  } else {
                    this.allUsers.unshift({
                      id: newId,
                      ...payload,
                      registerTime: registerTimeToPersist,
                      lastActive: Math.max(registerTimeToPersist, Date.now())
                    });
                  }
                }
              }
            } else {
              this.allUsers.unshift({
                id: newId,
                ...payload,
                registerTime: registerTimeToPersist,
                lastActive: Math.max(registerTimeToPersist, Date.now())
              });
            }
          }
        } else {
          const registerTimeToPersist = payload.registerTime || Date.now();
          if (isEdit) {
            const targetIndex = this.allUsers.findIndex((u) => String(u.id) === String(userId));
            if (targetIndex > -1) {
              this.allUsers[targetIndex] = {
                ...this.allUsers[targetIndex],
                ...payload,
                registerTime: registerTimeToPersist,
                lastActive: Math.max(registerTimeToPersist, Date.now())
              };
            }
          } else {
            const now = Date.now();
            this.allUsers.unshift({
              id: now,
              ...payload,
              registerTime: registerTimeToPersist,
              lastActive: Math.max(registerTimeToPersist, now)
            });
          }
        }

        const successText = isEdit ? '用户更新成功' : '用户创建成功';
        this.showModalMessage(successText, 'success');
        await this.loadUsers(canUseApi);
        setTimeout(() => this.hideUserModal(), 600);
        
      } catch (error) {
        this.showModalMessage('保存失败: ' + error.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    }

    buildUserUpdatePayload(source = {}) {
      const allowed = ['name', 'email', 'phone', 'region', 'profile'];
      const payload = {};
      allowed.forEach((key) => {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length) payload[key] = trimmed;
          return;
        }
        payload[key] = value;
      });
      return payload;
    }

    buildUserCreatePayload(source = {}) {
      const payload = {};
      ['name', 'email', 'phone', 'region', 'profile'].forEach((key) => {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length) payload[key] = trimmed;
          return;
        }
        payload[key] = value;
      });
      return payload;
    }

    showModalMessage(text, type) {
      const messageEl = document.getElementById('modalMessage');
      if (!messageEl) return;
      
      messageEl.textContent = text;
      messageEl.className = `message ${type}`;
      messageEl.style.display = 'block';
    }

    viewUser(userId) {
      const user = this.state.users.find(u => u.id == userId);
      if (!user) {
        alert('未找到该用户');
        return;
      }
      
      // 创建查看详情的模态框
      const modal = document.getElementById('userModal');
      const title = document.getElementById('modalTitle');
      const modalBody = modal.querySelector('.modal-body');
      
      if (!modal || !title || !modalBody) return;
      
      title.textContent = '用户详情';
      
      // 创建详情视图HTML
      const detailName = (user.name && user.name.trim()) || (user.email ? user.email.split('@')[0] : `用户${user.id}`);
      const avatarUrl = user.avatar ? Utils.escapeHtml(user.avatar) : '';
      const avatarStyle = avatarUrl ? `style="background-image:url('${avatarUrl}');background-size:cover;background-position:center;color:transparent;"` : '';
      const avatarLetter = Utils.escapeHtml((detailName && detailName.charAt(0)) ? detailName.charAt(0).toUpperCase() : '?');
      const profileText = Utils.escapeHtml(user.profile || user.bio || '暂无简介');
      
      modalBody.innerHTML = `
        <div class="user-detail-view">
          <div class="detail-header">
            <div class="user-avatar-large" ${avatarStyle}>${avatarUrl ? '' : avatarLetter}</div>
            <div class="detail-info">
              <h2>${Utils.escapeHtml(detailName)}</h2>
              <span class="badge subtle">邮箱即账号</span>
            </div>
          </div>
          
          <div class="detail-grid">
            <div class="detail-item">
              <label>邮箱</label>
              <div class="detail-value">${Utils.escapeHtml(user.email)}</div>
            </div>
            <div class="detail-item">
              <label>手机号</label>
              <div class="detail-value">${Utils.escapeHtml(user.phone || '未填写')}</div>
            </div>
            <div class="detail-item">
              <label>地区</label>
              <div class="detail-value">${Utils.escapeHtml(user.region || '未填写')}</div>
            </div>
            <div class="detail-item">
              <label>账号 (邮箱即ID)</label>
              <div class="detail-value">${Utils.escapeHtml(user.email)}</div>
            </div>
            <div class="detail-item">
              <label>注册时间</label>
              <div class="detail-value">${Utils.formatTime(user.registerTime, 'datetime')}</div>
            </div>
            <div class="detail-item">
              <label>最后活跃</label>
              <div class="detail-value">${Utils.formatRelativeTime(user.lastActive)}</div>
            </div>
            <div class="detail-item full-width">
              <label>个人简介</label>
              <div class="detail-value">${profileText}</div>
            </div>
          </div>
          
          <div class="detail-actions">
            <button type="button" id="detailEditBtn" class="btn btn-primary">
              <svg class="icon"><use href="#edit"></use></svg>
              编辑用户
            </button>
            <button type="button" id="detailCloseBtn" class="btn btn-ghost">关闭</button>
          </div>
        </div>
      `;
      
      modal.style.display = 'flex';

      // 使用事件委托绑定到 modalBody，确保按钮即使在重新渲染后也能工作
      try {
        if (this._detailDelegate && modalBody) {
          modalBody.removeEventListener('click', this._detailDelegate);
          this._detailDelegate = null;
        }

        this._detailDelegate = (e) => {
          const editTarget = e.target.closest && e.target.closest('#detailEditBtn');
          const closeTarget = e.target.closest && e.target.closest('#detailCloseBtn');
          if (editTarget) {
            e.preventDefault();
            // 使用 allUsers 查找，保证编辑原始数据
            this.editUserFromDetail(user.id);
            return;
          }
          if (closeTarget) {
            e.preventDefault();
            this.hideUserModal();
            return;
          }
        };

        if (modalBody && this._detailDelegate) {
          modalBody.addEventListener('click', this._detailDelegate);
        }
      } catch (err) {
        console.warn('detail delegate bind failed', err);
      }
    }
    
    editUserFromDetail(userId) {
      // 直接恢复表单视图并进入编辑状态，避免依赖定时器与隐藏/显示时序
      this.restoreFormView();
      // 优先从全量数据查找，保证编辑的是原始数据
      let user = null;
      if (Array.isArray(this.allUsers)) {
        user = this.allUsers.find(u => String(u.id) === String(userId));
      }
      if (!user && Array.isArray(this.state.users)) {
        user = this.state.users.find(u => String(u.id) === String(userId));
      }
      if (user) {
        // 确保模态为可见状态
        const modal = document.getElementById('userModal');
        if (modal) modal.style.display = 'flex';
        this.showUserModal(user);
      } else {
        // 如果找不到，弹窗恢复为空表单
        this.showUserModal();
      }
    }

    editUser(userId) {
      const user = this.state.users.find(u => u.id == userId);
      if (user) {
        this.showUserModal(user);
      }
    }

    async deleteUser(userId) {
      if (!confirm('确定要删除这个用户吗？此操作不可撤销。')) {
        return;
      }
      const endpoints = this.userEndpoints || {};
      const canUseApi = window.api && typeof endpoints.delete === 'function';
      try {
        if (canUseApi) {
          const path = endpoints.delete(userId);
          await window.api.delete(path);
        } else {
          this.allUsers = this.allUsers.filter((u) => String(u.id) !== String(userId));
        }
        this.state.selectedUsers.delete(String(userId));
        await this.loadUsers(canUseApi);
        alert('用户删除成功');
      } catch (error) {
        alert('删除失败: ' + error.message);
      }
    }

    toggleSelectAll(checked) {
      const checkboxes = document.querySelectorAll('.user-checkbox');
      checkboxes.forEach(checkbox => {
        checkbox.checked = checked;
        const userId = checkbox.value;
        if (checked) {
          this.state.selectedUsers.add(userId);
        } else {
          this.state.selectedUsers.delete(userId);
        }
      });
      this.updateSelectionState();
    }

    updateSelectionState() {
      const selectAll = document.getElementById('selectAll');
      if (!selectAll) return;
      
      const checkboxes = document.querySelectorAll('.user-checkbox');
      
      if (checkboxes.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
      }
      
      const checkedCount = this.state.selectedUsers.size;
      const totalCount = checkboxes.length;
      
      selectAll.checked = checkedCount === totalCount;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < totalCount;
      // 更新已选信息文本
      this.updateSelectedInfo();
    }

    updateSelectedInfo() {
      const el = document.getElementById('selectedInfo');
      if (!el) return;
      const count = this.state.selectedUsers.size;
      if (count === 0) {
        el.innerHTML = '';
      } else {
        // 精简文字以减少换行风险，并加入小红点与 aria-label
        el.innerHTML = `已选 <strong>${count}</strong> 项 <span class="selected-dot" aria-hidden="true"></span> <button id="clearSelectionBtn" class="btn btn-ghost clear-btn" aria-label="清除已选项" title="清除已选">清除</button>`;
      }

      // 启用/禁用批量操作按钮（如果存在）
      try {
        const bulkViewBtn = document.getElementById('bulkViewBtn');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkViewBtn) bulkViewBtn.disabled = count === 0;
        if (bulkDeleteBtn) bulkDeleteBtn.disabled = count === 0;
      } catch (err) {
        // ignore
      }
    }

    // 批量查看已选用户（在模态框中展示简要信息）
    bulkViewSelected() {
      const ids = Array.from(this.state.selectedUsers);
      if (ids.length === 0) return;
      // 根据当前过滤后的 users 列表或全量数据查找（优先使用全量数据以保证跨页也能查看）
      const selected = ids.map(id => this.allUsers.find(u => String(u.id) === String(id))).filter(Boolean);
      this.showBulkViewModal(selected);
    }

    showBulkViewModal(usersArray) {
      const modal = document.getElementById('userModal');
      const title = document.getElementById('modalTitle');
      const modalBody = modal.querySelector('.modal-body');
      if (!modal || !title || !modalBody) return;
      title.textContent = `批量查看 — ${usersArray.length} 项`;
      // 使用卡片化网格展示选中用户
      const listHtml = usersArray.map(u => {
        const bulkName = (u.name && u.name.trim()) || (u.email ? u.email.split('@')[0] : `用户${u.id}`);
        const bulkAvatar = Utils.escapeHtml((bulkName && bulkName.charAt(0)) ? bulkName.charAt(0).toUpperCase() : '?');
        const regionValue = Utils.escapeHtml(u.region || '未填写');
        return `
        <li class="bulk-item">
          <div class="bulk-avatar">${bulkAvatar}</div>
          <div class="bulk-meta">
            <div class="name">${Utils.escapeHtml(u.name)}</div>
            <div class="sub">账号：${Utils.escapeHtml(u.email)}</div>
            <div class="sub">地区：${regionValue}</div>
            <div class="sub" style="color:var(--muted);">邮箱即ID</div>
          </div>
        </li>`;
      }).join('');

      modalBody.innerHTML = `
        <div class="bulk-view">
          <ul class="bulk-list" style="max-height:420px;overflow:auto;">${listHtml}</ul>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="closeBulkView">关闭</button>
          </div>
        </div>
      `;

      // 让模态使用更宽的对话框样式
      const dialog = modal.querySelector('.modal-dialog');
      if (dialog) dialog.classList.add('bulk-modal');

      // 绑定关闭
      setTimeout(() => {
        const closeBtn = document.getElementById('closeBulkView');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hideUserModal());
      }, 50);

      modal.style.display = 'flex';
    }

    // 批量删除所选用户
    async bulkDeleteSelected() {
      const ids = Array.from(this.state.selectedUsers);
      if (ids.length === 0) return;
      if (!confirm(`确定要删除选中的 ${ids.length} 项用户吗？此操作不可撤销。`)) return;
      const endpoints = this.userEndpoints || {};
      const canUseApi = window.api && endpoints.batchDelete;
      try {
        if (canUseApi) {
          await window.api.post(endpoints.batchDelete, { ids });
        } else {
          const idSet = new Set(ids.map(String));
          this.allUsers = this.allUsers.filter((u) => !idSet.has(String(u.id)));
        }
        // 清除选择
        this.state.selectedUsers.clear();
        // 重新加载（会基于 allUsers 重新计算分页）
        await this.loadUsers(canUseApi);
        alert(`已删除 ${ids.length} 项用户`);
      } catch (err) {
        alert('批量删除失败: ' + (err && err.message ? err.message : err));
      }
    }

    async exportUsers(format = 'json') {
      try {
        const filename = `users_export_${new Date().toISOString().split('T')[0]}`;
        
        if (format === 'excel') {
          // 导出为Excel
          Utils.exportToExcel(this.state.users, filename);
        } else {
          // 导出为JSON
          const data = JSON.stringify(this.state.users, null, 2);
          Utils.downloadData(data, filename + '.json');
        }
      } catch (error) {
        this.showError('导出失败: ' + error.message);
      }
    }

    setLoading(loading) {
      this.state.loading = loading;
      const tbody = document.getElementById('usersTbody');
      
      if (loading && tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">加载中...</td></tr>';
      }
    }

    showError(message) {
      console.error('UsersManager Error:', message);
      alert(message);
    }
  }

  // 创建全局用户管理器实例
  window.UsersManager = new UsersManager();
})();

// 注册用户列表 mock handler，便于后端不可用时自动回退
if (window.api && window.UsersManager) {
  try {
    window.api.registerMock('/admin/users', async () => {
      return window.UsersManager.generateMockUsers(85);
    });
  } catch (error) {}
}