from flask import Flask, jsonify, render_template, request, session, g
from extensions import db
from werkzeug.security import generate_password_hash, check_password_hash
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
import json
import smtplib
import math
import secrets
import os
import uuid
import re
from PIL import Image, UnidentifiedImageError
from flask import send_from_directory, send_file
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from werkzeug.exceptions import HTTPException
from urllib.parse import urlsplit
import io
import qrcode
from PIL import ImageOps
from database_storage import resolve_storage

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(4.25 * 1024 * 1024)

app.config["SECRET_KEY"] = os.environ.get(
    "SECRET_KEY",
    secrets.token_hex(32)
)

if not app.config["SECRET_KEY"]:
    raise RuntimeError("SECRET_KEY is not configured")

# Secure environment check
database_url = os.environ.get('DATABASE_URL')

database_uri, persistent_data_dir = resolve_storage(database_url, app.instance_path)
app.config['SQLALCHEMY_DATABASE_URI'] = database_uri
if persistent_data_dir is not None:
    app.logger.warning("SQLite persistent storage: %s", persistent_data_dir / "school.db")

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Add engine options here to prevent Vercel connection exhaustion
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

if os.environ.get("VERCEL") and not database_url:
    raise RuntimeError("DATABASE_URL must be configured on Vercel")
if os.environ.get("VERCEL") and not os.environ.get("SECRET_KEY"):
    raise RuntimeError("SECRET_KEY must be configured on Vercel")
db.init_app(app)

from models import (
    User, Profile, ProfileAppearance, AuthCode, Event, EventChange,
    Registration, SecurityCounter, EventImage, Comment,
)

app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.environ.get("APP_ENV") == "production")
if os.environ.get("APP_ENV") == "production" and not os.environ.get("SECRET_KEY"):
    raise RuntimeError("Set SECRET_KEY in production")
UPLOAD_FOLDER = os.path.abspath(os.environ.get("UPLOAD_FOLDER", os.path.join(str(persistent_data_dir) if persistent_data_dir else app.instance_path, "uploads")))
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
# Shared application helpers
ALLOWED_DOMAINS = (
    "@student.letovo.ru",
    "@letovo.ru"
)

CODE_LIFETIME_MINUTES = 10


def normalize_email(email):
    return str(email or "").strip().lower()


def valid_letovo_email(email):
    return len(email) <= 150 and bool(re.fullmatch(r"[a-z0-9.!#$%&\'*+/=?^_`{|}~-]+@(student\.letovo\.ru|letovo\.ru)", email))


def ensure_admin():
    configured_emails = os.environ.get("ADMIN_EMAILS", "")
    if not configured_emails.strip():
        configured_emails = ADMIN_EMAIL

    emails = {
        normalize_email(email)
        for email in configured_emails.split(",")
        if email.strip()
    }

    for email in emails:
        if not valid_letovo_email(email):
            raise RuntimeError(
                f"У администратора должна быть школьная почта: {email}"
            )

    for email in sorted(emails):
        user = User.query.filter_by(email=email).first()

        if user is None:
            user = User(
                username="Администратор",
                email=email,
                role="admin"
            )
            db.session.add(user)
        else:
            user.role = "admin"

    db.session.commit()


with app.app_context():
    db.create_all()
    ensure_admin()


def create_code():
    return f"{secrets.randbelow(1000000):06d}"


