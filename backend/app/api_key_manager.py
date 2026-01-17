"""API 密钥管理模块"""

import os
import uuid
import hashlib
import base64
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from cryptography.fernet import Fernet
import secrets

from .database import SessionLocal, APIKey, APICallLog, get_db_session


# 加密密钥（用于加密存储 API 密钥，便于显示）
# 注意：这是固定密钥，仅用于加密存储，不是用于验证
# 从环境变量读取，如果没有则使用默认值（仅用于开发环境）
_default_key = b"your-encryption-key-change-this-in-production-32bytes!!"  # 必须是32字节
_env_key = os.getenv("API_KEY_ENCRYPTION_KEY", "").encode() if os.getenv("API_KEY_ENCRYPTION_KEY") else None

if _env_key and len(_env_key) >= 32:
    ENCRYPTION_KEY = _env_key[:32]
elif _env_key:
    # 如果环境变量提供的密钥长度不足，补齐到32字节
    ENCRYPTION_KEY = _env_key.ljust(32)[:32]
else:
    # 使用默认密钥（仅用于开发环境，生产环境应设置环境变量）
    ENCRYPTION_KEY = _default_key
    if len(ENCRYPTION_KEY) < 32:
        ENCRYPTION_KEY = ENCRYPTION_KEY.ljust(32)[:32]
    elif len(ENCRYPTION_KEY) > 32:
        ENCRYPTION_KEY = ENCRYPTION_KEY[:32]

# 生成 Fernet 密钥
fernet_key = base64.urlsafe_b64encode(ENCRYPTION_KEY)
cipher = Fernet(fernet_key)


def generate_api_key() -> str:
    """生成 UUID 格式的 API 密钥"""
    return str(uuid.uuid4())


def hash_api_key(api_key: str) -> str:
    """哈希 API 密钥（SHA256）"""
    return hashlib.sha256(api_key.encode()).hexdigest()


def encrypt_api_key(api_key: str) -> str:
    """加密 API 密钥（用于存储，便于显示）"""
    try:
        return cipher.encrypt(api_key.encode()).decode()
    except Exception:
        return ""


def decrypt_api_key(encrypted_key: str) -> Optional[str]:
    """解密 API 密钥"""
    try:
        return cipher.decrypt(encrypted_key.encode()).decode()
    except Exception:
        return None


def create_api_key(name: str, expires_days: Optional[int] = None, description: Optional[str] = None) -> Dict:
    """
    创建新的 API 密钥
    
    Args:
        name: 密钥名称
        expires_days: 过期天数（None 表示永不过期）
        description: 描述信息
    
    Returns:
        dict: 包含 key 和 key_info 的字典
    """
    db = SessionLocal()
    try:
        # 生成密钥
        api_key = generate_api_key()
        key_hash = hash_api_key(api_key)
        encrypted_key = encrypt_api_key(api_key)
        
        # 计算过期时间
        expires_at = None
        if expires_days:
            expires_at = datetime.utcnow() + timedelta(days=expires_days)
        
        # 创建数据库记录
        db_key = APIKey(
            key_hash=key_hash,
            encrypted_key=encrypted_key,
            name=name,
            expires_at=expires_at,
            description=description,
            is_active=True,
            usage_count=0
        )
        db.add(db_key)
        db.commit()
        db.refresh(db_key)
        
        return {
            "key": api_key,  # 原始密钥（仅返回一次）
            "key_info": {
                "id": db_key.id,
                "name": db_key.name,
                "created_at": db_key.created_at.isoformat() if db_key.created_at else None,
                "expires_at": db_key.expires_at.isoformat() if db_key.expires_at else None,
                "is_active": db_key.is_active,
                "usage_count": db_key.usage_count,
                "last_used_at": db_key.last_used_at.isoformat() if db_key.last_used_at else None,
                "description": db_key.description
            }
        }
    finally:
        db.close()


def verify_api_key(api_key: str) -> Optional[APIKey]:
    """
    验证 API 密钥是否有效
    
    Args:
        api_key: API 密钥
    
    Returns:
        APIKey 对象（如果有效），否则 None
    """
    if not api_key:
        return None
    
    db = SessionLocal()
    try:
        key_hash = hash_api_key(api_key)
        db_key = db.query(APIKey).filter(
            APIKey.key_hash == key_hash,
            APIKey.is_active == True
        ).first()
        
        if not db_key:
            return None
        
        # 检查是否过期
        if db_key.expires_at and db_key.expires_at < datetime.utcnow():
            return None
        
        return db_key
    finally:
        db.close()


def update_api_key_usage(api_key_id: int):
    """更新 API 密钥使用统计"""
    db = SessionLocal()
    try:
        db_key = db.query(APIKey).filter(APIKey.id == api_key_id).first()
        if db_key:
            db_key.usage_count += 1
            db_key.last_used_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


def get_api_key_by_id(key_id: int) -> Optional[APIKey]:
    """根据 ID 获取 API 密钥"""
    db = SessionLocal()
    try:
        return db.query(APIKey).filter(APIKey.id == key_id).first()
    finally:
        db.close()


