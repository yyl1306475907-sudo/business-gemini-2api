"""Business Gemini OpenAPI 兼容服务
整合JWT获取和聊天功能，提供OpenAPI接口
支持多账号轮训
支持图片输出（OpenAI格式）

主入口文件 - 已重构为模块化结构
"""

import argparse
import threading
import time
import socket
import sys
from pathlib import Path

# 禁用SSL警告
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 导入 Flask 应用
from app import app, init_app

# 导入配置
from app.config import (
    CONFIG_FILE,
    IMAGE_CACHE_DIR,
    IMAGE_CACHE_HOURS,
    VIDEO_CACHE_DIR,
    VIDEO_CACHE_HOURS,
    PLAYWRIGHT_AVAILABLE,
    PLAYWRIGHT_BROWSER_INSTALLED
)

# 导入账号管理器和认证
from app.account_manager import account_manager
from app.auth import get_admin_secret_key

# 导入工具函数
from app.utils import check_proxy

# 导入 Cookie 刷新（使用临时邮箱方式）
from app.cookie_refresh import auto_refresh_expired_cookies_worker

# 导入 WebSocket 管理器
from app.websocket_manager import connection_manager, emit_system_log

# 初始化 Flask 应用并注册路由
app, socketio = init_app()


def print_startup_info():
    """打印启动信息"""
    print("="*60)
    print("Business Gemini OpenAPI 服务 (多账号轮训版)")
    print("支持图片输入输出 (OpenAI格式)")
    print("="*60)
    
    # 加载配置（自动使用数据库或 JSON）
    account_manager.load_config()
    get_admin_secret_key()
    
    # 代理信息
    if account_manager.config is None:
        account_manager.config = {}
    proxy = account_manager.config.get("proxy")
    print(f"\n[代理配置]")
    print(f"  地址: {proxy or '未配置'}")
    if proxy:
        proxy_available = check_proxy(proxy)
        print(f"  状态: {'✓ 可用' if proxy_available else '✗ 不可用'}")
    
    # 图片缓存信息
    print(f"\n[图片缓存]")
    print(f"  目录: {IMAGE_CACHE_DIR}")
    print(f"  缓存时间: {IMAGE_CACHE_HOURS} 小时")
    
    # 账号信息
    total, available = account_manager.get_account_count()
    print(f"\n[账号配置]")
    print(f"  总数量: {total}")
    print(f"  可用数量: {available}")
    
    for i, acc in enumerate(account_manager.accounts):
        state = account_manager.account_states.get(i, {})
        is_available = account_manager.is_account_available(i)
        status = "✓" if is_available else "✗"
        team_id = acc.get("team_id", "未知") + "..."
        cooldown_until = state.get("cooldown_until")
        extra = ""
        if cooldown_until and cooldown_until > time.time():
            remaining = int(cooldown_until - time.time())
            extra = f" (冷却中 ~{remaining}s)"
        print(f"  [{i}] {status} team_id: {team_id}{extra}")
    
    # 模型信息
    models = account_manager.config.get("models", [])
    print(f"\n[模型配置]")
    if models:
        for model in models:
            print(f"  - {model.get('id')}: {model.get('name', '')}")
    else:
        print("  - gemini-enterprise (默认)")
    
    print(f"\n[接口列表]")
    print("  GET  /v1/models           - 获取模型列表")
    print("  POST /v1/chat/completions - 聊天对话 (支持图片/视频)")
    print("  GET  /v1/status           - 系统状态")
    print("  GET  /health              - 健康检查")
    print("  GET  /image/<filename>    - 获取缓存图片")
    print("  GET  /video/<filename>    - 获取缓存视频")
    print("  GET  /login               - 登录页面")
    print("\n" + "="*60)
    print("启动服务...")


