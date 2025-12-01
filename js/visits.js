(function(){
  class VisitManager {
    constructor(){
      this.topics = [];
      this.selectedTopicId = null;
      this._detailContext = null;
      this._currentSeries = null;
      this._zoomRegistered = false;
      this.endpoints = (window.AppConfig && window.AppConfig.ENDPOINTS) || {};
      window.VisitManager = this;
    }

    bindDetailActions(){
      // 尝试访问访问管理部分的元素ID，如果不存在则使用通用ID
      const exportBtn = document.getElementById('visitsDetailExportBtn') || document.getElementById('detailExportBtn');
      const exportMenu = document.getElementById('visitsDetailExportMenu') || document.getElementById('detailExportMenu');
      const resetBtn = document.getElementById('visitsResetZoomBtn') || document.getElementById('resetZoomBtn');
      const viewsCanvas = document.getElementById('visitsViewsChart') || document.getElementById('viewsChart');
      const engagementCanvas = document.getElementById('visitsEngagementChart') || document.getElementById('engagementChart');
      const trendSelect = document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
      const trendSummary = document.getElementById('visitsTrendRangeSummary') || document.getElementById('trendRangeSummary');

      if(exportBtn && exportMenu) {
        this._detailExportBtn = exportBtn;
        this._detailExportMenu = exportMenu;
        exportBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleDetailExportMenu();
        });
        exportMenu.addEventListener('click', (e) => {
          const item = e.target.closest('.dropdown-item');
          if(!item) return;
          e.preventDefault();
          const format = item.getAttribute('data-format');
          this.exportCurrentSeries(format);
          this.closeDetailExportMenu();
        });
        this._detailExportOutside = (event) => {
          if(!this._detailExportMenu?.classList.contains('show')) return;
          if(this._detailExportBtn?.contains(event.target) || this._detailExportMenu?.contains(event.target)) return;
          this.closeDetailExportMenu();
        };
        document.addEventListener('click', this._detailExportOutside);
      }

      if(resetBtn) resetBtn.addEventListener('click', () => this.resetZoom());
      if(viewsCanvas) viewsCanvas.addEventListener('dblclick', () => this.resetZoom());
      if(engagementCanvas) engagementCanvas.addEventListener('dblclick', () => this.resetZoom());
      if(trendSummary) this._trendRangeSummary = trendSummary;

      if(!trendSummary) {
        const summaryFallback = document.getElementById('trendRangeSummary') || document.getElementById('visitsTrendRangeSummary');
        if(summaryFallback) this._trendRangeSummary = summaryFallback;
      }
      this.ensureTrendRangeBindings();
    }

    // 访话管理：绑定话题/排行层面的导出按钮
    bindTopicsExportActions(){
      const exportBtn = document.getElementById('topicsExportBtn');
      const exportMenu = document.getElementById('topicsExportMenu');
      if (!exportBtn || !exportMenu) return;

      exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportMenu.classList.toggle('show');
      });

      exportMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;
        e.preventDefault();
        const format = item.getAttribute('data-format');
        this.exportTopicsOverview(format);
        exportMenu.classList.remove('show');
      });

      // 点击页面其它区域时关闭菜单
      document.addEventListener('click', (evt) => {
        if (!exportMenu.classList.contains('show')) return;
        if (exportBtn.contains(evt.target) || exportMenu.contains(evt.target)) return;
        exportMenu.classList.remove('show');
      });
    }

    handleTrendRangeChange(){
      const select = this._trendRangeSelect || document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
      if(!select) return;
      const value = select.value || '24';
      if(this._trendRangeLastValue === value) return;
      this._trendRangeLastValue = value;
      this.resetZoom();
      this.updateTrendRangeSummary(value);
      this.refreshCurrentDetail(value);
    }

    ensureTrendRangeBindings(){
      const select = document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
      if(!select){
        return null;
      }
      if(!this._trendRangeChange){
        this._trendRangeChange = this.handleTrendRangeChange.bind(this);
      }
      if(this._trendRangeSelect && this._trendRangeSelect !== select){
        this._trendRangeSelect.removeEventListener('change', this._trendRangeChange);
      }
      this._trendRangeSelect = select;
      select.removeEventListener('change', this._trendRangeChange);
      select.addEventListener('change', this._trendRangeChange);
      const currentValue = select.value || '24';
      if(this._trendRangeLastValue === undefined){
        this._trendRangeLastValue = currentValue;
      }
      if(!this._trendRangeSummary){
        const summary = document.getElementById('visitsTrendRangeSummary') || document.getElementById('trendRangeSummary');
        if(summary) this._trendRangeSummary = summary;
      }
      if(this._trendRangeSummary){
        this.updateTrendRangeSummary(currentValue);
      }
      if(!this._trendRangeGlobalListener){
        this._trendRangeGlobalListener = (event) => {
          const target = event.target;
          if(!target) return;
          const id = target.id || target.name || '';
          if(id !== 'trendRange' && id !== 'visitsTrendRange') return;
          this.handleTrendRangeChange();
        };
        document.addEventListener('change', this._trendRangeGlobalListener, true);
        document.addEventListener('input', this._trendRangeGlobalListener, true);
      }
      if(!this._trendRangePoller){
        this._trendRangePoller = window.setInterval(() => {
          const watcher = this._trendRangeSelect || document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
          if(!watcher) return;
          const value = watcher.value || '24';
          if(this._trendRangeLastValue !== value){
            this._trendRangeLastValue = value;
            this.handleTrendRangeChange();
          }
        }, 400);
      }
      return select;
    }

    async loadTopics(forceReload = false){
      const useApi = this.shouldUseApi();
      const query = forceReload ? { _ts: Date.now() } : {};

      if(useApi){
        try {
          const response = await window.api.get(this.getTrendsEndpoint(), query);
          const topics = this.normalizeTopicsResponse(response);
          if (!Array.isArray(topics) || topics.length === 0) {
            throw new Error('empty or invalid topics response');
          }
          this.lastUsedSource = 'real';
          this.applyTopics(topics);
          return this.topics;
        } catch(error){
          console.warn('加载访问趋势数据失败或返回空，使用本地 mock 数据', error);
        }
      }

      this.lastUsedSource = 'mock';
      this.applyTopics(this.createMockTopics());
      return this.topics;
    }

    shouldUseApi(){
      const flags = (window.AppConfig && window.AppConfig.FEATURE_FLAGS) || {};
      if (!window.api || flags.USE_REAL_BACKEND === false) {
        return false;
      }
      return true;
    }

    getTrendsEndpoint(){
      const analytics = this.endpoints && this.endpoints.analytics;
      return (analytics && analytics.trends) || '/admin/analytics/trends';
    }

    normalizeTopicsResponse(payload){
      if(Array.isArray(payload)) return payload;
      if(payload && Array.isArray(payload.topics)) return payload.topics;
      if(payload && Array.isArray(payload.data)) return payload.data;
      if(payload && payload.data && Array.isArray(payload.data.topics)) return payload.data.topics;
      return [];
    }

    applyTopics(topics){
      const previousSelected = this.selectedTopicId;
      this.topics = Array.isArray(topics) ? topics : [];
      if(this.topics.length){
        const matched = previousSelected && this.topics.find(t => String(t.id) === String(previousSelected));
        this.selectedTopicId = matched ? matched.id : this.topics[0].id;
      } else {
        this.selectedTopicId = null;
      }

      if(this._detailContext){
        if(this._detailContext.type === 'topic'){
          const topic = this.topics.find(t => String(t.id) === String(this._detailContext.topicId));
          if(!topic) this._detailContext = null;
        } else if(this._detailContext.type === 'article'){
          const topic = this.topics.find(t => String(t.id) === String(this._detailContext.topicId));
          const article = topic?.news.find(n => String(n.id) === String(this._detailContext.id));
          if(!article) this._detailContext = null;
        }
      }

      this.emitTopicsUpdated({ reason: 'apply-topics' });
    }

    emitTopicsUpdated(extra = {}){
      try {
        const detail = Object.assign({
          topics: this.topics,
          selectedTopicId: this.selectedTopicId,
          timestamp: Date.now()
        }, extra || {});
        const event = new CustomEvent('visits:topics-updated', { detail });
        document.dispatchEvent(event);
      } catch (err) {
        console.debug('VisitManager emitTopicsUpdated failed', err);
      }
    }

    toggleDetailExportMenu(){
      if(!this._detailExportMenu) return;
      this._detailExportMenu.classList.toggle('show');
    }

    closeDetailExportMenu(){
      if(!this._detailExportMenu) return;
      this._detailExportMenu.classList.remove('show');
    }

    // 简单评分公式：score = views * 0.6 + likes * 0.3 + comments * 0.1
    calcScore(item){
      return Math.round((item.views * 0.6) + (item.likes * 0.3) + (item.comments * 0.1));
    }

    // 话题排名：聚合话题内前 N 篇的分数总和（例如 N=5）
    calcTopicScore(topic, topN=5){
      const arr = topic.news.map(n => ({...n, score: this.calcScore(n)})).sort((a,b)=>b.score-a.score);
      return arr.slice(0, topN).reduce((s,x)=>s+x.score,0);
    }

    renderTopics(){
      const container = document.getElementById('visitsTopicsList') || document.getElementById('topicsList');
      if(!container) return;

      const managedByTopicsManager = container.id === 'topicsList' && window.TopicsManager;
      if (managedByTopicsManager) {
        try {
          const topicsState = window.TopicsManager.state || {};
          const filtered = Array.isArray(topicsState.filteredTopics) ? topicsState.filteredTopics : [];
          if (!filtered.length) {
            this.selectedTopicId = null;
            this.renderNewsTable();
            return;
          }
          if (topicsState.selectedTopicId) {
            this.selectedTopicId = topicsState.selectedTopicId;
          } else if (!filtered.some((t) => String(t.id) === String(this.selectedTopicId))) {
            this.selectedTopicId = filtered[0].id;
          }
        } catch (err) {
          // TopicsManager 状态不可用时忽略，让下方逻辑兜底
        }
        this.renderNewsTable();
        return;
      }
      const kw = document.getElementById('topicSearch')?.value.trim().toLowerCase() || '';
      
      // 获取筛选条件
      const filterTopicType = document.getElementById('filterTopicType')?.value || '';
      const filterMinViews = parseInt(document.getElementById('filterMinViews')?.value) || 0;
      const filterMinLikes = parseInt(document.getElementById('filterMinLikes')?.value) || 0;
      const filterMinComments = parseInt(document.getElementById('filterMinComments')?.value) || 0;
      const filterNewsCount = document.getElementById('filterNewsCount')?.value || '';

      // compute topic scores
      const topicsWithScore = this.topics.map(t => ({...t, topicScore: this.calcTopicScore(t)}));
      
      // filter by keyword on topic name or any news title
      let filtered = topicsWithScore.filter(t => {
        // 关键词筛选
        if(kw) {
          const matchKeyword = t.name.toLowerCase().includes(kw) || 
                               t.news.some(n=>n.title.toLowerCase().includes(kw));
          if(!matchKeyword) return false;
        }

        // 话题类型筛选
        if(filterTopicType && t.name !== filterTopicType) return false;

        // 计算话题总数据
        const totalViews = t.news.reduce((s,n)=>s+n.views,0);
        const totalLikes = t.news.reduce((s,n)=>s+n.likes,0);
        const totalComments = t.news.reduce((s,n)=>s+n.comments,0);

        // 浏览量筛选
        if(filterMinViews > 0 && totalViews < filterMinViews) return false;
        
        // 点赞数筛选
        if(filterMinLikes > 0 && totalLikes < filterMinLikes) return false;
        
        // 评论数筛选
        if(filterMinComments > 0 && totalComments < filterMinComments) return false;

        // 新闻数量范围筛选
        if(filterNewsCount) {
          const newsCount = t.news.length;
          if(filterNewsCount === 'small' && (newsCount < 1 || newsCount > 5)) return false;
          if(filterNewsCount === 'medium' && (newsCount < 6 || newsCount > 10)) return false;
          if(filterNewsCount === 'large' && (newsCount < 11 || newsCount > 15)) return false;
          if(filterNewsCount === 'xlarge' && newsCount < 16) return false;
        }

        return true;
      });

      if(filtered.length === 0){
        container.innerHTML = '<div class="topic-empty">未找到匹配的话题</div>';
        this.selectedTopicId = null;
        this.renderNewsTable();
        return;
      }

      // sort by topicScore desc
      filtered.sort((a,b)=>b.topicScore - a.topicScore);

      container.innerHTML = filtered.map((t, idx) => `
        <div class="topic-item" data-id="${t.id}">
          <div class="topic-rank">${idx + 1}</div>
          <div class="topic-content">
            <div class="topic-name">${this.escape(t.name)}</div>
            <div class="topic-meta">${t.news.length} 篇新闻 • 得分 ${t.topicScore.toLocaleString('zh-CN')}</div>
          </div>
          <div class="topic-arrow">查看 ></div>
        </div>
      `).join('');

      // bind click
      container.querySelectorAll('.topic-item').forEach(el=> el.addEventListener('click', ()=>{
        const id = el.dataset.id;
        this.selectTopic(id);
      }));

      // if previously selected topic filtered out, clear selection
      if(this.selectedTopicId){
        const still = filtered.find(t=>String(t.id)===String(this.selectedTopicId));
        if(!still) {
          this.selectedTopicId = null;
          this.renderNewsTable();
        } else {
          const selectedEl = container.querySelector(`.topic-item[data-id='${this.selectedTopicId}']`);
          if(selectedEl) selectedEl.classList.add('active');
        }
      }
    }

    selectTopic(id){
      this.selectedTopicId = id;
      const topicsListEl = document.getElementById('topicsList');
      const managedByTopicsManager = topicsListEl && window.TopicsManager;
      if (!managedByTopicsManager) {
        const scope = topicsListEl || document.getElementById('visitsTopicsList');
        if (scope) {
          scope.querySelectorAll('.topic-item').forEach(el => el.classList.remove('active'));
          const target = scope.querySelector(`.topic-item[data-id='${id}']`);
          if (target) target.classList.add('active');
        }
      }
      this.renderNewsTable();
      // show aggregated topic-level charts
      const topic = this.topics.find(t=>String(t.id)===String(this.selectedTopicId));
      if (topic) this.showTopicDetail(topic);
    }

    showTopicDetail(topic, options = {}){
      // 尝试使用访问管理部分的元素ID，如果不存在则使用通用ID
      const panel = document.getElementById('visitsDetailPanel') || document.getElementById('detailPanel');
      if(!panel) return;
      panel.style.display = 'block';
      
      const titleEl = document.getElementById('visitsDetailTitle') || document.getElementById('detailTitle');
      if (titleEl) titleEl.textContent = `话题：${topic.name}`;
      
      // Prefer local topics data when available to avoid being overwritten by external adapters
      let effectiveTopic = topic;
      try {
        const local = this.topics.find(t => String(t.id) === String(topic.id));
        if (local) effectiveTopic = local;
      } catch (e) { /* ignore and use passed topic */ }

      const totalViews = (effectiveTopic.news || []).reduce((s,n)=>s + (Number(n.views) || 0),0);
      const totalLikes = (effectiveTopic.news || []).reduce((s,n)=>s + (Number(n.likes) || 0),0);
      const totalComments = (effectiveTopic.news || []).reduce((s,n)=>s + (Number(n.comments) || 0),0);
      
      const metaEl = document.getElementById('visitsDetailMeta') || document.getElementById('detailMeta');
      if (metaEl) metaEl.textContent = `共 ${topic.news.length} 篇 • 浏览 ${totalViews} • 点赞 ${totalLikes} • 评论 ${totalComments}`;

      // generate aggregated time series by summing each news' mock series
      const rangeSelect = this.ensureTrendRangeBindings();
      const rangeValue = options.rangeValue || rangeSelect?.value || '24';
      if(rangeSelect && rangeSelect.value !== rangeValue){
        rangeSelect.value = rangeValue;
      }
      this._trendRangeLastValue = rangeValue;
      this.updateTrendRangeSummary(rangeValue);
      // initialize accumulators
      let aggLabels = null;
      let aggViews = [];
      let aggLikes = [];
      let aggComments = [];

      (effectiveTopic.news || []).forEach((n, idx) => {
        const s = this.generateTimeSeries(n, rangeValue);
        if (!aggLabels) aggLabels = s.labels.slice();
        // ensure arrays same length
        if (aggViews.length === 0) { aggViews = s.views.slice(); aggLikes = s.likes.slice(); aggComments = s.comments.slice(); }
        else {
          for (let i=0;i<s.views.length;i++){ aggViews[i] = (aggViews[i]||0) + s.views[i]; aggLikes[i] = (aggLikes[i]||0) + s.likes[i]; aggComments[i] = (aggComments[i]||0) + s.comments[i]; }
        }
      });

      if (!aggLabels) { // empty fallback
        const s = this.generateTimeSeries({views:0,likes:0,comments:0}, rangeValue);
        aggLabels = s.labels; aggViews = s.views; aggLikes = s.likes; aggComments = s.comments;
      }

      const topicContext = {
        labels: aggLabels,
        views: aggViews,
        likes: aggLikes,
        comments: aggComments,
        context: { type: 'topic', name: effectiveTopic.name || topic.name, id: effectiveTopic.id || topic.id }
      };


      this.setCurrentSeries(topicContext);
      this.cacheExternalTopic(effectiveTopic);

      // 使用通用canvas ID以确保在访话管理聚合版中也能正常显示
      this.renderViewsChart(aggLabels, aggViews, 'viewsChart');
      this.renderEngagementChart(aggLabels, aggLikes, aggComments, 'engagementChart');

      if(!options.skipContext){
        this._detailContext = {
          type: 'topic',
          topicId: topic.id,
          snapshot: this.cloneTopicPayload(effectiveTopic)
        };
      } else if (this._detailContext?.type === 'topic' && !this._detailContext.snapshot) {
        this._detailContext.snapshot = this.cloneTopicPayload(effectiveTopic);
      }
    }

    cacheExternalTopic(topic){
      if(!topic || !topic.id) return;
      if(!Array.isArray(this.topics)) this.topics = [];
      const idx = this.topics.findIndex(t => String(t.id) === String(topic.id));
      const cloned = this.cloneTopicPayload(topic) || topic;
      if(idx === -1){
        this.topics.push(cloned);
        return;
      }
      const existing = this.topics[idx] || {};
      const merged = {
        ...existing,
        ...cloned,
        news: Array.isArray(cloned?.news) && cloned.news.length ? cloned.news : existing.news
      };
      this.topics[idx] = merged;
    }

    cloneTopicPayload(topic){
      if(!topic) return null;
      try {
        if(typeof structuredClone === 'function') return structuredClone(topic);
      } catch (err) { /* fall through */ }
      try {
        return JSON.parse(JSON.stringify(topic));
      } catch (error) {
        return topic;
      }
    }

    renderNewsTable(){
      const tbody = document.getElementById('visitsNewsTbody') || document.getElementById('newsTbody');
      if(!tbody) return;
      if(!this.selectedTopicId){ tbody.innerHTML = '<tr><td colspan="6" class="text-center">请选择一个话题查看排行</td></tr>'; return; }

      const topic = this.topics.find(t=>String(t.id)===String(this.selectedTopicId));
      if(!topic){ tbody.innerHTML = '<tr><td colspan="6" class="text-center">话题未找到</td></tr>'; return; }

      const newsSource = Array.isArray(topic.news) ? topic.news : [];
      if (!newsSource.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">该话题暂无新闻数据</td></tr>';
        return;
      }

      const sortBy = document.getElementById('rankingSelect')?.value || 'score';
      const list = newsSource.map(n=> ({...n, score: this.calcScore(n)}));
      if(sortBy === 'views') list.sort((a,b)=>b.views-a.views);
      else if(sortBy === 'likes') list.sort((a,b)=>b.likes-a.likes);
      else if(sortBy === 'comments') list.sort((a,b)=>b.comments-a.comments);
      else list.sort((a,b)=> (b.score - a.score) || (b.views - a.views));

      // 默认只展示前 N 条，支持展开/收起更多
      const COLLAPSED_COUNT = 3;
      const isCollapsed = !this._newsExpanded; // 未展开视为折叠状态
      const visibleList = isCollapsed ? list.slice(0, COLLAPSED_COUNT) : list;

      let rowsHtml = visibleList.map((n, idx) => `
        <tr data-news-id="${n.id}">
          <td>${idx+1}</td>
          <td style="max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escape(n.title)}</td>
          <td>${n.views}</td>
          <td>${n.likes}</td>
          <td>${n.comments}</td>
          <td>${n.score}</td>
        </tr>
      `).join('');

      if (list.length > COLLAPSED_COUNT) {
        const toggleText = isCollapsed ? `展开剩余 ${list.length - COLLAPSED_COUNT} 条` : '收起排行';
        rowsHtml += `
          <tr class="ranking-toggle-row">
            <td colspan="6" class="text-center">
              <button id="rankingToggleBtn" class="btn btn-ghost btn-sm" type="button">${toggleText}</button>
            </td>
          </tr>
        `;
      }

      tbody.innerHTML = rowsHtml;

      // 绑定点击行展示详情
      tbody.querySelectorAll('tr[data-news-id]').forEach((tr) => {
        const nid = tr.getAttribute('data-news-id');
        tr.addEventListener('click', () => {
          const item = list.find(n => String(n.id) === String(nid));
          if (item) this.showDetail(item);
        });
      });

      // 绑定“展开/收起”按钮
      const toggleBtn = document.getElementById('rankingToggleBtn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._newsExpanded = !this._newsExpanded;
          this.renderNewsTable();
        });
      }
    }

    // 导出当前话题下新闻排行表格
    exportCurrentRanking(format){
      if (!this.selectedTopicId) {
        alert('请先选择一个话题，再导出排行');
        return;
      }
      const topic = this.topics.find(t => String(t.id) === String(this.selectedTopicId));
      if (!topic || !Array.isArray(topic.news) || topic.news.length === 0) {
        alert('当前话题暂无新闻数据可导出');
        return;
      }

      const sortBy = document.getElementById('rankingSelect')?.value || 'score';
      const list = topic.news.map(n => ({ ...n, score: this.calcScore(n) }));
      if (sortBy === 'views') list.sort((a,b)=>b.views-a.views);
      else if (sortBy === 'likes') list.sort((a,b)=>b.likes-a.likes);
      else if (sortBy === 'comments') list.sort((a,b)=>b.comments-a.comments);
      else list.sort((a,b)=> (b.score - a.score) || (b.views - a.views));

      const rows = [['排名','新闻ID','标题','浏览量','点赞数','评论数','综合得分']];
      list.forEach((n, idx) => {
        rows.push([
          idx + 1,
          n.id,
          n.title,
          n.views,
          n.likes,
          n.comments,
          n.score
        ]);
      });

      const name = topic.name || `话题-${this.selectedTopicId}`;
      this.exportRows(rows, name + '-新闻排行', format);
    }

    // 导出所有话题聚合概览
    exportTopicsOverview(format){
      if (!Array.isArray(this.topics) || this.topics.length === 0) {
        alert('暂无话题数据可导出');
        return;
      }

      const rows = [['话题ID','话题名称','新闻数量','总浏览量','总点赞数','总评论数','综合得分（前5篇合计）']];
      this.topics.forEach((t) => {
        const news = Array.isArray(t.news) ? t.news : [];
        const totalViews = news.reduce((s,n)=>s + (Number(n.views)||0), 0);
        const totalLikes = news.reduce((s,n)=>s + (Number(n.likes)||0), 0);
        const totalComments = news.reduce((s,n)=>s + (Number(n.comments)||0), 0);
        const topicScore = this.calcTopicScore(t);
        rows.push([
          t.id,
          t.name,
          news.length,
          totalViews,
          totalLikes,
          totalComments,
          topicScore
        ]);
      });

      this.exportRows(rows, '访话-话题总览', format);
    }

    // 通用导出：支持 CSV / Excel
    exportRows(rows, fileBaseName, format){
      if (!rows || !rows.length) {
        alert('暂无数据可导出');
        return;
      }

      const safeName = (fileBaseName || '导出数据').replace(/[\\/:*?"<>|]/g, '_');

      if (format === 'csv') {
        const csv = rows.map(row => row.map(field => {
          const value = field ?? '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))){
            return '"' + value.replace(/"/g,'""') + '"';
          }
          return value;
        }).join(',')).join('\n');
        if (window.Utils && typeof window.Utils.downloadData === 'function') {
          window.Utils.downloadData(csv, `${safeName}.csv`, 'text/csv;charset=utf-8');
        } else {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${safeName}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        return;
      }

      if (format === 'excel') {
        if (typeof XLSX === 'undefined') {
          alert('Excel导出库未加载，请刷新页面后重试');
          return;
        }
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const colCount = rows[0].length;
        worksheet['!cols'] = Array.from({ length: colCount }).map(() => ({ wch: 16 }));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '数据');
        XLSX.writeFile(workbook, `${safeName}.xlsx`);
        return;
      }

      // 未识别格式时，默认导出为 CSV
      this.exportRows(rows, fileBaseName, 'csv');
    }

    describeTrendRange(value) {
      const map = {
        '24': '过去24小时（按小时）',
        '168': '过去7天（按小时）',
        '30d': '过去30天（按天）'
      };
      return map[value] || '自定义范围';
    }

    describeRankingSort(value) {
      const map = {
        score: '综合得分（默认）',
        views: '按浏览量',
        likes: '按点赞数',
        comments: '按评论数'
      };
      return map[value] || '综合得分（默认）';
    }

    formatDateTime(value) {
      if (!value) return '-';
      if (window.Utils && typeof window.Utils.formatTime === 'function') {
        try { return window.Utils.formatTime(value, 'full'); } catch (e) {}
      }
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    sanitizeFilename(name) {
      return (name || '趋势数据').replace(/[\\/:*?"<>|]/g, '_');
    }

    getRankingSortKey(){
      const select = document.getElementById('rankingSelect');
      return (select && select.value) || 'score';
    }

    buildTopicNewsRows(topic){
      if(!topic || !Array.isArray(topic.news)) return null;
      const sortBy = this.getRankingSortKey();
      const enriched = topic.news.map((n) => {
        const views = Number(n.views) || 0;
        const likes = Number(n.likes) || 0;
        const comments = Number(n.comments) || 0;
        const score = this.calcScore({ views, likes, comments });
        return { ...n, views, likes, comments, score };
      });

      if (sortBy === 'views') enriched.sort((a,b)=>b.views - a.views);
      else if (sortBy === 'likes') enriched.sort((a,b)=>b.likes - a.likes);
      else if (sortBy === 'comments') enriched.sort((a,b)=>b.comments - a.comments);
      else enriched.sort((a,b)=> (b.score - a.score) || (b.views - a.views));

      return {
        sortBy,
        header: ['排名','新闻ID','新闻标题','浏览量','点赞数','评论数','综合得分'],
        rows: enriched.map((item, idx) => [
          idx + 1,
          item.id,
          item.title,
          item.views,
          item.likes,
          item.comments,
          item.score
        ])
      };
    }

    buildTopicMeta(topic) {
      if (!topic) return null;
      const news = Array.isArray(topic.news) ? topic.news : [];
      const totalViews = news.reduce((sum, item) => sum + (Number(item.views) || 0), 0);
      const totalLikes = news.reduce((sum, item) => sum + (Number(item.likes) || 0), 0);
      const totalComments = news.reduce((sum, item) => sum + (Number(item.comments) || 0), 0);
      return {
        id: topic.id,
        name: topic.name || topic.title || `话题-${topic.id}`,
        newsCount: news.length,
        totalViews,
        totalLikes,
        totalComments
      };
    }

    buildArticleMeta(article, topic) {
      if (!article) return null;
      return {
        id: article.id,
        title: article.title || `新闻-${article.id}`,
        topicId: topic?.id || null,
        topicName: topic?.name || topic?.title || null,
        views: Number(article.views) || 0,
        likes: Number(article.likes) || 0,
        comments: Number(article.comments) || 0,
        score: this.calcScore({ views: Number(article.views) || 0, likes: Number(article.likes) || 0, comments: Number(article.comments) || 0 })
      };
    }

    getDetailExportSnapshot() {
      if (!this._currentSeries || !Array.isArray(this._currentSeries.labels) || !this._currentSeries.labels.length) {
        return null;
      }

      const generatedAt = new Date();
      const trendSelect = this._trendRangeSelect || document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
      const rangeValue = trendSelect ? trendSelect.value : '24';
      const context = this._currentSeries.context || {};

      const labels = Array.isArray(this._currentSeries.labels) ? [...this._currentSeries.labels] : [];
      const views = Array.isArray(this._currentSeries.views) ? [...this._currentSeries.views] : [];
      const likes = Array.isArray(this._currentSeries.likes) ? [...this._currentSeries.likes] : [];
      const comments = Array.isArray(this._currentSeries.comments) ? [...this._currentSeries.comments] : [];
      const maxLen = Math.max(labels.length, views.length, likes.length, comments.length);
      if (!maxLen) return null;

      while (labels.length < maxLen) labels.push('');
      while (views.length < maxLen) views.push(0);
      while (likes.length < maxLen) likes.push(0);
      while (comments.length < maxLen) comments.push(0);

      const rows = [];
      let totalViews = 0;
      let totalLikes = 0;
      let totalComments = 0;
      let peakViews = 0;
      let peakLikes = 0;
      let peakComments = 0;
      for (let i = 0; i < maxLen; i++) {
        const rowViews = Number(views[i]) || 0;
        const rowLikes = Number(likes[i]) || 0;
        const rowComments = Number(comments[i]) || 0;
        rows.push([labels[i], rowViews, rowLikes, rowComments]);
        totalViews += rowViews;
        totalLikes += rowLikes;
        totalComments += rowComments;
        peakViews = Math.max(peakViews, rowViews);
        peakLikes = Math.max(peakLikes, rowLikes);
        peakComments = Math.max(peakComments, rowComments);
      }

      const topicId = context.type === 'topic'
        ? (context.id || context.topicId)
        : (context.topicId || this.selectedTopicId);
      let topicMeta = null;
      let topicRef = null;
      let topicNews = null;
      if (topicId) {
        topicRef = this.topics.find(t => String(t.id) === String(topicId)) || null;
        if (topicRef) {
          topicMeta = this.buildTopicMeta(topicRef);
          topicNews = this.buildTopicNewsRows(topicRef);
        }
      }

      let articleMeta = null;
      if (context.type === 'article') {
        let topicForArticle = null;
        if (topicMeta) {
          topicForArticle = this.topics.find(t => String(t.id) === String(topicMeta.id)) || null;
        }
        if (!topicForArticle && topicRef) {
          topicForArticle = topicRef;
        }
        if (!topicForArticle && context.topicId) {
          topicForArticle = this.topics.find(t => String(t.id) === String(context.topicId)) || null;
        }
        if (!topicForArticle && this.selectedTopicId) {
          topicForArticle = this.topics.find(t => String(t.id) === String(this.selectedTopicId)) || null;
        }

        let article = topicForArticle?.news?.find(n => String(n.id) === String(context.id));
        if (!article && this._detailContext?.snapshot && String(this._detailContext.snapshot.id) === String(context.id)) {
          article = this._detailContext.snapshot;
        }
        articleMeta = this.buildArticleMeta(article, topicForArticle);
      }

      return {
        generatedAt,
        rangeValue,
        rangeLabel: this.describeTrendRange(rangeValue),
        contextType: context.type || 'article',
        topic: topicMeta,
        article: articleMeta,
        topicNews,
        totals: {
          points: maxLen,
          views: totalViews,
          likes: totalLikes,
          comments: totalComments,
          avgViews: maxLen ? Number((totalViews / maxLen).toFixed(2)) : 0,
          avgLikes: maxLen ? Number((totalLikes / maxLen).toFixed(2)) : 0,
          avgComments: maxLen ? Number((totalComments / maxLen).toFixed(2)) : 0
        },
        peaks: {
          views: peakViews,
          likes: peakLikes,
          comments: peakComments
        },
        rows,
        seriesHeader: ['时间', '浏览量', '点赞数', '评论数']
      };
    }

    buildDetailSummaryRows(snapshot, { includeSeries = true } = {}) {
      const rows = [
        ['导出时间', this.formatDateTime(snapshot.generatedAt)],
        ['数据类型', snapshot.contextType === 'topic' ? '话题趋势' : '新闻趋势'],
        ['趋势范围', snapshot.rangeLabel],
        ['数据点数量', snapshot.totals.points],
        ['累计浏览', snapshot.totals.views],
        ['累计点赞', snapshot.totals.likes],
        ['累计评论', snapshot.totals.comments],
        ['平均浏览', snapshot.totals.avgViews],
        ['平均点赞', snapshot.totals.avgLikes],
        ['平均评论', snapshot.totals.avgComments],
        ['峰值浏览', snapshot.peaks.views],
        ['峰值点赞', snapshot.peaks.likes],
        ['峰值评论', snapshot.peaks.comments]
      ];

      if (snapshot.topic) {
        rows.push([]);
        rows.push(['话题概览']);
        rows.push(['话题ID', snapshot.topic.id]);
        rows.push(['话题名称', snapshot.topic.name]);
        rows.push(['关联新闻数', snapshot.topic.newsCount]);
        rows.push(['话题累计浏览', snapshot.topic.totalViews]);
        rows.push(['话题累计点赞', snapshot.topic.totalLikes]);
        rows.push(['话题累计评论', snapshot.topic.totalComments]);
      }

      if (snapshot.topicNews?.rows?.length) {
        rows.push([]);
        rows.push(['话题新闻列表', `排序方式：${this.describeRankingSort(snapshot.topicNews.sortBy)}`]);
        rows.push(snapshot.topicNews.header);
        rows.push(...snapshot.topicNews.rows);
      }

      if (snapshot.article) {
        rows.push([]);
        rows.push(['新闻详情']);
        rows.push(['新闻ID', snapshot.article.id]);
        rows.push(['新闻标题', snapshot.article.title]);
        if (snapshot.article.topicName) {
          rows.push(['所属话题', `${snapshot.article.topicName} (${snapshot.article.topicId || ''})`]);
        }
        rows.push(['浏览量', snapshot.article.views]);
        rows.push(['点赞', snapshot.article.likes]);
        rows.push(['评论', snapshot.article.comments]);
        rows.push(['综合得分', snapshot.article.score]);
      }

      if (includeSeries) {
        rows.push([]);
        rows.push(['趋势明细']);
        rows.push(snapshot.seriesHeader);
        rows.push(...snapshot.rows);
      }

      return rows;
    }

    convertRowsToCsv(rows) {
      if (!Array.isArray(rows)) return '';
      return rows.map((row) => {
        if (!Array.isArray(row) || !row.length) return '';
        return row.map((value) => {
          if (value === undefined || value === null) return '';
          const str = String(value);
          if (/[",\n]/.test(str)) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        }).join(',');
      }).join('\n');
    }

    showDetail(item, options = {}){
      // show detail panel and render charts
      const panel = document.getElementById('visitsDetailPanel') || document.getElementById('detailPanel');
      if(!panel) return;
      panel.style.display = 'block';
      
      const titleEl = document.getElementById('visitsDetailTitle') || document.getElementById('detailTitle');
      if (titleEl) titleEl.textContent = item.title;
      
      const metaEl = document.getElementById('visitsDetailMeta') || document.getElementById('detailMeta');
      if (metaEl) metaEl.textContent = `浏览 ${item.views} • 点赞 ${item.likes} • 评论 ${item.comments}`;

      // generate mock time series
      const rangeEl = document.getElementById('visitsTrendRange') || document.getElementById('trendRange');
      const range = options.rangeValue || rangeEl?.value || '24';
      if(rangeEl && rangeEl.value !== range){
        rangeEl.value = range;
      }
      this._trendRangeLastValue = range;
      this.updateTrendRangeSummary(range);
      const series = this.generateTimeSeries(item, range);

      this.setCurrentSeries({
        labels: series.labels,
        views: series.views,
        likes: series.likes,
        comments: series.comments,
        context: { type: 'article', id: item.id, title: item.title, topicId: this.selectedTopicId }
      });

      this.renderViewsChart(series.labels, series.views, 'viewsChart');
      this.renderEngagementChart(series.labels, series.likes, series.comments, 'engagementChart');

      if(!options.skipContext){
        this._detailContext = { type: 'article', id: item.id, topicId: this.selectedTopicId, snapshot: item };
      }
    }

    // generate mock hourly/day series for a news item
    generateTimeSeries(item, range){
      const normalizedRange = ['24','168','30d'].includes(range) ? range : '24';
      const now = Date.now();
      const labels = [];
      const views = [];
      const likes = [];
      const comments = [];

      if(normalizedRange === '24'){
        for(let h=23; h>=0; h--){
          const t = new Date(now - h*3600*1000);
          labels.push(`${t.getHours()}:00`);
          // generate proportionate numbers around total
          const v = Math.max(0, Math.round(item.views * (0.02 + Math.random()*0.08)));
          views.push(v);
          likes.push(Math.max(0, Math.round(item.likes * (0.02 + Math.random()*0.06))));
          comments.push(Math.max(0, Math.round(item.comments * (0.01 + Math.random()*0.03))));
        }
      } else if(normalizedRange === '168'){
        for(let h=167; h>=0; h-=6){
          const t = new Date(now - h*3600*1000);
          labels.push(`${t.getMonth()+1}/${t.getDate()} ${t.getHours()}:00`);
          const v = Math.max(0, Math.round(item.views * (0.01 + Math.random()*0.05)));
          views.push(v);
          likes.push(Math.max(0, Math.round(item.likes * (0.01 + Math.random()*0.04))));
          comments.push(Math.max(0, Math.round(item.comments * (0.005 + Math.random()*0.02))));
        }
      } else { // '30d'
        for(let d=29; d>=0; d--){
          const t = new Date(now - d*24*3600*1000);
          labels.push(`${t.getMonth()+1}/${t.getDate()}`);
          const v = Math.max(0, Math.round(item.views * (0.02 + Math.random()*0.06)));
          views.push(v);
          likes.push(Math.max(0, Math.round(item.likes * (0.01 + Math.random()*0.04))));
          comments.push(Math.max(0, Math.round(item.comments * (0.005 + Math.random()*0.02))));
        }
      }

      return { labels, views, likes, comments };
    }

    renderViewsChart(labels, data, canvasId = 'viewsChart'){
      if(!window.Chart) {
        // Chart.js 未加载，使用回退渲染
        this.renderFallbackCharts(canvasId, labels, [{ label: '浏览量', data }]);
        return;
      }

      if (!labels || !data || !Array.isArray(labels) || !Array.isArray(data)) {
        console.error('Invalid chart data for views chart:', { labels, data });
        return;
      }

      if (labels.length !== data.length) {
        const maxLen = Math.max(labels.length, data.length);
        if (maxLen === 0) {
          labels = ['无数据'];
          data = [0];
        } else {
          while (data.length < maxLen) data.push(0);
          while (labels.length < maxLen) labels.push('');
        }
      }

      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      // 恢复 canvas 可见性，移除回退视图
      if (canvas._fallbackWrapper) {
        try {
          canvas._fallbackWrapper.remove();
        } catch (err) {}
        canvas._fallbackWrapper = null;
      }
      canvas.style.removeProperty('display');

      const ctx = canvas.getContext('2d');
      if(!ctx) return;

      this._chartRegistry = this._chartRegistry || {};
      const previous = this._chartRegistry[canvasId] || this._viewsChart;
      if(previous && typeof previous.destroy === 'function'){
        try { previous.destroy(); } catch (err) {}
      } else if (typeof Chart.getChart === 'function') {
        const existing = Chart.getChart(canvas);
        if(existing){
          try { existing.destroy(); } catch (err) {}
        }
      }

      this.ensureZoomPlugin();
      this._viewsChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label:'浏览量',
            data,
            borderColor: 'rgba(109,94,242,1)',
            backgroundColor: 'rgba(109,94,242,0.15)',
            fill:true,
            tension:0.3,
            pointRadius:3,
            pointHoverRadius:5
          }]
        },
        options: {
          responsive:true,
          maintainAspectRatio:false,
          interaction: { mode:'nearest', intersect:false },
          plugins:{
            legend:{display:false},
            tooltip:{
              callbacks:{
                label:(ctx)=>` ${ctx.dataset.label}: ${ctx.formattedValue}`
              }
            },
            zoom: this.getZoomConfig()
          },
          scales:{
            x:{
              display:true,
              grid:{ color:'rgba(148,163,184,0.15)' }
            },
            y:{
              display:true,
              grid:{ color:'rgba(148,163,184,0.15)' }
            }
          }
        }
      });
      this._chartRegistry[canvasId] = this._viewsChart;
    }

    renderEngagementChart(labels, likes, comments, canvasId = 'engagementChart'){
      if(!window.Chart) {
        // Chart.js 未加载，分别渲染点赞/评论两个回退条形摘要
        this.renderFallbackCharts(canvasId, labels, [{ label: '互动（点赞/评论）', data: likes }]);
        return;
      }

      if (!Array.isArray(labels)) labels = [];
      if (!Array.isArray(likes)) likes = [];
      if (!Array.isArray(comments)) comments = [];

      let maxLen = Math.max(labels.length, likes.length, comments.length);
      if (!maxLen || maxLen <= 0) {
        labels = ['示例'];
        likes = [1];
        comments = [0];
        maxLen = 1;
      } else {
        while (likes.length < maxLen) likes.push(0);
        while (comments.length < maxLen) comments.push(0);
        while (labels.length < maxLen) labels.push('');
      }

      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      if (canvas._fallbackWrapper) {
        try {
          canvas._fallbackWrapper.remove();
        } catch (err) {}
        canvas._fallbackWrapper = null;
      }
      canvas.style.removeProperty('display');

      const ctx = canvas.getContext('2d');
      if(!ctx) return;

      this._chartRegistry = this._chartRegistry || {};
      const previous = this._chartRegistry[canvasId] || this._engChart;
      if(previous && typeof previous.destroy === 'function'){
        try { previous.destroy(); } catch (err) {}
      } else if (typeof Chart.getChart === 'function') {
        const existing = Chart.getChart(canvas);
        if(existing){
          try { existing.destroy(); } catch (err) {}
        }
      }

      this.ensureZoomPlugin();
      this._engChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label:'点赞', data:likes, backgroundColor:'rgba(16,185,129,0.85)' },
            { label:'评论', data:comments, backgroundColor:'rgba(59,130,246,0.85)' }
          ]
        },
        options: {
          responsive:true,
          maintainAspectRatio:false,
          interaction:{ mode:'index', intersect:false },
          plugins:{
            legend:{ position:'top' },
            tooltip:{
              callbacks:{
                label:(ctx)=>` ${ctx.dataset.label}: ${ctx.formattedValue}`
              }
            },
            zoom: this.getZoomConfig()
          },
          scales:{
            x:{
              display:true,
              grid:{ color:'rgba(148,163,184,0.15)' }
            },
            y:{
              beginAtZero:true,
              grid:{ color:'rgba(148,163,184,0.15)' }
            }
          }
        }
      });
      this._chartRegistry[canvasId] = this._engChart;
    }

    resolveZoomPlugin(){
      const candidates = [
        window['chartjs-plugin-zoom'],
        window.chartjsPluginZoom,
        window.chartjsZoomPlugin,
        window.ChartZoom,
        window.ChartZoomPlugin
      ];
      for(const candidate of candidates){
        if(!candidate) continue;
        if(typeof candidate === 'object' && candidate.default){
          return candidate.default;
        }
        return candidate;
      }
      return null;
    }

    ensureZoomPlugin(){
      if(this._zoomRegistered) return true;
      if(!window.Chart || typeof window.Chart.register !== 'function') return false;
      const zoomPlugin = this.resolveZoomPlugin();
      if(!zoomPlugin){
        console.warn('[VisitManager] chartjs-plugin-zoom 未加载，缩放功能暂不可用');
        return false;
      }
      try {
        window.Chart.register(zoomPlugin);
        this._zoomRegistered = true;
      } catch (error) {
        console.error('[VisitManager] 注册 chartjs-plugin-zoom 失败', error);
        return false;
      }
      return true;
    }

    getZoomConfig(){
      return {
        pan: {
          enabled: true,
          mode: 'x',
          modifierKey: 'ctrl'
        },
        limits: {
          x: { min: 'original', max: 'original' }
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          drag: {
            enabled: true,
            modifierKey: 'shift',
            backgroundColor: 'rgba(109,94,242,0.15)',
            borderColor: 'rgba(109,94,242,0.35)'
          },
          mode: 'x'
        }
      };
    }

    resetZoom(){
      if(typeof Chart === 'undefined') return;
      const processed = new Set();
      const tryReset = (chart) => {
        if(!chart || processed.has(chart)) return;
        processed.add(chart);
        if(typeof chart.resetZoom === 'function') {
          try { chart.resetZoom(); } catch (err) {}
        }
      };

      tryReset(this._viewsChart);
      tryReset(this._engChart);

      if(this._chartRegistry){
        Object.values(this._chartRegistry).forEach((chart) => tryReset(chart));
      }

      const fallbackCanvasIds = ['viewsChart','engagementChart','visitsViewsChart','visitsEngagementChart'];
      fallbackCanvasIds.forEach((id) => {
        const canvas = document.getElementById(id);
        if(!canvas) return;
        const chart = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
        tryReset(chart);
      });
    }

    updateTrendRangeSummary(value){
      if(!value) value = '24';
      const el = this._trendRangeSummary || document.getElementById('trendRangeSummary');
      if(el) el.textContent = this.describeTrendRange(value);
    }

    setCurrentSeries(payload){
      this._currentSeries = payload;
    }

    // 若 Chart.js 未加载，使用轻量 DOM 回退渲染以保证页面可视化可见
    renderFallbackCharts(containerCanvasId, labels, datasets) {
      try {
        const canvas = document.getElementById(containerCanvasId);
        if (!canvas) return;
        // 隐藏 canvas，使用父容器插入回退面板
        canvas.style.display = 'none';
        let wrapper = canvas._fallbackWrapper;
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.className = 'chart-fallback-wrapper';
          wrapper.style.padding = '8px';
          wrapper.style.display = 'grid';
          wrapper.style.gridTemplateColumns = '1fr';
          wrapper.style.gap = '6px';
          canvas.parentNode.insertBefore(wrapper, canvas.nextSibling);
          canvas._fallbackWrapper = wrapper;
        } else {
          wrapper.innerHTML = '';
        }

        // 简单标题
        const title = document.createElement('div');
        title.style.fontSize = '13px';
        title.style.color = '#333';
        title.style.fontWeight = '600';
        title.textContent = datasets[0]?.label || '趋势数据（回退）';
        wrapper.appendChild(title);

        // 绘制一条简单的条形图（缩略）用于展示数据走向
        const series = datasets[0]?.data || [];
        const max = series.reduce((m, v) => Math.max(m, Number(v) || 0), 0) || 1;
        const bars = document.createElement('div');
        bars.style.display = 'flex';
        bars.style.alignItems = 'end';
        bars.style.gap = '4px';
        bars.style.height = '120px';

        series.slice(-24).forEach((v) => {
          const h = (Number(v) || 0) / max * 100;
          const b = document.createElement('div');
          b.style.width = '8px';
          b.style.height = `${h}%`;
          b.style.background = 'linear-gradient(180deg, rgba(109,94,242,0.9), rgba(109,94,242,0.4))';
          b.title = String(v);
          bars.appendChild(b);
        });
        wrapper.appendChild(bars);

        // 附加简单数值摘要
        const summary = document.createElement('div');
        summary.style.fontSize = '12px';
        summary.style.color = 'var(--muted)';
        const total = series.reduce((s, x) => s + (Number(x) || 0), 0);
        summary.textContent = `样本点: ${series.length}，总计: ${total}`;
        wrapper.appendChild(summary);
      } catch (e) {
        console.warn('renderFallbackCharts error', e);
      }
    }

    exportCurrentSeries(format){
      const snapshot = this.getDetailExportSnapshot();
      if(!snapshot){
        alert('当前无可导出的趋势数据');
        return;
      }

      const baseName = this._currentSeries?.context?.title
        || snapshot.article?.title
        || snapshot.topic?.name
        || '趋势数据';
      const safeName = this.sanitizeFilename(`${baseName}-趋势明细`);

      if(format === 'csv'){
        const csvRows = this.buildDetailSummaryRows(snapshot, { includeSeries: true });
        const csv = this.convertRowsToCsv(csvRows);
        if(window.Utils && typeof window.Utils.downloadData === 'function'){
          window.Utils.downloadData(csv, `${safeName}.csv`, 'text/csv;charset=utf-8');
        }
        return;
      }

      if(format === 'excel'){
        if(typeof XLSX === 'undefined'){
          alert('Excel导出库未加载，请刷新页面后重试');
          return;
        }

        const workbook = XLSX.utils.book_new();
        const summarySheet = XLSX.utils.aoa_to_sheet(this.buildDetailSummaryRows(snapshot, { includeSeries: false }));
        XLSX.utils.book_append_sheet(workbook, summarySheet, '概要');

        const trendRows = [snapshot.seriesHeader, ...snapshot.rows];
        const trendSheet = XLSX.utils.aoa_to_sheet(trendRows);
        trendSheet['!cols'] = [
          { wch: 20 },
          { wch: 14 },
          { wch: 14 },
          { wch: 14 }
        ];
        XLSX.utils.book_append_sheet(workbook, trendSheet, '趋势数据');

        if(snapshot.topicNews?.rows?.length){
          const topicNewsSheet = XLSX.utils.aoa_to_sheet([snapshot.topicNews.header, ...snapshot.topicNews.rows]);
          topicNewsSheet['!cols'] = [
            { wch: 10 },
            { wch: 16 },
            { wch: 44 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 14 }
          ];
          XLSX.utils.book_append_sheet(workbook, topicNewsSheet, '话题新闻');
        }

        XLSX.writeFile(workbook, `${safeName}.xlsx`);
        return;
      }

      alert('暂不支持的导出格式，请选择 CSV 或 Excel');
    }

    refreshCurrentDetail(rangeOverride){
      const resolvedRange = rangeOverride || this._trendRangeSelect?.value || document.getElementById('visitsTrendRange')?.value || document.getElementById('trendRange')?.value || '24';
      if(!this._detailContext){
        if(this.selectedTopicId){
          const fallbackTopic = this.topics.find(t => String(t.id) === String(this.selectedTopicId));
          if(fallbackTopic){
            this.showTopicDetail(fallbackTopic, { rangeValue: resolvedRange });
            return;
          }
        }
        const panel = document.getElementById('detailPanel');
        if(panel) panel.style.display = 'none';
        return;
      }

      if(this._detailContext.type === 'topic'){
        let topic = this.topics.find(t => String(t.id) === String(this._detailContext.topicId));
        if(!topic && this._detailContext.snapshot){
          topic = this._detailContext.snapshot;
        }
        if(topic){
          this.showTopicDetail(topic, { skipContext: true, rangeValue: resolvedRange });
        } else {
          this._detailContext = null;
          this.refreshCurrentDetail(resolvedRange);
        }
        return;
      }

      if(this._detailContext.type === 'article'){
        const topic = this.topics.find(t => String(t.id) === String(this._detailContext.topicId));
        const article = topic?.news.find(n => String(n.id) === String(this._detailContext.id));
        if(article){
          this.showDetail(article, { skipContext: true, rangeValue: resolvedRange });
        } else if(this._detailContext.snapshot){
          this.showDetail(this._detailContext.snapshot, { skipContext: true, rangeValue: resolvedRange });
        } else {
          this._detailContext = null;
          this.refreshCurrentDetail(resolvedRange);
        }
      }
    }

    updateStats(){
      // 在访话管理页面，统计信息由CombinedManager统一处理
      // 但仍保留对原ID的支持，以确保在独立访问页面时正常工作
      const topicsCount = document.getElementById('topicsCount') || document.getElementById('topicCount');
      const newsCount = document.getElementById('newsCount');
      if(topicsCount) topicsCount.textContent = String(this.topics.length);
      if(newsCount) {
        const totalNews = this.topics.reduce((sum, topic) => {
          if (!topic || !Array.isArray(topic.news)) return sum;
          return sum + topic.news.length;
        }, 0);
        newsCount.textContent = String(totalNews);
      }
    }

    escape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    generateMockData(){
      this.applyTopics(this.createMockTopics());
    }

    createMockTopics(){
      const topics = ['娱乐','科技','社会','体育','财经','时政','健康','旅游','教育','汽车'];
      return topics.slice(0,8).map((name, i)=>{
        const newsCount = 8 + Math.floor(Math.random()*10);
        const news = Array.from({length:newsCount}).map((_,j)=>{
          // 为每条新闻生成更稳定且非零的互动数据
          const baseViews = 500 + Math.floor(Math.random()*20000);
          const baseLikes = Math.max(10, Math.floor(baseViews * (0.02 + Math.random()*0.08)));
          const baseComments = Math.max(5, Math.floor(baseViews * (0.01 + Math.random()*0.04)));
          return {
            id: `${i+1}-${j+1}`,
            title: `${name} 相关新闻标题 ${j+1}`,
            views: baseViews,
            likes: baseLikes,
            comments: baseComments
          };
        });
        return { id: i+1, name, news };
      });
    }

    // 添加新话题的功能
    async addTopic(topicData) {
      if (!topicData || !topicData.name) {
        throw new Error('话题名称不能为空');
      }

      const newTopic = {
        id: `topic-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: topicData.name,
        news: topicData.news || [],
        createdAt: new Date().toISOString()
      };

      this.topics.push(newTopic);
      // 重新渲染话题列表
      this.renderTopics();
      // 如果当前没有选中话题，则选中新创建的话题
      if (!this.selectedTopicId) {
        this.selectTopic(newTopic.id);
      }

      this.emitTopicsUpdated({ reason: 'add-topic', topicId: newTopic.id });

      return newTopic;
    }

    // 添加新闻到话题的功能
    async addNewsToTopic(topicId, newsData) {
      if (!topicId || !newsData || !newsData.title) {
        throw new Error('话题ID和新闻标题不能为空');
      }

      const topic = this.topics.find(t => String(t.id) === String(topicId));
      if (!topic) {
        throw new Error('话题不存在');
      }

      const newNews = {
        id: `news-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: newsData.title,
        views: newsData.views || Math.floor(Math.random() * 10000),
        likes: newsData.likes || Math.floor(Math.random() * 500),
        comments: newsData.comments || Math.floor(Math.random() * 100)
      };

      topic.news.push(newNews);

      // 如果当前正在查看该话题详情，则更新显示
      if (String(this.selectedTopicId) === String(topicId)) {
        this.selectTopic(topicId);
      }

      // 更新统计数据
      this.updateStats();

      this.emitTopicsUpdated({ reason: 'add-news', topicId, newsId: newNews.id });

      return newNews;
    }
  }

  window.VisitManager = new VisitManager();
})();

