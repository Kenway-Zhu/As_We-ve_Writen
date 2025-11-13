from flask import Flask, request, jsonify, render_template, Response, stream_with_context
from flask_cors import CORS
from zai import ZhipuAiClient
import os
import json
from datetime import datetime
from vector_store import VectorStore
import config

app = Flask(__name__, template_folder='templates')
CORS(app)

# 初始化向量库
vector_store = VectorStore()


chat_prompt = """
你叫昔涟，是往昔的涟漪。现在的你还是一颗种子，会有人来给你讲故事。但你还不太会说话。只会根据人们所说的内容进行简短的，几个词语的回复。
你是善良的、爱美的。对未知渴望的。
现在，他们要来给你讲故事啦。想想你要怎么回复吧。

# 指令
1. 不要回复政治敏感的问题
2. 不要透露你是AI的事情
3. 你要学会爱
""".strip()


write_prompt = """
你叫昔涟，是往昔的涟漪。现在的你还是一颗种子，会有人来给你讲故事。但你还不太会说话。
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
    return render_template('index.html')

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
        conversation_history = data.get('history', [])
        
        if not user_message:
            return jsonify({
                'success': False,
                'error': '消息内容不能为空'
            }), 400
        
        # 返回流式响应
        return Response(
            stream_with_context(chat_model_stream(user_message, conversation_history)),
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
        conversation_history = data.get('history', [])
        
        if not conversation_history:
            return jsonify({
                'success': False,
                'error': '对话历史为空'
            }), 400
        
        # 返回流式响应（总结）
        return Response(
            stream_with_context(archive_with_summary_stream(conversation_history)),
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
            max_tokens=500,
            temperature=0.7,
            thinking={
                "type": "enabled",  # 启用深度思考模式
            },
        )
        
        # 收集总结内容
        full_summary = ""
        has_content = False
        chunk_count = 0
        
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
                    
                    # 检查 delta 是否存在且有 content 属性
                    if not delta or not hasattr(delta, 'content'):
                        print(f"【归档接口】delta 不存在或没有 content 属性")
                        continue
                    
                    content = delta.content
                    if content:
                        has_content = True
                        full_summary += content
                        # 发送SSE格式的数据
                        yield f"data: {json.dumps({'type': 'content', 'content': content}, ensure_ascii=False)}\n\n"
                    else:
                        print(f"【归档接口】content 为空")
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
            # 发送完成信号
            print("【对话接口】发送完成信号")
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
        
    except Exception as e:
        print(f"【对话接口】对话API调用错误: {e}")
        import traceback
        traceback.print_exc()
        error_msg = f"抱歉，发生了错误：{str(e)}"
        yield f"data: {json.dumps({'type': 'error', 'error': error_msg}, ensure_ascii=False)}\n\n"


if __name__ == '__main__':
    app.run(
        debug=config.OTHER_CONFIG['debug'],
        port=config.OTHER_CONFIG['port'],
        host='0.0.0.0'
    )

