(function () {
  const { ENDPOINTS } = window.AppConfig || {};

  class DashboardManager {
    constructor() {
      this.charts = {};
      this.data = {};
      this.analyticsEndpoints = (ENDPOINTS && ENDPOINTS.analytics) || {};
    }

    async init() {
      if (!Auth.isLoggedIn()) {
        location.href = 'index.html';
        return;
      }

      // 先加载模拟数据保障首屏展示
      this.generateMockData();
      this.configureChartDefaults();

      // 渲染页面
      this.renderKPIs();
      this.initCharts();
      this.renderActivities();

      await this.loadDataAndRefresh();
    }

    async loadDataAndRefresh() {
      try {
        await this.loadData();
        this.renderKPIs();
        this.refreshChartsForTheme();
        this.renderActivities();
      } catch (error) {
        this.showError('实时仪表盘数据加载失败，已自动使用示例数据');
        console.error('Dashboard.loadData error:', error);
      }
    }

    async loadData() {
      const [overview, userStats, activityLogs, trends] = await Promise.all([
        this.safeFetch(this.analyticsEndpoints.overview),
        this.safeFetch(this.analyticsEndpoints.userStats),
        this.safeFetch(this.analyticsEndpoints.activityLogs),
        this.safeFetch(this.analyticsEndpoints.trends)
      ]);

      const normalizedOverview = this.normalizeOverview(overview);
      const normalizedUserStats = this.normalizeUserStats(userStats);
      const normalizedActivities = this.normalizeActivities(activityLogs);
      const normalizedTrends = this.normalizeTrends(trends);

      this.data = {
        ...this.data,
        ...(normalizedOverview || {}),
        ...(normalizedUserStats || {}),
        ...(normalizedTrends || {})
      };

      if (normalizedActivities && normalizedActivities.length) {
        this.data.activities = normalizedActivities;
      }
    }

    async safeFetch(path) {
      if (!path || !window.api) return null;
      try {
        return await window.api.get(path);
      } catch (error) {
        console.warn(`Dashboard: 请求 ${path} 失败`, error);
        return null;
      }
    }

    normalizeOverview(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const data = payload.data || payload;
      const toNumber = (value, fallback = 0) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };

      return {
        activeUsers: toNumber(data.activeUsers ?? data.total ?? this.data.activeUsers ?? 0),
        newUsers: toNumber(data.newUsers ?? data.todayNewUsers ?? this.data.newUsers ?? 0),
        topicCount: toNumber(data.topicCount ?? data.topicTotal ?? this.data.topicCount ?? 0),
        reportCount: toNumber(data.reportCount ?? data.reports ?? this.data.reportCount ?? 0)
      };
    }

    normalizeUserStats(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const data = payload.data || payload;

      const visitsLabels = Array.isArray(data.dates)
        ? data.dates
        : Array.isArray(data.labels)
          ? data.labels
          : this.data.visitsLabels;

      const visitsData = this.toNumberArray(data.visits,
        this.toNumberArray(data.values, this.data.visitsData));

      let growthLabels = Array.isArray(data.dates)
        ? data.dates
        : Array.isArray(data.labels)
          ? data.labels
          : this.data.userGrowthLabels || this.data.visitsLabels;

      if ((!growthLabels || !growthLabels.length) && Array.isArray(data.records) && data.records.length) {
        growthLabels = data.records.map((item) => item.date || item.day || item.label || item.name || '近日');
      }

      const extractSeries = (...candidates) => {
        for (const candidate of candidates) {
          if (Array.isArray(candidate) && candidate.length) {
            return this.toNumberArray(candidate, null);
          }
        }
        return null;
      };

      let userGrowthData = extractSeries(data.newUsers, data.daily, data.dailyNewUsers, data.growth);
      if (!userGrowthData && Array.isArray(data.records)) {
        userGrowthData = data.records.map((item) => Number(item.value ?? item.count ?? item.newUsers ?? 0));
      }
      if (!userGrowthData || !userGrowthData.length) {
        userGrowthData = visitsData;
      }

      const parsedDistribution = this.toNumberArray(data.distribution, null);
      let userDistribution = parsedDistribution && parsedDistribution.length
        ? parsedDistribution
        : this.data.userDistribution;

      const incomingTypes = Array.isArray(data.types) && data.types.length
        ? data.types
        : Array.isArray(data.labels) && data.labels.length
          ? data.labels
          : this.data.userTypes;

      let userTypes = incomingTypes;

      if (Array.isArray(userDistribution) && Array.isArray(userTypes) && userDistribution.length && userTypes.length) {
        if (userDistribution.length !== userTypes.length) {
          const minLength = Math.min(userDistribution.length, userTypes.length);
          userDistribution = userDistribution.slice(0, minLength);
          userTypes = userTypes.slice(0, minLength);
        }
      } else {
        userDistribution = [];
        userTypes = [];
      }

      return {
        visitsLabels,
        visitsData,
        userGrowthLabels: growthLabels,
        userGrowthData,
        userDistribution,
        userTypes
      };
    }

    normalizeActivities(payload) {
      if (!payload) return null;

      const pickList = (source) => {
        const candidates = [
          source?.data,
          source?.data?.records,
          source?.data?.rows,
          source?.data?.list,
          source?.records,
          source?.rows,
          source?.list,
          source?.items,
          source
        ];
        return candidates.find((item) => Array.isArray(item) && item.length) || [];
      };

      const list = pickList(payload);
      if (!list.length) return null;

      return list.map((item) => ({
        user: item.user || item.operator || item.account || item.username || '系统',
        action: item.action || item.event || item.message || item.detail || item.content || '执行了操作',
        time: item.time || item.timestamp || item.createdAt || item.updatedAt || new Date().toLocaleString(),
        type: item.type || item.category || item.scene || 'system'
      }));
    }

    normalizeTrends(payload) {
      if (!payload) return null;

      const pickTopics = (source) => {
        const base = source?.data || source;
        const candidates = [
          base?.topics,
          base?.records,
          base?.rows,
          base?.list,
          base?.items,
          Array.isArray(base) ? base : null
        ];
        return candidates.find((item) => Array.isArray(item) && item.length) || [];
      };

      const topics = pickTopics(payload);
      if (!topics.length) return null;

      const labels = topics.map((item) => item.name || item.topic || item.title || item.keyword || item.topicName || '热门话题');
      const counts = topics.map((item) => Number(item.views || item.value || item.count || item.heat || item.score || 0));

      return {
        topicsLabels: labels,
        topicsData: counts
      };
    }

    toNumberArray(source, fallback) {
      if (!Array.isArray(source) || !source.length) {
        return fallback;
      }
      const parsed = source.map((value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      });
      return parsed;
    }

    configureChartDefaults() {
      if (typeof Chart === 'undefined') {
        console.warn('Chart.js 未加载，将跳过图表配置');
        return;
      }

      const fontFamily = getComputedStyle(document.body).getPropertyValue('font-family') || '"Segoe UI", sans-serif';
      const mutedColor = this.getColor('--muted', '#6b7280');
      const textColor = this.getColor('--text', '#111827');
      const baseColor = this.isDarkTheme() ? '#ffffff' : mutedColor;

      Chart.defaults.font.family = fontFamily.trim();
      Chart.defaults.color = baseColor;
      Chart.defaults.borderColor = this.withAlpha(baseColor, 0.12);
      Chart.defaults.plugins.legend.labels.usePointStyle = true;
      Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
      Chart.defaults.plugins.legend.labels.boxWidth = 10;
      Chart.defaults.plugins.legend.labels.padding = 14;
      Chart.defaults.plugins.legend.labels.color = this.isDarkTheme() ? '#ffffff' : baseColor;
      Chart.defaults.plugins.tooltip.cornerRadius = 12;
      Chart.defaults.plugins.tooltip.padding = 12;
      Chart.defaults.plugins.tooltip.backgroundColor = this.withAlpha(this.getColor('--card', '#ffffff'), this.isDarkTheme() ? 0.96 : 0.94);
      Chart.defaults.plugins.tooltip.titleColor = this.isDarkTheme() ? '#ffffff' : textColor;
      Chart.defaults.plugins.tooltip.bodyColor = this.isDarkTheme() ? '#ffffff' : baseColor;
    }

    generateMockData() {
      // 生成最近30天的日期标签
      const dates = Array.from({ length: 30 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (29 - i));
        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      });

      // 生成访问数据，确保数据有一定的连续性和趋势
      const generateTrendingData = (length, min, max, volatility = 0.2) => {
        let current = Math.floor((max + min) / 2);
        return Array.from({ length }, () => {
          const change = (Math.random() - 0.5) * 2 * volatility * (max - min);
          current = Math.max(min, Math.min(max, current + change));
          return Math.round(current);
        });
      };

      this.data = {
        activeUsers: 120,
        newUsers: 5,
        topicCount: 45,
        reportCount: 30,
        // 访问数据和对应的日期标签
        visitsData: generateTrendingData(30, 500, 2000),
        visitsLabels: dates,
        userGrowthData: generateTrendingData(30, 120, 420, 0.25),
        userGrowthLabels: dates,
        
        // 用户分布数据
        userDistribution: [320, 640, 180, 90],
        userTypes: ['普通用户', '会员用户', 'VIP用户', '管理员'],
        
        // 热门话题数据
        topicsData: [286, 482, 328, 524, 608, 442, 386],
        topicsLabels: [
          '科技创新', '文化艺术', '社会新闻',
          '生活方式', '健康养生', '教育资讯', '财经动态'
        ],
        
        // 访问来源数据
        // 最新活动
        activities: [
          { user: 'admin', action: '更新了系统配置', time: '5分钟前', type: 'system' },
          { user: 'editor01', action: '发布了文章《2025年科技展望》', time: '1小时前', type: 'content' },
          { user: 'user007', action: '发表了评论', time: '2小时前' },
        ]
      };
    }

    renderKPIs() {
      const mapping = {
        activeUsers: 'activeUsers',
        newUsers: 'newUsers',
        topicCount: 'topicCount',
        reportCount: 'reportCount'
      };

      Object.entries(mapping).forEach(([dataKey, elementId]) => {
        const el = document.getElementById(elementId);
        if (el) {
          el.textContent = Utils.formatNumber(this.data[dataKey]);
        }
      });
    }

    initCharts() {
      if (typeof Chart === 'undefined') {
        console.warn('Chart.js 未加载，跳过仪表盘图表渲染');
        return;
      }

      try {
        this.createVisitsChart();
      } catch (e) {
        console.error('访问趋势图错误:', e);
      }

      try {
        this.createTopicsChart();
      } catch (e) {
        console.error('热门话题图错误:', e);
      }

      try {
        this.createUserGrowthChart();
      } catch (e) {
        console.error('用户增长图错误:', e);
      }

    }

    createVisitsChart() {
      const canvas = document.getElementById('visitsChart');
      if (!canvas) return;

      this.destroyChart('visitsChart');

      const ctx = canvas.getContext('2d');
      const primary = this.getColor('--primary', '#6d5ef2');
      const textMuted = this.getColor('--muted', '#6b7280');
      const gridColor = this.withAlpha(textMuted, 0.18);
      const gradientHeight = canvas.parentElement ? canvas.parentElement.offsetHeight : canvas.height || 320;
      const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
      gradient.addColorStop(0, this.withAlpha(primary, 0.35));
      gradient.addColorStop(1, this.withAlpha(primary, 0));

      this.charts.visitsChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: this.data.visitsLabels,
          datasets: [
            {
              label: '访问量',
              data: this.data.visitsData,
              tension: 0.35,
              fill: true,
              backgroundColor: gradient,
              borderColor: primary,
              borderWidth: 3,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: '#ffffff',
              pointBorderColor: primary,
              pointBorderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            x: {
              grid: {
                display: true,
                color: gridColor,
                drawBorder: false,
              },
              ticks: {
                color: textMuted,
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 8,
              },
            },
            y: {
              grid: {
                color: gridColor,
                drawBorder: false,
              },
              ticks: {
                color: textMuted,
                callback: (value) => Utils.formatNumber(value),
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => `访问量：${Utils.formatNumber(context.parsed.y)}`,
              },
            },
          },
        },
      });
    }

    createUserGrowthChart() {
      const canvas = document.getElementById('usersChart');
      if (!canvas) return;

      this.destroyChart('usersChart');

      let labels = Array.isArray(this.data.userGrowthLabels) && this.data.userGrowthLabels.length
        ? this.data.userGrowthLabels
        : this.data.visitsLabels || [];

      let series = Array.isArray(this.data.userGrowthData) && this.data.userGrowthData.length
        ? this.data.userGrowthData
        : this.data.visitsData || [];

      if (!labels.length || !series.length) {
        labels = ['暂无数据'];
        series = [0];
      }

      const usableLength = Math.min(labels.length, series.length);
      labels = labels.slice(labels.length - usableLength);
      series = series.slice(series.length - usableLength);

      const ctx = canvas.getContext('2d');
      const primary = this.getColor('--success', '#10b981');
      const textMuted = this.getColor('--muted', '#6b7280');
      const gridColor = this.withAlpha(textMuted, 0.18);
      const gradientHeight = canvas.parentElement ? canvas.parentElement.offsetHeight : canvas.height || 300;
      const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
      gradient.addColorStop(0, this.withAlpha(primary, 0.35));
      gradient.addColorStop(1, this.withAlpha(primary, 0));

      this.charts.usersChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: '新增用户',
            data: series,
            tension: 0.35,
            fill: true,
            backgroundColor: gradient,
            borderColor: primary,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: primary,
            pointBorderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            x: {
              grid: {
                display: true,
                color: gridColor,
                drawBorder: false,
              },
              ticks: {
                color: textMuted,
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 8,
              },
            },
            y: {
              beginAtZero: true,
              grid: {
                color: gridColor,
                drawBorder: false,
              },
              ticks: {
                color: textMuted,
                callback: (value) => Utils.formatNumber(value),
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => `新增用户：${Utils.formatNumber(context.parsed.y)}`,
              },
            },
          },
        },
      });
    }

    createTopicsChart() {
      const canvas = document.getElementById('topicsChart');
      if (!canvas) return;

      this.destroyChart('topicsChart');

      const secondary = this.getColor('--secondary', '#10b981');
      const muted = this.getColor('--muted', '#6b7280');
      const gridColor = this.withAlpha(muted, 0.15);
      const valueColor = this.withAlpha(this.getColor('--text', '#111827'), 0.8);

      const valueLabelPlugin = {
        id: `value-label-${canvas.id || 'topics'}`,
        afterDatasetsDraw: (chart) => {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data) return;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = valueColor;
          ctx.font = 'bold 11px "Segoe UI", sans-serif';
          meta.data.forEach((element, index) => {
            const { x, y } = element.tooltipPosition();
            const value = chart.data.datasets[0].data[index];
            ctx.fillText(Utils.formatNumber(value), x, y - 8);
          });
          ctx.restore();
        },
      };

      this.charts.topicsChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: this.data.topicsLabels,
          datasets: [
            {
              label: '浏览量',
              data: this.data.topicsData,
              borderRadius: 12,
              maxBarThickness: 56,
              backgroundColor: (context) => {
                const chart = context.chart;
                const { chartArea } = chart;
                if (!chartArea) {
                  return this.withAlpha(secondary, 0.8);
                }
                const gradient = chart.ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                gradient.addColorStop(0, this.withAlpha(secondary, 0.85));
                gradient.addColorStop(1, this.withAlpha(secondary, 0.58));
                return gradient;
              },
              hoverBackgroundColor: this.withAlpha(secondary, 1),
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              grid: { display: false, drawBorder: false },
              ticks: {
                color: muted,
                autoSkip: false,
                maxRotation: 55,
                minRotation: 35,
                align: 'end',
                padding: 8,
                callback: (value, index) => {
                  const label = this.data.topicsLabels[index] || '';
                  return label.length > 10 ? `${label.slice(0, 10)}…` : label;
                },
              },
            },
            y: {
              grid: { color: gridColor, drawBorder: false },
              ticks: {
                color: muted,
                callback: (value) => Utils.formatNumber(value),
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => items[0]?.label || '热门话题',
                label: (context) => `浏览量：${Utils.formatNumber(context.parsed.y)}`,
              },
            },
          },
        },
        plugins: [valueLabelPlugin],
      });
    }


    destroyChart(id) {
      if (this.charts[id]) {
        this.charts[id].destroy();
        delete this.charts[id];
      }
    }

    refreshChartsForTheme() {
      if (typeof Chart === 'undefined') {
        return;
      }
      Object.keys(this.charts).forEach((key) => {
        this.charts[key].destroy();
      });
      this.charts = {};
      this.configureChartDefaults();
      this.initCharts();
    }

    getColor(variableName, fallback) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(variableName);
      return value ? value.trim() : fallback;
    }

    isDarkTheme() {
      return (document.documentElement.getAttribute('data-theme') || '').trim() === 'dark';
    }

    hexToRgb(color) {
      if (!color) {
        return null;
      }
      const hex = color.replace('#', '').trim();
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b };
      }
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return { r, g, b };
      }
      return null;
    }

    parseRgb(color) {
      const match = color.match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      if (parts.length < 3) return null;
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
      };
    }

    withAlpha(color, alpha) {
      if (!color) {
        return `rgba(0, 0, 0, ${alpha})`;
      }

      const hex = this.hexToRgb(color);
      if (hex) {
        const { r, g, b } = hex;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      const rgb = this.parseRgb(color);
      if (rgb) {
        const { r, g, b } = rgb;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      return color;
    }

    renderActivities() {
      const container = document.getElementById('activityList');
      
      if (!this.data.activities || this.data.activities.length === 0) {
        container.innerHTML = '<div class="text-center" style="padding: 40px; color: var(--muted);">暂无活动记录</div>';
        return;
      }
      
      container.innerHTML = this.data.activities.map(activity => {
        // 直接使用文字图标，确保显示效果
        let icon = '💬';
        if (activity.type === 'system') icon = '⚙️';
        else if (activity.type === 'content') icon = '📝';
        else if (activity.type === 'user') icon = '👤';
        
        return `
          <div class="activity-item">
            <div class="activity-icon ${activity.type || 'comment'}">
              <span class="icon-emoji">${icon}</span>
            </div>
            <div class="activity-content">
              <div class="activity-title">${activity.user}</div>
              <div class="activity-desc">${activity.action}</div>
              <div class="activity-time">${activity.time}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    showError(message) {
      // 可以在这里实现错误提示
      console.error('Dashboard Error:', message);
    }

    // 刷新数据
    async refresh() {
      await this.loadDataAndRefresh();
    }
  }

  // 创建全局仪表盘管理器实例
  window.Dashboard = new DashboardManager();
})();