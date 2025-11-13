import faiss
import numpy as np
import pickle
import os
from datetime import datetime
from sentence_transformers import SentenceTransformer
import config

class VectorStore:
    def __init__(self, index_path=None, metadata_path=None):
        # 从配置文件读取路径
        self.index_path = index_path or config.FAISS_CONFIG['index_path']
        self.metadata_path = metadata_path or config.FAISS_CONFIG['metadata_path']
        
        # 加载嵌入模型
        self._load_model()
        
        # 获取向量维度
        if config.EMBEDDING_CONFIG['vector_dimension']:
            self.dimension = config.EMBEDDING_CONFIG['vector_dimension']
        else:
            # 自动获取模型维度
            test_embedding = self.model.encode(['test'])
            self.dimension = test_embedding.shape[1]
        
        # 加载或创建向量索引
        if os.path.exists(self.index_path):
            self.index = faiss.read_index(self.index_path)
            with open(self.metadata_path, 'rb') as f:
                self.metadata = pickle.load(f)
        else:
            # 创建新的FAISS索引（使用L2距离）
            self.index = faiss.IndexFlatL2(self.dimension)
            self.metadata = []
    
    def _load_model(self):
        """根据配置加载embedding模型"""
        embedding_config = config.EMBEDDING_CONFIG
        
        if embedding_config['model_type'] == 'local':
            # 使用本地模型
            model_path = embedding_config['local_model_path']
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"本地模型路径不存在: {model_path}")
            print(f"正在加载本地模型: {model_path}")
            self.model = SentenceTransformer(model_path, device=embedding_config['device'])
        else:
            # 使用HuggingFace模型
            model_name = embedding_config['hf_model_name']
            print(f"正在加载HuggingFace模型: {model_name}")
            self.model = SentenceTransformer(model_name, device=embedding_config['device'])
    
    def add_conversation(self, summary, conversation_history):
        """
        将对话总结添加到向量库
        
        Args:
            summary: 对话总结文本
            conversation_history: 原始对话历史
        """
        # 生成向量
        embedding = self.model.encode([summary])[0]
        embedding = embedding.astype('float32')
        
        # 添加到FAISS索引
        self.index.add(np.array([embedding]))
        
        # 保存元数据
        self.metadata.append({
            'summary': summary,
            'conversation': conversation_history,
            'timestamp': datetime.now().isoformat()
        })
        
        # 保存索引和元数据
        self.save()
    
    def get_count(self):
        """获取当前向量总数"""
        return self.index.ntotal
    
    def save(self):
        """保存索引和元数据到磁盘"""
        faiss.write_index(self.index, self.index_path)
        with open(self.metadata_path, 'wb') as f:
            pickle.dump(self.metadata, f)
    
    def search(self, query, k=5):
        """
        搜索相似对话
        
        Args:
            query: 查询文本
            k: 返回最相似的k个结果
        
        Returns:
            list: 相似对话列表
        """
        if self.index.ntotal == 0:
            return []
        
        # 生成查询向量
        query_embedding = self.model.encode([query])[0]
        query_embedding = query_embedding.astype('float32').reshape(1, -1)
        
        # 搜索
        distances, indices = self.index.search(query_embedding, k)
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.metadata):
                results.append({
                    'summary': self.metadata[idx]['summary'],
                    'conversation': self.metadata[idx]['conversation'],
                    'distance': float(distances[0][i])
                })
        
        return results

