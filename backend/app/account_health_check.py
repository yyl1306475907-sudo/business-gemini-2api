"""账号健康检查模块 - 定时自动测试账号连接"""

import threading
import time
from datetime import datetime
from typing import Optional

from .jwt_utils import get_jwt_for_account
from .exceptions import AccountAuthError, AccountRateLimitError
from .websocket_manager import emit_notification, emit_account_update

# 全局变量
_health_check_thread: Optional[threading.Thread] = None
_health_check_stop_event = threading.Event()
_health_check_running = False

# 上次检查时间和结果
_last_check_time: Optional[str] = None
_last_check_results: list = []


def get_health_check_status():
    """获取健康检查状态"""
    return {
        "running": _health_check_running,
        "last_check_time": _last_check_time,
        "last_check_results": _last_check_results
    }


def test_single_account(account_manager, account_idx: int, auto_delete: bool = False) -> dict:
    """测试单个账号
    
    Args:
        account_manager: 账号管理器实例
        account_idx: 账号索引
        auto_delete: 是否自动删除失败的账号
    
    Returns:
        测试结果字典
    """
    from .logger import print
    
    if account_idx < 0 or account_idx >= len(account_manager.accounts):
        return {"success": False, "error": "账号不存在", "account_idx": account_idx}
    
    account = account_manager.accounts[account_idx]
    proxy = account_manager.config.get("proxy")
    team_id = account.get("team_id", "")
    
    # 检查 Cookie 字段是否存在
    secure_c_ses = account.get("secure_c_ses", "").strip()
    csesidx = account.get("csesidx", "").strip()
    
    if not secure_c_ses or not csesidx:
        missing_fields = []
        if not secure_c_ses:
            missing_fields.append("secure_c_ses")
        if not csesidx:
            missing_fields.append("csesidx")
        error_msg = f"Cookie 信息不完整：缺少 {', '.join(missing_fields)}"
        
        print(f"[健康检查] 账号 {account_idx} ({team_id}): {error_msg}")
        
        if auto_delete:
            _delete_account(account_manager, account_idx)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": True
            }
        else:
            account_manager.mark_account_unavailable(account_idx, error_msg)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": False
            }
    
    try:
        # 尝试获取 JWT
        jwt = get_jwt_for_account(account, proxy)
        print(f"[健康检查] 账号 {account_idx} ({team_id}): ✓ 连接正常")
        
        # 确保账号标记为可用
        with account_manager.lock:
            if not account_manager.accounts[account_idx].get("available", True):
                account_manager.accounts[account_idx]["available"] = True
                account_manager.accounts[account_idx].pop("unavailable_reason", None)
                account_manager.accounts[account_idx].pop("unavailable_time", None)
                account_manager.account_states[account_idx]["available"] = True
        
        return {
            "success": True, 
            "account_idx": account_idx,
            "team_id": team_id,
            "message": "连接正常"
        }
        
    except AccountAuthError as e:
        error_msg = f"认证失败: {str(e)}"
        print(f"[健康检查] 账号 {account_idx} ({team_id}): ✗ {error_msg}")
        
        if auto_delete:
            _delete_account(account_manager, account_idx)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": True
            }
        else:
            account_manager.mark_account_unavailable(account_idx, error_msg)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": False
            }
            
    except AccountRateLimitError as e:
        # 限流不算失败，只是暂时不可用
        error_msg = f"触发限流: {str(e)}"
        print(f"[健康检查] 账号 {account_idx} ({team_id}): ⚠ {error_msg}")
        return {
            "success": True,  # 限流不算失败
            "account_idx": account_idx,
            "team_id": team_id,
            "message": error_msg,
            "rate_limited": True
        }
        
    except Exception as e:
        error_msg = f"测试失败: {str(e)}"
        print(f"[健康检查] 账号 {account_idx} ({team_id}): ✗ {error_msg}")
        
        if auto_delete:
            _delete_account(account_manager, account_idx)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": True
            }
        else:
            account_manager.mark_account_unavailable(account_idx, error_msg)
            return {
                "success": False, 
                "error": error_msg, 
                "account_idx": account_idx,
                "team_id": team_id,
                "deleted": False
            }


