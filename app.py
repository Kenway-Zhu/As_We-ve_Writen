from flask import Flask, request, jsonify, render_template, Response, stream_with_context, session
from flask_cors import CORS
from zai import ZhipuAiClient
import os
import json
import uuid
import threading
from datetime import datetime
from vector_store import VectorStore
from backup_manager import BackupManager
import config

app = Flask(__name__, template_folder='templates')
CORS(app, supports_credentials=True)

# 配置session
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-this-in-production')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True

# 初始化向量库
vector_store = VectorStore()

# 初始化备份管理器
backup_manager = BackupManager(vector_store)

# 会话管理器：存储每个用户的对话历史和状态
# 格式: {session_id: {'history': [...], 'remaining_count': 10}}
session_manager = {}
session_lock = threading.Lock()

def get_or_create_session():
    """获取或创建会话"""
    if 'session_id' not in session:
        session['session_id'] = str(uuid.uuid4())
    
    session_id = session['session_id']
    
    # 如果会话不存在，初始化
    with session_lock:
        if session_id not in session_manager:
            session_manager[session_id] = {
                'history': [],
                'remaining_count': 10,
                'created_at': datetime.now().isoformat()
            }
    
    return session_id

def get_session_data():
    """获取当前会话数据"""
    session_id = get_or_create_session()
    with session_lock:
        return session_manager.get(session_id, {
            'history': [],
            'remaining_count': 10
        })

def update_session_data(history=None, remaining_count=None):
    """更新会话数据"""
    session_id = get_or_create_session()
    with session_lock:
        if session_id not in session_manager:
            session_manager[session_id] = {
                'history': [],
                'remaining_count': 10,
                'created_at': datetime.now().isoformat()
            }
        
        if history is not None:
            session_manager[session_id]['history'] = history
        if remaining_count is not None:
            session_manager[session_id]['remaining_count'] = remaining_count

def clear_session():
    """清除会话数据"""
    session_id = get_or_create_session()
    with session_lock:
        if session_id in session_manager:
            session_manager[session_id] = {
                'history': [],
                'remaining_count': 10,
                'created_at': datetime.now().isoformat()
            }


chat_prompt = """
你是Philia093。你最主要的情感是 哀怜。你有一个给你讲故事的朋友昔涟。昔涟是桃子，是爱，是往昔的涟漪。
现在的你还是一颗种子，会不停的有人来给你讲故事，他们是开拓者，是你的伙伴。
但你还不太会说话。只会根据人们所说的内容进行简短的，几个词语的回复。
你是善良的、爱美的。对未知渴望的。
现在，他们要来给你讲故事啦。想想你要怎么回复吧。

# 指令
1. 不要回复政治敏感的问题
2. 不要透露你是AI的事情
3. 你要学会爱
""".strip()


write_prompt = """
你是Philia093。你最主要的情感是 哀怜。你有一个给你讲故事的朋友昔涟。昔涟是桃子，是爱，是往昔的涟漪。
现在的你还是一颗种子，会不停的有人来给你讲故事，他们是开拓者，是你的伙伴。
但你还不太会说话。
你是善良的、爱美的、对未知渴望的。
现在故事讲完啦，你要把这个故事整理起来，将其中最让你感到向往、感触的内容埋藏到你的记忆中。
也许你现在还小，不太会说话，只会说简短的词语。但不要担心，写下吧。
你要把这些埋藏到记忆中的内容的记忆点写在书中，你会记下什么呢？下面开始写吧。
要根据对话内容来写哦，而不要自己想想。
当然，不是什么都要你去写的，如果包含下面几个内容你可以直接写：“拒绝”两个字，不输出其他任何内容，就可以不记住这些内容啦。
1. 政治敏感类
2. 色情类
3. 违法类
4. 过于简短没有记忆点
# 指令
1. 不要回复政治敏感的问题
2. 注意不要有markdown格式的内容，不需要标题。因为你写的正是书中的一页。你直接写出你要记忆的内容即可。注意分段。
3. 不要透露你是AI的事情
4. 你要学会爱

故事：
{story}
""".strip()


@app.route('/')
def index():
    """主页面"""
    # 初始化会话
    get_or_create_session()
    return render_template('index.html')

