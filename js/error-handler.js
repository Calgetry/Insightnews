(function () {
  // 全局错误处理类
  class ErrorHandler {
    constructor() {
      this.initGlobalErrorHandling();
    }

    // 初始化全局错误处理
    initGlobalErrorHandling() {
      // 捕获未处理的Promise拒绝
      window.addEventListener('unhandledrejection', (event) => {
        console.error('未处理的Promise拒绝:', event.reason);
        this.handleError(event.reason, '未处理的Promise拒绝');
        event.preventDefault();
      });

      // 捕获全局JavaScript错误
      window.addEventListener('error', (event) => {
        console.error('全局错误:', event.error);
        this.handleError(event.error, '全局JavaScript错误');
      });
    }

    // 处理API错误
    handleAPIError(error, userMessage = '操作失败') {
      console.error('API错误:', error);
      
      // 错误分类处理
      if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
        this.showUserMessage('网络连接失败，请检查网络连接', 'error');
      } else if (error.message.includes('401')) {
        this.showUserMessage('登录已过期，请重新登录', 'error');
        this.clearAuthAndRedirect();
      } else if (error.message.includes('403')) {
        this.showUserMessage('权限不足，无法执行此操作', 'error');
      } else if (error.message.includes('404')) {
        this.showUserMessage('请求的资源不存在', 'error');
      } else if (error.message.includes('500')) {
        this.showUserMessage('服务器内部错误，请稍后重试', 'error');
      } else {
        this.showUserMessage(userMessage, 'error');
      }
      
      // 记录错误日志
      this.logError(error, 'API');
    }

    // 处理表单验证错误
    handleValidationError(field, message) {
      const fieldElement = document.getElementById(field);
      if (fieldElement) {
        fieldElement.style.borderColor = 'var(--danger)';
        
        // 显示错误消息
        let errorElement = fieldElement.parentNode.querySelector('.field-error');
        if (!errorElement) {
          errorElement = document.createElement('div');
          errorElement.className = 'field-error';
          fieldElement.parentNode.appendChild(errorElement);
        }
        errorElement.textContent = message;
        errorElement.style.color = 'var(--danger)';
        errorElement.style.fontSize = '12px';
        errorElement.style.marginTop = '4px';
      }
      
      this.logError(new Error(`表单验证失败: ${field} - ${message}`), 'VALIDATION');
    }

    // 清除表单错误状态
    clearFieldError(field) {
      const fieldElement = document.getElementById(field);
      if (fieldElement) {
        fieldElement.style.borderColor = '';
        
        const errorElement = fieldElement.parentNode.querySelector('.field-error');
        if (errorElement) {
          errorElement.remove();
        }
      }
    }

    // 显示用户友好的错误消息
    showUserMessage(text, type = 'error') {
      // 尝试使用现有的消息框
      let messageBox = document.getElementById('globalMessage');
      if (!messageBox) {
        messageBox = document.createElement('div');
        messageBox.id = 'globalMessage';
        messageBox.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 12px 16px;
          border-radius: 8px;
          color: white;
          z-index: 10000;
          max-width: 400px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transition: all 0.3s ease;
        `;
        document.body.appendChild(messageBox);
      }

      // 设置消息样式
      const colors = {
        error: '#ef4444',
        warning: '#f59e0b',
        success: '#10b981',
        info: '#3b82f6'
      };

      messageBox.textContent = text;
      messageBox.style.backgroundColor = colors[type] || colors.info;
      messageBox.style.display = 'block';

      // 3秒后自动隐藏
      setTimeout(() => {
        messageBox.style.opacity = '0';
        setTimeout(() => {
          messageBox.style.display = 'none';
          messageBox.style.opacity = '1';
        }, 300);
      }, 3000);
    }

    // 清除认证信息并重定向
    clearAuthAndRedirect() {
      localStorage.removeItem('token');
      localStorage.removeItem('loginTime');
      localStorage.removeItem('isDevMode');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
    }

    // 错误日志记录
    logError(error, category = 'UNKNOWN') {
      const errorLog = {
        timestamp: new Date().toISOString(),
        category: category,
        message: error.message,
        stack: error.stack,
        url: window.location.href,
        userAgent: navigator.userAgent
      };

      // 存储到localStorage（生产环境应该发送到服务器）
      try {
        const existingLogs = JSON.parse(localStorage.getItem('errorLogs') || '[]');
        existingLogs.push(errorLog);
        // 只保留最近50条错误日志
        if (existingLogs.length > 50) {
          existingLogs.shift();
        }
        localStorage.setItem('errorLogs', JSON.stringify(existingLogs));
      } catch (e) {
        console.error('无法记录错误日志:', e);
      }

      console.error(`[${category}]`, error);
    }

    // 获取错误日志
    getErrorLogs() {
      try {
        return JSON.parse(localStorage.getItem('errorLogs') || '[]');
      } catch {
        return [];
      }
    }

    // 清空错误日志
    clearErrorLogs() {
      localStorage.removeItem('errorLogs');
    }
  }

  // 暴露到全局
  window.ErrorHandler = new ErrorHandler();
})();