"""WebSocket 连接管理器"""

from typing import List, Dict, Any
from flask_socketio import SocketIO, emit
import json
import threading
from datetime import datetime

# 全局 SocketIO 实例（将在 gemini.py 中初始化）
socketio: SocketIO = None

# 活跃连接管理
class ConnectionManager:
    """WebSocket 连接管理器"""
    
    def __init__(self):
        self.active_connections: List[str] = []  # 存储客户端 session ID
        self.lock = threading.Lock()
    
    def add_connection(self, sid: str):
        """添加连接"""
        with self.lock:
            if sid not in self.active_connections:
                self.active_connections.append(sid)
                # 调试日志已关闭
                # print(f"[WebSocket] 客户端已连接: {sid} (总计: {len(self.active_connections)})")
    
    def remove_connection(self, sid: str):
        """移除连接"""
        with self.lock:
            if sid in self.active_connections:
                self.active_connections.remove(sid)
                # 调试日志已关闭
                # print(f"[WebSocket] 客户端已断开: {sid} (剩余: {len(self.active_connections)})")
    
    def get_connection_count(self) -> int:
        """获取连接数"""
        with self.lock:
            return len(self.active_connections)
    
    def broadcast(self, event: str, data: Dict[Any, Any], namespace: str = '/'):
        """广播消息给所有连接的客户端"""
        if socketio is None:
            return
        
        with self.lock:
            if self.active_connections:
                socketio.emit(event, data, namespace=namespace)
                # 调试日志已关闭
                # print(f"[WebSocket] 广播事件 '{event}' 给 {len(self.active_connections)} 个客户端")

# 全局连接管理器实例
connection_manager = ConnectionManager()


def init_socketio(app):
    """初始化 SocketIO"""
    global socketio
    socketio = SocketIO(
        app,
        cors_allowed_origins="*",  # 允许所有来源（生产环境应限制）
        async_mode='threading',
        logger=False,
        engineio_logger=False,
        manage_session=False,  # 不使用 Flask 的 session 管理，避免冲突
        ping_timeout=60,  # 增加 ping 超时时间
        ping_interval=25  # ping 间隔
    )
    return socketio


def emit_account_update(account_index: int, account_data: Dict[str, Any]):
    """推送账号更新事件"""
    connection_manager.broadcast('account_update', {
        'account_index': account_index,
        'account': account_data,
        'timestamp': datetime.now().isoformat()
    })


def emit_cookie_refresh_progress(account_index: int, status: str, message: str, progress: float = None):
    """推送 Cookie 刷新进度"""
    connection_manager.broadcast('cookie_refresh_progress', {
        'account_index': account_index,
        'status': status,  # 'start', 'progress', 'success', 'error'
        'message': message,
        'progress': progress,  # 0.0 - 1.0
        'timestamp': datetime.now().isoformat()
    })


def emit_system_log(level: str, message: str, category: str = 'system'):
    """推送系统日志"""
    connection_manager.broadcast('system_log', {
        'level': level,  # 'info', 'warning', 'error', 'success'
        'message': message,
        'category': category,
        'timestamp': datetime.now().isoformat()
    })


def emit_stats_update(stats: Dict[str, Any]):
    """推送统计信息更新"""
    connection_manager.broadcast('stats_update', {
        'stats': stats,
        'timestamp': datetime.now().isoformat()
    })


def emit_api_call_log(log_data: Dict[str, Any]):
    """推送 API 调用日志"""
    connection_manager.broadcast('api_call_log', {
        'log': log_data,
        'timestamp': datetime.now().isoformat()
    })


def emit_notification(title: str, message: str, type: str = 'info'):
    """推送通知"""
    connection_manager.broadcast('notification', {
        'title': title,
        'message': message,
        'type': type,  # 'info', 'success', 'warning', 'error'
        'timestamp': datetime.now().isoformat()
    })

