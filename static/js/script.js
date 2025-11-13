// 使用相对路径，避免端口不一致问题
const API_BASE = '/api';
let conversationHistory = [];
let remainingCount = 10;
let isArchiving = false;

// DOM元素
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const archiveButton = document.getElementById('archiveButton');
const remainingCountSpan = document.getElementById('remainingCount');
const vectorCountSpan = document.getElementById('vectorCount');
const bookPage = document.getElementById('bookPage');
const bookPageText = document.getElementById('bookPageText');
const bookPageNumber = document.getElementById('bookPageNumber');
const container = document.querySelector('.container');

// 加载向量总数
async function loadVectorCount() {
    try {
        const response = await fetch(`${API_BASE}/vector_count`);
        const data = await response.json();
        if (data.success) {
            vectorCountSpan.textContent = data.count;
        }
    } catch (error) {
        console.error('加载向量总数失败:', error);
    }
}

// 格式化时间（仅时分）
function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// 格式化完整时间（时分秒）
function formatFullTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// 更新实时时钟
function updateRealTimeClock() {
    const clockElement = document.getElementById('clockTime');
    if (clockElement) {
        clockElement.textContent = formatFullTime(new Date());
    }
}

// 初始化欢迎消息时间戳
function initWelcomeMessageTime() {
    const welcomeTimeElement = document.getElementById('welcomeTime');
    if (welcomeTimeElement) {
        welcomeTimeElement.textContent = formatTime(new Date());
    }
}

