// 使用相对路径，避免端口不一致问题
const API_BASE = '/api';
let conversationHistory = [];
let remainingCount = 10;
let isArchiving = false;

// 滚动相关变量（必须在函数使用前定义）
let scrollTimeoutId = null;

// 音频上下文和音乐相关变量（全局定义）
var audioContext = null;
var isPlaying = false;
var morseTimeouts = []; // 存储所有定时器ID
var masterGainNode = null; // 主音量控制节点
var currentVolume = 0.5; // 默认音量50%

// 摩斯密码字典（必须在textToMorse函数之前定义）
const morseCode = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    ' ': ' ' // 单词间隔
};

// 将文本转换为摩斯密码
function textToMorse(text) {
    const words = text.toUpperCase().split(' ');
    return words.map(word => {
        return word.split('').map(char => {
            return morseCode[char] || '';
        }).filter(m => m).join(' ');
    }).filter(w => w).join(' / ');
}

// 初始化会话（页面加载时）
async function initSession() {
    try {
        const response = await fetch(`${API_BASE}/session/init`, {
            method: 'GET',
            credentials: 'include' // 重要：包含cookie以支持session
        });
        const data = await response.json();
        if (data.success) {
            conversationHistory = data.history || [];
            remainingCount = data.remaining_count || 10;
            // 使用DOM查询获取元素
            const remainingCountSpanEl = document.getElementById('remainingCount');
            if (remainingCountSpanEl) {
                remainingCountSpanEl.textContent = remainingCount;
            }
            
            // 如果有历史记录，恢复显示（可选）
            // 这里不恢复显示，让用户重新开始对话
        }
        
        // 初始化时显示"删除中"进度条（0%），隐藏剩余对话次数
        const progressContainerEl = document.getElementById('progressContainer');
        const remainingCountDisplayEl = document.getElementById('remainingCountDisplay');
        if (progressContainerEl) {
            progressContainerEl.style.display = 'flex';
            const progressLabel = progressContainerEl.querySelector('.progress-label');
            if (progressLabel) {
                progressLabel.textContent = '删除中';
            }
        }
        if (remainingCountDisplayEl) {
            remainingCountDisplayEl.style.display = 'none';
        }
        // 使用DOM查询获取进度条元素
        const progressBarEl = document.getElementById('progressBar');
        const progressPercentEl = document.getElementById('progressPercent');
        if (progressBarEl && progressPercentEl) {
            progressBarEl.style.width = '0%';
            progressPercentEl.textContent = '0%';
        }
    } catch (error) {
        console.error('初始化会话失败:', error);
        // 即使失败也设置初始显示状态
        const progressContainerEl = document.getElementById('progressContainer');
        const remainingCountDisplayEl = document.getElementById('remainingCountDisplay');
        if (progressContainerEl) {
            progressContainerEl.style.display = 'flex';
            const progressLabel = progressContainerEl.querySelector('.progress-label');
            if (progressLabel) {
                progressLabel.textContent = '删除中';
            }
        }
        if (remainingCountDisplayEl) {
            remainingCountDisplayEl.style.display = 'none';
        }
        const progressBarEl = document.getElementById('progressBar');
        const progressPercentEl = document.getElementById('progressPercent');
        if (progressBarEl && progressPercentEl) {
            progressBarEl.style.width = '0%';
            progressPercentEl.textContent = '0%';
        }
    }
}

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
const progressContainer = document.getElementById('progressContainer');
const remainingCountDisplay = document.getElementById('remainingCountDisplay');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');

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

