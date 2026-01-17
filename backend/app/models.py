"""数据模型定义"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ChatImage:
    """表示生成的图片/视频"""
    url: Optional[str] = None
    base64_data: Optional[str] = None
    mime_type: str = "image/png"
    local_path: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    media_type: str = "image"  # image 或 video


@dataclass
class ChatResponse:
    """聊天响应，包含文本和图片"""
    text: str = ""
    images: List[ChatImage] = field(default_factory=list)
    thoughts: List[str] = field(default_factory=list)

