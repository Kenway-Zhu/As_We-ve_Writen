"""
向量库备份管理模块
实现自动备份和清理功能
"""

import os
import shutil
import threading
from datetime import datetime, timedelta


class BackupManager:
    def __init__(self, vector_store):
        """
        初始化备份管理器
        
        Args:
            vector_store: VectorStore实例
        """
        self.vector_store = vector_store
        self.backup_dir = 'backups'
        self.backup_interval_hours = 3  # 每3小时备份一次
        self.retention_days = 5  # 保留5天的备份
        self.running = False
        self.timer = None
        self.lock = threading.Lock()
        
        # 创建备份目录
        if not os.path.exists(self.backup_dir):
            os.makedirs(self.backup_dir)
            print(f"【备份管理器】创建备份目录: {self.backup_dir}")
    
    def backup(self):
        """
        执行备份操作
        """
        try:
            with self.lock:
                index_path = self.vector_store.index_path
                metadata_path = self.vector_store.metadata_path
                
                # 检查文件是否存在
                if not os.path.exists(index_path) or not os.path.exists(metadata_path):
                    print("【备份管理器】警告：向量库文件不存在，跳过备份")
                    return False
                
                # 生成备份文件名（带时间戳）
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_index_path = os.path.join(
                    self.backup_dir, 
                    f'vector_index_{timestamp}.faiss'
                )
                backup_metadata_path = os.path.join(
                    self.backup_dir, 
                    f'vector_metadata_{timestamp}.pkl'
                )
                
                # 复制文件
                shutil.copy2(index_path, backup_index_path)
                shutil.copy2(metadata_path, backup_metadata_path)
                
                print(f"【备份管理器】备份完成: {timestamp}")
                print(f"  - 索引文件: {backup_index_path}")
                print(f"  - 元数据文件: {backup_metadata_path}")
                
                return True
                
        except Exception as e:
            print(f"【备份管理器】备份失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def cleanup_old_backups(self):
        """
        清理超过保留期的备份文件
        """
        try:
            with self.lock:
                if not os.path.exists(self.backup_dir):
                    return
                
                cutoff_time = datetime.now() - timedelta(days=self.retention_days)
                deleted_count = 0
                
                # 遍历备份目录
                for filename in os.listdir(self.backup_dir):
                    file_path = os.path.join(self.backup_dir, filename)
                    
                    # 只处理备份文件
                    if not (filename.startswith('vector_index_') or 
                           filename.startswith('vector_metadata_')):
                        continue
                    
                    # 获取文件修改时间
                    file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                    
                    # 如果文件超过保留期，删除
                    if file_mtime < cutoff_time:
                        try:
                            os.remove(file_path)
                            deleted_count += 1
                            print(f"【备份管理器】删除过期备份: {filename}")
                        except Exception as e:
                            print(f"【备份管理器】删除文件失败 {filename}: {e}")
                
                if deleted_count > 0:
                    print(f"【备份管理器】清理完成，删除了 {deleted_count} 个过期备份文件")
                else:
                    print(f"【备份管理器】没有需要清理的过期备份")
                    
        except Exception as e:
            print(f"【备份管理器】清理失败: {e}")
            import traceback
            traceback.print_exc()
    
    def backup_and_cleanup(self):
        """
        执行备份并清理过期文件
        """
        print(f"\n【备份管理器】开始执行备份任务 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.backup()
        self.cleanup_old_backups()
        print(f"【备份管理器】备份任务完成\n")
        
        # 如果还在运行，安排下一次备份
        if self.running:
            self.schedule_next_backup()
    
    def schedule_next_backup(self):
        """
        安排下一次备份
        """
        if not self.running:
            return
        
        # 计算下次备份时间（3小时后）
        interval_seconds = self.backup_interval_hours * 3600
        next_backup_time = datetime.now() + timedelta(seconds=interval_seconds)
        
        print(f"【备份管理器】下次备份时间: {next_backup_time.strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 使用Timer安排下一次备份
        self.timer = threading.Timer(interval_seconds, self.backup_and_cleanup)
        self.timer.daemon = True  # 设置为守护线程
        self.timer.start()
    
    def start(self):
        """
        启动自动备份
        """
        if self.running:
            print("【备份管理器】备份任务已在运行")
            return
        
        self.running = True
        print(f"【备份管理器】启动自动备份服务")
        print(f"  - 备份间隔: {self.backup_interval_hours} 小时")
        print(f"  - 保留期限: {self.retention_days} 天")
        
        # 立即执行一次备份和清理
        self.backup_and_cleanup()
    
    def stop(self):
        """
        停止自动备份
        """
        self.running = False
        if self.timer:
            self.timer.cancel()
        print("【备份管理器】已停止自动备份服务")
    
    def get_backup_info(self):
        """
        获取备份信息
        
        Returns:
            dict: 备份统计信息
        """
        try:
            if not os.path.exists(self.backup_dir):
                return {
                    'backup_count': 0,
                    'oldest_backup': None,
                    'newest_backup': None,
                    'total_size': 0
                }
            
            backups = []
            total_size = 0
            
            for filename in os.listdir(self.backup_dir):
                if filename.startswith('vector_index_'):
                    file_path = os.path.join(self.backup_dir, filename)
                    file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                    file_size = os.path.getsize(file_path)
                    backups.append({
                        'filename': filename,
                        'time': file_mtime,
                        'size': file_size
                    })
                    total_size += file_size
            
            if not backups:
                return {
                    'backup_count': 0,
                    'oldest_backup': None,
                    'newest_backup': None,
                    'total_size': 0
                }
            
            backups.sort(key=lambda x: x['time'])
            
            return {
                'backup_count': len(backups),
                'oldest_backup': backups[0]['time'].isoformat(),
                'newest_backup': backups[-1]['time'].isoformat(),
                'total_size': total_size
            }
        except Exception as e:
            print(f"【备份管理器】获取备份信息失败: {e}")
            return {
                'backup_count': 0,
                'oldest_backup': None,
                'newest_backup': None,
                'total_size': 0
            }

