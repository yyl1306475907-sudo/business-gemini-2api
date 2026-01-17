"""Business Gemini Pool Application Package"""

from flask import Flask
from flask_cors import CORS

# 创建 Flask 应用
app = Flask(__name__, template_folder='../templates', static_folder='../static')
CORS(app)

# 延迟导入，避免循环依赖
def init_app():
    """初始化应用"""
    from . import routes
    from .websocket_manager import init_socketio, connection_manager
    
    # 初始化 SocketIO
    socketio = init_socketio(app)
    
    # 注册路由
    routes.register_routes(app)
    
    # 配置错误处理，静默 WebSocket 连接错误（不影响功能）
    import logging
    import sys
    import traceback
    from werkzeug.serving import WSGIRequestHandler
    
    # 保存原始的异常处理函数
    original_excepthook = sys.excepthook
    
    def custom_excepthook(exc_type, exc_value, exc_traceback):
        """自定义异常处理，过滤 WebSocket 相关错误"""
        # 检查是否是 AssertionError 且包含 write() before start_response
        if exc_type == AssertionError and 'write() before start_response' in str(exc_value):
            # 检查堆栈跟踪中是否包含 socket.io
            tb_str = ''.join(traceback.format_tb(exc_traceback))
            if 'socket.io' in tb_str.lower() or 'socketio' in tb_str.lower():
                # 静默处理，不输出错误
                return
        # 其他错误正常处理
        original_excepthook(exc_type, exc_value, exc_traceback)
    
    # 设置自定义异常处理
    sys.excepthook = custom_excepthook
    
    # 重写 WSGIRequestHandler 的 log_error 方法，过滤 WebSocket 错误
    original_log_error = WSGIRequestHandler.log_error
    
    def log_error_filter(self, format, *args):
        """过滤 WebSocket 相关的错误日志"""
        error_msg = format % args if args else format
        # 如果是 WebSocket 相关的错误（write() before start_response），不记录日志
        # 这个错误不影响功能，只是 Werkzeug 和 Flask-SocketIO 的兼容性问题
        if 'write() before start_response' in error_msg:
            return  # 静默处理，不记录日志
        # 其他错误正常记录
        original_log_error(self, format, *args)
    
    WSGIRequestHandler.log_error = log_error_filter
    
    # 重写 run_wsgi 方法，捕获并静默处理 WebSocket 错误
    original_run_wsgi = WSGIRequestHandler.run_wsgi
    
    def run_wsgi_with_error_handling(self):
        """包装 run_wsgi 方法，捕获 WebSocket 错误"""
        # 在调用前检查是否是 socket.io 路径
        is_socketio = False
        try:
            environ = self.make_environ()
            path = environ.get('PATH_INFO', '') or environ.get('REQUEST_URI', '')
            is_socketio = 'socket.io' in path.lower()
        except:
            pass
        
        # 如果确定是 socket.io 路径，重写 server.log 方法来过滤错误
        original_log = None
        if is_socketio:
            original_log = self.server.log
            
            def filtered_log(level, msg):
                """过滤 WebSocket 相关错误日志"""
                if level == 'error' and 'write() before start_response' in msg:
                    return  # 静默处理，不记录日志
                original_log(level, msg)
            
            self.server.log = filtered_log
        
        try:
            original_run_wsgi(self)
        except AssertionError as e:
            # 如果是 write() before start_response 错误，静默处理
            error_msg = str(e)
            if 'write() before start_response' in error_msg and is_socketio:
                # 恢复原始 log 方法
                if original_log:
                    self.server.log = original_log
                return  # 静默处理，不抛出异常，不记录日志
            # 恢复原始 log 方法
            if original_log:
                self.server.log = original_log
            # 其他 AssertionError 继续抛出
            raise
        except Exception as e:
            # 捕获所有异常，检查是否是 WebSocket 相关错误
            error_msg = str(e)
            if 'write() before start_response' in error_msg and is_socketio:
                # 恢复原始 log 方法
                if original_log:
                    self.server.log = original_log
                return  # 静默处理
            # 恢复原始 log 方法
            if original_log:
                self.server.log = original_log
            # 其他异常继续抛出
            raise
        finally:
            # 确保恢复原始 log 方法
            if original_log:
                self.server.log = original_log
    
    WSGIRequestHandler.run_wsgi = run_wsgi_with_error_handling
    
    # 注册 WebSocket 事件处理
    @socketio.on('connect')
    def handle_connect(auth=None):
        """处理客户端连接"""
        try:
            from flask import request
            sid = request.sid
            if sid:
                connection_manager.add_connection(sid)
        except Exception as e:
            # 静默处理连接错误，避免影响其他功能
            # 不输出错误日志，因为某些客户端（如 chat_history.html）不需要 WebSocket
            pass
        return True  # 明确返回 True 表示接受连接
    
    @socketio.on('disconnect')
    def handle_disconnect():
        """处理客户端断开"""
        try:
            from flask import request
            sid = request.sid
            if sid:
                connection_manager.remove_connection(sid)
        except Exception:
            pass
    
    @socketio.on('ping')
    def handle_ping():
        """处理心跳包"""
        try:
            import time
            from flask import request
            sid = request.sid
            if sid:
                socketio.emit('pong', {'timestamp': time.time()}, room=sid)
        except Exception:
            pass
    
    # 启动定时健康检查（如果已启用）
    try:
        from .account_manager import account_manager
        if account_manager.config.get("health_check_enabled", False):
            from .account_health_check import start_health_check
            interval = account_manager.config.get("health_check_interval", 30)
            auto_delete = account_manager.config.get("health_check_auto_delete", False)
            start_health_check(account_manager, interval, auto_delete)
            print(f"[健康检查] 已自动启动定时检查，间隔 {interval} 分钟")
    except Exception as e:
        print(f"[健康检查] 启动失败: {e}")
    
    return app, socketio