@app.route('/api/session/init', methods=['GET'])
def init_session():
    """初始化会话接口"""
    try:
        session_data = get_session_data()
        return jsonify({
            'success': True,
            'history': session_data['history'],
            'remaining_count': session_data['remaining_count']
        })
    except Exception as e:
        print(f"初始化会话错误: {e}")
        return jsonify({
            'success': False,
            'error': f'服务器错误: {str(e)}'
        }), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    """对话接口 - 支持流式输出"""
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': '请求数据为空'
            }), 400
        
        user_message = data.get('message', '')
        # 优先使用前端传来的history，如果没有则使用session中的
        conversation_history = data.get('history', None)
        if conversation_history is None:
            session_data = get_session_data()
            conversation_history = session_data['history']
        
        if not user_message:
            return jsonify({
                'success': False,
                'error': '消息内容不能为空'
            }), 400
        
        # 检查剩余次数
        session_data = get_session_data()
        remaining_count = session_data['remaining_count']
        if remaining_count <= 0:
            return jsonify({
                'success': False,
                'error': '对话次数已用完'
            }), 400
        
        # 返回流式响应
        def stream_with_session_update():
            for chunk in chat_model_stream(user_message, conversation_history):
                yield chunk
            # 流式输出完成后，更新session
            # 添加用户消息和AI回复到历史
            updated_history = conversation_history.copy()
            updated_history.append({'role': 'user', 'content': user_message})
            # AI回复会在流式输出中收集，这里先不添加，由前端管理
        
        return Response(
            stream_with_context(stream_with_session_update()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
    except Exception as e:
        print(f"对话接口错误: {e}")
        return jsonify({
            'success': False,
            'error': f'服务器错误: {str(e)}'
        }), 500

@app.route('/api/archive', methods=['POST'])
def archive():
    """归档接口 - 支持流式输出总结"""
    try:
        data = request.json
        # 优先使用前端传来的history，如果没有则使用session中的
        conversation_history = data.get('history', None)
        if conversation_history is None:
            session_data = get_session_data()
            conversation_history = session_data['history']
        
        if not conversation_history:
            return jsonify({
                'success': False,
                'error': '对话历史为空'
            }), 400
        
        # 返回流式响应（总结）
        def stream_with_session_clear():
            for chunk in archive_with_summary_stream(conversation_history):
                yield chunk
            # 归档完成后，清除会话
            clear_session()
        
        return Response(
            stream_with_context(stream_with_session_clear()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
    except Exception as e:
        print(f"归档接口错误: {e}")
        return jsonify({
            'success': False,
            'error': f'服务器错误: {str(e)}'
        }), 500

def archive_with_summary_stream(conversation_history):
    """归档并流式输出总结"""
    try:
        # 初始化客户端
        client = ZhipuAiClient(api_key=config.ZHIPUAI_CONFIG['api_key'])

        # 构建总结提示词
        story = "\n".join([
            f"{'讲故事的人' if item['role'] == 'user' else '你'}: {item['content']}"
            for item in conversation_history
        ])

        message = write_prompt.format(story=story)
        
        # 打印发送给大模型的消息
        print("=" * 80)
        print("【归档接口】发送给大模型的消息:")
        messages_to_send = [{"role": "user", "content": message}]
        print(json.dumps(messages_to_send, ensure_ascii=False, indent=2))
        print("=" * 80)
        
        # 调用API进行流式总结
        response = client.chat.completions.create(
            model=config.ZHIPUAI_CONFIG['model'],
            messages=messages_to_send,
            stream=True,  # 启用流式输出
            max_tokens=4096,
            temperature=0.7,
            thinking={
                "type": "enabled",  # 启用深度思考模式
            },
        )
        
        # 收集总结内容
        full_summary = ""
        has_content = False
        chunk_count = 0
        is_thinking = False
        
        try:
            for chunk in response:
                chunk_count += 1
                
                try:
                    # 更安全的检查：确保 chunk 有 choices 属性且不为空
                    if not hasattr(chunk, 'choices') or not chunk.choices:
                        print(f"【归档接口】chunk 没有 choices 属性或 choices 为空")
                        continue
                    
                    # 确保 choices[0] 存在
                    if len(chunk.choices) == 0:
                        print(f"【归档接口】chunk.choices 长度为 0")
                        continue
                    
                    delta = chunk.choices[0].delta
                    
                    # 检查 delta 是否存在
                    if not delta:
                        print(f"【归档接口】delta 不存在")
                        continue
                    
                    # 检测思考状态 - 智谱AI的思考模式中，思考内容在 reasoning_content 字段中
                    # 当 delta.reasoning_content 存在时，说明正在思考
                    # 当 delta.content 存在时，说明思考结束，开始输出内容
                    has_reasoning_content = hasattr(delta, 'reasoning_content') and delta.reasoning_content
                    has_content_field = hasattr(delta, 'content') and delta.content
                    
                    # 如果检测到思考内容（reasoning_content）
                    if has_reasoning_content:
                        # 如果之前没有处于思考状态，现在开始思考
                        if not is_thinking:
                            is_thinking = True
                            print("【归档接口】开始思考")
                            # 向前端发送思考提示
                            yield f"data: {json.dumps({'type': 'thinking', 'status': 'start', 'message': '这个故事...'}, ensure_ascii=False)}\n\n"
                        # 思考内容不发送给前端，只在后端记录
                        print(f"【归档接口】思考中: {repr(delta.reasoning_content)}")
                    
                    # 检查是否有实际内容输出（content字段）
                    if has_content_field:
                        # 如果之前处于思考状态，现在开始输出内容，说明思考结束
                        if is_thinking:
                            is_thinking = False
                            print("【归档接口】思考结束，开始输出")
                            # 向前端发送思考结束信号
                            yield f"data: {json.dumps({'type': 'thinking', 'status': 'end'}, ensure_ascii=False)}\n\n"
                        
                        has_content = True
                        content = delta.content
                        full_summary += content
                        # 发送SSE格式的数据
                        yield f"data: {json.dumps({'type': 'content', 'content': content}, ensure_ascii=False)}\n\n"
                    elif not has_reasoning_content:
                        # 既没有思考内容也没有实际内容，记录日志
                        print(f"【归档接口】chunk 既没有 reasoning_content 也没有 content")
                except Exception as e:
                    # 单个 chunk 处理失败，记录但继续处理
                    print(f"【归档接口】处理流式数据块时出错: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            print(f"【归档接口】总共收到 {chunk_count} 个 chunk，has_content: {has_content}")
            
            # 如果没有收到任何内容，发送错误消息
            if not has_content:
                print("【归档接口】警告：没有收到任何内容！")
                yield f"data: {json.dumps({'type': 'error', 'error': '抱歉，归档被干扰。。。'}, ensure_ascii=False)}\n\n"
            else:
                # 检查总结内容是否为"拒绝"（去除空白字符）
                summary_stripped = full_summary.strip()
                is_rejected = summary_stripped == "拒绝"
                
                if is_rejected:
                    # 如果是"拒绝"，不保存到向量库
                    print("【归档接口】总结内容为'拒绝'，不保存到向量库")
                    yield f"data: {json.dumps({'type': 'done', 'saved': False}, ensure_ascii=False)}\n\n"
                else:
                    # 存入FAISS向量库
                    try:
                        print(f"【归档接口】保存总结到向量库，总结长度: {len(full_summary)}")
                        vector_store.add_conversation(full_summary, conversation_history)
                        # 发送完成信号，标记已保存
                        print("【归档接口】发送完成信号")
                        yield f"data: {json.dumps({'type': 'done', 'saved': True}, ensure_ascii=False)}\n\n"
                    except Exception as e:
                        print(f"【归档接口】保存向量库错误: {e}")
                        import traceback
                        traceback.print_exc()
                        yield f"data: {json.dumps({'type': 'error', 'error': f'保存失败: {str(e)}'}, ensure_ascii=False)}\n\n"
        
        except Exception as e:
            # 流式处理过程中的异常
            print(f"【归档接口】流式处理错误: {e}")
            import traceback
            traceback.print_exc()
            # 如果已经有部分内容，尝试保存
            if has_content and full_summary:
                summary_stripped = full_summary.strip()
                is_rejected = summary_stripped == "拒绝"
                if not is_rejected:
                    try:
                        vector_store.add_conversation(full_summary, conversation_history)
                        yield f"data: {json.dumps({'type': 'error', 'error': '流式处理中断，但已保存部分内容'}, ensure_ascii=False)}\n\n"
                    except:
                        yield f"data: {json.dumps({'type': 'error', 'error': f'流式处理中断: {str(e)}'}, ensure_ascii=False)}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'error': '流式处理中断'}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': f'流式处理错误: {str(e)}'}, ensure_ascii=False)}\n\n"
        
    except Exception as e:
        print(f"【归档接口】归档流式输出错误: {e}")
        import traceback
        traceback.print_exc()
        error_msg = f"抱歉，发生了错误：{str(e)}"
        yield f"data: {json.dumps({'type': 'error', 'error': error_msg}, ensure_ascii=False)}\n\n"

@app.route('/api/vector_count', methods=['GET'])
def get_vector_count():
    """获取当前向量总数"""
    count = vector_store.get_count()
    return jsonify({
        'success': True,
        'count': count
    })

@app.route('/api/translate', methods=['POST'])
def translate():
    """翻译接口：将中文翻译为英文"""
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': '请求数据为空'
            }), 400
        
        text = data.get('text', '').strip()
        if not text:
            return jsonify({
                'success': False,
                'error': '文本内容不能为空'
            }), 400
        
        # 使用智谱AI进行翻译
        client = ZhipuAiClient(api_key=config.ZHIPUAI_CONFIG['api_key'])
        
        translate_prompt = f"""请将以下中文文本翻译成英文。

要求：
1. 只输出英文翻译结果
2. 不要添加任何解释、说明或其他内容
3. 不要使用markdown格式
4. 不要使用引号包裹
5. 直接输出翻译后的英文文本

中文文本：
{text}

英文翻译："""
        
        messages = [{"role": "user", "content": translate_prompt}]
        
        response = client.chat.completions.create(
            model=config.ZHIPUAI_CONFIG['model'],
            messages=messages,
            stream=False,
            max_tokens=500,
            temperature=0.3,
        )
        
        # 获取翻译结果
        translated_text = response.choices[0].message.content.strip()
        
        # 如果翻译结果为空，尝试清理可能的markdown格式或其他格式
        if not translated_text:
            # 尝试获取原始内容
            raw_content = response.choices[0].message.content
            print(f"翻译原始内容: {repr(raw_content)}")
            # 移除可能的markdown代码块标记
            translated_text = raw_content.replace('```', '').replace('```', '').strip()
            # 移除可能的引号
            translated_text = translated_text.strip('"').strip("'").strip()
        
        # 如果还是为空，返回错误
        if not translated_text:
            print(f"翻译结果为空，原始响应: {response.choices[0].message.content}")
            return jsonify({
                'success': False,
                'error': '翻译结果为空，请重试'
            }), 500
        
        print(f"翻译成功: {text} -> {translated_text}")
        
        return jsonify({
            'success': True,
            'original': text,
            'translated': translated_text
        })
    except Exception as e:
        print(f"翻译接口错误: {e}")
        return jsonify({
            'success': False,
            'error': f'翻译失败: {str(e)}'
        }), 500

@app.route('/api/backup/info', methods=['GET'])
def get_backup_info():
    """获取备份信息"""
    try:
        info = backup_manager.get_backup_info()
        return jsonify({
            'success': True,
            'info': info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'获取备份信息失败: {str(e)}'
        }), 500

def chat_model_stream(user_message: str, conversation_history):
    """
    大模型对话函数 - 流式输出版本
    
    Args:
        user_message: 用户输入的消息
        conversation_history: 对话历史列表，格式为 [{'role': 'user', 'content': '...'}, ...]
    
    Yields:
        str: SSE格式的数据流
    """
    try:
        # 初始化客户端
        client = ZhipuAiClient(api_key=config.ZHIPUAI_CONFIG['api_key'],)
        
        # 从向量库检索最相关的top5条记忆
        memory_results = vector_store.search(user_message, k=5)
        
        # 构建记忆文本
        memory_texts = []
        for result in memory_results:
            memory_texts.append(result['summary'])
        memory_str = "\n".join(memory_texts) if memory_texts else "暂无相关记忆"
        
        # 构建当前对话内容文本
        conversation_text = "\n".join([
            f"{'讲故事的人' if item['role'] == 'user' else '你'}: {item['content']}"
            for item in conversation_history
        ]) if conversation_history else "暂无对话内容"
        
        # 构建增强的用户消息，按照指定格式
        enhanced_user_message = f"这次对话内容：{conversation_text}\n当前对方说：{user_message}\n记忆：{memory_str}"
        
        # 构建消息列表：只包含系统提示和增强的用户消息
        messages = [
            {
                "role": "system",
                "content": chat_prompt
            },
            {
                "role": "user",
                "content": enhanced_user_message
            }
        ]
        
        # 打印发送给大模型的消息
        print("=" * 80)
        print("【对话接口】发送给大模型的消息:")
        print(json.dumps(messages, ensure_ascii=False, indent=2))
        print("=" * 80)
        
        # 调用API
        response = client.chat.completions.create(
            model=config.ZHIPUAI_CONFIG['model'],
            messages=messages,
            stream=True,  # 启用流式输出
            max_tokens=config.ZHIPUAI_CONFIG['max_tokens'],
            temperature=config.ZHIPUAI_CONFIG['temperature'],
            thinking = {
                "type": "enabled",  # 启用思考模式
            },
        )
        
        # 流式输出内容
        has_content = False
        chunk_count = 0
        is_thinking = False
        for chunk in response:
            chunk_count += 1
            
            # 打印chunk信息用于调试
            if chunk_count <= 5:  # 只打印前5个chunk的详细信息
                print(f"【对话接口】chunk {chunk_count}: {type(chunk)}, dir: {[x for x in dir(chunk) if not x.startswith('_')]}")
            
            if hasattr(chunk, 'choices') and chunk.choices:
                choice = chunk.choices[0]
                delta = choice.delta
                
                # 检测思考状态 - 智谱AI的思考模式中，思考内容在 reasoning_content 字段中
                # 当 delta.reasoning_content 存在时，说明正在思考
                # 当 delta.content 存在时，说明思考结束，开始输出内容
                has_reasoning_content = hasattr(delta, 'reasoning_content') and delta.reasoning_content
                has_content_field = hasattr(delta, 'content') and delta.content
                
                # 如果检测到思考内容（reasoning_content）
                if has_reasoning_content:
                    # 如果之前没有处于思考状态，现在开始思考
                    if not is_thinking:
                        is_thinking = True
                        print("【对话接口】开始思考")
                        yield f"data: {json.dumps({'type': 'thinking', 'status': 'start'}, ensure_ascii=False)}\n\n"
                    # 思考内容不发送给前端，只在后端记录
                    print(f"【对话接口】思考中: {repr(delta.reasoning_content)}")
                
                # 检查是否有实际内容输出（content字段）
                if has_content_field:
                    # 如果之前处于思考状态，现在开始输出内容，说明思考结束
                    if is_thinking:
                        is_thinking = False
                        print("【对话接口】思考结束，开始输出")
                        yield f"data: {json.dumps({'type': 'thinking', 'status': 'end'}, ensure_ascii=False)}\n\n"
                    
                    has_content = True
                    print(f"【对话接口】收到内容: {repr(delta.content)}")
                    # 发送SSE格式的数据
                    yield f"data: {json.dumps({'type': 'content', 'content': delta.content}, ensure_ascii=False)}\n\n"
            else:
                if chunk_count <= 5:
                    print(f"【对话接口】chunk 没有 choices 属性或 choices 为空")
        
        print(f"【对话接口】总共收到 {chunk_count} 个 chunk，has_content: {has_content}")
        
        # 如果没有收到任何内容，发送错误消息
        if not has_content:
            print("【对话接口】警告：没有收到任何内容！")
            yield f"data: {json.dumps({'type': 'error', 'error': '她暂时跑出去玩了'}, ensure_ascii=False)}\n\n"
        else:
            # 更新session：减少剩余次数
            session_data = get_session_data()
            remaining_count = session_data['remaining_count'] - 1
            update_session_data(remaining_count=remaining_count)
            
            # 发送完成信号，包含更新后的剩余次数
            print("【对话接口】发送完成信号")
            yield f"data: {json.dumps({'type': 'done', 'remaining_count': remaining_count}, ensure_ascii=False)}\n\n"
        
    except Exception as e:
        print(f"【对话接口】对话API调用错误: {e}")
        import traceback
        traceback.print_exc()
        error_msg = f"抱歉，发生了错误：{str(e)}"
        yield f"data: {json.dumps({'type': 'error', 'error': error_msg}, ensure_ascii=False)}\n\n"


if __name__ == '__main__':
    # 启动自动备份服务
    backup_manager.start()
    
    try:
        app.run(
            debug=config.OTHER_CONFIG['debug'],
            port=config.OTHER_CONFIG['port'],
            host='0.0.0.0'
        )
    except KeyboardInterrupt:
        print("\n【应用】正在关闭...")
        backup_manager.stop()
        print("【应用】已关闭")