// 添加消息到界面
function addMessage(role, content, timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // 添加时间戳
    if (timestamp) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = formatTime(timestamp);
        messageDiv.appendChild(timeDiv);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(contentDiv);
    chatContainer.appendChild(messageDiv);
    
    // 滚动到底部
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// 发送消息 - 支持流式输出
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || remainingCount <= 0 || isArchiving) return;

    // 记录用户消息发送时间
    const userTimestamp = new Date();
    // 添加用户消息到界面（立即显示时间戳）
    addMessage('user', message, userTimestamp);
    conversationHistory.push({ role: 'user', content: message });
    
    // 清空输入框
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    sendButton.innerHTML = '发送中<span class="loading"></span>';

    // 创建助手消息容器（用于流式更新）
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'message assistant';
    
    // 不立即添加时间戳，等回复完成后再添加
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    assistantMessageDiv.appendChild(contentDiv);
    
    // 创建思考中提示元素
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-indicator';
    thinkingDiv.textContent = '思考中...';
    thinkingDiv.style.display = 'none';
    assistantMessageDiv.appendChild(thinkingDiv);
    
    // 立即添加到界面（不显示时间戳）
    chatContainer.appendChild(assistantMessageDiv);
    
    let assistantResponse = '';
    let hasError = false;
    let firstContentReceived = false;
    let isThinking = false;

    try {
        // 调用后端API（流式响应）
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                history: conversationHistory
            })
        });

        // 检查响应状态
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP错误: ${response.status}`);
        }

        // 读取流式数据
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // 解码数据
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'thinking') {
                            // 处理思考状态
                            if (data.status === 'start') {
                                isThinking = true;
                                thinkingDiv.style.display = 'block';
                                contentDiv.style.display = 'none';
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            } else if (data.status === 'end') {
                                isThinking = false;
                                thinkingDiv.style.display = 'none';
                                contentDiv.style.display = 'block';
                            }
                        } else if (data.type === 'content') {
                            // 如果正在思考，先隐藏思考提示
                            if (isThinking) {
                                isThinking = false;
                                thinkingDiv.style.display = 'none';
                                contentDiv.style.display = 'block';
                            }
                            // 标记已收到内容
                            if (!firstContentReceived) {
                                firstContentReceived = true;
                            }
                            // 追加内容
                            assistantResponse += data.content;
                            contentDiv.textContent = assistantResponse;
                            // 滚动到底部
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        } else if (data.type === 'error') {
                            // 处理错误
                            hasError = true;
                            if (!firstContentReceived) {
                                firstContentReceived = true;
                            }
                            contentDiv.textContent = data.error || '抱歉，发生了错误。';
                            console.error('服务器错误:', data.error);
                        } else if (data.type === 'done') {
                            // 流式输出完成，添加时间戳
                            const assistantTimestamp = new Date();
                            const timeDiv = document.createElement('div');
                            timeDiv.className = 'message-time';
                            timeDiv.textContent = formatTime(assistantTimestamp);
                            // 将时间戳插入到内容之前
                            assistantMessageDiv.insertBefore(timeDiv, contentDiv);
                        }
                    } catch (e) {
                        console.error('解析SSE数据失败:', e, line);
                    }
                }
            }
        }
        
        // 如果成功接收到回复
        if (!hasError && assistantResponse) {
            conversationHistory.push({ role: 'assistant', content: assistantResponse });
            
            // 减少剩余次数
            remainingCount--;
            remainingCountSpan.textContent = remainingCount;
            
            // 如果有对话历史，启用归档按钮（用户可以主动结束对话）
            if (conversationHistory.length >= 2) {
                archiveButton.disabled = false;
            }
            
            // 如果次数用完，禁用输入
            if (remainingCount <= 0) {
                messageInput.disabled = true;
                sendButton.disabled = true;
                addMessage('assistant', '对话次数已用完，您可以点击归档按钮结束并保存本次对话。', new Date());
            }
        } else if (!hasError && !assistantResponse) {
            // 没有收到任何内容
            if (!firstContentReceived) {
                firstContentReceived = true;
            }
            contentDiv.textContent = '抱歉，没有收到回复。';
            hasError = true;
        }
        
    } catch (error) {
        console.error('发送消息失败:', error);
        hasError = true;
        if (!firstContentReceived) {
            firstContentReceived = true;
        }
        contentDiv.textContent = `抱歉，网络错误：${error.message || '请稍后重试。'}`;
    } finally {
        messageInput.disabled = false;
        sendButton.disabled = false;
        sendButton.textContent = '发送';
        messageInput.focus();
    }
}

// 显示书页（从左边滑入）
function showBookPage() {
    bookPageText.textContent = '';
    bookPageNumber.textContent = '';
    bookPageNumber.classList.remove('visible');
    bookPage.classList.remove('slide-out');
    // 使用setTimeout确保动画生效
    setTimeout(() => {
        bookPage.classList.add('active');
    }, 10);
}

// 隐藏书页（向右滑出）
function hideBookPage() {
    bookPage.classList.remove('active');
    bookPage.classList.add('slide-out');
    // 动画完成后移除元素类
    setTimeout(() => {
        bookPage.classList.remove('slide-out');
    }, 600);
}

// 归档对话 - 结束当前对话并保存，显示书页
async function archiveConversation() {
    // 检查是否有对话历史（至少需要一条用户消息和一条助手回复）
    const hasUserMessage = conversationHistory.some(msg => msg.role === 'user');
    const hasAssistantMessage = conversationHistory.some(msg => msg.role === 'assistant');
    
    if ((!hasUserMessage || !hasAssistantMessage) || isArchiving) {
        if (!hasUserMessage || !hasAssistantMessage) {
            addMessage('assistant', '请先进行至少一轮对话后再归档。', new Date());
        }
        return;
    }

    isArchiving = true;
    archiveButton.disabled = true;
    archiveButton.textContent = '归档中...';
    
    // 禁用输入，防止在归档过程中继续发送消息
    messageInput.disabled = true;
    sendButton.disabled = true;

    // 隐藏对话框
    if (container) {
        container.style.display = 'none';
    }

    // 显示书页（从左边滑入）
    showBookPage();

    try {
        const response = await fetch(`${API_BASE}/archive`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                history: conversationHistory
            })
        });

        // 检查响应状态
        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }

        // 读取流式数据
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let summaryText = '';
        let hasError = false;
        let isSaved = false; // 记录是否保存到向量库
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // 解码数据
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.type === 'content') {
                            // 追加内容
                            summaryText += data.content;
                            bookPageText.textContent = summaryText;
                            // 滚动到底部
                            bookPage.scrollTop = bookPage.scrollHeight;
                        } else if (data.type === 'error') {
                            // 处理错误
                            hasError = true;
                            bookPageText.textContent = data.error || '抱歉，发生了错误。';
                            console.error('服务器错误:', data.error);
                        } else if (data.type === 'done') {
                            // 流式输出完成，记录保存状态
                            // 只有当 saved 明确为 true 时才标记为已保存
                            isSaved = data.saved === true;
                            console.log('归档完成，保存状态:', isSaved);
                        }
                    } catch (e) {
                        console.error('解析SSE数据失败:', e, line);
                    }
                }
            }
        }
        
        // 如果成功接收到总结
        if (!hasError && summaryText) {
            // 重新加载向量总数并显示页码（只有在保存成功时才更新）
            if (isSaved) {
                await loadVectorCount();
                const currentPageNumber = parseInt(vectorCountSpan.textContent) || 0;
                bookPageNumber.textContent = currentPageNumber;
                bookPageNumber.classList.add('visible');
            }
            
            // 重置对话
            conversationHistory = [];
            remainingCount = 10;
            remainingCountSpan.textContent = remainingCount;
            
            // 停留13秒后自动滑出
            setTimeout(() => {
                // 如果保存成功，显示"已归档..."提示
                if (isSaved) {
                    const archiveNotification = document.getElementById('archiveNotification');
                    if (archiveNotification) {
                        archiveNotification.classList.add('show');
                        // 2秒后隐藏（动画会自动处理淡入淡出）
                        setTimeout(() => {
                            archiveNotification.classList.remove('show');
                            archiveNotification.style.display = 'none';
                        }, 2000);
                    }
                }
                
                hideBookPage();
                // 滑出后重置对话界面
                setTimeout(() => {
                    // 显示对话框
                    if (container) {
                        container.style.display = 'flex';
                    }
                    const currentTime = formatTime(new Date());
                    chatContainer.innerHTML = `
                        <div class="message assistant" id="welcomeMessage">
                            <div class="message-time" id="welcomeTime">${currentTime}</div>
                            <div class="message-content">
                                ♪
                            </div>
                        </div>
                    `;
                    messageInput.disabled = false;
                    sendButton.disabled = false;
                    archiveButton.disabled = true;
                    initWelcomeMessageTime();
                }, 600);
            }, 13000);
        } else if (!hasError && !summaryText) {
            // 没有收到任何内容
            bookPageText.textContent = '抱歉，没有生成总结。';
            hasError = true;
            // 错误情况下也停留13秒后滑出
            setTimeout(() => {
                hideBookPage();
                setTimeout(() => {
                    // 显示对话框
                    if (container) {
                        container.style.display = 'flex';
                    }
                    const currentTime = formatTime(new Date());
            chatContainer.innerHTML = `
                        <div class="message assistant" id="welcomeMessage">
                            <div class="message-time" id="welcomeTime">${currentTime}</div>
                    <div class="message-content">
                                ♪
                    </div>
                </div>
            `;
            messageInput.disabled = false;
            sendButton.disabled = false;
                    archiveButton.disabled = true;
                    initWelcomeMessageTime();
                }, 600);
            }, 13000);
        }
        
    } catch (error) {
        console.error('归档失败:', error);
        bookPageText.textContent = `归档失败：${error.message || '请稍后重试。'}`;
        // 错误情况下也停留13秒后滑出
        setTimeout(() => {
            hideBookPage();
            setTimeout(() => {
                // 显示对话框
                if (container) {
                    container.style.display = 'flex';
                }
                const currentTime = formatTime(new Date());
                chatContainer.innerHTML = `
                    <div class="message assistant" id="welcomeMessage">
                        <div class="message-time" id="welcomeTime">${currentTime}</div>
                        <div class="message-content">
                            ♪
                        </div>
                    </div>
                `;
                messageInput.disabled = false;
                sendButton.disabled = false;
                archiveButton.disabled = true;
                initWelcomeMessageTime();
            }, 600);
        }, 13000);
    } finally {
        isArchiving = false;
        archiveButton.textContent = '结束对话并归档';
    }
}


// 事件监听
sendButton.addEventListener('click', sendMessage);
archiveButton.addEventListener('click', archiveConversation);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !sendButton.disabled) {
        sendMessage();
    }
});

// 页面加载时初始化
loadVectorCount();
initWelcomeMessageTime();
updateRealTimeClock(); // 立即更新一次时钟

// 每30秒更新一次向量总数
setInterval(loadVectorCount, 30000);

// 每秒更新实时时钟
setInterval(updateRealTimeClock, 1000);

