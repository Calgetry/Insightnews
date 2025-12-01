(function(){
  const statusText = {
    pending: '待处理',
    reviewing: '处理中',
    resolved: '已处理'
  };

  const severityText = {
    high: '高',
    medium: '中',
    low: '低'
  };

  const ReportsManager = {
    state: {
      reports: [],
      filtered: [],
      selectedId: null,
      filters: {
        query: '',
        status: '',
        severity: '',
        range: '30d'
      }
    },

    init(){
      if(!Auth.isLoggedIn()){
        window.location.href = 'index.html';
        return;
      }
      this.cacheDom();
      this.bindEvents();
      this.reloadData();
    },

    cacheDom(){
      this.searchInput = document.getElementById('reportSearch');
      this.searchBtn = document.getElementById('reportSearchBtn');
      this.statusFilter = document.getElementById('statusFilter');
      this.severityFilter = document.getElementById('severityFilter');
      this.rangeFilter = document.getElementById('rangeFilter');
      this.refreshBtn = document.getElementById('reportRefresh');
      this.tableBody = document.getElementById('reportsTbody');
      this.countLabel = document.getElementById('reportCount');
      this.summaryTotal = document.getElementById('summaryTotal');
      this.summaryPending = document.getElementById('summaryPending');
      this.summaryCritical = document.getElementById('summaryCritical');
      this.summarySync = document.getElementById('summarySync');
      this.detailBody = document.getElementById('reportDetailBody');
      this.detailEmpty = document.getElementById('reportEmpty');
      this.detailStatus = document.getElementById('detailStatus');
      this.detailSubject = document.getElementById('detailSubject');
      this.detailTopic = document.getElementById('detailTopic');
      this.detailEmail = document.getElementById('detailEmail');
      this.detailReporter = document.getElementById('detailReporter');
      this.detailSeverity = document.getElementById('detailSeverity');
      this.detailTime = document.getElementById('detailTime');
      this.detailMessage = document.getElementById('detailMessage');
      this.detailNotes = document.getElementById('detailNotes');
      this.markReviewBtn = document.getElementById('markReviewBtn');
      this.markResolvedBtn = document.getElementById('markResolvedBtn');
    },

    bindEvents(){
      if(this.searchInput){
        this.searchInput.addEventListener('input', Utils.debounce(() => {
          this.state.filters.query = this.searchInput.value.trim();
          this.applyFilters();
        }, 250));
      }

      if(this.searchBtn){
        this.searchBtn.addEventListener('click', () => {
          this.state.filters.query = this.searchInput?.value.trim() || '';
          this.applyFilters();
        });
      }

      if(this.statusFilter){
        this.statusFilter.addEventListener('change', () => {
          this.state.filters.status = this.statusFilter.value;
          this.applyFilters();
        });
      }

      if(this.severityFilter){
        this.severityFilter.addEventListener('change', () => {
          this.state.filters.severity = this.severityFilter.value;
          this.applyFilters();
        });
      }

      if(this.rangeFilter){
        this.rangeFilter.addEventListener('change', () => {
          this.state.filters.range = this.rangeFilter.value;
          this.applyFilters();
        });
      }

      if(this.refreshBtn){
        this.refreshBtn.addEventListener('click', () => this.reloadData());
      }

      if(this.tableBody){
        this.tableBody.addEventListener('click', (e) => {
          const row = e.target.closest('tr');
          if(!row || !row.dataset.reportId) return;
          this.selectReport(row.dataset.reportId);
        });
      }

      if(this.markReviewBtn){
        this.markReviewBtn.addEventListener('click', () => this.updateSelectedStatus('reviewing'));
      }

      if(this.markResolvedBtn){
        this.markResolvedBtn.addEventListener('click', () => this.updateSelectedStatus('resolved'));
      }
    },

    reloadData(){
      const endpoints = (window.AppConfig && window.AppConfig.ENDPOINTS) || {};
      const reportsPath = endpoints.reports ? endpoints.reports.list : '/admin/reports';
      const useApi = window.api && !(window.AppConfig && window.AppConfig.FEATURE_FLAGS && window.AppConfig.FEATURE_FLAGS.USE_REAL_BACKEND === false);

      if (useApi) {
        window.api.get(reportsPath).then((res) => {
          const reports = Array.isArray(res) ? res : (res && res.reports) || res || [];
          if (!reports || !reports.length) {
            this.state.reports = this.generateMockReports(12);
          } else {
            this.state.reports = reports;
          }
        }).catch(() => {
          this.state.reports = this.generateMockReports(12);
        }).finally(() => {
          this.applyFilters();
          this.detailBody.hidden = true;
          this.detailEmpty.hidden = false;
        });
      } else {
        this.state.reports = this.generateMockReports(12);
        this.applyFilters();
        this.detailBody.hidden = true;
        this.detailEmpty.hidden = false;
      }
    },

    applyFilters(){
      const { query, status, severity, range } = this.state.filters;
      const now = Date.now();
      const rangeMap = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };

      let result = [...this.state.reports];

      if(query){
        const keyword = query.toLowerCase();
        result = result.filter((report) => {
          return (
            report.subject.toLowerCase().includes(keyword) ||
            report.topicTitle.toLowerCase().includes(keyword) ||
            report.reporter.name.toLowerCase().includes(keyword) ||
            report.reporter.email.toLowerCase().includes(keyword)
          );
        });
      }

      if(status){
        result = result.filter((report) => report.status === status);
      }

      if(severity){
        result = result.filter((report) => report.severity === severity);
      }

      if(range !== 'all'){
        const duration = rangeMap[range] || rangeMap['30d'];
        result = result.filter((report) => now - report.createdAt <= duration);
      }

      this.state.filtered = result;
      this.renderTable();
      this.updateSummary();

      if(this.state.selectedId && !result.some(r => r.id === this.state.selectedId)){
        this.detailBody.hidden = true;
        this.detailEmpty.hidden = false;
        this.state.selectedId = null;
      }
    },

    renderTable(){
      if(!this.tableBody) return;
      if(!this.state.filtered.length){
        this.tableBody.innerHTML = '<tr><td colspan="6" class="text-center muted">当前筛选条件下暂无举报</td></tr>';
        this.countLabel.textContent = '0 条';
        return;
      }

      this.tableBody.innerHTML = this.state.filtered.map((report) => `
        <tr data-report-id="${report.id}" class="${report.id === this.state.selectedId ? 'active' : ''}">
          <td><span class="status-pill ${report.status}">${statusText[report.status]}</span></td>
          <td>
            <div class="table-subject">${Utils.escapeHtml(report.subject)}</div>
            <div class="muted">${Utils.escapeHtml(report.topicTitle)}</div>
          </td>
          <td>
            <div>${Utils.escapeHtml(report.reporter.name)}</div>
            <div class="muted">${Utils.escapeHtml(report.reporter.email)}</div>
          </td>
          <td><span class="severity-pill ${report.severity}">${severityText[report.severity]}</span></td>
          <td>${report.channel === 'email' ? '邮件' : '表单'}</td>
          <td>${Utils.formatTime(report.createdAt, 'full')}</td>
        </tr>
      `).join('');

      this.countLabel.textContent = `${this.state.filtered.length} 条`;
    },

    selectReport(reportId){
      const report = this.state.filtered.find((item) => String(item.id) === String(reportId));
      if(!report) return;
      this.state.selectedId = report.id;
      this.renderTable();
      this.renderDetail(report);
    },

    renderDetail(report){
      if(!report) return;
      this.detailEmpty.hidden = true;
      this.detailBody.hidden = false;

      this.detailStatus.textContent = statusText[report.status];
      this.detailStatus.className = `status-pill ${report.status}`;
      this.detailSubject.textContent = report.subject;
      this.detailTopic.textContent = `所属话题：${report.topicTitle} · ${report.category}`;
      this.detailEmail.textContent = report.reporter.email;
      this.detailReporter.textContent = report.reporter.name;
      this.detailSeverity.textContent = severityText[report.severity];
      this.detailTime.textContent = Utils.formatTime(report.createdAt, 'full');
      this.detailMessage.textContent = report.message;
      this.detailNotes.value = report.notes || '';

      this.detailNotes.oninput = Utils.debounce(() => {
        report.notes = this.detailNotes.value.trim();
      }, 400);
    },

    updateSelectedStatus(status){
      if(!this.state.selectedId) return;
      const report = this.state.reports.find((item) => item.id === this.state.selectedId);
      if(!report) return;
      report.status = status;
      report.updatedAt = Date.now();
      this.applyFilters();
      const latest = this.state.filtered.find((item) => item.id === report.id) || report;
      this.renderDetail(latest);
    },

    updateSummary(){
      const total = this.state.filtered.length;
      const pending = this.state.filtered.filter(r => r.status === 'pending').length;
      const critical = this.state.filtered.filter(r => r.severity === 'high').length;
      this.summaryTotal.textContent = total;
      this.summaryPending.textContent = pending;
      this.summaryCritical.textContent = critical;
      this.summarySync.textContent = Utils.formatTime(Date.now(), 'time');
    },

    generateMockReports(count = 10){
      const topics = ['文娱热点追踪', '科技速递', '国际观察', '财经深度', '社会时评'];
      const categories = ['文娱', '科技', '国际', '财经', '社会'];
      const severities = ['high', 'medium', 'low'];
      const statuses = ['pending', 'reviewing', 'resolved'];
      const reporters = ['赵亮', '王蕾', '陈晨', '刘洋', '李潇', '周舟', '苏禾', '侯敏'];
      const domains = ['gmail.com', 'outlook.com', 'insightmail.com', 'qq.com'];

      const list = [];
      for(let i=0; i<count; i++){
        const topicIndex = Math.floor(Math.random()*topics.length);
        const severity = severities[Math.floor(Math.random()*severities.length)];
        const status = statuses[Math.floor(Math.random()*statuses.length)];
        const createdAt = Date.now() - Math.floor(Math.random()*45*24*60*60*1000);
        const name = reporters[Math.floor(Math.random()*reporters.length)];
        const email = `${name.toLowerCase()}@${domains[Math.floor(Math.random()*domains.length)]}`.replace(/\s+/g,'');
        list.push({
          id: `report-${Date.now()}-${i}`,
          subject: `关于 ${topics[topicIndex]} 的内容违规反馈 ${i+1}`,
          topicTitle: `${topics[topicIndex]} 第 ${i+1} 条`,
          category: categories[topicIndex % categories.length],
          severity,
          status,
          channel: 'email',
          createdAt,
          updatedAt: createdAt,
          reporter: { name, email },
          message: '您好，邮件来自用户反馈邮箱。我们观察到该话题下的最新内容存在偏激描述，请安排编辑复核，必要时下线相关稿件。',
          notes: ''
        });
      }
      return list.sort((a,b)=>b.createdAt-a.createdAt);
    }
  };

  // 暴露给全局以便调试与 mock 注册
  window.ReportsManager = ReportsManager;

  document.addEventListener('DOMContentLoaded', () => {
    if(document.body.contains(document.getElementById('reportsTable'))){
      ReportsManager.init();
    }
  });
})();

// 注册 reports 的 mock handler，便于在真实后端不可用时回退
if (window.api && window.ReportsManager) {
  try {
    window.api.registerMock('/admin/reports', async (method, path, options) => {
      return ReportsManager.generateMockReports(12);
    });
  } catch (e) {}
}
