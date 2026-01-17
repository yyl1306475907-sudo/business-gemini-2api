"""文件管理器模块"""

import time
from typing import Dict, List, Optional


class FileManager:
    """文件管理器 - 管理上传文件的映射关系（OpenAI file_id <-> Gemini fileId）"""
    
    def __init__(self):
        self.files: Dict[str, Dict] = {}  # openai_file_id -> {gemini_file_id, session_name, filename, mime_type, size, created_at}
    
    def add_file(self, openai_file_id: str, gemini_file_id: str, session_name: str, 
                 filename: str, mime_type: str, size: int) -> Dict:
        """添加文件映射"""
        file_info = {
            "id": openai_file_id,
            "gemini_file_id": gemini_file_id,
            "session_name": session_name,
            "filename": filename,
            "mime_type": mime_type,
            "bytes": size,
            "created_at": int(time.time()),
            "purpose": "assistants",
            "object": "file"
        }
        self.files[openai_file_id] = file_info
        return file_info
    
    def get_file(self, openai_file_id: str) -> Optional[Dict]:
        """获取文件信息"""
        return self.files.get(openai_file_id)
    
    def get_gemini_file_id(self, openai_file_id: str) -> Optional[str]:
        """获取 Gemini 文件ID"""
        file_info = self.files.get(openai_file_id)
        return file_info.get("gemini_file_id") if file_info else None
    
    def delete_file(self, openai_file_id: str) -> bool:
        """删除文件映射"""
        if openai_file_id in self.files:
            del self.files[openai_file_id]
            return True
        return False
    
    def list_files(self) -> List[Dict]:
        """列出所有文件"""
        return list(self.files.values())
    
    def get_session_for_file(self, openai_file_id: str) -> Optional[str]:
        """获取文件关联的会话名称"""
        file_info = self.files.get(openai_file_id)
        return file_info.get("session_name") if file_info else None


# 全局文件管理器实例
file_manager = FileManager()

