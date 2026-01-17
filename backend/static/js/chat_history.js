console.log('JavaScript 开始加载...');
        // ==================== 全局状态 ==================== -->
        let conversations = []; // 所有对话列表
        let currentConversationId = null; // 当前对话ID
        let chatHistory = []; // 当前对话的消息历史
        let isLoading = false;
        let currentAIBubble = null;
        let abortController = null;
        let uploadedFiles = []; // 存储已上传的文件信息 {id, name, gemini_file_id}

        // ==================== 获取模型列表 ====================
        async function loadModelList() {
            try {
                // 检查是否有 API Key
                const headers = getAuthHeaders();
                if (!headers['X-API-Token']) {
                    // 如果没有 API Key，显示提示
                    const select = document.getElementById('modelSelect');
                    select.innerHTML = '<option value="">请先输入 API Key</option>';
                    return;
                }
                
                const response = await fetch('/api/models', {
                    headers: headers
                });
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        throw new Error('API Key 无效，请检查输入');
                    }
                    // 尝试解析错误响应，如果失败则使用默认错误消息
                    let errorMessage = '获取模型列表失败';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error?.message || errorData.message || errorMessage;
                    } catch (e) {
                        // 如果响应不是 JSON，使用状态文本
                        errorMessage = `获取模型列表失败 (${response.status} ${response.statusText})`;
                    }
                    throw new Error(errorMessage);
                }
                let data;
                try {
                    data = await response.json();
                } catch (e) {
                    throw new Error(`响应格式错误: ${e.message}`);
                }
                const models = data.models || [];
                
                const select = document.getElementById('modelSelect');
                select.innerHTML = ''; // 清空现有选项
                
                if (models.length === 0) {
                    // 如果没有模型，使用默认模型
                    select.innerHTML = '<option value="local-gemini-enterprise">Gemini Enterprise (默认)</option>';
                } else {
                    models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id || model.name;
                        option.textContent = model.name || model.id;
                        select.appendChild(option);
                    });
                }
                
                // 从localStorage恢复上次选择的模型
                const savedModel = localStorage.getItem('selectedModel');
                if (savedModel && select.querySelector(`option[value="${savedModel}"]`)) {
                    select.value = savedModel;
                }
                
                // 监听模型选择变化，保存到localStorage
                select.addEventListener('change', () => {
                    localStorage.setItem('selectedModel', select.value);
                });
            } catch (error) {
                console.error('加载模型列表失败:', error);
                // 失败时使用默认模型
                const select = document.getElementById('modelSelect');
                select.innerHTML = '<option value="local-gemini-enterprise">Gemini Enterprise (默认)</option>';
            }
        }

        // ==================== 获取当前选中的模型 ====================
        function getSelectedModel() {
            const select = document.getElementById('modelSelect');
            const selectedValue = select ? select.value : null;
            // 如果没有选中值或加载失败，尝试使用 localStorage 中的值
            if (!selectedValue) {
                const savedModel = localStorage.getItem('selectedModel');
                if (savedModel) {
                    console.log('使用 localStorage 中保存的模型:', savedModel);
                    return savedModel;
                }
            }
            // 如果都没有，返回第一个可用的模型ID（通常是 local-gemini-enterprise）
            return selectedValue || 'local-gemini-enterprise';
        }

        // ==================== 初始化 ====================
        window.onload = () => {
            console.log('页面加载完成，开始初始化...');
            
            // 从 URL 参数获取 API Key
            const urlParams = new URLSearchParams(window.location.search);
            const apiKeyFromUrl = urlParams.get('api_key');
            if (apiKeyFromUrl) {
                localStorage.setItem('api_key', apiKeyFromUrl);
            }
            
            // 检查是否需要显示 API Key 弹窗
            checkApiKey();
            
            loadConversations();
            if (currentConversationId) {
                loadChatHistory();
            } else if (conversations.length === 0) {
                createNewConversation();
            }
            loadModelList(); // 加载模型列表
            if (chatHistory.length === 0) {
                addMessage('ai', '你好！有什么我可以帮你的吗？');
            } else {
                renderChatHistory();
            }
            
            // 初始化文件上传事件监听
            document.getElementById('fileInput').addEventListener('change', handleFileSelect);
            
            // 确保页面加载后滚动到底部
            setTimeout(() => {
                const container = document.getElementById('chatContainer');
                container.scrollTop = container.scrollHeight;
            }, 100);
        };

        // ==================== 主题切换 ====================
        function toggleTheme() {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme);
            document.getElementById('themeIcon').textContent = newTheme === 'dark' ? '🌙' : '☀️';
            localStorage.setItem('theme', newTheme);
        }

        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        document.getElementById('themeIcon').textContent = savedTheme === 'dark' ? '🌙' : '☀️';

        // ==================== 键盘事件处理 ====================
        function handleKeyDown(event) {
            if (event.keyCode === 13 && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }

        // ==================== 发送消息 ====================
        async function sendMessage() {
            console.log('sendMessage 被调用');
            const input = document.getElementById('userInput');
            const text = input.value.trim();
            console.log('输入内容:', text, '加载状态:', isLoading);
            if (!text || isLoading) {
                console.log('条件不满足，返回');
                return;
            }

            // 获取已上传的文件信息
            const attachments = uploadedFiles.map(f => ({
                name: f.name,
                isImage: f.isImage,
                previewUrl: f.previewUrl || null
            }));
            
            // 添加用户消息（包含附件）
            addMessage('user', text, attachments);
            input.value = '';

            // 设置加载状态
            setLoading(true);

            // 获取流式模式设置
            const isStream = document.getElementById('streamMode').checked;

            try {
                if (isStream) {
                    await sendStreamRequest(text);
                } else {
                    await sendNonStreamRequest(text);
                }
            } catch (error) {
                console.error('请求失败:', error);
                if (error.name !== 'AbortError') {
                    addErrorMessage('请求失败: ' + error.message);
                }
            } finally {
                setLoading(false);
                // 发送成功后清空已上传的文件
                clearUploadedFiles();
            }
        }

        // ==================== 获取认证头 ====================
        function getAuthHeaders(includeContentType = true) {
            const headers = {};
            if (includeContentType) {
                headers['Content-Type'] = 'application/json';
            }
            // 优先从 URL 参数获取 API Key
            const urlParams = new URLSearchParams(window.location.search);
            let apiKey = urlParams.get('api_key');
            
            // 如果没有 URL 参数，只从 localStorage 获取 'api_key'（不使用 'admin_token'，避免访客自动使用管理员 token）
            if (!apiKey) {
                apiKey = localStorage.getItem('api_key');
            }
            
            // 如果还没有，尝试从输入框获取（如果存在）
            if (!apiKey) {
                const apiKeyInput = document.getElementById('apiKeyInput');
                if (apiKeyInput && apiKeyInput.value) {
                    apiKey = apiKeyInput.value;
                    // 保存到 localStorage 以便下次使用
                    localStorage.setItem('api_key', apiKey);
                }
            }
            
            if (apiKey) {
                headers['X-API-Token'] = apiKey;
            }
            
            return headers;
        }

        // ==================== 流式请求 ====================
        async function sendStreamRequest(text) {
            // 显示等待动画
            const typingId = showTypingIndicator();
            
            let aiMessageId = null;
            let fullContent = '';

            abortController = new AbortController();
            console.log('开始发送流式请求...');

            // 获取选中的模型ID
            const selectedModel = getSelectedModel();
            console.log('使用模型:', selectedModel);
            
            const response = await fetch('/v1/chat/completions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    model: selectedModel,
                    messages: buildMessages(text),
                    stream: true,
                    conversation_id: currentConversationId || undefined,
                    is_new_conversation: chatHistory.length === 0
                }),
                signal: abortController.signal
            });

            if (!response.ok) {
                // 尝试解析错误响应，如果失败则使用默认错误消息
                let errorMessage = '请求失败';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error?.message || errorData.error || errorData.message || errorMessage;
                } catch (e) {
                    // 如果响应不是 JSON（可能是 HTML 错误页面），使用状态文本
                    if (response.status === 504) {
                        errorMessage = '请求超时（504 Gateway Timeout）。这可能是由于：\n1. 服务器处理时间过长\n2. 网络连接不稳定\n3. 反向代理超时设置过短\n\n请稍后重试，或尝试使用非流式模式。';
                    } else {
                        errorMessage = `请求失败 (${response.status} ${response.statusText})`;
                    }
                }
                throw new Error(errorMessage);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let streamEnded = false;

            try {
                while (!streamEnded) {
                    const { done, value } = await reader.read();
                    if (done) {
                        streamEnded = true;
                        break;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                // 流式结束
                                streamEnded = true;
                                break;
                            }
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    // 收到第一个内容时，移除等待动画并创建AI消息气泡
                                    if (!aiMessageId) {
                                        removeTypingIndicator(typingId);
                                        aiMessageId = createAIBubble();
                                    }
                                    
                                    // 处理不同类型的 content
                                    if (typeof content === 'string') {
                                        // 纯文本内容
                                        fullContent += content;
                                    } else if (typeof content === 'object' && content !== null) {
                                        // 可能是图片/视频对象格式：{type: "image_url", image_url: {url: "..."}}
                                        if (content.type === 'image_url' && content.image_url?.url) {
                                            const imageUrl = content.image_url.url;
                                            // 将图片URL追加到内容中（换行分隔）
                                            if (fullContent && !fullContent.endsWith('\n')) {
                                                fullContent += '\n';
                                            }
                                            fullContent += imageUrl + '\n';
                                        } else {
                                            // 其他对象类型，转换为字符串
                                            console.warn('[流式响应] 收到未知的 content 对象:', content);
                                            fullContent += JSON.stringify(content);
                                        }
                                    }
                                    
                                    updateAIBubble(aiMessageId, fullContent);
                                }
                            } catch (e) {
                                // 忽略解析错误
                            }
                        }
                    }
                    
                    // 如果流已结束，退出外层循环
                    if (streamEnded) {
                        break;
                    }
                }
            } catch (error) {
                // 处理流读取错误
                console.error('流式响应读取错误:', error);
                // 如果 reader 已经关闭，忽略错误
                if (error.message && error.message.includes('already finished')) {
                    console.warn('流式响应已结束，忽略后续读取尝试');
                } else {
                    throw error;
                }
            } finally {
                // 确保释放 reader
                try {
                    reader.releaseLock();
                } catch (e) {
                    // 忽略释放错误
                }
            }

            // 如果没有收到任何内容，移除等待动画
            if (!aiMessageId) {
                removeTypingIndicator(typingId);
            }

            // 保存到历史记录（确保 fullContent 是字符串）
            if (fullContent) {
                // 确保保存的是字符串，而不是对象
                const contentToSave = typeof fullContent === 'string' ? fullContent : String(fullContent);
                chatHistory.push({ role: 'ai', content: contentToSave, time: new Date().toISOString() });
                saveChatHistory();
            }
        }

        // ==================== 非流式请求 ====================
        async function sendNonStreamRequest(text) {
            // 显示加载指示器
            const loadingId = showTypingIndicator();

            abortController = new AbortController();

            // 获取选中的模型ID
            const selectedModel = getSelectedModel();
            console.log('使用模型:', selectedModel);
            
            const response = await fetch('/v1/chat/completions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    model: selectedModel,
                    messages: buildMessages(text),
                    stream: false,
                    conversation_id: currentConversationId || undefined,
                    is_new_conversation: chatHistory.length === 0
                }),
                signal: abortController.signal
            });

            // 移除加载指示器
            removeTypingIndicator(loadingId);

            if (!response.ok) {
                // 检查响应类型
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || '请求失败');
                } else {
                    // 如果不是 JSON，可能是 HTML 错误页面
                    const errorText = await response.text();
                    throw new Error(`请求失败 (${response.status}): ${errorText.substring(0, 100)}`);
                }
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                throw new Error(`响应格式错误: ${e.message}`);
            }
            const content = data.choices?.[0]?.message?.content;

            if (content) {
                // 处理 content 可能是字符串或数组的情况
                let displayContent = '';
                if (typeof content === 'string') {
                    displayContent = content;
                } else if (Array.isArray(content)) {
                    // OpenAI 格式数组：[{type: "text", text: "..."}, {type: "image_url", image_url: {url: "..."}}]
                    const parts = [];
                    for (const item of content) {
                        if (item.type === 'text' && item.text) {
                            parts.push(item.text);
                        } else if (item.type === 'image_url' && item.image_url?.url) {
                            parts.push(item.image_url.url);
                        }
                    }
                    displayContent = parts.join('\n');
                }
                
                if (displayContent) {
                    addMessage('ai', displayContent);
                } else {
                    addErrorMessage('未收到有效响应');
                }
            } else {
                addErrorMessage('未收到有效响应');
            }
        }

        // ==================== 构建消息列表 ====================
        function buildMessages(currentText) {
            const messages = [];
            
            // 添加历史消息（最近10条）
            const recentHistory = chatHistory.slice(-10);
            for (const msg of recentHistory) {
                messages.push({
                    role: msg.role === 'ai' ? 'assistant' : 'user',
                    content: msg.content
                });
            }

            // 构建当前用户消息（支持文件）
            const fileIds = getUploadedFileIds();
            if (fileIds.length > 0) {
                // 使用OpenAI格式的content数组
                const contentParts = [];
                
                // 添加文件引用
                for (const fileId of fileIds) {
                    contentParts.push({
                        type: 'file',
                        file: { id: fileId }
                    });
                }
                
                // 添加文本内容
                contentParts.push({
                    type: 'text',
                    text: currentText
                });
                
                messages.push({
                    role: 'user',
                    content: contentParts
                });
            } else {
                messages.push({
                    role: 'user',
                    content: currentText
                });
            }

            return messages;
        }

        // ==================== UI 操作函数 ====================
        function addMessage(role, content, attachments = []) {
            const container = document.getElementById('chatContainer');
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const rowDiv = document.createElement('div');
            rowDiv.className = `message-row ${role}`;
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = `avatar ${role}`;
            avatarDiv.innerHTML = role === 'ai' ? '🤖' : '👤';
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content';
            
            // 如果有附件，先显示附件
            if (attachments && attachments.length > 0) {
                const attachmentsContainer = document.createElement('div');
                attachmentsContainer.className = 'message-attachments';
                attachmentsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;';
                
                for (const attachment of attachments) {
                    if (attachment.isImage && attachment.previewUrl) {
                        // 图片附件
                        const img = document.createElement('img');
                        img.src = attachment.previewUrl;
                        img.style.cssText = 'max-width: 200px; max-height: 200px; border-radius: 8px; cursor: pointer; object-fit: cover;';
                        img.title = attachment.name;
                        img.onclick = function() {
                            window.open(attachment.previewUrl, '_blank');
                        };
                        attachmentsContainer.appendChild(img);
                    } else {
                        // 非图片文件附件
                        const fileTag = document.createElement('div');
                        fileTag.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--primary-light); border-radius: 6px; font-size: 13px; color: var(--text-main);';
                        fileTag.innerHTML = `<span>📄</span><span>${attachment.name}</span>`;
                        attachmentsContainer.appendChild(fileTag);
                    }
                }
                contentWrapper.appendChild(attachmentsContainer);
            }
            
            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = 'bubble';
            bubbleDiv.textContent = content;
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'timestamp';
            timeDiv.innerText = time;
            
            contentWrapper.appendChild(bubbleDiv);
            contentWrapper.appendChild(timeDiv);
            
            rowDiv.appendChild(avatarDiv);
            rowDiv.appendChild(contentWrapper);
            
            container.appendChild(rowDiv);
            container.scrollTop = container.scrollHeight;

            // 保存到历史记录（包含附件）
            chatHistory.push({ role, content, attachments: attachments || [], time: new Date().toISOString() });
            saveChatHistory();
        }

        function createAIBubble() {
            const container = document.getElementById('chatContainer');
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const messageId = 'ai-msg-' + Date.now();
            
            const rowDiv = document.createElement('div');
            rowDiv.className = 'message-row ai';
            rowDiv.id = messageId;
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar ai';
            avatarDiv.innerHTML = '🤖';
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content';
            
            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = 'bubble';
            bubbleDiv.id = messageId + '-bubble';
            bubbleDiv.textContent = '';
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'timestamp';
            timeDiv.innerText = time;
            
            contentWrapper.appendChild(bubbleDiv);
            contentWrapper.appendChild(timeDiv);
            
            rowDiv.appendChild(avatarDiv);
            rowDiv.appendChild(contentWrapper);
            
            container.appendChild(rowDiv);
            container.scrollTop = container.scrollHeight;

            return messageId;
        }

        function updateAIBubble(messageId, content) {
            const bubble = document.getElementById(messageId + '-bubble');
            if (bubble) {
                // 确保 content 是字符串
                let contentStr = content;
                if (typeof content !== 'string') {
                    // 如果是对象，尝试转换为字符串
                    if (typeof content === 'object' && content !== null) {
                        if (content.type === 'image_url' && content.image_url?.url) {
                            contentStr = content.image_url.url;
                        } else {
                            contentStr = JSON.stringify(content);
                        }
                    } else {
                        contentStr = String(content);
                    }
                }
                
                // 解析内容，将多媒体 URL 转换为元素
                bubble.innerHTML = parseContentWithMedia(contentStr);
                const container = document.getElementById('chatContainer');
                container.scrollTop = container.scrollHeight;
            }
        }

        // 解析内容中的媒体 URL 并转换为 HTML
        function parseContentWithMedia(content) {
            // 确保 content 是字符串
            if (typeof content !== 'string') {
                if (typeof content === 'object' && content !== null) {
                    // 如果是对象数组（OpenAI 格式）
                    if (Array.isArray(content)) {
                        const parts = [];
                        for (const item of content) {
                            if (item.type === 'text' && item.text) {
                                parts.push(escapeHtml(item.text));
                            } else if (item.type === 'image_url' && item.image_url?.url) {
                                const url = item.image_url.url;
                                parts.push(`<div class="ai-image-container"><img src="${escapeHtml(url)}" alt="AI生成的图片" style="max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer; margin: 8px 0;" onclick="window.open('${escapeHtml(url)}', '_blank')" onerror="this.style.display='none'; this.nextSibling.style.display='inline';"><span style="display:none;">${escapeHtml(url)}</span></div>`);
                            }
                        }
                        return parts.join('<br>');
                    }
                    // 单个对象
                    if (content.type === 'image_url' && content.image_url?.url) {
                        const url = content.image_url.url;
                        return `<div class="ai-image-container"><img src="${escapeHtml(url)}" alt="AI生成的图片" style="max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer; margin: 8px 0;" onclick="window.open('${escapeHtml(url)}', '_blank')" onerror="this.style.display='none'; this.nextSibling.style.display='inline';"><span style="display:none;">${escapeHtml(url)}</span></div>`;
                    }
                    return escapeHtml(JSON.stringify(content));
                }
                content = String(content);
            }
            
            const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))/gi;
            const videoUrlRegex = /(https?:\/\/[^\s]+\.(?:mp4|mov|webm|mkv|avi))/gi;
            
            // 将内容按行分割处理
            const lines = content.split('\n');
            const processedLines = lines.map(line => {
                // 检查该行是否是纯图片URL
                const trimmedLine = line.trim();
                if (imageUrlRegex.test(trimmedLine) && trimmedLine.match(imageUrlRegex)?.[0] === trimmedLine) {
                    // 重置正则表达式的lastIndex
                    imageUrlRegex.lastIndex = 0;
                    // 该行是纯图片URL，转换为图片元素
                    return `<div class="ai-image-container"><img src="${escapeHtml(trimmedLine)}" alt="AI生成的图片" style="max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer; margin: 8px 0;" onclick="window.open('${escapeHtml(trimmedLine)}', '_blank')" onerror="this.style.display='none'; this.nextSibling.style.display='inline';"><span style="display:none;">${escapeHtml(trimmedLine)}</span></div>`;
                }
                videoUrlRegex.lastIndex = 0;
                if (videoUrlRegex.test(trimmedLine) && trimmedLine.match(videoUrlRegex)?.[0] === trimmedLine) {
                    videoUrlRegex.lastIndex = 0;
                    return `<div class="ai-video-container"><video controls preload="metadata" style="max-width: 360px; border-radius: 12px;"><source src="${escapeHtml(trimmedLine)}" type="video/mp4">您的浏览器不支持视频播放。<a href="${escapeHtml(trimmedLine)}" target="_blank" rel="noopener">点击下载</a></video></div>`;
                }
                // 重置正则表达式的lastIndex
                imageUrlRegex.lastIndex = 0;
                // 普通文本行，转义HTML
                return escapeHtml(line);
            });
            
            return processedLines.join('<br>');
        }

        // HTML转义函数
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showTypingIndicator() {
            const container = document.getElementById('chatContainer');
            const indicatorId = 'typing-' + Date.now();
            
            const rowDiv = document.createElement('div');
            rowDiv.className = 'message-row ai';
            rowDiv.id = indicatorId;
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar ai';
            avatarDiv.innerHTML = '🤖';
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content';
            
            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.innerHTML = '<span></span><span></span><span></span>';
            
            contentWrapper.appendChild(indicator);
            rowDiv.appendChild(avatarDiv);
            rowDiv.appendChild(contentWrapper);
            
            container.appendChild(rowDiv);
            container.scrollTop = container.scrollHeight;

            return indicatorId;
        }

        function removeTypingIndicator(indicatorId) {
            const indicator = document.getElementById(indicatorId);
            if (indicator) {
                indicator.remove();
            }
        }

        function addErrorMessage(message) {
            const container = document.getElementById('chatContainer');
            
            const rowDiv = document.createElement('div');
            rowDiv.className = 'message-row ai';
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar ai';
            avatarDiv.innerHTML = '⚠️';
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content';
            
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = message;
            
            contentWrapper.appendChild(errorDiv);
            rowDiv.appendChild(avatarDiv);
            rowDiv.appendChild(contentWrapper);
            
            container.appendChild(rowDiv);
            container.scrollTop = container.scrollHeight;
        }

        function setLoading(loading) {
            isLoading = loading;
            const input = document.getElementById('userInput');
            const sendBtn = document.getElementById('sendBtn');
            
            input.disabled = loading;
            sendBtn.disabled = loading;
            sendBtn.innerHTML = loading ? '⏳' : '➤';
        }

        // ==================== 对话管理 ====================
        function generateConversationId() {
            return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        function saveConversations() {
            try {
                localStorage.setItem('Business Gemini_conversations', JSON.stringify(conversations));
                if (currentConversationId) {
                    localStorage.setItem('Business Gemini_current_conversation_id', currentConversationId);
                }
            } catch (e) {
                console.error('保存对话列表失败:', e);
            }
        }

        function loadConversations() {
            try {
                const saved = localStorage.getItem('Business Gemini_conversations');
                if (saved) {
                    conversations = JSON.parse(saved);
                } else {
                    // 兼容旧版本：尝试加载单个对话历史
                    const oldHistory = localStorage.getItem('Business Gemini_chat_history');
                    if (oldHistory) {
                        try {
                            const oldMessages = JSON.parse(oldHistory);
                            if (oldMessages && oldMessages.length > 0) {
                                const convId = generateConversationId();
                                conversations = [{
                                    id: convId,
                                    title: '对话 1',
                                    messages: oldMessages,
                                    createdAt: new Date().toISOString(),
                                    updatedAt: new Date().toISOString()
                                }];
                                currentConversationId = convId;
                                saveConversations();
                                // 删除旧数据
                                localStorage.removeItem('Business Gemini_chat_history');
                            }
                        } catch (e) {
                            console.error('迁移旧对话历史失败:', e);
                        }
                    }
                }

                // 加载当前对话ID
                const savedId = localStorage.getItem('Business Gemini_current_conversation_id');
                if (savedId && conversations.find(c => c.id === savedId)) {
                    currentConversationId = savedId;
                } else if (conversations.length > 0) {
                    currentConversationId = conversations[0].id;
                }

                renderConversationsList();
            } catch (e) {
                console.error('加载对话列表失败:', e);
                conversations = [];
            }
        }

        function createNewConversation() {
            const convId = generateConversationId();
            const newConv = {
                id: convId,
                title: '新对话',
                messages: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            conversations.unshift(newConv);
            currentConversationId = convId;
            chatHistory = [];
            saveConversations();
            renderConversationsList();
            renderChatHistory();
            document.getElementById('chatContainer').innerHTML = '';
        }

        function switchConversation(convId) {
            if (currentConversationId === convId) return;
            
            // 保存当前对话
            if (currentConversationId) {
                const currentConv = conversations.find(c => c.id === currentConversationId);
                if (currentConv) {
                    currentConv.messages = [...chatHistory];
                    currentConv.updatedAt = new Date().toISOString();
                }
            }

            // 切换到新对话
            currentConversationId = convId;
            const conv = conversations.find(c => c.id === convId);
            if (conv) {
                chatHistory = [...conv.messages];
                // 清理历史记录中的对象格式内容，转换为字符串
                chatHistory = chatHistory.map(msg => {
                    if (msg.role === 'ai' && typeof msg.content !== 'string') {
                        if (Array.isArray(msg.content)) {
                            const parts = [];
                            for (const item of msg.content) {
                                if (item.type === 'text' && item.text) {
                                    parts.push(item.text);
                                } else if (item.type === 'image_url' && item.image_url?.url) {
                                    parts.push(item.image_url.url);
                                }
                            }
                            msg.content = parts.join('\n');
                        } else if (typeof msg.content === 'object' && msg.content !== null) {
                            if (msg.content.type === 'image_url' && msg.content.image_url?.url) {
                                msg.content = msg.content.image_url.url;
                            } else {
                                msg.content = JSON.stringify(msg.content);
                            }
                        } else {
                            msg.content = String(msg.content);
                        }
                    }
                    return msg;
                });
            } else {
                chatHistory = [];
            }

            saveConversations();
            renderConversationsList();
            renderChatHistory();
        }

        function deleteConversation(convId, event) {
            event.stopPropagation();
            if (!confirm('确定要删除这个对话吗？')) return;

            const index = conversations.findIndex(c => c.id === convId);
            if (index === -1) return;

            conversations.splice(index, 1);

            if (currentConversationId === convId) {
                if (conversations.length > 0) {
                    currentConversationId = conversations[0].id;
                    switchConversation(currentConversationId);
                } else {
                    currentConversationId = null;
                    chatHistory = [];
                    document.getElementById('chatContainer').innerHTML = '';
                }
            }

            saveConversations();
            renderConversationsList();
        }

        function renameConversation(convId, event) {
            event.stopPropagation();
            const conv = conversations.find(c => c.id === convId);
            if (!conv) return;

            const newTitle = prompt('请输入新标题:', conv.title);
            if (newTitle && newTitle.trim()) {
                conv.title = newTitle.trim();
                conv.updatedAt = new Date().toISOString();
                saveConversations();
                renderConversationsList();
            }
        }

        function renderConversationsList() {
            const list = document.getElementById('conversationsList');
            if (!list) return;

            list.innerHTML = '';

            if (conversations.length === 0) {
                list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 14px;">暂无对话<br>点击"新建"开始对话</div>';
                return;
            }

            // 按更新时间排序（最新的在前）
            const sorted = [...conversations].sort((a, b) => 
                new Date(b.updatedAt) - new Date(a.updatedAt)
            );

            sorted.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'conversation-item' + (conv.id === currentConversationId ? ' active' : '');
                item.onclick = () => switchConversation(conv.id);

                const time = new Date(conv.updatedAt);
                const timeStr = time.toLocaleDateString('zh-CN', { 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                item.innerHTML = `
                    <div class="conversation-item-content">
                        <div class="conversation-item-title">${conv.title}</div>
                        <div class="conversation-item-time">${timeStr}</div>
                    </div>
                    <div class="conversation-item-actions">
                        <button class="conversation-action-btn" onclick="renameConversation('${conv.id}', event)" title="重命名">✏️</button>
                        <button class="conversation-action-btn delete" onclick="deleteConversation('${conv.id}', event)" title="删除">🗑️</button>
                    </div>
                `;

                list.appendChild(item);
            });
        }

        function updateConversationTitle() {
            if (!currentConversationId) return;
            const conv = conversations.find(c => c.id === currentConversationId);
            if (!conv) return;

            // 使用第一条用户消息作为标题（如果还没有自定义标题）
            if (conv.title === '新对话' || conv.title === '对话 1') {
                const firstUserMsg = chatHistory.find(msg => msg.role === 'user');
                if (firstUserMsg) {
                    const content = typeof firstUserMsg.content === 'string' 
                        ? firstUserMsg.content 
                        : JSON.stringify(firstUserMsg.content);
                    conv.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
                    saveConversations();
                    renderConversationsList();
                }
            }
        }

        // ==================== 对话历史管理 ====================
        function saveChatHistory() {
            if (!currentConversationId) return;
            const conv = conversations.find(c => c.id === currentConversationId);
            if (conv) {
                conv.messages = [...chatHistory];
                conv.updatedAt = new Date().toISOString();
                saveConversations();
                updateConversationTitle();
            }
        }

        function loadChatHistory() {
            if (currentConversationId) {
                const conv = conversations.find(c => c.id === currentConversationId);
                if (conv) {
                    chatHistory = [...conv.messages];
                    // 清理历史记录中的对象格式内容，转换为字符串
                    chatHistory = chatHistory.map(msg => {
                        if (msg.role === 'ai' && typeof msg.content !== 'string') {
                            if (Array.isArray(msg.content)) {
                                const parts = [];
                                for (const item of msg.content) {
                                    if (item.type === 'text' && item.text) {
                                        parts.push(item.text);
                                    } else if (item.type === 'image_url' && item.image_url?.url) {
                                        parts.push(item.image_url.url);
                                    }
                                }
                                msg.content = parts.join('\n');
                            } else if (typeof msg.content === 'object' && msg.content !== null) {
                                if (msg.content.type === 'image_url' && msg.content.image_url?.url) {
                                    msg.content = msg.content.image_url.url;
                                } else {
                                    msg.content = JSON.stringify(msg.content);
                                }
                            } else {
                                msg.content = String(msg.content);
                            }
                        }
                        return msg;
                    });
                    saveChatHistory();
                } else {
                    chatHistory = [];
                }
            } else {
                chatHistory = [];
            }
        }

        function renderChatHistory() {
            const container = document.getElementById('chatContainer');
            container.innerHTML = '';
            
            for (const msg of chatHistory) {
                const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                
                const rowDiv = document.createElement('div');
                rowDiv.className = `message-row ${msg.role}`;
                
                const avatarDiv = document.createElement('div');
                avatarDiv.className = `avatar ${msg.role}`;
                avatarDiv.innerHTML = msg.role === 'ai' ? '🤖' : '👤';
                
                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'message-content';
                
                // 如果有附件，先显示附件（兼容旧的images字段）
                const attachments = msg.attachments || (msg.images ? msg.images.map(url => ({ isImage: true, previewUrl: url, name: '图片' })) : []);
                if (attachments && attachments.length > 0) {
                    const attachmentsContainer = document.createElement('div');
                    attachmentsContainer.className = 'message-attachments';
                    attachmentsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;';
                    
                    for (const attachment of attachments) {
                        if (attachment.isImage && attachment.previewUrl) {
                            // 图片附件
                            const img = document.createElement('img');
                            img.src = attachment.previewUrl;
                            img.style.cssText = 'max-width: 200px; max-height: 200px; border-radius: 8px; cursor: pointer; object-fit: cover;';
                            img.title = attachment.name || '图片';
                            img.onclick = function() {
                                window.open(attachment.previewUrl, '_blank');
                            };
                            attachmentsContainer.appendChild(img);
                        } else {
                            // 非图片文件附件
                            const fileTag = document.createElement('div');
                            fileTag.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--primary-light); border-radius: 6px; font-size: 13px; color: var(--text-main);';
                            fileTag.innerHTML = `<span>📄</span><span>${attachment.name || '文件'}</span>`;
                            attachmentsContainer.appendChild(fileTag);
                        }
                    }
                    contentWrapper.appendChild(attachmentsContainer);
                }
                
                const bubbleDiv = document.createElement('div');
                bubbleDiv.className = 'bubble';
                // AI消息需要解析图片URL
                if (msg.role === 'ai') {
                    // 确保 content 是字符串，如果是对象则转换
                    let contentToRender = msg.content;
                    if (typeof contentToRender !== 'string') {
                        if (typeof contentToRender === 'object' && contentToRender !== null) {
                            // 如果是对象数组（OpenAI 格式）
                            if (Array.isArray(contentToRender)) {
                                const parts = [];
                                for (const item of contentToRender) {
                                    if (item.type === 'text' && item.text) {
                                        parts.push(item.text);
                                    } else if (item.type === 'image_url' && item.image_url?.url) {
                                        parts.push(item.image_url.url);
                                    }
                                }
                                contentToRender = parts.join('\n');
                            } else if (contentToRender.type === 'image_url' && contentToRender.image_url?.url) {
                                // 单个图片对象
                                contentToRender = contentToRender.image_url.url;
                            } else {
                                // 其他对象，转换为字符串
                                contentToRender = JSON.stringify(contentToRender);
                            }
                        } else {
                            contentToRender = String(contentToRender);
                        }
                    }
                    bubbleDiv.innerHTML = parseContentWithMedia(contentToRender);
                } else {
                    bubbleDiv.textContent = typeof msg.content === 'string' ? msg.content : String(msg.content);
                }
                
                const timeDiv = document.createElement('div');
                timeDiv.className = 'timestamp';
                timeDiv.innerText = time;
                
                contentWrapper.appendChild(bubbleDiv);
                contentWrapper.appendChild(timeDiv);
                
                rowDiv.appendChild(avatarDiv);
                rowDiv.appendChild(contentWrapper);
                
                container.appendChild(rowDiv);
            }
            
            container.scrollTop = container.scrollHeight;
        }

        function clearChat() {
            if (confirm('确定要清空当前对话的所有记录吗？')) {
                chatHistory = [];
                if (currentConversationId) {
                    const conv = conversations.find(c => c.id === currentConversationId);
                    if (conv) {
                        conv.messages = [];
                        conv.updatedAt = new Date().toISOString();
                        saveConversations();
                    }
                }
                document.getElementById('chatContainer').innerHTML = '';
                addMessage('ai', '对话已清空。有什么我可以帮你的吗？');
            }
        }

        // ==================== 文件上传功能 ====================
        function handleFileSelect(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            
            for (const file of files) {
                uploadFile(file);
            }
            
            // 清空input以便可以重复选择同一文件
            event.target.value = '';
        }

        async function uploadFile(file) {
            const uploadBtn = document.getElementById('uploadBtn');
            const filesContainer = document.getElementById('uploadedFilesContainer');
            const filesList = document.getElementById('uploadedFiles');
            
            // 显示文件容器
            filesContainer.style.display = 'block';
            
            // 创建文件标签（上传中状态）
            const fileTag = document.createElement('div');
            fileTag.className = 'file-tag file-uploading';
            fileTag.id = 'file-' + Date.now();
            fileTag.innerHTML = `
                <span class="file-icon">📄</span>
                <span class="file-name">${file.name}</span>
            `;
            filesList.appendChild(fileTag);
            
            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('purpose', 'assistants');
                
                const response = await fetch('/v1/files', {
                    method: 'POST',
                    headers: getAuthHeaders(false), // 文件上传不需要 Content-Type，浏览器会自动设置
                    body: formData
                });
                
                if (!response.ok) {
                    // 尝试解析错误响应，如果失败则使用默认错误消息
                    let errorMessage = '上传失败';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error?.message || errorData.message || errorMessage;
                    } catch (e) {
                        // 如果响应不是 JSON（可能是 HTML 错误页面），使用状态文本
                        errorMessage = `上传失败 (${response.status} ${response.statusText})`;
                    }
                    throw new Error(errorMessage);
                }
                
                let data;
                try {
                    data = await response.json();
                } catch (e) {
                    throw new Error(`响应格式错误: ${e.message}`);
                }
                
                // 更新文件标签为成功状态
                fileTag.className = 'file-tag';
                fileTag.innerHTML = `
                    <span class="file-icon">📄</span>
                    <span class="file-name">${file.name}</span>
                    <button class="remove-file" onclick="removeFile('${fileTag.id}', '${data.id}')">×</button>
                `;
                
                // 保存文件信息（包含图片预览）
                const fileInfo = {
                    tagId: fileTag.id,
                    id: data.id,
                    name: file.name,
                    gemini_file_id: data.gemini_file_id,
                    isImage: file.type.startsWith('image/'),
                    previewUrl: null
                };
                
                // 如果是图片，生成预览URL（使用Promise确保同步完成）
                if (fileInfo.isImage) {
                    await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            fileInfo.previewUrl = e.target.result;
                            resolve();
                        };
                        reader.readAsDataURL(file);
                    });
                }
                
                uploadedFiles.push(fileInfo);
                
                // 更新上传按钮状态
                updateUploadBtnState();
                
            } catch (error) {
                console.error('文件上传失败:', error);
                fileTag.remove();
                alert('文件上传失败: ' + error.message);
                
                // 如果没有文件了，隐藏容器
                if (uploadedFiles.length === 0) {
                    filesContainer.style.display = 'none';
                }
            }
        }

        function removeFile(tagId, fileId) {
            // 从DOM中移除
            const fileTag = document.getElementById(tagId);
            if (fileTag) {
                fileTag.remove();
            }
            
            // 从数组中移除
            uploadedFiles = uploadedFiles.filter(f => f.tagId !== tagId);
            
            // 更新UI状态
            updateUploadBtnState();
            
            // 如果没有文件了，隐藏容器
            if (uploadedFiles.length === 0) {
                document.getElementById('uploadedFilesContainer').style.display = 'none';
            }
            
            // 可选：调用删除API
            fetch(`/v1/files/${fileId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            }).catch(console.error);
        }

        function getUploadedFileIds() {
            return uploadedFiles.map(f => f.id);
        }

        function clearUploadedFiles() {
            uploadedFiles = [];
            document.getElementById('uploadedFiles').innerHTML = '';
            document.getElementById('uploadedFilesContainer').style.display = 'none';
            updateUploadBtnState();
        }

        function updateUploadBtnState() {
            const uploadBtn = document.getElementById('uploadBtn');
            if (uploadedFiles.length > 0) {
                uploadBtn.classList.add('has-files');
                uploadBtn.title = `已上传 ${uploadedFiles.length} 个文件`;
            } else {
                uploadBtn.classList.remove('has-files');
                uploadBtn.title = '上传文件';
            }
        }
        // ==================== API Key 弹窗 ====================
        function showApiKeyModal() {
            const modal = document.getElementById('apiKeyModal');
            const apiKeyInput = document.getElementById('apiKeyInput');
            if (modal && apiKeyInput) {
                // 从 localStorage 加载已保存的 API Key（不使用 admin_token，避免访客自动使用管理员 token）
                const savedApiKey = localStorage.getItem('api_key');
                if (savedApiKey) {
                    apiKeyInput.value = savedApiKey;
                } else {
                    // 如果没有保存的 API Key，清空输入框
                    apiKeyInput.value = '';
                }
                modal.style.display = 'flex';
            }
        }

        function closeApiKeyModal() {
            const modal = document.getElementById('apiKeyModal');
            if (modal) {
                modal.style.display = 'none';
            }
        }

        async function saveApiKey() {
            const apiKeyInput = document.getElementById('apiKeyInput');
            if (!apiKeyInput) return;
            
            const apiKey = apiKeyInput.value.trim();
            if (!apiKey) {
                alert('请输入 API Key');
                return;
            }
            
            // 验证 API Key 是否有效
            const saveBtn = document.getElementById('saveApiKeyBtn');
            const originalText = saveBtn?.textContent || '保存';
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = '验证中...';
            }
            
            try {
                // 临时设置 API Key 进行验证
                const testHeaders = {
                    'Content-Type': 'application/json',
                    'X-API-Token': apiKey
                };
                
                const response = await fetch('/v1/models', {
                    headers: testHeaders
                });
                
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        throw new Error('API Key 无效，请检查输入');
                    }
                    throw new Error('验证失败，请稍后重试');
                }
                
                // 验证成功，保存 API Key
                localStorage.setItem('api_key', apiKey);
                closeApiKeyModal();
                loadModelList(); // 重新加载模型列表
                alert('API Key 验证成功，已保存');
            } catch (error) {
                alert('验证失败: ' + error.message);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalText;
                }
            }
        }

        // 检查是否需要显示 API Key 弹窗
        function checkApiKey() {
            const urlParams = new URLSearchParams(window.location.search);
            const apiKeyFromUrl = urlParams.get('api_key');
            
            if (apiKeyFromUrl) {
                localStorage.setItem('api_key', apiKeyFromUrl);
                return; // 从 URL 参数获取，不需要显示弹窗
            }
            
            // 只检查 'api_key'，不使用 'admin_token'（避免访客自动使用管理员 token）
            const savedApiKey = localStorage.getItem('api_key');
            if (!savedApiKey) {
                // 没有 API Key，显示弹窗
                setTimeout(() => showApiKeyModal(), 500);
            }
        }
    


        // 点击弹窗外部关闭
        document.getElementById('apiKeyModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'apiKeyModal') {
                closeApiKeyModal();
            }
        });
        
        // 按 ESC 键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeApiKeyModal();
            }
        });
    