def _delete_account(account_manager, account_idx: int):
    """删除账号"""
    from .logger import print
    
    if account_idx < 0 or account_idx >= len(account_manager.accounts):
        return
    
    team_id = account_manager.accounts[account_idx].get("team_id", "")
    
    with account_manager.lock:
        account_manager.accounts.pop(account_idx)
        # 重新映射 account_states
        new_states = {}
        for i in range(len(account_manager.accounts)):
            if i < account_idx:
                new_states[i] = account_manager.account_states.get(i, {})
            else:
                new_states[i] = account_manager.account_states.get(i + 1, {})
        account_manager.account_states = new_states
        account_manager.config["accounts"] = account_manager.accounts
    
    account_manager.save_config()
    
    print(f"[健康检查] 账号 {account_idx} ({team_id}) 已自动删除")
    emit_account_update(account_idx, None)
    emit_notification("账号自动删除", f"账号 {account_idx} ({team_id}) 测试失败，已自动删除", "warning")


def run_health_check(account_manager, auto_delete: bool = False) -> list:
    """运行一次健康检查
    
    Args:
        account_manager: 账号管理器实例
        auto_delete: 是否自动删除失败的账号
    
    Returns:
        检查结果列表
    """
    global _last_check_time, _last_check_results
    from .logger import print
    
    results = []
    total = len(account_manager.accounts)
    
    if total == 0:
        print("[健康检查] 没有账号需要检查")
        return results
    
    print(f"[健康检查] 开始检查 {total} 个账号...")
    
    # 从后往前检查，这样删除账号时不会影响索引
    for i in range(total - 1, -1, -1):
        if _health_check_stop_event.is_set():
            print("[健康检查] 收到停止信号，中断检查")
            break
        
        result = test_single_account(account_manager, i, auto_delete)
        results.insert(0, result)  # 保持顺序
        
        # 每个账号之间等待一下，避免请求过快
        if i > 0:
            time.sleep(2)
    
    _last_check_time = datetime.now().isoformat()
    _last_check_results = results
    
    success_count = sum(1 for r in results if r.get("success"))
    deleted_count = sum(1 for r in results if r.get("deleted"))
    
    print(f"[健康检查] 完成: {success_count}/{len(results)} 成功" + 
          (f", {deleted_count} 个已删除" if deleted_count > 0 else ""))
    
    return results


def _health_check_loop(account_manager, interval_minutes: int, auto_delete: bool):
    """健康检查循环"""
    global _health_check_running
    from .logger import print
    
    _health_check_running = True
    print(f"[健康检查] 定时任务已启动，间隔 {interval_minutes} 分钟")
    
    while not _health_check_stop_event.is_set():
        try:
            run_health_check(account_manager, auto_delete)
        except Exception as e:
            print(f"[健康检查] 执行出错: {e}")
        
        # 等待下一次检查
        for _ in range(interval_minutes * 60):
            if _health_check_stop_event.is_set():
                break
            time.sleep(1)
    
    _health_check_running = False
    print("[健康检查] 定时任务已停止")


def start_health_check(account_manager, interval_minutes: int = 30, auto_delete: bool = False):
    """启动定时健康检查
    
    Args:
        account_manager: 账号管理器实例
        interval_minutes: 检查间隔（分钟）
        auto_delete: 是否自动删除失败的账号
    """
    global _health_check_thread, _health_check_stop_event
    from .logger import print
    
    if _health_check_thread and _health_check_thread.is_alive():
        print("[健康检查] 定时任务已在运行中")
        return
    
    _health_check_stop_event.clear()
    _health_check_thread = threading.Thread(
        target=_health_check_loop,
        args=(account_manager, interval_minutes, auto_delete),
        daemon=True
    )
    _health_check_thread.start()


def stop_health_check():
    """停止定时健康检查"""
    global _health_check_stop_event
    from .logger import print
    
    if not _health_check_running:
        print("[健康检查] 定时任务未在运行")
        return
    
    _health_check_stop_event.set()
    print("[健康检查] 正在停止定时任务...")