// 格式化完整时间（年月日 时分秒）
function formatFullTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
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

    // 显示"删除中"进度条，隐藏剩余对话次数
    if (progressContainer) {
        progressContainer.style.display = 'flex';
        // 确保标签显示"删除中"
        const progressLabel = progressContainer.querySelector('.progress-label');
        if (progressLabel) {
            progressLabel.textContent = '删除中';
        }
    }
    if (remainingCountDisplay) {
        remainingCountDisplay.style.display = 'none';
    }
    // 初始化进度条为0%
    updateProgress(0);

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
            credentials: 'include', // 重要：包含cookie以支持session
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
        let receivedChunks = 0;
        const startTime = Date.now();
        const estimatedDuration = 10000; // 预估10秒完成
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // 确保进度达到100%
                updateProgress(100);
                break;
            }
            
            receivedChunks++;
            // 基于时间估算进度（0-90%），最后10%在done时完成
            const elapsed = Date.now() - startTime;
            const timeBasedProgress = Math.min(90, (elapsed / estimatedDuration) * 90);
            // 也可以基于chunk数量
            const chunkBasedProgress = Math.min(90, (receivedChunks / 100) * 90);
            // 使用两者中较大的值
            const currentProgress = Math.max(timeBasedProgress, chunkBasedProgress);
            updateProgress(currentProgress);
            
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
                                updateProgress(20); // 思考开始，进度20%
                            } else if (data.status === 'end') {
                                isThinking = false;
                                thinkingDiv.style.display = 'none';
                                contentDiv.style.display = 'block';
                                updateProgress(40); // 思考结束，进度40%
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
                            // 根据内容长度更新进度（40%-90%）
                            const contentProgress = 40 + Math.min(50, (assistantResponse.length / 1000) * 50);
                            updateProgress(contentProgress);
                        } else if (data.type === 'error') {
                            // 处理错误
                            hasError = true;
                            if (!firstContentReceived) {
                                firstContentReceived = true;
                            }
                            contentDiv.textContent = data.error || '抱歉，发生了错误。';
                            console.error('服务器错误:', data.error);
                            updateProgress(100);
                        } else if (data.type === 'done') {
                            // 流式输出完成，添加时间戳
                            const assistantTimestamp = new Date();
                            const timeDiv = document.createElement('div');
                            timeDiv.className = 'message-time';
                            timeDiv.textContent = formatTime(assistantTimestamp);
                            // 将时间戳插入到内容之前
                            assistantMessageDiv.insertBefore(timeDiv, contentDiv);
                            
                            // 更新剩余次数（如果后端返回了）
                            if (data.remaining_count !== undefined) {
                                remainingCount = data.remaining_count;
                                remainingCountSpan.textContent = remainingCount;
                            }
                            updateProgress(100);
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
        // 对话完成后，进度条达到100%，然后重置为0%（保持显示"删除中"进度条）
        updateProgress(100);
        // 延迟一下再重置，让用户看到100%
        setTimeout(() => {
            updateProgress(0);
        }, 500);
        
        // 保持显示进度条，不显示剩余对话次数
        if (progressContainer) {
            progressContainer.style.display = 'flex';
        }
        if (remainingCountDisplay) {
            remainingCountDisplay.style.display = 'none';
        }
        
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

    // 显示进度条，隐藏剩余对话次数
    if (progressContainer) {
        progressContainer.style.display = 'flex';
        // 修改标签为"删除中"
        const progressLabel = progressContainer.querySelector('.progress-label');
        if (progressLabel) {
            progressLabel.textContent = '删除中';
        }
    }
    if (remainingCountDisplay) {
        remainingCountDisplay.style.display = 'none';
    }
    // 初始化进度条为100%（归档时从100%降到0%）
    updateProgress(100);

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
            credentials: 'include', // 重要：包含cookie以支持session
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
        let receivedChunks = 0;
        
        // 归档时进度从100%降到0%
        const startTime = Date.now();
        const estimatedDuration = 10000; // 预估10秒完成
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // 确保进度降到0%
                updateProgress(0);
                break;
            }
            
            receivedChunks++;
            // 基于时间估算进度（100%-10%），最后10%在done时完成
            const elapsed = Date.now() - startTime;
            const timeBasedProgress = Math.max(10, 100 - (elapsed / estimatedDuration) * 90);
            // 也可以基于chunk数量
            const chunkBasedProgress = Math.max(10, 100 - (receivedChunks / 100) * 90);
            // 使用两者中较小的值（进度下降）
            const currentProgress = Math.min(timeBasedProgress, chunkBasedProgress);
            updateProgress(currentProgress);
            
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
                                // 显示思考提示
                                bookPageText.textContent = data.message || '这个故事...';
                                updateProgress(80); // 思考开始，进度80%（从100%下降）
                            } else if (data.status === 'end') {
                                // 思考结束，清空提示，准备显示实际内容
                                bookPageText.textContent = '';
                                summaryText = ''; // 重置总结文本
                                updateProgress(60); // 思考结束，进度60%
                            }
                        } else if (data.type === 'content') {
                            // 追加内容
                            summaryText += data.content;
                            bookPageText.textContent = summaryText;
                            // 滚动到底部
                            bookPage.scrollTop = bookPage.scrollHeight;
                            // 根据内容长度更新进度（60%-10%）
                            const contentProgress = Math.max(10, 60 - (summaryText.length / 1000) * 50);
                            updateProgress(contentProgress);
                        } else if (data.type === 'error') {
                            // 处理错误
                            hasError = true;
                            bookPageText.textContent = data.error || '抱歉，发生了错误。';
                            console.error('服务器错误:', data.error);
                            updateProgress(0);
                        } else if (data.type === 'done') {
                            // 流式输出完成，记录保存状态
                            // 只有当 saved 明确为 true 时才标记为已保存
                            isSaved = data.saved === true;
                            console.log('归档完成，保存状态:', isSaved);
                            updateProgress(0);
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
            
            // 保持显示"删除中"进度条，不显示剩余对话次数
            if (progressContainer) {
                progressContainer.style.display = 'flex';
                const progressLabel = progressContainer.querySelector('.progress-label');
                if (progressLabel) {
                    progressLabel.textContent = '删除中';
                }
            }
            if (remainingCountDisplay) {
                remainingCountDisplay.style.display = 'none';
            }
            // 重置进度条为0%
            updateProgress(0);
            
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
            // 保持显示"删除中"进度条，不显示剩余对话次数
            if (progressContainer) {
                progressContainer.style.display = 'flex';
                const progressLabel = progressContainer.querySelector('.progress-label');
                if (progressLabel) {
                    progressLabel.textContent = '删除中';
                }
            }
            if (remainingCountDisplay) {
                remainingCountDisplay.style.display = 'none';
            }
            // 重置进度条为0%
            updateProgress(0);
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
        // 保持显示"删除中"进度条，不显示剩余对话次数
        if (progressContainer) {
            progressContainer.style.display = 'flex';
            const progressLabel = progressContainer.querySelector('.progress-label');
            if (progressLabel) {
                progressLabel.textContent = '删除中';
            }
        }
        if (remainingCountDisplay) {
            remainingCountDisplay.style.display = 'none';
        }
        // 重置进度条为0%
        updateProgress(0);
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
        // 确保显示"删除中"进度条，不显示剩余对话次数
        if (progressContainer) {
            progressContainer.style.display = 'flex';
            const progressLabel = progressContainer.querySelector('.progress-label');
            if (progressLabel) {
                progressLabel.textContent = '删除中';
            }
        }
        if (remainingCountDisplay) {
            remainingCountDisplay.style.display = 'none';
        }
        // 重置进度条为0%
        updateProgress(0);
    }
}