def send_email_code(email, code, purpose):
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    production = os.environ.get("APP_ENV") == "production" or bool(os.environ.get("VERCEL"))
    mode = os.environ.get("MAIL_MODE")
    if mode is None:
        mode = "smtp" if production or smtp_host or smtp_user or smtp_password else "console"
    if mode == "console":
        if production:
            raise RuntimeError("Console mail is disabled in production")
        print(f"[LETOMEET DEV] Code for {email}: {code}", flush=True)
        return True
    if mode != "smtp" or not smtp_host or not smtp_user or not smtp_password:
        raise RuntimeError("SMTP is not configured; use MAIL_MODE=console for local testing")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    email_from = os.environ.get("EMAIL_FROM") or smtp_user

    message = EmailMessage()

    message["Subject"] = (
        "Код для LETOMEET"
        if purpose == "login"
        else "Код регистрации в LETOMEET"
    )

    message["From"] = email_from
    message["To"] = email

    message.set_content(
        f"""Здравствуйте!

    Ваш код для LETOMEET: {code}

    Код действует {CODE_LIFETIME_MINUTES} минут.

    Если вы не запрашивали этот код, просто проигнорируйте это письмо.

    LETOMEET
    """
    )

    html = f"""
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>

    <body style="
        margin: 0;
        padding: 0;
        background-color: #f5f5f5;
        font-family: Arial, Helvetica, sans-serif;
    ">

        <div style="
            max-width: 560px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid #e5e5e5;
        ">

            <div style="
                padding: 28px 32px;
                border-bottom: 1px solid #eeeeee;
            ">
                <div style="
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                ">
                    LETOMEET
                </div>
            </div>

            <div style="
                padding: 40px 32px;
                text-align: center;
            ">

                <h1 style="
                    margin: 0 0 12px;
                    font-size: 24px;
                    color: #222222;
                ">
                    Код подтверждения
                </h1>

                <p style="
                    margin: 0 0 28px;
                    font-size: 15px;
                    line-height: 1.5;
                    color: #666666;
                ">
                    Используйте этот код для продолжения работы с LETOMEET.
                </p>

                <div style="
                    display: inline-block;
                    padding: 16px 28px;
                    background: #f7f3df;
                    border-radius: 12px;
                    font-size: 32px;
                    font-weight: 700;
                    letter-spacing: 6px;
                    color: #222222;
                ">
                    {code}
                </div>

                <p style="
                    margin: 24px 0 0;
                    font-size: 14px;
                    color: #777777;
                ">
                    Код действует {CODE_LIFETIME_MINUTES} минут.
                </p>

            </div>

            <div style="
                padding: 24px 32px;
                background: #fafafa;
                border-top: 1px solid #eeeeee;
                font-size: 13px;
                line-height: 1.5;
                color: #888888;
            ">
                Если вы не запрашивали этот код, просто проигнорируйте это письмо.
                <br><br>
                LETOMEET — каталог событий школы.
            </div>

        </div>

    </body>
    </html>
    """

    message.add_alternative(html, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)

    return True


def current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    return db.session.get(User, user_id)


def admin_required():
    user = current_user()

    if not user:
        return None, (
            jsonify({"error": "Необходимо войти"}),
            401
        )

    if user.role != "admin":
        return None, (
            jsonify({"error": "Доступ запрещён"}),
            403
        )

    return user, None

FILTER_GROUPS = [
    {
        "key": "activity",
        "label": "Род деятельности",
        "options": ["Компьютерные игры", "Настольные игры", "Рисование", "Прогулка", "Спорт", "Просмотр", "Разговоры", "Музыка"],
    },
    {
        "key": "type",
        "label": "Тип события",
        "options": ["Просто сбор", "Турнир", "Клуб"],
    },
    {
        "key": "duration",
        "label": "Длительность",
        "options": ["До 20 минут", "Менее часа", "Около часа", "Пара часов", "Более 5 часов"],
    },
    {
        "key": "place",
        "label": "Место",
        "options": ["Дом пансиона", "Блок Science", "Учебный блок 2 этажа", "Блок Arts", "Фикусная", "Желтые диваны", "Синие диваны", "Учебный блок 3 этажа", "Главная сцена", "Малая сцена", "Блок иностранных языков", "Большой академ", "Улица", "Ресепшен", "Библиотека"]
    },
]

