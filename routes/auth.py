"""Auth endpoints."""
from main import *  # Shared application, models, and service helpers
import main as m

@app.post("/api/auth/register/request")
def register_request():
    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = normalize_email(data.get("email"))

    if not username:
        return jsonify({
            "error": "Введите имя"
        }), 400

    if len(username) > 80:
        return jsonify({
            "error": "Имя слишком длинное"
        }), 400

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Используйте почту @student.letovo.ru или @letovo.ru"
        }), 400

    existing = User.query.filter_by(email=email).first()

    if existing:
        return jsonify({
            "error": "Этот email уже зарегистрирован. Войдите в аккаунт."
        }), 400

    code = create_code()

    auth_code = AuthCode(
        email=email,
        username=username,
        purpose="register",
        code_hash=generate_password_hash(code),
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=CODE_LIFETIME_MINUTES)
    )

    db.session.add(auth_code)
    db.session.commit()

    try:
        m.send_email_code(email, code, "register")
        AuthCode.query.filter(AuthCode.email == email, AuthCode.purpose == "register", AuthCode.id != auth_code.id).delete(synchronize_session=False)
        db.session.commit()
    except Exception as error:
        app.logger.error("Code delivery failed (%s)", type(error).__name__)
        db.session.delete(auth_code)
        db.session.commit()

        return jsonify({
            "error": "Не удалось отправить письмо. Попробуйте ещё раз."
        }), 500

    return jsonify({
        "message": "Код отправлен на вашу почту"
    })

@app.post("/api/auth/register/verify")
def register_verify():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))
    code = str(data.get("code", "")).strip()

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Некорректная почта"
        }), 400

    if not code.isdigit() or len(code) != 6:
        return jsonify({
            "error": "Введите 6-значный код"
        }), 400

    auth_code = (
        AuthCode.query
        .filter_by(
            email=email,
            purpose="register"
        )
        .order_by(AuthCode.id.desc())
        .first()
    )

    if not auth_code:
        return jsonify({
            "error": "Код не найден. Запросите новый."
        }), 400

    now = datetime.now(timezone.utc)

    if auth_code.expires_at.replace(tzinfo=timezone.utc) < now:
        return jsonify({
            "error": "Код истёк. Запросите новый."
        }), 400

    if not check_password_hash(
        auth_code.code_hash,
        code
    ):
        return jsonify({
            "error": "Неверный код"
        }), 400

    if User.query.filter_by(email=email).first():
        return jsonify({
            "error": "Этот email уже зарегистрирован."
        }), 400

    user = User(
        username=auth_code.username,
        email=email,
        role="user"
    )

    consumed = AuthCode.query.filter_by(id=auth_code.id).delete(synchronize_session=False)
    if not consumed:
        db.session.rollback()
        return jsonify(error="Код уже использован. Запросите новый."), 400
    db.session.add(user)
    db.session.commit()

    session.clear()
    session["user_id"] = user.id

    return jsonify({
        "message": "Регистрация завершена",
        "user": user.to_dict()
    })

@app.post("/api/auth/login/request")
def login_request():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Используйте почту @student.letovo.ru или @letovo.ru"
        }), 400

    user = User.query.filter_by(email=email).first()

    if not user:
        return jsonify({
            "error": "Аккаунт не найден. Сначала зарегистрируйтесь."
        }), 404

    code = create_code()

    auth_code = AuthCode(
        email=email,
        username=user.username,
        purpose="login",
        code_hash=generate_password_hash(code),
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=CODE_LIFETIME_MINUTES)
    )

    db.session.add(auth_code)
    db.session.commit()

    try:
        m.send_email_code(email, code, "login")
        AuthCode.query.filter(AuthCode.email == email, AuthCode.purpose == "login", AuthCode.id != auth_code.id).delete(synchronize_session=False)
        db.session.commit()
    except Exception as error:
        app.logger.error("Code delivery failed (%s)", type(error).__name__)
        db.session.delete(auth_code)
        db.session.commit()

        return jsonify({
            "error": "Не удалось отправить письмо. Попробуйте ещё раз."
        }), 500

    return jsonify({
        "message": "Код отправлен на вашу почту"
    })

@app.post("/api/auth/login/verify")
def login_verify():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))
    code = str(data.get("code", "")).strip()

    auth_code = (
        AuthCode.query
        .filter_by(
            email=email,
            purpose="login"
        )
        .order_by(AuthCode.id.desc())
        .first()
    )

    if not auth_code:
        return jsonify({
            "error": "Код не найден. Запросите новый."
        }), 400

    now = datetime.now(timezone.utc)

    if auth_code.expires_at.replace(tzinfo=timezone.utc) < now:
        return jsonify({
            "error": "Код истёк. Запросите новый."
        }), 400

    if not check_password_hash(
        auth_code.code_hash,
        code
    ):
        return jsonify({
            "error": "Неверный код"
        }), 400

    user = User.query.filter_by(email=email).first()

    if not user:
        return jsonify({
            "error": "Пользователь не найден"
        }), 404

    consumed = AuthCode.query.filter_by(id=auth_code.id).delete(synchronize_session=False)
    if not consumed:
        db.session.rollback()
        return jsonify(error="Код уже использован. Запросите новый."), 400
    db.session.commit()

    session.clear()
    session["user_id"] = user.id

    return jsonify({
        "message": "Вход выполнен",
        "user": user.to_dict()
    })

@app.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "user": None
        })

    user = db.session.get(User, user_id)

    if not user:
        session.clear()

        return jsonify({
            "user": None
        })

    return jsonify({
        "user": user.to_dict()
    })

@app.post("/api/auth/logout")
def logout():
    session.clear()

    return jsonify({
        "message": "Вы вышли из аккаунта"
    })
