"""数据库模型和配置"""

from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
from pathlib import Path
import json
import os

Base = declarative_base()

# 数据库文件路径（支持环境变量配置，用于 Zeabur 等平台的持久化存储）
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent.parent))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = DATA_DIR / "geminibusiness.db"
DATABASE_URL = f"sqlite:///{DB_FILE}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Account(Base):
    """账号表"""
    __tablename__ = "accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(String(200), nullable=True)
    secure_c_ses = Column(Text, nullable=True)
    host_c_oses = Column(Text, nullable=True)
    csesidx = Column(String(100), nullable=True)
    user_agent = Column(Text, nullable=True)
    available = Column(Boolean, default=True)
    tempmail_url = Column(Text, nullable=True)
    tempmail_name = Column(String(200), nullable=True)
    tempmail_worker_url = Column(Text, nullable=True)
    
    # 配额信息（JSON 存储为 Text，使用时解析）
    quota_usage_json = Column(Text, nullable=True)  # JSON 字符串
    quota_reset_date = Column(String(50), nullable=True)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    @property
    def quota_usage(self):
        """获取配额使用量（字典）"""
        if self.quota_usage_json:
            try:
                return json.loads(self.quota_usage_json)
            except:
                return {}
        return {}
    
    @quota_usage.setter
    def quota_usage(self, value):
        """设置配额使用量（字典转 JSON）"""
        if isinstance(value, dict):
            self.quota_usage_json = json.dumps(value, ensure_ascii=False)
        else:
            self.quota_usage_json = None


class Model(Base):
    """模型配置表"""
    __tablename__ = "models"
    
    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(String(100), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    api_model_id = Column(String(100), nullable=True)
    context_length = Column(Integer, default=32768)
    max_tokens = Column(Integer, default=8192)
    price_per_1k_tokens = Column(String(50), nullable=True)
    enabled = Column(Boolean, default=True)
    account_index = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SystemConfig(Base):
    """系统配置表（存储 proxy、image_base_url 等）"""
    __tablename__ = "system_config"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    value_type = Column(String(20), default="string")  # string, bool, int, json
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class APIKey(Base):
    """API 密钥表"""
    __tablename__ = "api_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    key_hash = Column(String(100), unique=True, nullable=False, index=True)  # 存储哈希值
    encrypted_key = Column(Text, nullable=True)  # 存储加密后的密钥（可选，用于显示）
    name = Column(String(100), nullable=False)  # 密钥名称
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)  # 过期时间
    is_active = Column(Boolean, default=True, index=True)  # 是否激活
    usage_count = Column(Integer, default=0)  # 使用次数
    last_used_at = Column(DateTime, nullable=True, index=True)  # 最后使用时间
    description = Column(Text, nullable=True)  # 描述信息
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class APICallLog(Base):
    """API 调用日志表"""
    __tablename__ = "api_call_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    api_key_id = Column(Integer, nullable=True, index=True)  # 关联的 API Key ID（可为空，兼容旧 token）
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)  # 调用时间
    model = Column(String(50), nullable=True)  # 使用的模型
    status = Column(String(20), nullable=False, index=True)  # success 或 error
    error_message = Column(Text, nullable=True)  # 错误信息
    ip_address = Column(String(50), nullable=True, index=True)  # 客户端 IP
    endpoint = Column(String(100), nullable=True)  # 调用的端点
    response_time = Column(Integer, nullable=True)  # 响应时间（毫秒）
    request_size = Column(Integer, nullable=True)  # 请求大小（字节）
    response_size = Column(Integer, nullable=True)  # 响应大小（字节）


def _migrate_add_columns():
    """迁移：添加新列到现有表（如果不存在）"""
    try:
        from sqlalchemy import text, inspect
        
        inspector = inspect(engine)
        conn = engine.connect()
        try:
            # 检查 accounts 表是否存在 tempmail_worker_url 列
            columns = [col['name'] for col in inspector.get_columns('accounts')]
            if 'tempmail_worker_url' not in columns:
                print("[数据库迁移] 添加 tempmail_worker_url 列到 accounts 表...")
                conn.execute(text("ALTER TABLE accounts ADD COLUMN tempmail_worker_url TEXT"))
                conn.commit()
                print("[数据库迁移] ✓ 已添加 tempmail_worker_url 列")
        except Exception as e:
            # 如果表不存在或其他错误，忽略（create_all 会处理）
            if 'no such table' not in str(e).lower():
                print(f"[数据库迁移] 警告: {e}")
        finally:
            conn.close()
    except ImportError:
        # SQLAlchemy 版本可能不支持 inspect，跳过迁移
        pass
    except Exception as e:
        # 其他错误，忽略
        pass


def init_db():
    """初始化数据库表"""
    Base.metadata.create_all(bind=engine)
    # 迁移：添加新列（如果不存在）
    _migrate_add_columns()


def get_db():
    """获取数据库会话（生成器）"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_session() -> Session:
    """获取数据库会话（直接返回）"""
    return SessionLocal()

