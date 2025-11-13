#!/usr/bin/env python3
"""
初始化向量数据库脚本
用于创建空的FAISS索引和元数据文件
"""

import os
import sys
import faiss
import pickle
import config
from vector_store import VectorStore


def init_database(force=False):
    """
    初始化向量数据库
    
    Args:
        force: 如果为True，即使文件已存在也会覆盖
    """
    index_path = config.FAISS_CONFIG['index_path']
    metadata_path = config.FAISS_CONFIG['metadata_path']
    
    # 检查文件是否已存在
    index_exists = os.path.exists(index_path)
    metadata_exists = os.path.exists(metadata_path)
    
    if (index_exists or metadata_exists) and not force:
        print(f"警告：数据库文件已存在！")
        print(f"  - 索引文件: {index_path} {'存在' if index_exists else '不存在'}")
        print(f"  - 元数据文件: {metadata_path} {'存在' if metadata_exists else '不存在'}")
        
        response = input("\n是否要覆盖现有数据库？(yes/no): ").strip().lower()
        if response not in ['yes', 'y']:
            print("操作已取消。")
            return False
    
    try:
        print("\n正在初始化向量数据库...")
        
        # 加载embedding模型以获取向量维度
        print("1. 加载embedding模型...")
        vector_store = VectorStore()
        dimension = vector_store.dimension
        print(f"   ✓ 模型加载成功，向量维度: {dimension}")
        
        # 创建新的FAISS索引
        print("2. 创建FAISS索引...")
        index = faiss.IndexFlatL2(dimension)
        print(f"   ✓ 索引创建成功")
        
        # 创建空的元数据列表
        print("3. 创建元数据文件...")
        metadata = []
        print(f"   ✓ 元数据初始化成功")
        
        # 保存索引和元数据
        print("4. 保存到磁盘...")
        faiss.write_index(index, index_path)
        print(f"   ✓ 索引已保存到: {index_path}")
        
        with open(metadata_path, 'wb') as f:
            pickle.dump(metadata, f)
        print(f"   ✓ 元数据已保存到: {metadata_path}")
        
        # 验证初始化结果
        print("\n5. 验证初始化结果...")
        if os.path.exists(index_path) and os.path.exists(metadata_path):
            # 重新加载验证
            loaded_index = faiss.read_index(index_path)
            with open(metadata_path, 'rb') as f:
                loaded_metadata = pickle.load(f)
            
            print(f"   ✓ 索引向量数量: {loaded_index.ntotal}")
            print(f"   ✓ 元数据条目数: {len(loaded_metadata)}")
            print("\n✅ 数据库初始化成功！")
            return True
        else:
            print("❌ 验证失败：文件未正确创建")
            return False
            
    except FileNotFoundError as e:
        print(f"\n❌ 错误：找不到模型文件")
        print(f"   请检查 config.py 中的模型路径配置")
        print(f"   错误详情: {e}")
        return False
    except Exception as e:
        print(f"\n❌ 初始化失败：{e}")
        import traceback
        traceback.print_exc()
        return False


def show_database_info():
    """显示当前数据库信息"""
    index_path = config.FAISS_CONFIG['index_path']
    metadata_path = config.FAISS_CONFIG['metadata_path']
    
    print("\n当前数据库状态：")
    print(f"  索引文件: {index_path}")
    print(f"  元数据文件: {metadata_path}")
    
    if os.path.exists(index_path) and os.path.exists(metadata_path):
        try:
            index = faiss.read_index(index_path)
            with open(metadata_path, 'rb') as f:
                metadata = pickle.load(f)
            
            print(f"\n  索引向量数量: {index.ntotal}")
            print(f"  元数据条目数: {len(metadata)}")
            
            if len(metadata) > 0:
                print(f"\n  最新条目时间: {metadata[-1].get('timestamp', 'N/A')}")
        except Exception as e:
            print(f"  读取数据库时出错: {e}")
    else:
        print("\n  数据库文件不存在，需要初始化")


def main():
    """主函数"""
    print("=" * 60)
    print("向量数据库初始化工具")
    print("=" * 60)
    
    # 显示当前数据库信息
    show_database_info()
    
    # 解析命令行参数
    force = '--force' in sys.argv or '-f' in sys.argv
    
    if len(sys.argv) > 1 and sys.argv[1] not in ['--force', '-f', '--info', '-i']:
        print(f"\n用法:")
        print(f"  python init_db.py          # 交互式初始化")
        print(f"  python init_db.py --force   # 强制覆盖现有数据库")
        print(f"  python init_db.py --info    # 仅显示数据库信息")
        return
    
    if '--info' in sys.argv or '-i' in sys.argv:
        return
    
    # 执行初始化
    success = init_database(force=force)
    
    if success:
        print("\n" + "=" * 60)
        print("初始化完成！现在可以启动应用了。")
        print("=" * 60)
    else:
        print("\n" + "=" * 60)
        print("初始化失败，请检查错误信息。")
        print("=" * 60)
        sys.exit(1)


if __name__ == '__main__':
    main()

