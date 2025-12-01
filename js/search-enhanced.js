(function () {
  const HISTORY_KEY = 'admin_search_history';
  const MAX_HISTORY = 10;

  class EnhancedSearch {
    constructor() {
      this.debounceTimer = null;
      this.debounceDelay = 300; // 防抖延迟
    }

    // 获取搜索历史
    getHistory() {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      } catch {
        return [];
      }
    }

    // 保存搜索历史
    saveHistory(keyword) {
      if (!keyword || keyword.trim().length < 2) return;
      const history = this.getHistory();
      const trimmed = keyword.trim();
      const filtered = history.filter(h => h !== trimmed);
      filtered.unshift(trimmed);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
    }

    // 删除历史记录
    removeHistory(keyword) {
      const history = this.getHistory().filter(h => h !== keyword);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    // 智能搜索匹配（支持多关键词、模糊匹配）
    smartMatch(text, keyword, fields = ['name', 'email']) {
      if (!keyword || !text) return { match: false, score: 0 };
      
      const kw = keyword.toLowerCase().trim();
      const txt = String(text).toLowerCase();
      
      // 完全匹配
      if (txt === kw) return { match: true, score: 100 };
      
      // 包含匹配
      if (txt.includes(kw)) {
        const pos = txt.indexOf(kw);
        const score = 80 - (pos * 2); // 位置越靠前得分越高
        return { match: true, score };
      }
      
      // 多关键词匹配（空格分隔）
      const keywords = kw.split(/\s+/).filter(k => k.length > 0);
      if (keywords.length > 1) {
        const allMatch = keywords.every(k => txt.includes(k));
        if (allMatch) return { match: true, score: 60 };
      }
      
      // 模糊匹配（字符顺序）
      let kwIdx = 0;
      for (let i = 0; i < txt.length && kwIdx < kw.length; i++) {
        if (txt[i] === kw[kwIdx]) kwIdx++;
      }
      if (kwIdx === kw.length) return { match: true, score: 40 };
      
      return { match: false, score: 0 };
    }

    // 高亮关键词
    highlight(text, keyword) {
      if (!keyword || !text) return this.escapeHtml(String(text || ''));
      const kw = keyword.trim();
      const txt = String(text || '');
      const regex = new RegExp(`(${this.escapeRegex(kw)})`, 'gi');
      return this.escapeHtml(txt).replace(regex, '<span class="highlight">$1</span>');
    }

    // 生成搜索建议
    generateSuggestions(keyword, items, fields = ['name', 'email'], maxSuggestions = 5) {
      if (!keyword || keyword.trim().length < 1) return [];
      
      const suggestions = [];
      const kw = keyword.toLowerCase().trim();
      
      items.forEach(item => {
        fields.forEach(field => {
          const value = String(item[field] || '').toLowerCase();
          if (value.includes(kw) && value !== kw) {
            const existing = suggestions.find(s => s.text === item[field]);
            if (!existing) {
              suggestions.push({
                text: item[field],
                type: field,
                item: item
              });
            }
          }
        });
      });
      
      return suggestions.slice(0, maxSuggestions);
    }

    // 过滤数据（支持多条件）
    filterData(items, { keyword = '', fields = ['name', 'email'], region = '' }) {
      if (!keyword &&  !region) {
        return items;
      }
      
      const kw = keyword.toLowerCase().trim();
      const keywords = kw ? kw.split(/\s+/) : [];
      
      return items.filter(item => {
        // 关键词搜索
        if (keyword) {
          const selectedFields = fields.length > 0 ? fields : ['name', 'email'];
          const match = selectedFields.some(field => {
            const value = String(item[field] || '').toLowerCase();
            if (keywords.length > 1) {
              return keywords.every(k => value.includes(k));
            }
            return value.includes(kw);
          });
          if (!match) return false;
        }
        
        
        // 地区筛选
        if (region) {
          const itemRegion = String(item.region || '').toLowerCase();
          if (!itemRegion.includes(region.toLowerCase())) return false;
        }
        
        return true;
      });
    }

    // 防抖搜索
    debounceSearch(callback, delay = this.debounceDelay) {
      return (...args) => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          callback.apply(this, args);
        }, delay);
      };
    }

    // 转义HTML
    escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // 转义正则表达式特殊字符
    escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 高级搜索：支持拼音搜索（需要pinyin库）
    pinyinSearch(text, keyword) {
      // 这里可以集成拼音搜索功能
      // 需要引入pinyin.js库
      console.warn('拼音搜索功能需要引入pinyin.js库');
      return this.smartMatch(text, keyword);
    }

    // 导出搜索历史
    exportHistory() {
      const history = this.getHistory();
      const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'search_history.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    // 导入搜索历史
    importHistory(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const history = JSON.parse(e.target.result);
            if (Array.isArray(history)) {
              localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
              resolve(history);
            } else {
              reject(new Error('无效的历史数据格式'));
            }
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsText(file);
      });
    }
  }

  // 暴露到全局
  window.EnhancedSearch = new EnhancedSearch();
})();