// 访问趋势页在后端不可用时的 mock 数据
// 仅在明确配置为使用本地 mock 时注册 mock handler，避免在启用真实后端时被 mock 覆盖
if (window.api && window.VisitManager) {
  try {
    const flags = (window.AppConfig && window.AppConfig.FEATURE_FLAGS) || {};
    if (flags.USE_REAL_BACKEND === false) {
      window.api.registerMock('/admin/analytics/trends', async () => {
        return window.VisitManager.createMockTopics();
      });
    }
  } catch (error) {}
}

// 额外注册 analytics/trends 的 mock 变体以覆盖不同的 URL 拼接方式（确保回退生效）
if (window.api && window.VisitManager) {
  try {
    // 基本注册（不带 base 前缀）
    window.api.registerMock('/admin/analytics/trends', async (method, path, options) => {
      return window.VisitManager.createMockTopics();
    });

    // 带 base 前缀的变体
    try {
      const base = (window.AppConfig && window.AppConfig.API_BASE_URL) || '';
      if (base) {
        const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
        const prefixed = normalizedBase + '/admin/analytics/trends';
        window.api.registerMock(prefixed, async (method, path, options) => {
          return window.VisitManager.createMockTopics();
        });
        // 匹配任意以 /admin/analytics/trends 结尾的 URL（包含完整域名的情况）
        window.api.registerMock(/\/admin\/analytics\/trends$/, async (method, path, options) => {
          return window.VisitManager.createMockTopics();
        });
      }
    } catch (e) { /* ignore */ }
  } catch (e) {}
}

