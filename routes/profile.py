"""Profile endpoints."""
from main import *  # Shared application, models, and service helpers

@app.put("/api/me/profile")
def update_profile():
    user = current_user()
    if not user:
        return jsonify(error="Необходимо войти"), 401
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Некорректные данные профиля"), 400
    name = data.get("username")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        return jsonify(error="Имя: от 1 до 80 символов"), 400
    profile = db.session.get(Profile, user.id)
    images = {}
    for field in ("avatar_url", "banner_url"):
        value = data.get(field, getattr(profile, field, None)) or None
        if value:
            match = re.fullmatch(r"/media/([a-f0-9]{32})\.jpg", value) if isinstance(value, str) else None
            photo = db.session.get(EventImage, match.group(1)) if match else None
            if not photo or photo.user_id != user.id:
                return jsonify(error="Сначала загрузите своё изображение"), 400
        images[field] = value
    appearance = db.session.get(ProfileAppearance, user.id)
    colors = {}
    for field in ("avatar_color", "banner_color"):
        value = data.get(field, getattr(appearance, field, None) or "#e3cd86")
        if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            return jsonify(error="Цвет должен быть в формате #RRGGBB"), 400
        colors[field] = value.lower()
    if not appearance:
        appearance = ProfileAppearance(user_id=user.id)
        db.session.add(appearance)
    for field, value in colors.items():
        setattr(appearance, field, value)
    if not profile:
        profile = Profile(user_id=user.id)
        db.session.add(profile)
    user.username = name.strip()
    for field, value in images.items():
        setattr(profile, field, value)
    db.session.commit()
    return jsonify(user=user.to_dict())

@app.get("/api/me/events")
def my_events():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "error": "Необходимо войти в аккаунт"
        }), 401

    events = Event.query.filter_by(
        creator_id=user_id
    ).order_by(
        Event.date,
        Event.time
    ).all()

    return jsonify({
        "events": [event.to_dict(include_changes=True) for event in events]
    })
