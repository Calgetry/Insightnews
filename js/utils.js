(function () {
  // 工具函数库
  window.Utils = {
    // HTML转义
    escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    // 格式化时间
    formatTime(timestamp, format = 'full') {
      if (!timestamp) return '';
      
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return String(timestamp);
      
      const formats = {
        time: date.toLocaleTimeString('zh-CN'),
        date: date.toLocaleDateString('zh-CN'),
        full: date.toLocaleString('zh-CN'),
        relative: this.formatRelativeTime(timestamp)
      };
      
      return formats[format] || formats.full;
    },

    formatDatetimeLocal(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    },

    // 相对时间格式化 - 修复递归问题
    formatRelativeTime(timestamp) {
      const now = new Date();
      const target = new Date(timestamp);
      
      if (isNaN(target.getTime())) return '未知时间';
      
      const diff = now - target;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      if (hours < 24) return `${hours}小时前`;
      if (days < 7) return `${days}天前`;
      
      // 避免递归调用，直接使用日期格式化
      return target.toLocaleDateString('zh-CN');
    },

    // 深拷贝
    deepClone(obj) {
      if (obj === null || typeof obj !== 'object') return obj;
      if (obj instanceof Date) return new Date(obj.getTime());
      if (obj instanceof Array) return obj.map(item => this.deepClone(item));
      
      const cloned = {};
      for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    },

    // 防抖函数
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    // 节流函数
    throttle(func, limit) {
      let inThrottle;
      return function(...args) {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    },

    // 生成随机ID
    generateId(prefix = '') {
      return prefix + Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // 文件大小格式化
    formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 数字格式化
    formatNumber(num) {
      if (typeof num !== 'number') return '0';
      return num.toLocaleString('zh-CN');
    },

    // 验证邮箱
    validateEmail(email) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(email);
    },

    // 下载数据
    downloadData(data, filename, type = 'application/json') {
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // 导出为Excel (使用SheetJS生成真正的.xlsx文件)
    exportToExcel(data, filename) {
      if (!data || data.length === 0) {
        alert('没有数据可导出');
        return;
      }

      // 检查SheetJS是否加载
      if (typeof XLSX === 'undefined') {
        alert('Excel导出库未加载，请刷新页面重试');
        return;
      }

      // 准备表头
      const headers = ['姓名', '邮箱', '手机号', '地区', '注册时间', '最后活跃', '个人简介'];

      // 准备数据行（与表头对应）
      const rows = data.map((user) => [
        user.name || '',
        user.email || '',
        user.phone || '',
        user.region || '',
        user.registerTime ? new Date(user.registerTime).toLocaleString('zh-CN') : '',
        user.lastActive ? new Date(user.lastActive).toLocaleString('zh-CN') : '',
        user.bio || ''
      ]);

      // 合并表头和数据并创建工作表
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // 设置列宽
      const colWidths = [
        { wch: 12 },  // 姓名
        { wch: 25 },  // 邮箱
        { wch: 14 },  // 手机号
        { wch: 16 },  // 地区
        { wch: 20 },  // 注册时间
        { wch: 20 },  // 最后活跃
        { wch: 35 }   // 个人简介
      ];
      ws['!cols'] = colWidths;

      // 设置行高
      const rowHeights = [{ hpx: 30 }]; // 表头行高
      for (let i = 0; i < rows.length; i++) {
        rowHeights.push({ hpx: 25 }); // 数据行高
      }
      ws['!rows'] = rowHeights;

      // 设置单元格样式
      const range = XLSX.utils.decode_range(ws['!ref']);
      
      for (let C = range.s.c; C <= range.e.c; ++C) {
        for (let R = range.s.r; R <= range.e.r; ++R) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          // 初始化单元格样式
          ws[cellAddress].s = {
            alignment: {
              vertical: 'center',
              wrapText: true
            },
            border: {
              top: { style: 'thin', color: { rgb: 'D0D0D0' } },
              bottom: { style: 'thin', color: { rgb: 'D0D0D0' } },
              left: { style: 'thin', color: { rgb: 'D0D0D0' } },
              right: { style: 'thin', color: { rgb: 'D0D0D0' } }
            },
            font: {
              name: '微软雅黑',
              sz: 11
            }
          };

          // 表头样式
          if (R === 0) {
            ws[cellAddress].s.fill = {
              fgColor: { rgb: '4472C4' }
            };
            ws[cellAddress].s.font = {
              name: '微软雅黑',
              sz: 11,
              bold: true,
              color: { rgb: 'FFFFFF' }
            };
            ws[cellAddress].s.alignment.horizontal = 'center';
          }
          // 数据行斑马纹
          else if (R % 2 === 0) {
            ws[cellAddress].s.fill = {
              fgColor: { rgb: 'F2F2F2' }
            };
          }
        }
      }

      // 创建工作簿
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '用户数据');

      // 设置工作簿属性
      wb.Props = {
        Title: '用户数据导出',
        Subject: 'InsightNews用户管理',
        Author: 'InsightNews Admin',
        CreatedDate: new Date()
      };

      // 导出文件
      XLSX.writeFile(wb, filename + '.xlsx', {
        bookType: 'xlsx',
        type: 'binary',
        cellStyles: true
      });
    },

    // 旧的XML生成方法已移除
    escapeXml(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }
    ,

    // Safe storage wrapper: try localStorage first, fall back to in-memory object when blocked
    storage: (function () {
      const mem = Object.create(null);
      let available;

      function detect() {
        if (available !== undefined) return available;
        try {
          if (typeof localStorage === 'undefined') {
            available = false;
            return available;
          }
          const k = '__storage_test__';
          localStorage.setItem(k, k);
          localStorage.removeItem(k);
          available = true;
        } catch (e) {
          available = false;
          try { window.__storageBlocked = true; } catch (err) {}
        }
        return available;
      }

      return {
        isAvailable() { return detect(); },
        getItem(key) {
          try {
            if (detect()) return localStorage.getItem(key);
          } catch (e) {
            try { window.__storageBlocked = true; } catch (err) {}
          }
          return mem[key] !== undefined ? mem[key] : null;
        },
        setItem(key, value) {
          try {
            if (detect()) {
              return localStorage.setItem(key, value);
            }
          } catch (e) {
            try { window.__storageBlocked = true; } catch (err) {}
          }
          mem[key] = String(value);
        },
        removeItem(key) {
          try {
            if (detect()) return localStorage.removeItem(key);
          } catch (e) {
            try { window.__storageBlocked = true; } catch (err) {}
          }
          if (mem[key] !== undefined) delete mem[key];
        },
        clear() {
          try {
            if (detect()) return localStorage.clear();
          } catch (e) {
            try { window.__storageBlocked = true; } catch (err) {}
          }
          for (const k in mem) if (Object.prototype.hasOwnProperty.call(mem, k)) delete mem[k];
        }
      };
    })()
  };
})();