if __name__ == '__main__':
    # 解析命令行参数
    parser = argparse.ArgumentParser(
        description='Business Gemini OpenAPI 兼容服务',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python gemini.py                    # 正常启动服务
  python gemini.py --migrate          # 迁移 JSON 到数据库
  python gemini.py --migrate --force  # 强制迁移（覆盖现有数据）
  python gemini.py --export           # 导出数据库到 JSON
        """
    )
    parser.add_argument('--migrate', action='store_true', 
                       help='迁移 JSON 配置到数据库')
    parser.add_argument('--export', action='store_true', 
                       help='导出数据库到 JSON 文件（备份）')
    parser.add_argument('--force', action='store_true', 
                       help='强制迁移（覆盖现有数据，仅与 --migrate 一起使用）')
    parser.add_argument('--port', type=int, default=None,
                       help='指定服务端口（默认: 8000 或从配置读取）')
    parser.add_argument('--host', type=str, default=None,
                       help='指定服务地址（默认: 0.0.0.0，Windows 建议使用 127.0.0.1）')
    parser.add_argument('--headless', action='store_true',
                       help='强制使用无头模式进行 Cookie 自动刷新（默认: 根据系统自动检测）')
    parser.add_argument('--headed', action='store_true',
                       help='强制使用有头模式（可视化模式）进行 Cookie 自动刷新')
    
    args = parser.parse_args()
    
    # 处理迁移命令
    if args.migrate:
        try:
            from app.migration import migrate_json_to_db
            success = migrate_json_to_db(force=args.force)
            exit(0 if success else 1)
        except ImportError:
            print("[错误] SQLAlchemy 未安装，无法使用数据库功能")
            print("安装命令: pip install sqlalchemy")
            exit(1)
        except Exception as e:
            print(f"[错误] 迁移失败: {e}")
            import traceback
            traceback.print_exc()
            exit(1)
    
    # 处理导出命令
    if args.export:
        try:
            from app.migration import export_db_to_json
            success = export_db_to_json()
            exit(0 if success else 1)
        except ImportError:
            print("[错误] SQLAlchemy 未安装，无法使用数据库功能")
            print("安装命令: pip install sqlalchemy")
            exit(1)
        except Exception as e:
            print(f"[错误] 导出失败: {e}")
            import traceback
            traceback.print_exc()
            exit(1)
    
    # 正常启动服务
    print_startup_info()
    
    if not account_manager.accounts:
        print("[!] 警告: 没有配置任何账号")
    
    # 启动 Cookie 自动刷新后台线程（使用临时邮箱方式）
    auto_refresh_enabled = account_manager.config.get("auto_refresh_cookie", False)
    if auto_refresh_enabled and PLAYWRIGHT_AVAILABLE:
        # 将 headless/headed 参数传递给自动刷新线程
        import os
        if args.headless:
            os.environ['FORCE_HEADLESS'] = '1'
            os.environ.pop('FORCE_HEADED', None)  # 清除 headed 标志
            print("[✓] 已启用强制无头模式（--headless）")
        elif args.headed:
            os.environ['FORCE_HEADED'] = '1'
            os.environ.pop('FORCE_HEADLESS', None)  # 清除 headless 标志
            print("[✓] 已启用强制有头模式（--headed）")
        # 启动临时邮箱自动刷新线程（每30分钟检查过期 Cookie 并使用临时邮箱刷新）
        expired_refresh_thread = threading.Thread(target=auto_refresh_expired_cookies_worker, daemon=True)
        expired_refresh_thread.start()
        print("[✓] Cookie 自动刷新功能已启用（每30分钟检查一次过期 Cookie，使用临时邮箱自动刷新）")
    elif auto_refresh_enabled and not PLAYWRIGHT_AVAILABLE:
        print("[!] 警告: 配置启用了自动刷新 Cookie，但 Playwright 未安装")
        print("    安装命令: pip install playwright && playwright install chromium")
    
    # 确定端口和主机地址
    port = args.port
    if port is None:
        # 从配置中读取端口
        if account_manager.config and "service" in account_manager.config:
            port = int(account_manager.config["service"].get("port", 8000))
        else:
            port = 8000
    
    host = args.host
    if host is None:
        # 根据系统类型选择默认主机地址
        import os
        if os.name == 'nt':  # Windows
            # Windows 系统默认使用 127.0.0.1，避免权限问题
            host = '127.0.0.1'
        else:  # Linux/Unix/macOS
            # Linux/Unix 系统默认使用 0.0.0.0，允许外部访问
            # 注意：如果端口 < 1024，可能需要 root 权限
            host = '0.0.0.0'
    
    # 检查端口是否被占用
    def is_port_in_use(port):
        """检查端口是否被占用"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return False
            except OSError:
                return True
    
    if is_port_in_use(port):
        print(f"[错误] 端口 {port} 已被占用，请使用其他端口")
        print(f"      提示: 使用 --port 参数指定其他端口，例如: python gemini.py --port 8001")
        sys.exit(1)
    
    # 检查特权端口（Linux/Unix 系统）
    import os
    if os.name != 'nt' and port < 1024:
        import os
        if os.geteuid() != 0:
            print(f"[警告] 端口 {port} 是特权端口（< 1024），可能需要 root 权限")
            print(f"      建议: 使用非特权端口（>= 1024），例如: python gemini.py --port 8000")
            print(f"      或者: 以 root 身份运行（不推荐）")
    
    # 显示访问地址
    import os
    if host == '0.0.0.0':
        # 如果绑定到 0.0.0.0，显示本地和外部访问地址
        print(f"[启动] 服务地址:")
        print(f"      本地访问: http://127.0.0.1:{port}")
        if os.name != 'nt':  # Linux/Unix
            # 尝试获取本机 IP 地址
            try:
                import socket
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
                print(f"      外部访问: http://{local_ip}:{port}")
            except Exception:
                pass
        print(f"      管理界面: http://127.0.0.1:{port}/")
        print(f"      聊天界面: http://127.0.0.1:{port}/chat_history.html")
    else:
        print(f"[启动] 服务地址: http://{host}:{port}")
        print(f"[启动] 管理界面: http://{host}:{port}/")
        print(f"[启动] 聊天界面: http://{host}:{port}/chat_history.html")
    print()
    
    # 使用 SocketIO 运行应用（支持 WebSocket）
    try:
        socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)
    except OSError as e:
        if "以一种访问权限不允许的方式做了一个访问套接字的尝试" in str(e) or "permission denied" in str(e).lower():
            print(f"[错误] 端口 {port} 访问权限被拒绝")
            print(f"      可能的原因:")
            print(f"      1. 端口被其他程序占用")
            print(f"      2. 需要管理员权限（Windows: 以管理员身份运行）")
            print(f"      3. 防火墙阻止")
            print(f"      解决方案:")
            print(f"      - 使用其他端口: python gemini.py --port 8001")
            print(f"      - 使用本地地址: python gemini.py --host 127.0.0.1")
            print(f"      - 以管理员身份运行（Windows）")
        else:
            print(f"[错误] 启动失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[错误] 启动失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
