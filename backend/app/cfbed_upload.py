"""cfbed 上传模块 - 将生成的图片/视频上传到 cfbed 服务"""

import base64
import requests
from typing import Optional, Dict

from .config import MEDIA_STREAM_CHUNK_SIZE


def upload_to_cfbed(
    file_data: bytes,
    filename: str,
    mime_type: str,
    endpoint: str,
    api_token: str,
    upload_channel: str = "telegram",
    server_compress: bool = True,
    auto_retry: bool = True,
    upload_name_type: str = "default",
    return_format: str = "default",
    upload_folder: Optional[str] = None,
    proxy: Optional[str] = None
) -> Dict[str, str]:
    """上传文件到 cfbed 服务
    
    Args:
        file_data: 文件二进制数据
        filename: 文件名
        mime_type: MIME 类型
        endpoint: cfbed 上传端点（如 https://cfbed.sanyue.de/upload）
        api_token: cfbed API Token
        upload_channel: 上传渠道 (telegram/cfr2/s3)
        server_compress: 服务端压缩（仅针对 Telegram 渠道的图片）
        auto_retry: 失败时自动切换渠道重试
        upload_name_type: 文件命名方式 (default/index/origin/short)
        return_format: 返回链接格式 (default/full)
        upload_folder: 上传目录（相对路径）
        proxy: HTTP 代理（可选）
    
    Returns:
        {"src": "/file/abc123_image.jpg"} - src 字段包含文件路径（不包含域名）
    
    Raises:
        Exception: 上传失败时抛出异常
    """
    # 构建查询参数
    params = {
        "authCode": api_token,
        "uploadChannel": upload_channel,
        "serverCompress": str(server_compress).lower(),
        "autoRetry": str(auto_retry).lower(),
        "uploadNameType": upload_name_type,
        "returnFormat": return_format,
    }
    if upload_folder:
        params["uploadFolder"] = upload_folder
    
    # 构建完整 URL
    url = f"{endpoint}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
    
    # 准备文件上传
    files = {
        "file": (filename, file_data, mime_type)
    }
    
    proxies = {"http": proxy, "https": proxy} if proxy else None
    
    try:
        resp = requests.post(
            url,
            files=files,
            proxies=proxies,
            verify=False,
            timeout=300  # 5分钟超时，适合大文件
        )
        resp.raise_for_status()
        
        data = resp.json()
        
        # cfbed 返回格式: [{ src: "/file/abc123_image.jpg" }]
        if isinstance(data, list) and len(data) > 0 and data[0].get("src"):
            return data[0]
        
        raise ValueError(f"Invalid response format from cfbed: {data}")
    except requests.RequestException as e:
        raise Exception(f"cfbed 上传失败: {e}") from e


def upload_base64_to_cfbed(
    base64_data: str,
    filename: str,
    mime_type: str,
    endpoint: str,
    api_token: str,
    proxy: Optional[str] = None
) -> Dict[str, str]:
    """从 base64 数据上传文件到 cfbed
    
    Args:
        base64_data: Base64 编码的文件数据
        filename: 文件名
        mime_type: MIME 类型
        endpoint: cfbed 上传端点
        api_token: cfbed API Token
        proxy: HTTP 代理（可选）
    
    Returns:
        {"src": "/file/abc123_image.jpg"}
    """
    # 将 base64 转为 bytes
    try:
        file_data = base64.b64decode(base64_data)
    except Exception as e:
        raise ValueError(f"Base64 解码失败: {e}") from e
    
    return upload_to_cfbed(
        file_data=file_data,
        filename=filename,
        mime_type=mime_type,
        endpoint=endpoint,
        api_token=api_token,
        proxy=proxy
    )


def upload_file_streaming_to_cfbed(
    file_stream,
    filename: str,
    mime_type: str,
    endpoint: str,
    api_token: str,
    proxy: Optional[str] = None
) -> Dict[str, str]:
    """流式上传文件到 cfbed（适合大文件）
    
    Args:
        file_stream: requests.Response 对象（支持 iter_content）
        filename: 文件名
        mime_type: MIME 类型
        endpoint: cfbed 上传端点
        api_token: cfbed API Token
        proxy: HTTP 代理（可选）
    
    Returns:
        {"src": "/file/abc123_image.jpg"}
    """
    # 对于流式上传，我们需要先读取到内存
    # 注意：cfbed 的 API 需要完整的文件数据，所以这里还是需要读取完整内容
    # 但我们可以使用 iter_content 来避免一次性加载到内存
    chunks = []
    for chunk in file_stream.iter_content(chunk_size=MEDIA_STREAM_CHUNK_SIZE):
        if chunk:
            chunks.append(chunk)
    
    # 合并所有块
    file_data = b"".join(chunks)
    
    return upload_to_cfbed(
        file_data=file_data,
        filename=filename,
        mime_type=mime_type,
        endpoint=endpoint,
        api_token=api_token,
        proxy=proxy
    )