def list_api_keys(include_inactive: bool = False) -> List[Dict]:
    """列出所有 API 密钥"""
    db = SessionLocal()
    try:
        query = db.query(APIKey)
        if not include_inactive:
            query = query.filter(APIKey.is_active == True)
        
        keys = query.order_by(APIKey.created_at.desc()).all()
        
        result = []
        for key in keys:
            result.append({
                "id": key.id,
                "name": key.name,
                "created_at": key.created_at.isoformat() if key.created_at else None,
                "expires_at": key.expires_at.isoformat() if key.expires_at else None,
                "is_active": key.is_active,
                "usage_count": key.usage_count,
                "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
                "description": key.description,
                "is_expired": key.expires_at is not None and key.expires_at < datetime.utcnow()
            })
        return result
    finally:
        db.close()


def revoke_api_key(key_id: int) -> bool:
    """撤销 API 密钥（设置为非激活）"""
    db = SessionLocal()
    try:
        db_key = db.query(APIKey).filter(APIKey.id == key_id).first()
        if db_key:
            db_key.is_active = False
            db.commit()
            return True
        return False
    finally:
        db.close()


def delete_api_key(key_id: int) -> bool:
    """删除 API 密钥"""
    db = SessionLocal()
    try:
        db_key = db.query(APIKey).filter(APIKey.id == key_id).first()
        if db_key:
            # 先删除关联的调用日志
            db.query(APICallLog).filter(APICallLog.api_key_id == key_id).delete()
            # 删除密钥
            db.delete(db_key)
            db.commit()
            return True
        return False
    finally:
        db.close()


def log_api_call(
    api_key_id: Optional[int],
    model: Optional[str],
    status: str,
    response_time: Optional[int] = None,
    ip_address: Optional[str] = None,
    endpoint: Optional[str] = None,
    error_message: Optional[str] = None,
    request_size: Optional[int] = None,
    response_size: Optional[int] = None
):
    """记录 API 调用日志"""
    db = SessionLocal()
    try:
        log = APICallLog(
            api_key_id=api_key_id,
            model=model,
            status=status,
            response_time=response_time,
            ip_address=ip_address,
            endpoint=endpoint,
            error_message=error_message,
            request_size=request_size,
            response_size=response_size
        )
        db.add(log)
        db.commit()
    except Exception as e:
        # 记录日志失败不应该影响主流程
        print(f"[API日志] 记录日志失败: {e}")
    finally:
        db.close()


def get_api_key_stats(key_id: int, days: int = 30) -> Dict:
    """获取 API 密钥统计信息"""
    db = SessionLocal()
    try:
        db_key = db.query(APIKey).filter(APIKey.id == key_id).first()
        if not db_key:
            return {}
        
        # 计算时间范围
        since = datetime.utcnow() - timedelta(days=days)
        
        # 查询调用日志
        logs = db.query(APICallLog).filter(
            APICallLog.api_key_id == key_id,
            APICallLog.timestamp >= since
        ).all()
        
        # 统计
        total_calls = len(logs)
        success_calls = len([log for log in logs if log.status == "success"])
        error_calls = total_calls - success_calls
        
        # 计算平均响应时间
        response_times = [log.response_time for log in logs if log.response_time]
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0
        
        # 按模型统计
        model_stats = {}
        for log in logs:
            model = log.model or "unknown"
            if model not in model_stats:
                model_stats[model] = {"total": 0, "success": 0, "error": 0}
            model_stats[model]["total"] += 1
            if log.status == "success":
                model_stats[model]["success"] += 1
            else:
                model_stats[model]["error"] += 1
        
        return {
            "key_id": key_id,
            "key_name": db_key.name,
            "total_calls": total_calls,
            "success_calls": success_calls,
            "error_calls": error_calls,
            "success_rate": (success_calls / total_calls * 100) if total_calls > 0 else 0,
            "avg_response_time": round(avg_response_time, 2),
            "model_stats": model_stats,
            "period_days": days
        }
    finally:
        db.close()


def get_api_call_logs(
    key_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 50,
    status: Optional[str] = None
) -> Dict:
    """获取 API 调用日志"""
    db = SessionLocal()
    try:
        query = db.query(APICallLog)
        
        if key_id:
            query = query.filter(APICallLog.api_key_id == key_id)
        
        if status:
            query = query.filter(APICallLog.status == status)
        
        # 总数
        total = query.count()
        
        # 分页
        offset = (page - 1) * page_size
        logs = query.order_by(APICallLog.timestamp.desc()).offset(offset).limit(page_size).all()
        
        result = []
        for log in logs:
            result.append({
                "id": log.id,
                "api_key_id": log.api_key_id,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "model": log.model,
                "status": log.status,
                "error_message": log.error_message,
                "ip_address": log.ip_address,
                "endpoint": log.endpoint,
                "response_time": log.response_time,
                "request_size": log.request_size,
                "response_size": log.response_size
            })
        
        return {
            "logs": result,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size
        }
    finally:
        db.close()

