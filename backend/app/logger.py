"""日志系统"""

import builtins
import logging
import os
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler
from .config import LOG_LEVELS, CURRENT_LOG_LEVEL, CURRENT_LOG_LEVEL_NAME

_original_print = builtins.print

# 日志文件夹和文件配置
LOG_DIR = Path(__file__).parent.parent / "log"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"
ERROR_LOG_FILE = LOG_DIR / "error.log"

# 配置日志记录器
_logger = logging.getLogger("business_gemini_pool")
_logger.setLevel(logging.DEBUG)

# 避免重复添加处理器
if not _logger.handlers:
    # 格式化器
    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 所有日志文件处理器（按大小轮转，最大10MB，保留5个备份）
    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    _logger.addHandler(file_handler)
    
    # 错误日志文件处理器（只记录 ERROR 级别）
    error_file_handler = RotatingFileHandler(
        ERROR_LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    error_file_handler.setLevel(logging.ERROR)
    error_file_handler.setFormatter(formatter)
    _logger.addHandler(error_file_handler)


def _infer_log_level(text: str) -> str:
    """推断日志级别"""
    t = text.strip()
    if t.startswith("[DEBUG]"):
        return "DEBUG"
    if t.startswith("[ERROR]") or t.startswith("[!]"):
        return "ERROR"
    return "INFO"


def _log_to_file(level_name: str, text: str):
    """将日志写入文件"""
    level_name = level_name.upper()
    if level_name == "DEBUG":
        _logger.debug(text)
    elif level_name == "ERROR":
        _logger.error(text)
    else:
        _logger.info(text)


def filtered_print(*args, **kwargs):
    """简单的日志过滤，根据全局日志级别屏蔽低级别输出，并写入文件"""
    level = kwargs.pop("_level", None)
    sep = kwargs.get("sep", " ")
    text = sep.join(str(a) for a in args)
    level_name = (level or _infer_log_level(text)).upper()
    
    # 如果日志级别足够，输出到控制台
    if LOG_LEVELS.get(level_name, LOG_LEVELS["INFO"]) >= CURRENT_LOG_LEVEL:
        _original_print(*args, **kwargs)
    
    # 始终写入文件（不受日志级别限制，但文件处理器有自己的级别）
    _log_to_file(level_name, text)


# 替换全局 print
builtins.print = filtered_print

# 导出 print 函数供其他模块使用
print = filtered_print


def set_log_level(level: str, persist: bool = False):
    """设置全局日志级别"""
    global CURRENT_LOG_LEVEL_NAME, CURRENT_LOG_LEVEL
    from .account_manager import account_manager
    
    lvl = (level or "").upper()
    if lvl not in LOG_LEVELS:
        raise ValueError(f"无效日志级别: {level}")
    CURRENT_LOG_LEVEL_NAME = lvl
    CURRENT_LOG_LEVEL = LOG_LEVELS[lvl]
    if persist and account_manager.config is not None:
        account_manager.config["log_level"] = lvl
        account_manager.save_config()
    _original_print(f"[LOG] 当前日志级别: {CURRENT_LOG_LEVEL_NAME}")

