import os
import sqlite3
import requests
from flask import Flask, render_template_string, request, redirect, url_for, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = "z_ai_super_secret_key_hzgshf"

# ----------------------------------------------------
# إعدادات التوكن والنموذج (Hugging Face)
# ----------------------------------------------------
HF_API_TOKEN = "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"
MODEL_URL = "https://api-inference.huggingface.co/models/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated"

# ----------------------------------------------------
# إعداد مسار قاعدة البيانات الثابت تلقائياً
# ----------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            is_admin INTEGER DEFAULT 0
        )
    ''')
    # إنشاء حساب الأدمن الافتراضي
    admin = c.execute("SELECT * FROM users WHERE username='admin'").fetchone()
    if not admin:
        c.execute(
            "INSERT INTO users (username, password, is_active, is_admin) VALUES (?, ?, 1, 1)",
            ('admin', generate_password_hash('admin123'))
        )
    conn.commit()
    conn.close()

# تشغيل التهيئة للـ DB
init_db()

# ----------------------------------------------------
# التصميم والواجهة (HTML + CSS + JS)
# ----------------------------------------------------
BASE_STYLE = """
<style>
    :root {
        --bg-dark: #090a0f;
        --panel-bg: #111319;
        --accent-gold: #d4af37;
        --accent-green: #10b981;
        --text-color: #e2e8f0;
        --bubble-user: #1a2233;
        --bubble-ai: #161922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text-color); height: 100vh; overflow: hidden; }
    .auth-container { display: flex; justify-content: center; align-items: center; height: 100vh; }
    .auth-card { background: var(--panel-bg); padding: 40px; border-radius: 12px; border: 1px solid rgba(212, 175, 55, 0.3); width: 360px; text-align: center; box-shadow: 0 0 20px rgba(0,0,0,0.8); }
    .auth-card h2 { color: var(--accent-gold); margin-bottom: 20px; font-size: 28px; }
    .auth-card input { width: 100%; padding: 12px; margin: 10px 0; background: #1a1d26; border: 1px solid #333; color: white; border-radius: 6px; }
    .auth-card button { width: 100%; padding: 12px; background: var(--accent-gold); border: none; color: black; font-weight: bold; border-radius: 6px; cursor: pointer; margin-top: 10px; }
    .auth-card a { color: #888; text-decoration: none; font-size: 14px; display: block; margin-top: 15px; }
    
    .app-layout { display: flex; height: 100vh; }
    .sidebar { width: 260px; background: var(--panel-bg); border-right: 1px solid #1e222d; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; }
    .main-chat { flex: 1; display: flex; flex-direction: column; background: var(--bg-dark); position: relative; }
    
    .logo { font-size: 32px; font-weight: bold; color: var(--accent-gold); margin-bottom: 30px; text-shadow: 0 0 10px rgba(212,175,55,0.4); }
    .new-chat-btn { background: #1a231e; border: 1px solid var(--accent-green); color: var(--accent-green); padding: 10px; border-radius: 8px; width: 100%; cursor: pointer; text-align: left; }
    
    .user-profile { background: #161922; padding: 12px; border-radius: 8px; border: 1px solid #262a36; display: flex; align-items: center; justify-content: space-between; }
    .user-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--accent-green); color: black; font-weight: bold; }
    .user-badge.inactive { background: #ef4444; color: white; }

    .chat-messages { flex: 1; overflow-y: auto; padding: 30px; display: flex; flex-direction: column; gap: 20px; }
    .message { display: flex; gap: 15px; max-width: 80%; }
    .message.user { align-self: flex-end; flex-direction: row-reverse; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--accent-gold); color: black; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .bubble { background: var(--bubble-ai); padding: 15px 20px; border-radius: 12px; border: 1px solid #222735; line-height: 1.6; white-space: pre-wrap; }
    .message.user .bubble { background: var(--bubble-user); border-color: #2b354d; }

    .chat-input-area { padding: 20px 40px; }
    .input-wrapper { background: #111318; border: 1px solid var(--accent-gold); border-radius: 12px; display: flex; padding: 10px 15px; align-items: center; box-shadow: 0 0 15px rgba(212,175,55,0.1); }
    .input-wrapper input { flex: 1; background: transparent; border: none; color: white; outline: none; padding: 10px; font-size: 16px; }
    .send-btn { background: var(--accent-gold); border: none; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-weight: bold; }

    .admin-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    .admin-table th, .admin-table td { padding: 12px; border: 1px solid #222; text-align: left; }
    .admin-table th { background: #161922; color: var(--accent-gold); }
    .btn-toggle { padding: 6px 12px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 12px; }
    .btn-activate { background: var(--accent-green); color: black; }
    .btn-deactivate { background: #ef4444; color: white; }
</style>
"""

LOGIN_HTML = BASE_STYLE + """
<div class="auth-container">
    <div class="auth-card">
        <h2>Z AI LOGIN</h2>
        {% if error %}<p style="color:#ef4444; margin-bottom:10px;">{{ error }}</p>{% endif %}
        <form method="POST">
            <input type="text" name="username" placeholder="اسم المستخدم" required>
            <input type="password" name="password" placeholder="كلمة المرور" required>
            <button type="submit">تسجيل الدخول</button>
        </form>
        <a href="/register">ليس لديك حساب؟ اشترك الآن</a>
    </div>
</div>
"""

REGISTER_HTML = BASE_STYLE + """
<div class="auth-container">
    <div class="auth-card">
        <h2>حساب جديد</h2>
        <form method="POST">
            <input type="text" name="username" placeholder="اختر اسم مستخدم" required>
            <input type="password" name="password" placeholder="اختر كلمة مرور" required>
            <button type="submit">إنشاء الحساب</button>
        </form>
        <a href="/login">لديك حساب بالفعل؟ سجل دخولك</a>
    </div>
</div>
"""

CHAT_HTML = BASE_STYLE + """
<div class="app-layout">
    <div class="sidebar">
        <div>
            <div class="logo">Z</div>
            <button class="new-chat-btn">+ محادثة جديدة</button>
        </div>
        <div>
            {% if is_admin %}
            <a href="/admin" style="color:var(--accent-gold); text-decoration:none; display:block; margin-bottom:15px; font-weight:bold;">⚙️ لوحة الأدمن</a>
            {% endif %}
            <div class="user-profile">
                <div>
                    <strong>{{ username }}</strong><br>
                    {% if is_active %}
                        <span class="user-badge">Pro Plan ✔</span>
                    {% else %}
                        <span class="user-badge inactive">غير مفعل ✖</span>
                    {% endif %}
                </div>
                <a href="/logout" style="color:#ef4444; text-decoration:none; font-size:12px;">خروج</a>
            </div>
        </div>
    </div>
    
    <div class="main-chat">
        <div class="chat-messages" id="chatBox">
            <div class="message">
                <div class="avatar">Z</div>
                <div class="bubble">مرحباً بك! أنا Z AI المعتمد على Meta Llama 3.1 Abliterated. كيف يمكنني مساعدتك اليوم؟</div>
            </div>
            {% if not is_active %}
            <div class="message">
                <div class="avatar" style="background:#ef4444; color:white;">!</div>
                <div class="bubble" style="border-color:#ef4444;">
                    <strong>تنبيه:</strong> حسابك غير مفعل حالياً. يرجى التواصل مع الإدارة لرفع التفعيل وتفعيل اشتراكك.
                </div>
            </div>
            {% endif %}
        </div>
        
        <div class="chat-input-area">
            <div class="input-wrapper">
                <input type="text" id="userInput" placeholder="اكتب رسالتك هنا..." {% if not is_active %}disabled style="opacity:0.5;"{% endif %}>
                <button class="send-btn" onclick="sendMessage()" {% if not is_active %}disabled style="opacity:0.5;"{% endif %}>⚡</button>
            </div>
            <p style="font-size:11px; color:#555; text-align:center; margin-top:8px;">Z AI Assistant can make mistakes. Consider checking important information.</p>
        </div>
    </div>
</div>

<script>
async function sendMessage() {
    const input = document.getElementById('userInput');
    const text = input.value.trim();
    if (!text) return;

    const chatBox = document.getElementById('chatBox');
    
    chatBox.innerHTML += `
        <div class="message user">
            <div class="avatar" style="background:#fff;">U</div>
            <div class="bubble">${text}</div>
        </div>
    `;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    const loadingId = 'loading-' + Date.now();
    chatBox.innerHTML += `
        <div class="message" id="${loadingId}">
            <div class="avatar">Z</div>
            <div class="bubble">جاري التفكير...</div>
        </div>
    `;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt: text})
        });
        const data = await response.json();
        
        document.getElementById(loadingId).remove();
        
        chatBox.innerHTML += `
            <div class="message">
                <div class="avatar">Z</div>
                <div class="bubble">${data.response}</div>
            </div>
        `;
    } catch (e) {
        document.getElementById(loadingId).remove();
        chatBox.innerHTML += `
            <div class="message">
                <div class="avatar" style="background:red; color:white;">!</div>
                <div class="bubble">حدث خطأ أثناء التواصل مع النموذج.</div>
            </div>
        `;
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

document.getElementById('userInput')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendMessage();
});
</script>
"""

ADMIN_HTML = BASE_STYLE + """
<div style="padding: 40px; max-width: 1000px; margin: 0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2 style="color:var(--accent-gold)">⚙️ لوحة تحكم الأدمن</h2>
        <a href="/" style="color:white; text-decoration:none; background:#222; padding:8px 15px; border-radius:6px;">العودة للدردشة</a>
    </div>
    <hr style="border-color:#222; margin:20px 0;">
    
    <h3>إدارة المشتركين</h3>
    <table class="admin-table">
        <thead>
            <tr>
                <th>ID</th>
                <th>اسم المستخدم</th>
                <th>الحالة</th>
                <th>الرتبة</th>
                <th>التحكم بالاشتراك</th>
            </tr>
        </thead>
        <tbody>
            {% for u in users %}
            <tr>
                <td>{{ u.id }}</td>
                <td>{{ u.username }}</td>
                <td>
                    {% if u.is_active %}
                        <span style="color:var(--accent-green)">مفعل ✔</span>
                    {% else %}
                        <span style="color:#ef4444">معطل ✖</span>
                    {% endif %}
                </td>
                <td>{{ 'أدمن' if u.is_admin else 'مشترك' }}</td>
                <td>
                    {% if not u.is_admin %}
                        {% if u.is_active %}
                            <a href="/admin/toggle/{{ u.id }}" class="btn-toggle btn-deactivate">إيقاف الاشتراك</a>
                        {% else %}
                            <a href="/admin/toggle/{{ u.id }}" class="btn-toggle btn-activate">تفعيل الاشتراك</a>
                        {% endif %}
                    {% else %}
                        -
                    {% endif %}
                </td>
            </tr>
            {% endfor %}
        </tbody>
    </table>
</div>
"""

# ----------------------------------------------------
# المسارات (Routes)
# ----------------------------------------------------
@app.route('/')
def home():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template_string(
        CHAT_HTML, 
        username=session['username'], 
        is_active=session.get('is_active', 0),
        is_admin=session.get('is_admin', 0)
    )

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        conn = get_db()
        user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        conn.close()
        
        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['is_active'] = user['is_active']
            session['is_admin'] = user['is_admin']
            return redirect(url_for('home'))
        else:
            error = "اسم المستخدم أو كلمة المرور غير صحيحة"
            
    return render_template_string(LOGIN_HTML, error=error)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = generate_password_hash(request.form['password'])
        
        conn = get_db()
        try:
            conn.execute("INSERT INTO users (username, password, is_active) VALUES (?, ?, 0)", (username, password))
            conn.commit()
            conn.close()
            return redirect(url_for('login'))
        except sqlite3.IntegrityError:
            conn.close()
            return "اسم المستخدم مستخدم بالفعل!"
            
    return render_template_string(REGISTER_HTML)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/api/chat', methods=['POST'])
def api_chat():
    if 'user_id' not in session:
        return jsonify({'response': 'غير مصرح لك'}), 403
    
    conn = get_db()
    user = conn.execute("SELECT is_active FROM users WHERE id = ?", (session['user_id'],)).fetchone()
    conn.close()
    
    if not user or user['is_active'] == 0:
        return jsonify({'response': 'عفواً، اشتراكك معطل. يرجى التواصل مع الإدارة لتجديد الاشتراك.'}), 403

    prompt = request.json.get('prompt', '')
    
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    payload = {
        "inputs": f"<|system|>\nYou are a helpful AI assistant.<|user|>\n{prompt}<|assistant|>\n",
        "parameters": {"max_new_tokens": 500, "temperature": 0.7}
    }
    
    try:
        # الاتصال مباشرة بـ Hugging Face بدون بروكسي
        res = requests.post(MODEL_URL, headers=headers, json=payload, timeout=30)
        if res.status_code == 200:
            result = res.json()
            if isinstance(result, list) and len(result) > 0 and 'generated_text' in result[0]:
                text = result[0]['generated_text'].split("<|assistant|>\n")[-1]
                return jsonify({'response': text.strip()})
            elif isinstance(result, dict) and 'error' in result:
                return jsonify({'response': f"تنبيه من النموذج: {result['error']}"})
            return jsonify({'response': str(result)})
        else:
            return jsonify({'response': f'خطأ من الاستضافة ({res.status_code}): {res.text}'})
    except Exception as e:
        return jsonify({'response': f'تعذر الاتصال بالنموذج: {str(e)}'})

@app.route('/admin')
def admin():
    if 'user_id' not in session or not session.get('is_admin'):
        return "غير مسموح لك بالدخول، هذه الصفحة للأدمن فقط.", 403
    
    conn = get_db()
    users = conn.execute("SELECT id, username, is_active, is_admin FROM users").fetchall()
    conn.close()
    
    return render_template_string(ADMIN_HTML, users=users)

@app.route('/admin/toggle/<int:user_id>')
def admin_toggle(user_id):
    if 'user_id' not in session or not session.get('is_admin'):
        return "غير مسموح", 403
        
    conn = get_db()
    conn.execute("UPDATE users SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    
    return redirect(url_for('admin'))

if __name__ == '__main__':
    # القراءة التلقائية للمنفذ المحدد من قبل السيرفر
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
