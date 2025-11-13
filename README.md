# 对话系统

一个基于Flask和FAISS的对话系统，支持大模型对话和向量归档功能。

## 功能特性

1. **对话功能**
   - 页面输入框进行对话
   - 最多支持10次对话
   - 对话完成后可归档

2. **归档功能**
   - 自动总结对话内容
   - 将总结存入FAISS向量库
   - 归档完成后显示提示信息

3. **向量统计**
   - 页面实时显示已记录的向量总数

## 安装依赖

```bash
pip install -r requirements.txt
```

## 初始化数据库

首次使用前，需要初始化向量数据库：

```bash
# 交互式初始化（如果数据库已存在会询问是否覆盖）
python init_db.py

# 强制覆盖现有数据库
python init_db.py --force

# 查看当前数据库信息
python init_db.py --info
```

## 使用方法

1. 初始化数据库（首次使用）：
```bash
python init_db.py
```

2. 启动后端服务：
```bash
python app.py
```

3. 打开浏览器访问：`http://localhost:5000`

4. 在页面中进行对话，最多10次

5. 对话完成后点击"归档对话"按钮

## 自定义实现

### 实现大模型对话函数

在 `app.py` 中实现 `chat_model` 函数：

```python
def chat_model(user_message, conversation_history):
    """
    大模型对话函数
    
    Args:
        user_message: 用户输入的消息
        conversation_history: 对话历史列表
    
    Returns:
        str: 模型返回的回复
    """
    # 在这里实现你的大模型调用逻辑
    # 例如：调用OpenAI API、本地模型等
    pass
```

### 实现对话总结函数

在 `app.py` 中实现 `summarize_conversation` 函数：

```python
def summarize_conversation(conversation_history):
    """
    对话总结函数
    
    Args:
        conversation_history: 对话历史列表
    
    Returns:
        str: 对话的总结文本
    """
    # 在这里实现你的总结逻辑
    # 例如：调用大模型API进行总结
    pass
```

## 配置文件说明

### 配置Embedding模型

编辑 `config.py` 文件来配置embedding模型：

#### 使用本地模型

```python
EMBEDDING_CONFIG = {
    'model_type': 'local',  # 设置为 'local'
    'local_model_path': './models/embedding_model',  # 本地模型路径
    'vector_dimension': None,  # 如果为None，会自动从模型获取
    'device': 'cpu',  # 'cpu' 或 'cuda'
}
```

**本地模型要求：**
- 模型必须是sentence-transformers兼容的格式
- 可以使用 `sentence-transformers` 保存模型：
  ```python
  from sentence_transformers import SentenceTransformer
  model = SentenceTransformer('paraphrase-MiniLM-L6-v2')
  model.save('./models/embedding_model')
  ```

#### 使用HuggingFace模型

```python
EMBEDDING_CONFIG = {
    'model_type': 'huggingface',  # 设置为 'huggingface'
    'hf_model_name': 'paraphrase-MiniLM-L6-v2',  # HuggingFace模型名称
    'vector_dimension': None,  # 如果为None，会自动从模型获取
    'device': 'cpu',  # 'cpu' 或 'cuda'
}
```

### 配置FAISS索引

```python
FAISS_CONFIG = {
    'index_path': 'vector_index.faiss',  # 索引文件路径
    'metadata_path': 'vector_metadata.pkl',  # 元数据文件路径
    'index_type': 'flat',  # 'flat' (L2距离) 或 'ivf' (倒排索引)
}
```

### 其他配置

```python
OTHER_CONFIG = {
    'port': 5000,  # API端口
    'debug': True,  # 调试模式
}
```

## 项目结构

```
.
├── app.py              # Flask后端主文件
├── config.py           # 配置文件
├── vector_store.py     # FAISS向量库管理
├── init_db.py          # 数据库初始化脚本
├── templates/
│   └── index.html      # 前端页面
├── requirements.txt    # Python依赖
└── README.md          # 项目说明
```

## 注意事项

- 如果使用本地模型，请确保模型路径正确且模型格式兼容sentence-transformers
- 向量索引文件会保存在项目目录下：`vector_index.faiss` 和 `vector_metadata.pkl`
- 对话历史存储在内存中，重启服务后会清空（但已归档的向量会保留）
- 首次使用HuggingFace模型时会自动下载（约90MB）