// 更新进度条
function updateProgress(percent) {
    if (progressBar && progressPercent) {
        const clampedPercent = Math.max(0, Math.min(100, percent));
        progressBar.style.width = `${clampedPercent}%`;
        progressPercent.textContent = `${Math.round(clampedPercent)}%`;
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

// ==================== 留言板功能 ====================

// 留言数据存储（必须在函数使用前定义）
let comments = [];

// 页面加载时初始化
initSession(); // 初始化会话（必须在最前面）
loadVectorCount();
initWelcomeMessageTime();
updateRealTimeClock(); // 立即更新一次时钟
initCommentBoard(); // 初始化留言板
loadVolume(); // 加载音量设置

// 每30秒更新一次向量总数
setInterval(loadVectorCount, 30000);

// 每秒更新实时时钟
setInterval(updateRealTimeClock, 1000);

// 从localStorage加载留言
function loadComments() {
    try {
        const saved = localStorage.getItem('morseComments');
        if (saved) {
            comments = JSON.parse(saved);
            renderComments(); // 更新全屏显示
            // 如果有留言，更新音乐播放内容
            if (comments.length > 0 && isPlaying) {
                stopMorseMusic();
                startMorseMusic();
            }
        } else {
            // 即使没有留言，也要清空显示
            renderComments();
        }
    } catch (e) {
        console.error('加载留言失败:', e);
        comments = [];
        renderComments();
    }
}

// 保存留言到localStorage
function saveComments() {
    try {
        localStorage.setItem('morseComments', JSON.stringify(comments));
    } catch (e) {
        console.error('保存留言失败:', e);
    }
}

// 渲染留言列表到全屏背景
function renderComments() {
    const morseDisplay = document.getElementById('morseDisplay');
    if (!morseDisplay) return;
    
    // 固定的摩斯密码，始终显示在最前面
    const fixedMorse = [
        textToMorse("see you tomorrow"),
        textToMorse("see you again")
    ];
    
    // 将所有留言的摩斯密码合并（过滤掉空的）
    const commentMorse = comments
        .map(c => c.morse)
        .filter(morse => morse && morse.trim().length > 0);
    
    // 合并固定的和留言的摩斯密码
    const allMorse = [...fixedMorse, ...commentMorse].join('\n');
    
    // 如果没有有效的摩斯密码，清空显示
    if (!allMorse || allMorse.trim().length === 0) {
        morseDisplay.innerHTML = '';
        return;
    }
    
    // 停止之前的滚动
    stopMorseScroll();
    
    // 创建滚动文本
    morseDisplay.innerHTML = `
        <div class="morse-scroll-text">${escapeHtml(allMorse)}</div>
    `;
    
    // 启动自动滚动（使用setTimeout确保DOM已更新）
    setTimeout(() => {
        startMorseScroll();
    }, 10);
}

// 启动摩斯密码自动滚动（Shell风格：逐行滚动）
function startMorseScroll() {
    const morseDisplay = document.getElementById('morseDisplay');
    if (!morseDisplay) {
        console.warn('morseDisplay元素不存在');
        return;
    }
    
    const scrollText = morseDisplay.querySelector('.morse-scroll-text');
    if (!scrollText) {
        console.warn('morse-scroll-text元素不存在');
        return;
    }
    
    // 清除之前的动画
    if (scrollTimeoutId) {
        clearTimeout(scrollTimeoutId);
        scrollTimeoutId = null;
    }
    scrollText.style.animation = 'none';
    scrollText.style.transition = 'none';
    
    // 等待一下确保DOM已完全渲染
    setTimeout(() => {
        // 重置滚动位置到屏幕底部
        const viewportHeight = window.innerHeight;
        let scrollPosition = viewportHeight;
        scrollText.style.transform = `translateY(${scrollPosition}px)`;
        scrollText.style.willChange = 'transform';
        
        // 强制重排
        void scrollText.offsetWidth;
        
        // 计算文本高度和行高
        const textHeight = scrollText.scrollHeight;
        const computedStyle = getComputedStyle(scrollText);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 32.4; // 18px * 1.8
        
        console.log('滚动信息:', { textHeight, lineHeight, viewportHeight });
        
        if (textHeight === 0) {
            console.warn('摩斯密码文本高度为0，无法滚动');
            return;
        }
        
        // 计算需要滚动的总距离（文本高度 + 视口高度，确保文本完全滚出屏幕）
        const totalScrollDistance = textHeight + viewportHeight;
        const totalLines = Math.ceil(totalScrollDistance / lineHeight);
        console.log('总行数:', totalLines, '总滚动距离:', totalScrollDistance);
        
        // Shell风格滚动：逐行滚动，有轻微的随机性
        let currentLine = 0;
        const baseScrollSpeed = 2000; // 基础滚动速度（毫秒/行），2秒移动一行
        
        function scrollStep() {
            if (!scrollText.parentElement) {
                console.log('元素已移除，停止滚动');
                return; // 元素已移除，停止滚动
            }
            
            // 检查是否需要重置（当文本完全滚出屏幕顶部时）
            if (currentLine >= totalLines) {
                scrollPosition = viewportHeight;
                currentLine = 0;
                console.log('重置滚动位置');
            }
            
            // 计算目标位置（每行滚动）
            // 从 viewportHeight（屏幕底部）滚动到 -textHeight（文本完全离开屏幕顶部）
            const targetY = viewportHeight - (currentLine * lineHeight);
            
            // 添加轻微的随机性，模拟shell的滚动感觉（±0.5像素）
            const randomOffset = (Math.random() - 0.5) * 1;
            scrollPosition = targetY + randomOffset;
            
            scrollText.style.transform = `translateY(${scrollPosition}px)`;
            
            currentLine++;
            
            // 计算下一行的延迟（添加随机性，让滚动更像shell）
            const delay = baseScrollSpeed + (Math.random() * 30 - 15); // 基础速度 ±15ms
            
            scrollTimeoutId = setTimeout(() => {
                scrollStep();
            }, Math.max(20, delay)); // 确保至少20ms
        }
        
        // 开始滚动
        console.log('开始滚动');
        scrollStep();
    }, 100); // 给DOM一些时间完全渲染
}

// 停止滚动动画
function stopMorseScroll() {
    if (scrollTimeoutId) {
        clearTimeout(scrollTimeoutId);
        scrollTimeoutId = null;
        console.log('停止滚动');
    }
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 提交留言
async function submitComment() {
    const input = document.getElementById('commentInput');
    const submitButton = document.getElementById('commentSubmitButton');
    const originalText = input.value.trim();
    
    if (!originalText) return;
    
    // 禁用输入和按钮
    input.disabled = true;
    submitButton.disabled = true;
    submitButton.textContent = '处理中...';
    
    try {
        // 1. 翻译为英语
        console.log('开始翻译:', originalText);
        const translateResponse = await fetch(`${API_BASE}/translate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ text: originalText })
        });
        
        if (!translateResponse.ok) {
            const errorText = await translateResponse.text();
            console.error('翻译请求失败:', translateResponse.status, errorText);
            throw new Error(`翻译请求失败: ${translateResponse.status}`);
        }
        
        const translateData = await translateResponse.json();
        console.log('翻译响应:', translateData);
        
        if (!translateData.success) {
            throw new Error(translateData.error || '翻译失败');
        }
        
        const translatedText = translateData.translated;
        console.log('翻译结果:', translatedText);
        
        if (!translatedText || translatedText.trim() === '') {
            throw new Error('翻译结果为空');
        }
        
        // 2. 转换为摩斯密码
        const morseText = textToMorse(translatedText);
        console.log('摩斯密码:', morseText);
        
        if (!morseText || morseText.trim() === '') {
            throw new Error('无法转换为摩斯密码');
        }
        
        // 3. 保存留言
        comments.push({
            original: originalText,
            translated: translatedText,
            morse: morseText,
            timestamp: new Date().toISOString()
        });
        
        saveComments();
        renderComments();
        
        // 4. 如果音乐正在播放，重新开始播放（更新内容）
        if (isPlaying) {
            stopMorseMusic();
            setTimeout(() => {
                startMorseMusic();
            }, 100);
        }
        
        // 清空输入框
        input.value = '';
        
    } catch (error) {
        console.error('提交留言失败:', error);
        alert('提交失败：' + (error.message || '请稍后重试'));
    } finally {
        input.disabled = false;
        submitButton.disabled = false;
        submitButton.textContent = '提交';
        input.focus();
    }
}

// 切换注释板显示/隐藏
function toggleCommentBoard() {
    const commentBoard = document.getElementById('commentBoard');
    if (commentBoard) {
        commentBoard.classList.toggle('show');
    }
}

// 初始化留言板
function initCommentBoard() {
    const submitButton = document.getElementById('commentSubmitButton');
    const input = document.getElementById('commentInput');
    
    if (submitButton) {
        submitButton.addEventListener('click', submitComment);
    }
    
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !submitButton.disabled) {
                submitComment();
            }
        });
    }
    
    loadComments();
}

// ==================== 摩斯密码背景音乐 ====================

// 初始化音频上下文（需要用户交互后）
function initAudioContext() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // 创建主音量控制节点
            masterGainNode = audioContext.createGain();
            masterGainNode.gain.value = currentVolume;
            masterGainNode.connect(audioContext.destination);
        } catch (e) {
            console.error('无法创建音频上下文:', e);
            return false;
        }
    }
    return true;
}

// 改变音量
function changeVolume(value) {
    currentVolume = value / 100;
    if (masterGainNode) {
        masterGainNode.gain.value = currentVolume;
    }
    // 保存音量设置
    try {
        localStorage.setItem('morseVolume', value);
    } catch (e) {
        console.error('保存音量设置失败:', e);
    }
}

// 加载音量设置
function loadVolume() {
    try {
        const saved = localStorage.getItem('morseVolume');
        if (saved !== null) {
            const volume = parseInt(saved);
            if (volume >= 0 && volume <= 100) {
                currentVolume = volume / 100;
                const slider = document.getElementById('volumeSlider');
                if (slider) {
                    slider.value = volume;
                }
                if (masterGainNode) {
                    masterGainNode.gain.value = currentVolume;
                }
            }
        }
    } catch (e) {
        console.error('加载音量设置失败:', e);
    }
}

// 播放摩斯密码音调
function playMorseTone(duration, frequency = 440) {
    if (!audioContext) {
        console.warn('音频上下文未初始化');
        return;
    }
    
    if (audioContext.state === 'closed') {
        console.error('音频上下文已关闭');
        return;
    }
    
    // 如果音频上下文被暂停，尝试恢复（但不阻塞）
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => {
            console.error('恢复音频上下文失败:', e);
        });
        // 注意：这里不等待resume完成，因为音调需要立即播放
        // resume会在后台完成
    }
    
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        // 连接到主音量控制节点，而不是直接连接到destination
        if (masterGainNode) {
            gainNode.connect(masterGainNode);
        } else {
            gainNode.connect(audioContext.destination);
        }
        
        // 使用更柔和的频率（440Hz，A4音符，比600Hz更柔和）
        oscillator.frequency.value = frequency;
        // 使用sine波形（最柔和的波形）
        oscillator.type = 'sine';
        
        // 更柔和的淡入淡出效果，降低音量
        const now = audioContext.currentTime;
        const volume = 0.15; // 降低音量从0.3到0.15
        const fadeTime = 0.02; // 增加淡入淡出时间，使过渡更平滑
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + fadeTime);
        gainNode.gain.linearRampToValueAtTime(volume, now + duration - fadeTime);
        gainNode.gain.linearRampToValueAtTime(0, now + duration);
        
        oscillator.start(now);
        oscillator.stop(now + duration);
    } catch (e) {
        console.error('播放音调失败:', e);
    }
}

// 播放摩斯密码序列（直接解析摩斯密码字符串）
function playMorseSequence(morseString) {
    if (!audioContext || !isPlaying) return Promise.resolve(0);
    
    return new Promise((resolve) => {
        let delay = 0;
        const unitTime = 200; // 单位时间（毫秒）- 已调整为慢一倍
        
        // 解析摩斯密码字符串：. 表示点，- 表示划，空格表示符号间隔，/ 表示单词间隔
        const symbols = morseString.split('');
        let i = 0;
        
        while (i < symbols.length) {
            const char = symbols[i];
            
            if (char === '.') {
                // 短音（点）
                const timeoutId = setTimeout(() => {
                    if (isPlaying) {
                        playMorseTone(unitTime / 1000);
                    }
                }, delay);
                morseTimeouts.push(timeoutId);
                delay += unitTime * 2; // 音长 + 符号间隔
                i++;
            } else if (char === '-') {
                // 长音（划）
                const timeoutId = setTimeout(() => {
                    if (isPlaying) {
                        playMorseTone(unitTime * 3 / 1000);
                    }
                }, delay);
                morseTimeouts.push(timeoutId);
                delay += unitTime * 4; // 音长 + 符号间隔
                i++;
            } else if (char === ' ') {
                // 符号间隔（已包含在上面的延迟中）
                delay += unitTime; // 额外的间隔
                i++;
            } else if (char === '/') {
                // 单词间隔
                delay += unitTime * 7;
                i++;
                // 跳过后面的空格
                while (i < symbols.length && symbols[i] === ' ') {
                    i++;
                }
            } else {
                // 忽略其他字符
                i++;
            }
        }
        
        // 返回总时长
        const finalTimeoutId = setTimeout(() => {
            resolve(delay);
        }, delay);
        morseTimeouts.push(finalTimeoutId);
    });
}

// 播放摩斯密码背景音乐（循环）
async function playMorseBackground() {
    if (!isPlaying) {
        console.log('播放已停止，退出');
        return;
    }
    
    // 确保音频上下文可用
    if (!audioContext || audioContext.state === 'closed') {
        console.error('音频上下文不可用');
        stopMorseMusic();
        return;
    }
    
    // 获取所有摩斯密码，合并为一个序列
    // 固定的摩斯密码，始终播放在最前面
    const fixedMorse = [
        textToMorse("see you tomorrow"),
        textToMorse("see you again")
    ];
    
    // 获取所有留言的摩斯密码（过滤掉空的）
    const commentMorse = comments
        .map(c => c.morse)
        .filter(morse => morse && morse.trim().length > 0);
    
    // 合并固定的和留言的摩斯密码，用 ' / ' 连接
    const allMorse = [...fixedMorse, ...commentMorse];
    const morseSequence = allMorse.join(' / ');
    
    if (!morseSequence || morseSequence.trim() === '') {
        console.warn('摩斯密码序列为空，等待后重试');
        // 如果还是没有内容，等待后重试
        const retryTimeoutId = setTimeout(() => {
            if (isPlaying) {
                playMorseBackground();
            }
        }, 2000);
        morseTimeouts.push(retryTimeoutId);
        return;
    }
    
    console.log('播放摩斯密码序列:', morseSequence);
    
    // 将摩斯密码序列转换为可播放的文本（标准化空格）
    // 摩斯密码格式：. - 表示点和划，空格表示符号间隔，/ 表示单词间隔
    const playableText = morseSequence.replace(/\s+/g, ' ').trim();
    
    // 播放摩斯密码序列
    try {
        const duration = await playMorseSequence(playableText);
        console.log('播放完成，时长:', duration, 'ms');
        
        // 播放完成后，等待一段时间再循环
        if (isPlaying) {
            const waitTimeoutId = setTimeout(() => {
                if (isPlaying) {
                    // 等待2秒后再次播放
                    const loopTimeoutId = setTimeout(() => {
                        playMorseBackground();
                    }, 2000);
                    morseTimeouts.push(loopTimeoutId);
                }
            }, duration);
            morseTimeouts.push(waitTimeoutId);
        }
    } catch (e) {
        console.error('播放摩斯密码序列失败:', e);
        stopMorseMusic();
    }
}

// 开始播放摩斯密码音乐
async function startMorseMusic() {
    if (isPlaying) {
        console.log('音乐已在播放中');
        return;
    }
    
    // 清理之前的定时器（如果有）
    morseTimeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
    });
    morseTimeouts = [];
    
    // 初始化音频上下文
    if (!audioContext) {
        if (!initAudioContext()) {
            console.error('无法初始化音频上下文');
            alert('无法初始化音频，请检查浏览器设置或允许音频播放。');
            return;
        }
    }
    
    // 如果音频上下文被暂停（浏览器策略），需要恢复
    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('音频上下文已恢复，状态:', audioContext.state);
        } catch (e) {
            console.error('恢复音频上下文失败:', e);
            alert('无法播放音频，请检查浏览器设置。');
            return;
        }
    }
    
    // 确保音频上下文处于运行状态
    if (audioContext.state === 'closed') {
        console.error('音频上下文已关闭，重新初始化');
        audioContext = null;
        if (!initAudioContext()) {
            console.error('重新初始化音频上下文失败');
            return;
        }
    }
    
    console.log('开始播放音乐，音频上下文状态:', audioContext.state);
    
    isPlaying = true;
    const musicButton = document.getElementById('morseMusicButton');
    if (musicButton) {
        musicButton.classList.add('playing');
    }
    
    // 立即开始播放
    playMorseBackground();
}

// 停止播放摩斯密码音乐
function stopMorseMusic() {
    if (!isPlaying) return;
    
    isPlaying = false;
    
    // 清理所有定时器
    morseTimeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
    });
    morseTimeouts = [];
    
    const musicButton = document.getElementById('morseMusicButton');
    if (musicButton) {
        musicButton.classList.remove('playing');
    }
}

// 切换摩斯密码音乐
function toggleMorseMusic() {
    // 先检查当前状态，避免重复点击
    const musicButton = document.getElementById('morseMusicButton');
    const isCurrentlyPlaying = musicButton && musicButton.classList.contains('playing');
    
    if (isCurrentlyPlaying) {
        stopMorseMusic();
    } else {
        startMorseMusic();
    }
}

// 页面加载完成后，等待用户交互再初始化音频并自动播放
document.addEventListener('DOMContentLoaded', () => {
    let audioInitialized = false;
    let musicStarted = false;
    
    // 监听用户点击，初始化音频上下文并自动开始播放
    const initAudioOnInteraction = async () => {
        if (!audioInitialized) {
            if (!audioContext) {
                if (!initAudioContext()) {
                    return; // 初始化失败，返回
                }
            }
            audioInitialized = true;
            
            // 确保音频上下文已恢复（浏览器策略）
            if (audioContext && audioContext.state === 'suspended') {
                try {
                    await audioContext.resume();
                } catch (e) {
                    console.error('恢复音频上下文失败:', e);
                }
            }
            
            // 初始化后自动开始播放音乐
            if (!musicStarted && audioContext && audioContext.state !== 'closed') {
                // 延迟一点时间确保音频上下文已准备好
                setTimeout(() => {
                    if (audioContext && audioContext.state !== 'closed') {
                        startMorseMusic();
                        musicStarted = true;
                    }
                }, 200);
            }
        }
        
        // 只移除一次监听器
        if (audioInitialized) {
            document.removeEventListener('click', initAudioOnInteraction);
            document.removeEventListener('touchstart', initAudioOnInteraction);
        }
    };
    
    document.addEventListener('click', initAudioOnInteraction);
    document.addEventListener('touchstart', initAudioOnInteraction);
});