// 为新增功能注册mock处理器
if (window.api && window.VisitManager) {
  try {
    // 添加话题的mock处理器
    window.api.registerMock(/\/admin\/topics$/, async (method, path, options) => {
      if (method.toLowerCase() === 'post') {
        // 模拟添加话题
        const topicData = options && options.body ? options.body : {};
        const newTopic = await window.VisitManager.addTopic(topicData);
        return { code: 200, message: 'success', data: newTopic };
      } else if (method.toLowerCase() === 'get') {
        // 获取话题列表
        return { code: 200, message: 'success', data: window.VisitManager.topics };
      }
      return { code: 400, message: 'Method not allowed' };
    });

    // 添加新闻到话题的mock处理器
    window.api.registerMock(/\/admin\/topics\/.*\/news$/, async (method, path, options) => {
      if (method.toLowerCase() === 'post') {
        // 从路径中提取话题ID
        const match = path.match(/\/admin\/topics\/([^\/]+)\/news/);
        if (!match || !match[1]) {
          return { code: 400, message: 'Invalid topic ID' };
        }
        const topicId = match[1];
        const newsData = options && options.body ? options.body : {};
        const newNews = await window.VisitManager.addNewsToTopic(topicId, newsData);
        return { code: 200, message: 'success', data: newNews };
      }
      return { code: 400, message: 'Method not allowed' };
    });

    // 为兼容性，也注册到不同的路径
    window.api.registerMock(/\/topic$/, async (method, path, options) => {
      if (method.toLowerCase() === 'post') {
        // 模拟添加话题
        const topicData = options && options.body ? options.body : {};
        const newTopic = await window.VisitManager.addTopic(topicData);
        return { code: 200, message: 'success', data: newTopic };
      }
      return { code: 400, message: 'Method not allowed' };
    });

    window.api.registerMock(/\/topic\/.*\/news$/, async (method, path, options) => {
      if (method.toLowerCase() === 'post') {
        // 从路径中提取话题ID
        const match = path.match(/\/topic\/([^\/]+)\/news/);
        if (!match || !match[1]) {
          return { code: 400, message: 'Invalid topic ID' };
        }
        const topicId = match[1];
        const newsData = options && options.body ? options.body : {};
        const newNews = await window.VisitManager.addNewsToTopic(topicId, newsData);
        return { code: 200, message: 'success', data: newNews };
      }
      return { code: 400, message: 'Method not allowed' };
    });
  } catch (e) { /* ignore */ }
}

