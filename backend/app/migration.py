"""数据迁移工具：JSON 和数据库之间的数据迁移"""

import json
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session

from .database import SessionLocal, Account, Model, SystemConfig, init_db
from .config import CONFIG_FILE


def migrate_json_to_db(force: bool = False) -> bool:
    """
    将 JSON 配置迁移到数据库
    
    Args:
        force: 是否强制迁移（即使数据库已有数据）
    
    Returns:
        bool: 是否成功迁移
    """
    if not CONFIG_FILE.exists():
        print("[迁移] JSON 配置文件不存在，跳过迁移")
        return False
    
    db = SessionLocal()
    try:
        # 检查数据库是否已有数据
        existing_accounts = db.query(Account).count()
        if existing_accounts > 0 and not force:
            print(f"[迁移] 数据库已有 {existing_accounts} 个账号，跳过迁移（使用 --force 强制迁移）")
            return False
        
        # 读取 JSON 配置
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        print("[迁移] 开始从 JSON 迁移数据到数据库...")
        
        # 如果强制迁移，先清空现有数据
        if force and existing_accounts > 0:
            print("[迁移] 强制迁移模式：清空现有数据...")
            db.query(Account).delete()
            db.query(Model).delete()
            db.query(SystemConfig).delete()
            db.commit()
        
        # 迁移系统配置
        _migrate_system_config(db, config)
        
        # 迁移账号
        account_count = _migrate_accounts(db, config.get("accounts", []))
        
        # 迁移模型
        model_count = _migrate_models(db, config.get("models", []))
        
        db.commit()
        
        print(f"[迁移] ✓ 迁移完成：{account_count} 个账号，{model_count} 个模型")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"[迁移] ✗ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


def _migrate_system_config(db: Session, config: dict):
    """迁移系统配置"""
    config_mapping = {
        "proxy": ("proxy", "string"),
        "proxy_enabled": ("proxy_enabled", "bool"),
        "image_base_url": ("image_base_url", "string"),
        "upload_endpoint": ("upload_endpoint", "string"),
        "upload_api_token": ("upload_api_token", "string"),
        "log_level": ("log_level", "string"),
        "admin_password_hash": ("admin_password_hash", "string"),
        "admin_secret_key": ("admin_secret_key", "string"),
    }
    
    for json_key, (db_key, value_type) in config_mapping.items():
        if json_key in config:
            value = config[json_key]
            
            # 类型转换
            if value_type == "bool":
                value = str(value).lower() == "true"
            elif value_type == "int":
                try:
                    value = int(value)
                except:
                    pass
            
            # 检查是否已存在
            existing = db.query(SystemConfig).filter(SystemConfig.key == db_key).first()
            if existing:
                existing.value = str(value)
                existing.value_type = value_type
            else:
                db.add(SystemConfig(key=db_key, value=str(value), value_type=value_type))
    
    # 迁移 api_tokens（作为 JSON 存储）
    if "api_tokens" in config:
        tokens = config["api_tokens"]
        if isinstance(tokens, list):
            tokens_json = json.dumps(tokens, ensure_ascii=False)
            existing = db.query(SystemConfig).filter(SystemConfig.key == "api_tokens").first()
            if existing:
                existing.value = tokens_json
                existing.value_type = "json"
            else:
                db.add(SystemConfig(key="api_tokens", value=tokens_json, value_type="json"))


def _migrate_accounts(db: Session, accounts: list) -> int:
    """迁移账号"""
    count = 0
    for acc_data in accounts:
        # 处理配额使用量
        quota_usage = acc_data.get("quota_usage", {})
        if not isinstance(quota_usage, dict):
            quota_usage = {}
        
        account = Account(
            team_id=acc_data.get("team_id"),
            secure_c_ses=acc_data.get("secure_c_ses"),
            host_c_oses=acc_data.get("host_c_oses"),
            csesidx=acc_data.get("csesidx"),
            user_agent=acc_data.get("user_agent"),
            available=acc_data.get("available", True),
            tempmail_url=acc_data.get("tempmail_url"),
            tempmail_name=acc_data.get("tempmail_name"),
            quota_usage=quota_usage,
            quota_reset_date=acc_data.get("quota_reset_date"),
        )
        db.add(account)
        count += 1
    return count