# Nested locations share the existing place field; no database migration needed.
BOARDING_HOUSES = [1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
OUTDOOR_PLACES = ["На стадионе", "Корты для тенниса", "Спортплощадка у стадиона",
    "Амфитеатр", "Перекрёсток у амфитеатра", "Кострище", "Корт у 8, 7 и 9, 10 дома",
    "Спортплощадка за хабом", "Качели за хабом", "Качели перед хабом"]
PLACE_GROUP = next(group for group in FILTER_GROUPS if group["key"] == "place")
PLACE_GROUP["children"] = [
    {"label": "Дома бординга", "value": "Дом пансиона", "children": [
        {"label": f"{number} дом", "value": f"Дом пансиона · {number} дом", "children": [
            {"label": lounge, "value": f"Дом пансиона · {number} дом · {lounge}"}
            for lounge in ["Гостиная первого этажа", "Гостиная второго этажа"]]}
        for number in BOARDING_HOUSES]},
    {"label": "Улица", "value": "Улица", "children": [
        {"label": name, "value": f"Улица · {name}"} for name in OUTDOOR_PLACES]}
]

def location_values(nodes):
    for node in nodes:
        yield node["value"]
        yield from location_values(node.get("children", []))

PLACE_GROUP["options"] = list(dict.fromkeys(PLACE_GROUP["options"] + list(location_values(PLACE_GROUP["children"]))))

def filter_events(query_base, args):
    """Server-side filtering translated to SQL queries."""
    for group in FILTER_GROUPS:
        selected = args.getlist(group["key"])
        if selected:
            column = getattr(Event, group["key"])
            if group["key"] == "place":
                from sqlalchemy import or_
                query_base = query_base.filter(or_(*[
                    or_(column == value, column.startswith(value + " · ", autoescape=True))
                    for value in selected]))
            else:
                query_base = query_base.filter(column.in_(selected))

    date_from = args.get("from", "")
    date_to = args.get("to", "")

    if date_from:
        query_base = query_base.filter(Event.date >= date_from)
    if date_to:
        query_base = query_base.filter(Event.date <= date_to)

    return query_base.order_by(Event.date, Event.time).all()


def school_today():
    return datetime.now(timezone(timedelta(hours=3))).date()


def maintain_events(today=None):
    """Advance weekly events, archive yesterday's events and retain four archive days."""
    today = today or school_today()
    today_text = today.isoformat()
    # Bring existing active events into line with automatic creator participation.
    missing = Event.query.filter(Event.creator_id.isnot(None), Event.status.in_(["approved", "pending", "revision"]),
        ~db.session.query(Registration.id).filter(Registration.event_id == Event.id, Registration.user_id == Event.creator_id).exists()).all()
    for candidate in missing:
        event = Event.query.filter_by(id=candidate.id).with_for_update().first()
        if event and not Registration.query.filter_by(event_id=event.id, user_id=event.creator_id).first():
            db.session.add(Registration(user_id=event.creator_id,event_id=event.id))
            event.count += 1
    expired = Event.query.filter(Event.date < today_text, Event.status != "past").all()
    for event in expired:
        if event.regular and event.status in {"approved", "pending", "revision"}:
            try:
                previous = datetime.strptime(event.date, "%Y-%m-%d").date()
                weeks = ((today - previous).days + 6) // 7
                event.date = (previous + timedelta(weeks=weeks)).isoformat()
            except ValueError:
                event.status = "past"
        else:
            event.status = "past"
    archived_ids = [event.id for event in expired if event.status == "past"]
    if archived_ids:
        EventChange.query.filter(EventChange.event_id.in_(archived_ids)).delete(synchronize_session=False)
    archived_count = len(archived_ids)
    db.session.flush()
    cutoff = (today - timedelta(days=4)).isoformat()
    old_ids = [row.id for row in Event.query.filter(Event.status == "past", Event.date < cutoff).all()]
    if old_ids:
        EventChange.query.filter(EventChange.event_id.in_(old_ids)).delete(synchronize_session=False)
        Comment.query.filter(Comment.event_id.in_(old_ids)).delete(synchronize_session=False)
        Registration.query.filter(Registration.event_id.in_(old_ids)).delete(synchronize_session=False)
        Event.query.filter(Event.id.in_(old_ids)).delete(synchronize_session=False)
    db.session.commit()
    return {"archived": archived_count, "deleted": len(old_ids)}


@app.cli.command("maintain-events")
def maintain_events_command():
    """Run daily from an external scheduler, including when the website has no traffic."""
    print(maintain_events())


@app.before_request
def protect_requests():
    g.pop("send_reservation", None)
    if request.path.startswith("/api/") and request.path != "/api/maintenance/events":
        maintain_events()
    if request.is_json and not isinstance(request.get_json(silent=True), dict):
        return jsonify(error="Ожидается JSON-объект с полями формы"), 400
    if session.get("user_id") and not current_user():
        session.clear()

    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("Origin")
        public_url = os.environ.get("PUBLIC_BASE_URL", "").strip()
        expected_origin = (
            public_url.rstrip("/")
            if public_url
            else request.host_url.rstrip("/")
        )
        
        if origin and origin != expected_origin:
            return jsonify(error="Недопустимый источник запроса"), 403
    if request.path.startswith("/api/auth/") and request.method == "POST" and request.path.endswith(("/request", "/verify")):
        data = request.get_json(silent=True) or {}
        email = normalize_email(data.get("email"))
        verify = request.path.endswith("/verify")
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        keys = [("ip:" + str(request.remote_addr), 50, 600),
                (("verify:" if verify else "send:") + email, 5 if verify else 1, 600 if verify else 10)]
        for key, limit, seconds in keys:
            if not db.session.get(SecurityCounter, key):
                try:
                    with db.session.begin_nested():
                        db.session.add(SecurityCounter(key=key, count=0, reset=now + timedelta(seconds=seconds)))
                        db.session.flush()
                except IntegrityError:
                    pass  # Another request created the same counter.
            # Shorten cooldowns left by the old 60-second implementation.
            if key.startswith("send:"):
                SecurityCounter.query.filter(SecurityCounter.key == key, SecurityCounter.reset > now + timedelta(seconds=10)).update(
                    {"reset": now + timedelta(seconds=10)}, synchronize_session=False)
            SecurityCounter.query.filter(SecurityCounter.key == key, SecurityCounter.reset <= now).update(
                {"count": 0, "reset": now + timedelta(seconds=seconds)}, synchronize_session=False)
            changed = SecurityCounter.query.filter(SecurityCounter.key == key, SecurityCounter.count < limit).update(
                {"count": SecurityCounter.count + 1}, synchronize_session=False)
            if not changed:
                db.session.commit()
                counter = db.session.get(SecurityCounter, key, populate_existing=True)
                retry_after = max(1, math.ceil((counter.reset - now).total_seconds()))
                response = jsonify(error=f"Слишком много попыток. Повторите через {retry_after} сек.", retry_after=retry_after)
                response.status_code = 429
                response.headers["Retry-After"] = str(retry_after)
                return response
            if not verify and key.startswith("send:"):
                counter = db.session.get(SecurityCounter, key, populate_existing=True)
                g.send_reservation = (key, counter.reset)
        db.session.commit()

@app.after_request
def api_cache_control(response):
    # Failed deliveries must not consume the mailbox resend cooldown.
    reservation = getattr(g, "send_reservation", None)
    if reservation and response.status_code >= 400:
        db.session.rollback()
        key, reset = reservation
        SecurityCounter.query.filter_by(key=key, reset=reset).delete(synchronize_session=False)
        db.session.commit()
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

@app.errorhandler(HTTPException)
def api_http_error(error):
    if request.path.startswith("/api/"):
        messages = {404: "Запись не найдена или недоступна", 405: "Метод не поддерживается", 400: "Некорректный запрос"}
        return jsonify(error=messages.get(error.code, "Не удалось выполнить запрос")), error.code
    return error

@app.errorhandler(SQLAlchemyError)
def database_error(error):
    db.session.rollback()
    app.logger.error("Database request failed: %s", type(error).__name__)
    return jsonify(error="Не удалось сохранить или загрузить данные. Попробуйте снова позже."), 503

@app.errorhandler(413)
def upload_too_large(error):
    return jsonify(error="Фото должно быть не больше 4 МБ. Попробуйте уменьшить файл."), 413


# -----------------------------
# API
# -----------------------------


EVENT_LIMITS = {
    "title": 150, "summary": 300, "description": 4000, "activity": 100,
    "type": 100, "duration": 50, "place": 100, "room": 100,
    "date": 20, "time": 10, "end": 10, "organizer": 100,
    "chat": 200, "contact": 200, "card_color": 20, "card_emoji": 20, "tagline": 80
}
EVENT_REQUIRED = ("title", "summary", "description", "activity", "type", "duration", "place", "room", "date", "time", "end", "organizer", "contact")


def event_form(data, user_id, existing=None):
    values = {}
    for field, limit in EVENT_LIMITS.items():
        value = data.get(field, getattr(existing, field, "") if existing and field in {"chat", "tagline"} else "")
        if value is None and field not in EVENT_REQUIRED:
            value = ""
        if not isinstance(value, str) or len(value.strip()) > limit:
            return None, (jsonify(error=f"Поле {field}: требуется текст до {limit} символов"), 400)
        values[field] = value.strip()
    if any(not values[field] for field in EVENT_REQUIRED):
        return None, (jsonify(error="Заполните обязательные поля"), 400)
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["date"]):
            raise ValueError()
        datetime.strptime(values["date"], "%Y-%m-%d")
        for key in ("time", "end"):
            if not re.fullmatch(r"\d{2}:\d{2}", values[key]):
                raise ValueError()
            datetime.strptime(values[key], "%H:%M")
        if values["end"] <= values["time"]:
            raise ValueError()
    except ValueError:
        return None, (jsonify(error="Проверьте дату и время. Окончание должно быть позже начала в тот же день."), 400)
    regular = data.get("regular", False)
    if not isinstance(regular, bool):
        return None, (jsonify(error="Некорректное значение повторения"), 400)
    values["regular"] = regular
    values["card_color"] = values["card_color"] or "cream"
    if values["card_color"] not in {"cream", "blue", "green", "lavender", "peach", "pink", "dark"}:
        return None, (jsonify(error="Выберите цвет карточки из списка"), 400)
    raw_contact = values["contact"]
    if raw_contact.startswith("@"):
        if not re.fullmatch(r"@[A-Za-z0-9_]{1,32}", raw_contact):
            return None, (jsonify(error="Проверьте ник Telegram"), 400)
        values["contact"] = "https://t.me/" + raw_contact[1:]
    elif valid_letovo_email(normalize_email(raw_contact)):
        values["contact"] = normalize_email(raw_contact)
    else:
        try:
            url = urlsplit(raw_contact)
            if url.scheme not in {"http", "https"} or not url.netloc or url.username or any(c.isspace() for c in raw_contact):
                raise ValueError()
        except ValueError:
            return None, (jsonify(error="Укажите ник Telegram с @ или школьную почту"), 400)
    if values["chat"]:
        try:
            url = urlsplit(values["chat"])
            if url.scheme not in {"http", "https"} or not url.netloc or url.username or any(c.isspace() for c in values["chat"]):
                raise ValueError()
        except ValueError:
            return None, (jsonify(error="Проверьте ссылку на чат"), 400)
    photo = data.get("image_url", existing.image_url if existing else None) or None
    if photo and not (existing and photo == existing.image_url):
        match = re.fullmatch(r"/media/([a-f0-9]{32})\.jpg", photo) if isinstance(photo, str) else None
        if not match:
            return None, (jsonify(error="Сначала загрузите фото"), 400)
        uploaded = db.session.get(EventImage, match.group(1))
        if not uploaded or uploaded.user_id != user_id:
            return None, (jsonify(error="Это изображение недоступно для вашего аккаунта"), 403)
    values["image_url"] = photo
    return values, None


# Register HTTP endpoints after the application, models, and shared helpers exist.
# Keeping main.py as the application entry point preserves existing deployment commands.
import routes.pages
import routes.events
import routes.registrations
import routes.auth
import routes.profile
import routes.admin
import routes.media

if __name__ == "__main__":
    app.run(host="0.0.0.0",port=5000,debug=False)
