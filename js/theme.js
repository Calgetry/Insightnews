(function () {
  const THEME_KEY = 'admin_theme';
  const BRAND_KEY = 'admin_brand_color';

  class ThemeManager {
    constructor() {
      this.themes = ['light', 'dark'];
      this.currentTheme = this.getSavedTheme();
      this.init();
    }

    init() {
      this.applyTheme(this.currentTheme);
      this.setupEventListeners();
    }

    getSavedTheme() {
      return localStorage.getItem(THEME_KEY) || 'light';
    }

    applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(THEME_KEY, theme);
      this.currentTheme = theme;
      
      // 触发主题变化事件
      window.dispatchEvent(new CustomEvent('themeChange', { detail: theme }));
    }

    toggle() {
      const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
      this.applyTheme(newTheme);
      return newTheme;
    }

    setBrandColor(color) {
      if (!color) return;
      
      document.documentElement.style.setProperty('--primary', color);
      
      // 生成衍生颜色
      const darker = this.darkenColor(color, 0.1);
      document.documentElement.style.setProperty('--primary-600', darker);
      
      localStorage.setItem(BRAND_KEY, color);
    }

    darkenColor(color, amount) {
      // 简单的颜色变暗算法
      const hex = color.replace('#', '');
      const num = parseInt(hex, 16);
      const amt = Math.round(2.55 * amount * 100);
      const R = (num >> 16) - amt;
      const G = (num >> 8 & 0x00FF) - amt;
      const B = (num & 0x0000FF) - amt;
      
      return '#' + (
        0x1000000 +
        (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)
      ).toString(16).slice(1);
    }

    setupEventListeners() {
      // 监听系统主题偏好
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
          this.applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }

    getCurrentTheme() {
      return this.currentTheme;
    }

    // 重置为主题默认值
    reset() {
      localStorage.removeItem(THEME_KEY);
      localStorage.removeItem(BRAND_KEY);
      this.applyTheme('light');
      document.documentElement.style.removeProperty('--primary');
      document.documentElement.style.removeProperty('--primary-600');
    }
  }

  // 创建全局主题管理器实例
  window.Theme = new ThemeManager();
})();