def _migrate_models(db: Session, models: list) -> int:
    """迁移模型"""
    count = 0
    for model_data in models:
        model_id = model_data.get("id")
        if not model_id:
            continue
        
        # 检查是否已存在
        existing = db.query(Model).filter(
            Model.model_id == model_id
        ).first()
        
        if existing:
            # 更新现有模型
            existing.name = model_data.get("name", existing.name)
            existing.description = model_data.get("description", existing.description)
            existing.api_model_id = model_data.get("api_model_id", existing.api_model_id)
            existing.context_length = model_data.get("context_length", existing.context_length)
            existing.max_tokens = model_data.get("max_tokens", existing.max_tokens)
            existing.price_per_1k_tokens = model_data.get("price_per_1k_tokens", existing.price_per_1k_tokens)
            existing.enabled = model_data.get("enabled", existing.enabled)
            existing.account_index = model_data.get("account_index", existing.account_index)
        else:
            # 创建新模型
            model = Model(
                model_id=model_id,
                name=model_data.get("name", ""),
                description=model_data.get("description"),
                api_model_id=model_data.get("api_model_id"),
                context_length=model_data.get("context_length", 32768),
                max_tokens=model_data.get("max_tokens", 8192),
                price_per_1k_tokens=model_data.get("price_per_1k_tokens"),
                enabled=model_data.get("enabled", True),
                account_index=model_data.get("account_index", 0),
            )
            db.add(model)
        count += 1
    return count


def export_db_to_json(output_file: Optional[Path] = None) -> bool:
    """
    将数据库数据导出为 JSON 格式（用于备份）
    
    Args:
        output_file: 输出文件路径，默认覆盖原 JSON 文件
    
    Returns:
        bool: 是否成功导出
    """
    if output_file is None:
        output_file = CONFIG_FILE
    
    db = SessionLocal()
    try:
        config = {}
        
        # 导出系统配置
        system_configs = db.query(SystemConfig).all()
        for sc in system_configs:
            key = sc.key
            value = sc.value
            
            # 类型转换
            if sc.value_type == "bool":
                value = value.lower() == "true"
            elif sc.value_type == "int":
                try:
                    value = int(value)
                except:
                    pass
            elif sc.value_type == "json":
                try:
                    value = json.loads(value)
                except:
                    pass
            
            config[key] = value
        
        # 导出账号
        accounts = db.query(Account).order_by(Account.id).all()
        config["accounts"] = []
        for acc in accounts:
            config["accounts"].append({
                "team_id": acc.team_id,
                "secure_c_ses": acc.secure_c_ses,
                "host_c_oses": acc.host_c_oses,
                "csesidx": acc.csesidx,
                "user_agent": acc.user_agent,
                "available": acc.available,
                "tempmail_url": acc.tempmail_url,
                "tempmail_name": acc.tempmail_name,
                "quota_usage": acc.quota_usage,
                "quota_reset_date": acc.quota_reset_date,
            })
        
        # 导出模型
        models = db.query(Model).order_by(Model.id).all()
        config["models"] = []
        for model in models:
            config["models"].append({
                "id": model.model_id,
                "name": model.name,
                "description": model.description,
                "api_model_id": model.api_model_id,
                "context_length": model.context_length,
                "max_tokens": model.max_tokens,
                "price_per_1k_tokens": model.price_per_1k_tokens,
                "enabled": model.enabled,
                "account_index": model.account_index,
            })
        
        # 写入文件
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=4)
        
        print(f"[导出] ✓ 已导出到 {output_file}")
        return True
        
    except Exception as e:
        print(f"[导出] ✗ 导出失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

